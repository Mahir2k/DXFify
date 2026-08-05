# WebGL Canvas Renderer & Physical Brush Mechanics

This document details dual viewport canvas rendering (`web/src/components/DxfPreview.tsx`), 2D rigid transformation matrix math, SVG pointer capture, and physical deformation brush mechanics.

---

## 1. Dual Viewport Synchronization (`DxfPreview.tsx` & `ImagePreview.tsx`)

The UI displays two side-by-side inspection viewports:
- **Left Panel (`ImagePreview.tsx`)**: Displays the raw/rectified photograph with vector overlay.
- **Right Panel (`DxfPreview.tsx`)**: Displays the interactive CAD vector canvas.

```
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Left Panel: ImagePreview.tsx        │  │ Right Panel: DxfPreview.tsx          │
│ (Raw Photo + Vector Overlay)         │  │ (Interactive Vector CAD Editor)      │
└──────────────────┬───────────────────┘  └──────────────────┬───────────────────┘
                   │                                         │
                   └──────────────────┬──────────────────────┘
                                      │ Synchronized Viewport Matrix
                                      ▼
                   ┌──────────────────────────────────────┐
                   │ Shared Zoom, Pan, Rotation & Pointer │
                   └──────────────────────────────────────┘
```

---

## 2. 2D Rigid Rotation Transformation Math

When the user rotates the workspace (0°, 90°, 180°, 270°), vector coordinates must undergo rigid 2D transformation composition without mutating underlying 1:1 DXF model coordinates.

Given model coordinate $\mathbf{p} = (x, y)^T$ and workspace origin $(X_0, Y_0)^T$:

$$\mathbf{p}' = \mathbf{R}(\theta) (\mathbf{p} - \mathbf{p}_0) + \mathbf{p}_0$$

where 2D rotation matrix $\mathbf{R}(\theta)$ is:

$$\mathbf{R}(\theta) = \begin{bmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{bmatrix}$$

`coordinateTransforms.ts` exports `dxfModelToSvgPixels()` and `svgPixelsToDxfModel()` enforcing forward and inverse matrix transformations across all zoom, pan, and rotation operations.

---

## 3. SVG Pointer Capture & Event Routing

To prevent mouse/touch pointer loss during fast vertex dragging or brush strokes:
- Pointer event listeners (`onPointerDown`, `onPointerMove`, `onPointerUp`) are attached directly to the root `<svg>` container.
- `e.currentTarget.setPointerCapture(e.pointerId)` is invoked on `pointerdown` to lock pointer events to the canvas element until released.

---

## 4. Physical Deformation Brush Mechanics (`🖌`)

The physical deformation brush simulates a rigid geometric object (Ball `●` or Cube `■`) pushing against a flexible polyline contour.

```
         Ball (Circle) Brush                      Cube (Square) Brush
             . - - - .                                ┌───────┐
          .             .                             │       │
         '   Outer Edge  '                            │       │
         '  (Push Limit) '                            │       │
          .             .                             └───────┘
             ' - - - '
```

### Mathematical Formulations

Given cursor location $\mathbf{c} = (x_c, y_c)^T$ and brush radius $R_{brush}$:

1. **Ball (Circle) Mode**:
   For each polyline vertex $\mathbf{v}_i = (x_i, y_i)^T$, calculate distance $d = \|\mathbf{v}_i - \mathbf{c}\|_2$.
   If $d < R_{brush}$, displace vertex outward to brush perimeter:

   $$\mathbf{v}_i' = \mathbf{c} + R_{brush} \cdot \frac{\mathbf{v}_i - \mathbf{c}}{\|\mathbf{v}_i - \mathbf{c}\|_2}$$

2. **Cube (Square) Mode**:
   Given square half-width $W = R_{brush}$, evaluate axis displacements $\Delta x = x_i - x_c$ and $\Delta y = y_i - y_c$.
   If $|\Delta x| < W$ and $|\Delta y| < W$, project vertex to nearest square edge boundary:

   $$\mathbf{v}_i' = \mathbf{c} + \begin{bmatrix} \text{sign}(\Delta x) \cdot W \\ \Delta y \end{bmatrix} \quad \text{if } |\Delta x| > |\Delta y|$$

### Brush Resizing Interaction
- Hold **Shift** + **Mouse Scroll Wheel** to adjust brush radius $R_{brush}$ dynamically.
- Press **B** or **S** on keyboard to toggle between Ball (`●`) and Cube (`■`) brush shapes.
