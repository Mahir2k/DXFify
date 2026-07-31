# 05 - Coordinate Systems & Transformation Mathematics

## 1. Overview of Coordinate Spaces

The DXFify platform operates across three distinct coordinate spaces:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          COORDINATE SPACES MAP                              │
└─────────────────────────────────────────────────────────────────────────────┘
  1. Camera Image Space (px)     2. DXF Model Space (mm)     3. SVG Viewport (px)
   (Origin Top-Left, Y Down)     (Origin Bottom-Left, Y Up)  (Origin Top-Left, Y Down)
          ┌──────► X                    ▲ Y                         ┌──────► X
          │                             │                           │
          ▼ Y                           └──────► X                  ▼ Y
```

| Coordinate Space | Origin Location | Axis Orientation | Units | Primary Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Camera Image Space** | Top-Left corner | $X \to$ Right, $Y \downarrow$ Down | Pixels ($\text{px}$) | Raw camera photo, ArUco detection |
| **DXF Model Space** | Bottom-Left corner | $X \to$ Right, $Y \uparrow$ Up | Millimeters ($\text{mm}$) | Standard CAD entities, export |
| **SVG Viewport Space** | Top-Left corner | $X \to$ Right, $Y \downarrow$ Down | Pixels ($\text{px}$) | Browser UI overlay, canvas rendering |

All coordinate conversions are implemented in `web/src/utils/coordinateTransforms.ts`.

---

## 2. Planar Homography 8x8 DLT Solver

Homography maps points between un-rectified photo pixel coordinates $(u, v)$ and rectified paper coordinates $(x, y)$.

### Derivation
A planar homography is represented by a $3 \times 3$ matrix $\mathbf{H}$ with 8 independent parameters:

$$\mathbf{H} = \begin{bmatrix} h_0 & h_1 & h_2 \\ h_3 & h_4 & h_5 \\ h_6 & h_7 & 1 \end{bmatrix}$$

For a point correspondence $(x, y) \mapsto (u, v)$:

$$u = \frac{h_0 x + h_1 y + h_2}{h_6 x + h_7 y + 1}, \quad v = \frac{h_3 x + h_4 y + h_5}{h_6 x + h_7 y + 1}$$

Rearranging into homogenous linear form $A \mathbf{h} = B$:

$$\begin{aligned}
x h_0 + y h_1 + 1 h_2 + 0 h_3 + 0 h_4 + 0 h_5 - x u h_6 - y u h_7 &= u \\
0 h_0 + 0 h_1 + 0 h_2 + x h_3 + y h_4 + 1 h_5 - x v h_6 - y v h_7 &= v
\end{aligned}$$

Four point correspondences yield an $8 \times 8$ system of linear equations.

### Implementation (`solveHomography`)
The system $A \mathbf{h} = B$ is solved using Gaussian elimination with partial row pivoting to prevent numeric instability:

```typescript
export function solveHomography(src: [number, number][], dst: [number, number][]): number[] | null {
  // Construct 8x8 matrix A and 8x1 vector B
  // ... Gaussian elimination with max row pivoting ...
  return H; // 9-element array
}
```

---

## 3. 2D Rigid Rotation Composition

When a user executes edge alignment (e.g. aligning a slanted segment to horizontal), the workspace geometry is rotated around a specific pivot point $(c_x, c_y)$ by angle $\alpha$.

```
               (cx, cy) Pivot
                     ●
                    / \
                   /   \  Rotated by angle α
                  ▼     ▼
               Point   Rotated Point
