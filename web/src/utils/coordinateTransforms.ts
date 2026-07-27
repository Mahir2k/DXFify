export interface RotationStep {
  angle: number; // angle in degrees
  cx: number;    // pivot X in mm
  cy: number;    // pivot Y in mm
}

export interface RigidMatrix {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

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

export function transformHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-6) return [x, y];
  const u = (H[0] * x + H[1] * y + H[2]) / w;
  const v = (H[3] * x + H[4] * y + H[5]) / w;
  return [u, v];
}

/**
  Accumulates a sequence of 2D rotation steps into a single composite 2D rigid matrix (cos, sin, tx, ty).
 */
export function composeRotationTransforms(transforms: RotationStep[]): RigidMatrix {
  let m: RigidMatrix = { cos: 1, sin: 0, tx: 0, ty: 0 };
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
  Generates an SVG matrix(a, b, c, d, e, f) transform string for background <image> elements in SVG Y-down space.
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
  Converts an (x, y) mm point from DXF model space into (px, py) image pixel space.
 */
export function dxfModelToImagePixels(
  x_mm: number,
  y_mm: number,
  options: {
    scale: number;
    paperH: number;
    selectedTab: string;
    homographyH: number[] | null;
    rotationTransforms: RotationStep[];
  }
): [number, number] {
  const { scale, paperH, selectedTab, homographyH, rotationTransforms } = options;
  let mx = x_mm;
  let my = y_mm;

  if (selectedTab === 'original' && homographyH) {
    for (let i = rotationTransforms.length - 1; i >= 0; i--) {
      const t = rotationTransforms[i];
      const rad = -t.angle * (Math.PI / 180);
      const dx = mx - t.cx;
      const dy = my - t.cy;
      mx = t.cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      my = t.cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    }
  }

  let px = mx * scale;
  let py = (paperH - my) * scale;

  if (selectedTab === 'original' && homographyH) {
    [px, py] = transformHomography(homographyH, px, py);
  }

  return [px, py];
}

/**
  Converts a (px, py) image pixel coordinate from ImagePreview into (x, y) mm in DXF model space.
 */
export function imagePixelsToDxfModel(
  px_in: number,
  py_in: number,
  options: {
    scale: number;
    paperH: number;
    selectedTab: string;
    homographyH_inv: number[] | null;
    rotationTransforms?: RotationStep[];
  }
): { x: number; y: number } {
  const { scale, paperH, selectedTab, homographyH_inv, rotationTransforms } = options;
  let px = px_in;
  let py = py_in;

  if (selectedTab === 'original' && homographyH_inv) {
    const [unWarpX, unWarpY] = transformHomography(homographyH_inv, px, py);
    px = unWarpX;
    py = unWarpY;
  }

  let mx = px / scale;
  let my = paperH - py / scale;

  if (selectedTab === 'original' && homographyH_inv && rotationTransforms) {
    for (const t of rotationTransforms) {
      const rad = t.angle * (Math.PI / 180);
      const dx = mx - t.cx;
      const dy = my - t.cy;
      mx = t.cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      my = t.cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    }
  }

  return { x: mx, y: my };
}
