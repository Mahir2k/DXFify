# React State & CAD Tools Architecture

This document covers the React application state management (`web/src/App.tsx`), atomized history stack (undo/redo), and technical specifications of all 25+ CAD editing tools.

---

## 1. Application State Architecture (`web/src/App.tsx`)

Global application state is managed centrally in `App.tsx`:

- **`activeEntities`**: Array of current CAD vector entities (polylines, circles, arcs, lines).
- **`historyStack`**: Atomized array of document snapshots for undo operations.
- **`redoStack`**: Snapshot stack for redo operations.
- **`selectedTool`**: Active tool mode (`select`, `brush`, `markHole`, `ruler`, `nodeMove`, `splitPoly`, etc.).
- **`brushShape`**: Physical deformation brush mode (`ball` = circle, `cube` = square).
- **`layerVisibility`**: Boolean toggles for `OUTER`, `HOLES`, and `DETAILS` layers.

### History Atomicity Rule
Every complete user interaction (vertex drag release, brush stroke completion, layer change) pushes a clean immutable clone of `activeEntities` onto `historyStack` and clears `redoStack`. Standard keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`) pop states from `historyStack` and `redoStack`.

---

## 2. Technical Toolset Specification (`web/src/components/Toolbar.tsx`)

The CAD editor provides 25 specialized CAD editing tools divided into four functional categories:

### Group 1: Navigation & Selection
1. **Select / Pointer (`↖`)**: Standard selection and node inspection.
2. **Pan (`✋`)**: Canvas pan mode (also accessible via middle-mouse drag or Spacebar + drag).
3. **Zoom Region (`🔍`)**: Drag bounding box to zoom into specific feature.
4. **Reset View (`⟲`)**: Resets zoom scale to fit entire paper page.

### Group 2: Entity & Vertex Editing
5. **Move Vertex (`┼`)**: Drag individual polyline handle nodes.
6. **Add Vertex (`+`)**: Click segment to insert a new vertex handle.
7. **Delete Vertex (`-`)**: Click vertex handle to remove node and re-connect adjacent segments.
8. **Split Polyline (`✂`)**: Click polyline segment to break contour into two independent paths.
9. **Join Polylines (`☍`)**: Click endpoints of two open polylines to merge into a single entity.
10. **Physical Deformation Brush (`🖌`)**: Deform contours outward against brush boundary.
11. **Brush Shape Toggle (`●` / `■`)**: Toggle between spherical (Ball) and cubic (Cube) brush geometry.

### Group 3: Layer & Feature Marking
12. **Mark Outer Cut (`□`)**: Assign selected outline to `OUTER` layer (Black/White cut path).
13. **Mark Interior Hole (`○`)**: Assign selected outline to `HOLES` layer (Red interior cut).
14. **Mark Detail Line (`〰`)**: Assign selected outline to `DETAILS` layer (Green score/engrave line).
15. **Invert Selection (`⇄`)**: Invert active selection set.
16. **Delete Entity (`🗑`)**: Remove selected entity from canvas.

### Group 4: Measurement & Calibration
17. **Point-to-Point Distance Ruler (`📏`)**: Click two points to measure real-world distance in millimeters.
18. **Angle Measurement (`∠`)**: Click three vertices to compute subtended angle in degrees.
19. **Bounding Box Display (`⤢`)**: Toggle overall $W \times H$ metric bounding box dimensions overlay.
20. **ArUco Verification (`⯁`)**: Highlight 4 detected corner ArUco marker centers.
21. **Center Alignment (`✛`)**: Compute geometric centroid of outer boundary.
