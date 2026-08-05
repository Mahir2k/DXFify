# 06 - Interactive CAD Editing Tools Specification

## 1. Toolset Overview

The interactive CAD editor in `web/src/components/DxfPreview.tsx` provides **25 specialized CAD tools** organized into four functional groups:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CAD TOOL STRIP (25)                           │
├─────────────────┬─────────────────┬─────────────────┬───────────────────┤
│ 1. SELECTION &  │ 2. PRIMITIVE    │ 3. GEOMETRY     │ 4. UTILITY &      │
│    INSPECTION   │    CREATION     │    MODIFICATION │    EXPORT         │
├─────────────────┼─────────────────┼─────────────────┼───────────────────┤
│ • Select        │ • Line          │ • Chamfer       │ • Sub-Region      │
│ • Snap          │ • Arc (3-Point) │ • Fillet        │ • Mark Hole       │
│ • Measure       │ • Polyline      │ • Add Point     │ • Delete          │
│ • Brush         │ • Spline        │ • Delete Point  │ • Undo / Redo     │
│ • Align         │ • Rectangle     │ • Cut Polyline  │ • DXF / SVG / PDF │
│                 │ • Circle        │ • Fuse Points   │                   │
│                 │ • Slot (4-Point)│                 │                   │
│                 │ • Centerlines   │                 │                   │
└─────────────────┴─────────────────┴─────────────────┴───────────────────┘
```

---

## 2. Detailed Tool Specifications

### Group 1: Selection, Inspection & Alignment

#### 1. `select` (Node Edit & Marquee Selection)
- **Node Editing**: Allows clicking and dragging individual polyline vertex nodes, circle center points, and circle radius handles.
- **Marquee Selection**: Dragging a box across empty space selects all enclosed entities and displays a 2D bounding box transform widget.
- **Bounding Box Transform Widget**:
  - **Translate**: Dragging inside the box translates entities $(\Delta x, \Delta y)$.
  - **Scale**: Dragging corner handles resizes entities proportionally (holding `Shift` constrains aspect ratio).
  - **Rotate**: Dragging top rotation handle rotates selected entities around bounding box center.
- **Canvas Panning**: Dragging unselected space pans the CAD viewport.

#### 2. `snap` (Object Snapping)
- Automatically detects and highlights the nearest polyline vertex or line segment within $15\text{ mm}$ snapping radius.
- **Point-to-Segment Distance Mathematics**:
  For a point $P_0(x_0, y_0)$ and segment $P_1(x_1, y_1) \to P_2(x_2, y_2)$, project $P_0$ onto the infinite line via parameter $t$:
  $$t = \text{clamp}\left( \frac{(x_0 - x_1)(x_2 - x_1) + (y_0 - y_1)(y_2 - y_1)}{(x_2 - x_1)^2 + (y_2 - y_1)^2}, \; 0, \; 1 \right)$$
  $$\text{proj}_x = x_1 + t(x_2 - x_1), \quad \text{proj}_y = y_1 + t(y_2 - y_1)$$
  $$d_{seg} = \sqrt{(x_0 - \text{proj}_x)^2 + (y_0 - \text{proj}_y)^2}$$

#### 3. `measure` (Interactive Distance Tape)
- 2-click measuring tape calculating Euclidean distance in millimeters between two points:
  $$d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$
- Displays a dashed measurement line with a dynamic floating distance label.

#### 4. `brush` (Proportional Deformation Brush)
- Interactive radial deformation brush that repels polyline vertices and circle centers outward to the brush boundary.
- **Brush Metric Options**:
  - `Ball` (Euclidean $L_2$ metric): $d = \sqrt{(v_x - c_x)^2 + (v_y - c_y)^2}$
  - `Cube` (Chebyshev $L_\infty$ metric): $d = \max(|v_x - c_x|, |v_y - c_y|)$
- **Deformation Mathematics**:
  If $d < R$, the node is pushed outward along unit displacement vector $\mathbf{u} = \frac{\mathbf{v} - \mathbf{c}}{d}$:
  $$\mathbf{v}' = \mathbf{c} + R \cdot \mathbf{u}$$

```
                Brush Radius R
               ┌──────────────┐
               │    Node v    │
               │      ●       │
               │       \      │
               │        ▼ v'  │
               │        ●     │
               └──────────────┘
