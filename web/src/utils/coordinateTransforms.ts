/**
 * Represents a discrete 2D rotation step applied to CAD workspace geometry.
 */
export interface RotationStep {
  /** Angle in degrees (positive for counter-clockwise) */
  angle: number;
  /** Center X pivot in millimeters */
  cx: number;
  /** Center Y pivot in millimeters */
  cy: number;
}

/**
 * 2D rigid transformation matrix parameters (rotation + translation).
 */
export interface RigidMatrix {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

/**
 * Options required for bidirectional coordinate space conversion.
 */
export interface TransformOptions {
  scale: number;
  paperH: number;
  selectedTab: string;
  homographyH?: number[] | null;
  homographyH_inv?: number[] | null;
  rotationTransforms?: RotationStep[] | null;
}

/**
 * Solves an 8-DOF perspective homography matrix mapping 4 source points to 4 destination points
 * using Gaussian elimination with partial pivoting.
 *
 * @param src Array of 4 2D source point tuples [x, y]
 * @param dst Array of 4 2D destination point tuples [u, v]
 * @returns 9-element column-major homography matrix array H, or null if singular
 */
export function solveHomography(src: [number, number][], dst: [number, number][]): number[] | null {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    B.push(v);
  }
  for (let i = 0; i < 8; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 8; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [B[i], B[maxRow]] = [B[maxRow], B[i]];
    if (Math.abs(A[i][i]) < 1e-8) return null;
    for (let k = i + 1; k < 8; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < 8; j++) {
        if (i === j) A[k][j] = 0;
        else A[k][j] += c * A[i][j];
      }
      B[k] += c * B[i];
    }
  }
  const H = new Array(9);
  H[8] = 1;
  for (let i = 7; i >= 0; i--) {
    let sum = B[i];
    for (let j = i + 1; j < 8; j++) {
      sum -= A[i][j] * H[j];
    }
    H[i] = sum / A[i][i];
  }
  return H;
}

/**
 * Applies 3x3 homography transformation to point (x, y).
 */
export function transformHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-6) return [x, y];
  const u = (H[0] * x + H[1] * y + H[2]) / w;
  const v = (H[3] * x + H[4] * y + H[5]) / w;
  return [u, v];
}

/**
 * Accumulates a sequence of 2D rotation steps into a single composite 2D rigid matrix (cos, sin, tx, ty).
 */
export function composeRotationTransforms(transforms?: RotationStep[] | null): RigidMatrix {
  let m: RigidMatrix = { cos: 1, sin: 0, tx: 0, ty: 0 };
  if (!transforms) return m;
  for (const t of transforms) {
    const rad = t.angle * (Math.PI / 180);
    const n_cos = Math.cos(rad);
    const n_sin = Math.sin(rad);
    const n_tx = t.cx - t.cx * n_cos + t.cy * n_sin;
    const n_ty = t.cy - t.cx * n_sin - t.cy * n_cos;

    m = {
      cos: n_cos * m.cos - n_sin * m.sin,
      sin: n_sin * m.cos + n_cos * m.sin,
      tx: n_cos * m.tx - n_sin * m.ty + n_tx,
      ty: n_sin * m.tx + n_cos * m.ty + n_ty,
    };
  }
  return m;
}

/**
 * Generates an SVG matrix(a, b, c, d, e, f) transform string for background <image> elements in SVG Y-down space.
 */
export function getSvgImageMatrix(matrix: RigidMatrix, scale: number, paperH: number): string {
  const a = matrix.cos;
  const b = -matrix.sin;
  const c = matrix.sin;
  const d = matrix.cos;
  const e = matrix.tx * scale - matrix.sin * paperH * scale;
  const f = (1 - matrix.cos) * paperH * scale - matrix.ty * scale;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

/**
 * Maps 2D DXF millimeter model coordinates (x_mm, y_mm) to image pixel coordinates.
 */
export function dxfModelToImagePixels(
  x_mm: number,
  y_mm: number,
  opts: TransformOptions,
): [number, number] {
  const { scale, paperH, selectedTab, homographyH_inv, rotationTransforms } = opts;
  let mx = x_mm;
  let my = y_mm;

  if (rotationTransforms && rotationTransforms.length > 0) {
    for (let i = rotationTransforms.length - 1; i >= 0; i--) {
      const t = rotationTransforms[i];
      const rad = -t.angle * (Math.PI / 180);
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const dx = mx - t.cx;
      const dy = my - t.cy;
      mx = t.cx + (dx * c - dy * s);
      my = t.cy + (dx * s + dy * c);
    }
  }

  if (selectedTab === 'original' && homographyH_inv) {
    const workX = mx * scale;
    const workY = (paperH - my) * scale;
    return transformHomography(homographyH_inv, workX, workY);
  }

  return [mx * scale, (paperH - my) * scale];
}

/**
 * Maps image pixel coordinates (px, py) to 2D DXF millimeter model space coordinates.
 */
export function imagePixelsToDxfModel(
  px: number,
  py: number,
  opts: TransformOptions,
): { x: number; y: number } {
  const { scale, paperH, selectedTab, homographyH, rotationTransforms } = opts;

  if (selectedTab === 'original' && homographyH) {
    const [wx, wy] = transformHomography(homographyH, px, py);
    const mx_raw = wx / scale;
    const my_raw = paperH - wy / scale;
    let mx = mx_raw;
    let my = my_raw;
    if (rotationTransforms) {
      for (const t of rotationTransforms) {
        const rad = (t.angle * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const dx = mx - t.cx;
        const dy = my - t.cy;
        mx = t.cx + (dx * c - dy * s);
        my = t.cy + (dx * s + dy * c);
      }
    }
    return { x: mx, y: my };
  }

  let mx = px / scale;
  let my = paperH - py / scale;

  if (rotationTransforms && rotationTransforms.length > 0) {
    for (const t of rotationTransforms) {
      const rad = (t.angle * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const dx = mx - t.cx;
      const dy = my - t.cy;
      mx = t.cx + (dx * c - dy * s);
      my = t.cy + (dx * s + dy * c);
    }
  }

  return { x: mx, y: my };
}