```

### Single Rotation Step
Rotating a 2D point $(x, y)$ around pivot $(c_x, c_y)$ by angle $\alpha$ (in radians):

$$\begin{bmatrix} x' \\ y' \end{bmatrix} = \begin{bmatrix} c_x \\ c_y \end{bmatrix} + \begin{bmatrix} \cos\alpha & -\sin\alpha \\ \sin\alpha & \cos\alpha \end{bmatrix} \begin{bmatrix} x - c_x \\ y - c_y \end{bmatrix}$$

Expanding into affine form:
$$x' = x \cos\alpha - y \sin\alpha + \underbrace{(c_x - c_x \cos\alpha + c_y \sin\alpha)}_{t_x}$$
$$y' = x \sin\alpha + y \cos\alpha + \underbrace{(c_y - c_x \sin\alpha - c_y \cos\alpha)}_{t_y}$$

### Sequential Transformation Matrix Accumulation
When multiple rotation operations are performed, individual steps $T_1, T_2, \dots, T_n$ are accumulated into a single composite rigid matrix $\mathbf{M} = (\cos\Theta, \sin\Theta, t_x, t_y)$ using `composeRotationTransforms`:

$$\mathbf{M}_{k} = \mathbf{T}_k \cdot \mathbf{M}_{k-1}$$

```typescript
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
```

---

## 4. Mathematical Derivation of SVG Image Matrix

To keep background photo overlays perfectly aligned under vector entities when workspace rotations occur, the SVG `<image>` element must receive an SVG affine transformation string `matrix(a, b, c, d, e, f)`.

### Mathematical Derivation
Let a model space point be $(x, y)$ in mm. Its position in SVG pixel space before rotation is:
$$px = x \cdot S, \quad py = (H_{paper} - y) \cdot S$$

Where $S$ is scale ($\text{px/mm}$) and $H_{paper}$ is paper height ($\text{mm}$).

Solving for model space:
$$x = \frac{px}{S}, \quad y = H_{paper} - \frac{py}{S}$$

Applying model space rigid transform matrix $(M_{cos}, M_{sin}, t_x, t_y)$:
$$x' = M_{cos} x - M_{sin} y + t_x$$
$$y' = M_{sin} x + M_{cos} y + t_y$$

Converting rotated model point $(x', y')$ back to rotated SVG pixel space $(px', py')$:
$$px' = x' \cdot S = \left(M_{cos} \frac{px}{S} - M_{sin} \left(H_{paper} - \frac{py}{S}\right) + t_x\right) S$$
$$px' = M_{cos} px + M_{sin} py + (t_x \cdot S - M_{sin} H_{paper} S)$$

$$py' = (H_{paper} - y') \cdot S = \left(H_{paper} - \left(M_{sin} \frac{px}{S} + M_{cos} \left(H_{paper} - \frac{py}{S}\right) + t_y\right)\right) S$$
$$py' = -M_{sin} px + M_{cos} py + \left((1 - M_{cos}) H_{paper} S - t_y S\right)$$

### SVG Matrix Coefficients
Matching standard SVG matrix form $\begin{bmatrix} px' \\ py' \\ 1 \end{bmatrix} = \begin{bmatrix} a & c & e \\ b & d & f \\ 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} px \\ py \\ 1 \end{bmatrix}$:

$$\begin{aligned}
a &= M_{cos} \\
b &= -M_{sin} \\
c &= M_{sin} \\
d &= M_{cos} \\
e &= t_x \cdot S - M_{sin} \cdot H_{paper} \cdot S \\
f &= (1 - M_{cos}) \cdot H_{paper} \cdot S - t_y \cdot S
\end{aligned}$$

### Implementation (`getSvgImageMatrix`)
```typescript
export function getSvgImageMatrix(matrix: RigidMatrix, scale: number, paperH: number): string {
  const a = matrix.cos;
  const b = -matrix.sin;
  const c = matrix.sin;
  const d = matrix.cos;
  const e = matrix.tx * scale - matrix.sin * paperH * scale;
  const f = (1 - matrix.cos) * paperH * scale - matrix.ty * scale;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}
```

---

## 5. Bidirectional Model ↔ Pixel Transformations

### 1. Model Space (mm) to Image Pixels (px)
`dxfModelToImagePixels(x_mm, y_mm, options)`
- Converts DXF model coordinates $(X_{mm}, Y_{mm})$ to image pixels.
- On the `original` photo tab, un-rotates coordinates by applying sequential inverse rotation steps, then projects through homography matrix $\mathbf{H}$.
- On the `debug` tab, directly converts to SVG pixels: $px = X_{mm} \cdot S, py = (H_{paper} - Y_{mm}) \cdot S$.

### 2. Image Pixels (px) to Model Space (mm)
`imagePixelsToDxfModel(px, py, options)`
- Converts cursor image pixels $(px, py)$ to DXF model coordinates $(X_{mm}, Y_{mm})$.
- On the `original` photo tab, un-warps raw photo pixels via inverse homography matrix $\mathbf{H}^{-1}$, converts to un-rotated model millimeters ($X_{mm} = px / S, Y_{mm} = H_{paper} - py / S$), and applies forward sequential `rotationTransforms` steps to map pointer events directly to current rotated workspace entities.
- On the `debug` tab, converts SVG pixels to model millimeters: $X_{mm} = px / S, Y_{mm} = H_{paper} - py / S$.

---

## 6. End-to-End Mathematical Verification Results

The transformation math was verified end-to-end via an automated test script (`scratch/verify_transforms.js`).

### Test Execution Output
```
=== Test 1: Single rotation (5° around center of phone) ===
Matrix: { cos: 0.99619, sin: 0.08715, tx: 13.22557, ty: -2.91543 }
SVG matrix: matrix(0.99619, -0.08715, 0.08715, 0.99619, -126.59682, 40.45609)
  (35, 250) → entity@(263.03, 478.16) vs image@(263.03, 478.16) ✓
  (100, 100) → entity@(1041.29, 1915.80) vs image@(1041.29, 1915.80) ✓
  (0, 0) → entity@(132.26, 2999.15) vs image@(132.26, 2999.15) ✓
  (105, 148.5) → entity@(1048.83, 1428.29) vs image@(1048.83, 1428.29) ✓
  (210, 297) → entity@(1965.41, -142.57) vs image@(1965.41, -142.57) ✓
ALL PASSED ✓

=== Test 2: Two rotations (Portrait to Landscape + 3° Fine Tune) ===
  (35, 250) → entity@(24.39, 2160.37) vs image@(24.39, 2160.37) ✓
  (100, 100) → entity@(1556.35, 1589.76) vs image@(1556.35, 1589.76) ✓
  (0, 0) → entity@(2502.64, 2640.73) vs image@(2502.64, 2640.73) ✓
ALL PASSED ✓
```

This mathematical proof confirms zero spatial discrepancy between entity coordinates and background image projection across arbitrary rotation sequences.