```

#### 5. `align` (Edge Alignment & Workspace Rotation)
- Selects a reference line segment $(P_1, P_2)$ and computes its current inclination angle $\theta = \text{atan2}(y_2 - y_1, x_2 - x_1)$.
- Computes target orientation angle (horizontal: $0^\circ$ or $180^\circ$, vertical: $90^\circ$ or $-90^\circ$).
- Rotates all workspace entities by $\alpha = \theta_{target} - \theta$ around segment midpoint $(c_x, c_y)$, appending a rotation step to `rotationTransforms` for automatic background photo alignment.

#### 6. `subregion-select` (Selective Re-Vectorization)
- Drags a rectangular bounding box $[x_{min}, y_{min}, x_{max}, y_{max}]$ across a region of interest.
- Triggers a sub-region modal allowing the user to re-process only the selected area using alternative curve strategies (e.g. Pratt circle fitting, B-splines, RANSAC fillets) via `/api/convert-region`.

---

### Group 2: Primitive Creation Tools

#### 7. `line` (2-Point Segment)
- 2-click tool drawing a straight `LWPOLYLINE` segment between $P_1$ and $P_2$.

#### 8. `arc` (3-Point Arc)
- 3-click tool creating a quadratic Bézier curve arc passing through start point $P_1$, control point $P_{ctrl}$, and end point $P_2$.

#### 9. `polyline` (Multi-Vertex Path)
- Multi-click tool placing sequential polyline vertices.
- **Close Option**: Double-clicking or clicking near start vertex closes polyline (`closed = true`).

#### 10. `spline` (Centripetal Catmull-Rom B-Spline)
- Multi-click tool generating a smooth parametric spline curve through control points using **Centripetal Catmull-Rom Splines** ($\alpha = 0.5$, `evaluateSplinePoints`):
  Knot parameters $t_i$ are calculated using square-root chord distances to prevent overshoots and loops:
  $$t_i = t_{i-1} + \|P_i - P_{i-1}\|^{0.5}$$
  Interpolation evaluates piecewise cubic polynomials:
  $$\mathbf{P}(t) = \frac{t_2 - t}{t_2 - t_1}\mathbf{A}_1(t) + \frac{t - t_1}{t_2 - t_1}\mathbf{A}_2(t)$$
  guaranteeing a cusp-free, loop-free, and spike-free curve across arbitrary control point spacing.

#### 11. `rect-3pt` (3-Point Angled Rectangle)
- 3-click tool creating an arbitrarily oriented rectangle defined by base segment $P_1 \to P_2$ and height vector $P_3$.

#### 12. `circle-3pt` (3-Point Circumcircle)
- 3-click tool fitting a CAD `CIRCLE` entity passing through three points $P_1(x_1, y_1), P_2(x_2, y_2), P_3(x_3, y_3)$ by solving perpendicular bisector determinants (`computeCircumcircle`):
  $$D = 2 \left[ x_1(y_2 - y_3) + x_2(y_3 - y_1) + x_3(y_1 - y_2) \right]$$
  $$c_x = \frac{1}{D} \left[ (x_1^2 + y_1^2)(y_2 - y_3) + (x_2^2 + y_2^2)(y_3 - y_1) + (x_3^2 + y_3^2)(y_1 - y_2) \right]$$
  $$c_y = \frac{1}{D} \left[ (x_1^2 + y_1^2)(x_3 - x_2) + (x_2^2 + y_2^2)(x_1 - x_3) + (x_3^2 + y_3^2)(x_2 - x_1) \right]$$
  $$\text{Radius } r = \sqrt{(x_1 - c_x)^2 + (y_1 - c_y)^2}$$

#### 13. `slot-4pt` (4-Point Rounded Slot)
- 4-click tool creating a stadium/slot shape defined by center axis $P_1 \to P_2$, width point $P_3$, and end cap arc radius.

#### 14. `centerline` (Universal Geometry Centerlines)
- Universal centerline generator for all CAD entity types (`CIRCLE`, 2-point `LINE`, `RECTANGLE`, `SLOT`, `POLYGON`, and complex polylines).
- **Mathematical Formulations**:
  - **Circles**: Given center $(c_x, c_y)$ and radius $r$, appends two orthogonal crosshair lines extending $125\%$ beyond the radius:
    $$P_{horiz} = \left[ (c_x - 1.25r, c_y), \; (c_x + 1.25r, c_y) \right]$$
    $$P_{vert} = \left[ (c_x, c_y - 1.25r), \; (c_x, c_y + 1.25r) \right]$$

  - **2-Point Line Segments ($P_1 \to P_2$)**:
    Computes segment midpoint $\mathbf{M} = \frac{P_1 + P_2}{2}$, length $L = \|P_2 - P_1\|$, unit direction $\mathbf{u} = \frac{P_2 - P_1}{L}$, and unit normal $\mathbf{n} = (-u_y, u_x)$.
    Appends an axial centerline extending $25\%$ past both endpoints and a perpendicular crosshairs line through $\mathbf{M}$:
    $$P_{axial} = \left[ \mathbf{M} - 1.25\frac{L}{2}\mathbf{u}, \; \mathbf{M} + 1.25\frac{L}{2}\mathbf{u} \right]$$
    $$P_{perp} = \left[ \mathbf{M} - \max(3.0, 0.25L)\mathbf{n}, \; \mathbf{M} + \max(3.0, 0.25L)\mathbf{n} \right]$$

  - **General Polylines, Rectangles & Slots**:
    Computes bounding box $[x_{min}, x_{max}] \times [y_{min}, y_{max}]$, center point $(c_x, c_y) = \left( \frac{x_{min}+x_{max}}{2}, \frac{y_{min}+y_{max}}{2} \right)$, width $w = x_{max} - x_{min}$, and height $h = y_{max} - y_{min}$.
    Generates horizontal and vertical centerlines extending $125\%$ beyond bounding box bounds:
    $$dx = \max\left(3.0, \; 1.25 \frac{w}{2}\right), \quad dy = \max\left(3.0, \; 1.25 \frac{h}{2}\right)$$
    $$P_{horiz} = \left[ (c_x - dx, c_y), \; (c_x + dx, c_y) \right]$$
    $$P_{vert} = \left[ (c_x - dy, c_y), \; (c_x + dy, c_y) \right]$$

---

### Group 3: Modification & Editing Tools

#### 15. `chamfer` (2-Point Beveled Corner)
- 2-click tool replacing a corner section between point $P_1$ (segment $\text{seg}_1$) and point $P_2$ (segment $\text{seg}_2$) with a straight bevel segment $[P_{start}, P_{end}]$.
- **Segment-Bounded Trimming**: Orders selection points by segment index ($\text{minSeg} = \min(\text{seg}_1, \text{seg}_2)$) and constructs the trimmed polyline:
  $$\text{newPts} = \left[ \; \mathbf{pts}[0 \dots \text{minSeg}], \quad P_{start}, \quad P_{end}, \quad \mathbf{pts}[(\text{maxSeg} + 1) \dots n-1] \; \right]$$
  preserving outer endpoints regardless of selection order.

#### 16. `fillet` (2-Point Inward Bézier Arc Fillet)
- 2-click tool rounding a polyline corner between point $P_1$ and point $P_2$.
- **Corner Detection & Bézier Fillet Mathematics**:
  Finds the sharp corner vertex $C_{corner}$ across range $[\text{minSeg} + 1, \text{maxSeg}]$ maximizing perpendicular distance to line segment $(P_{start}, P_{end})$.
  Evaluates a 16-point quadratic Bézier curve:
  $$B(t) = (1-t)^2 P_{start} + 2(1-t)t C_{corner} + t^2 P_{end}, \quad t \in [0, 1]$$
  guaranteeing an smooth, inward-curving corner arc.

#### 17. `add-point` (Vertex Insertion)
- Clicking an existing polyline segment inserts a new vertex node at the closest projected segment point.

#### 18. `delete-point` (Vertex Removal)
- Clicking a polyline vertex node deletes it, bridging adjacent vertices $V_{i-1}$ and $V_{i+1}$.

#### 19. `cut` (Polyline Splitting)
- Splits a polyline at a designated vertex into two distinct polyline entities.

#### 20. `fuse` (2-Point Polyline Endpoint Fusion)
- 2-click tool merging two close endpoints or separate polyline entities into a single continuous entity in workspace memory (`applyFuseTwoPoints`).

#### 21. `mark-hole` (Layer Toggle)
- Toggles target entity layer between **`OUTER`** (Color 7 / White) and **`HOLES`** (Color 1 / Red).

#### 22. `delete` (Entity Eraser)
- Erases target entity under cursor.

---

### Group 4: Utility & Keyboard Shortcuts

#### Keyboard Shortcuts Summary (`TopBar.tsx` & `App.tsx`)

| Shortcut | Action | Shortcut | Action |
| :--- | :--- | :--- | :--- |
| `Ctrl + O` | Open image upload dialog | `Shift + Scroll` | Resize deformation brush radius |
| `Ctrl + Enter` | Run initial conversion job | `1` | Select Tool (`select`) |
| `Ctrl + S` | Download output DXF file | `2` | Line Tool (`line`) |
| `Ctrl + Z` | Undo last CAD edit | `3` | Polyline Tool (`polyline`) |
| `Ctrl + Y` | Redo last CAD edit | `4` | Circle Tool (`circle-3pt`) |
| `G` | Toggle workspace background grid | `Delete` / `Backspace` | Delete selected entities |
| `V` | Switch to DXF Preview tab | `Esc` | Cancel active drawing operation |
| `Tab` | Toggle between DXF & Image tab | `Space + Drag` | Pan CAD viewport |
