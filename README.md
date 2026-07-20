# DXFify — Photo to DXF Dimensional Reconstruction

DXFify converts a single photograph of a flat object lying on a calibrated sheet (with ArUco markers) into a metrically-scaled 2D DXF file at true 1:1 scale, suitable for direct laser-cutting, CAD modeling, and manufacturing.

---

## 1. System Architecture

The project consists of two core components:
1. **Python Pipeline Worker (`dxferpy/`)**:
   - Performs AI segmentation via the BiRefNet model to isolate the object boundary.
   - Detects the 4 ArUco corners to warp perspective and establish physical pixel-to-millimeter coordinates.
   - Fits geometric elements (polylines, straight segments, snapped orthogonal lines, and circular arcs) using custom OpenCV and algebraic solvers.
   - Runs as a persistent Flask HTTP microservice to keep the BiRefNet model warm.
2. **Web Dashboard (`web/`)**:
   - Renders a multi-layer interactive canvas displaying vector shapes overlaid on original inputs.
   - Exposes extensive conversion settings to tune the segmentation and vectorization engines.
   - Provides an in-place CAD editor to inspect coordinates, delete geometries, snap points, mark holes, and brush-deform contours.
   - Runs as an Express server proxying API requests to the Python microservice, built with React, Vite, and TypeScript.

---

## 2. Setup & Execution

### A. Python Backend (Pipeline Worker)
Ensure Python 3.10+ is installed.

1. Navigate to the backend directory:
   ```bash
   cd dxferpy
   ```
2. Set up a virtual environment and install dependencies:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. Run the persistent server:
   ```bash
   python3 pipeline_worker.py
   ```
   *The Flask microservice listens on port 8788. It preloads the `birefnet-general-lite` model.*

### B. Web Dashboard
Ensure Node.js 18+ is installed.

1. Navigate to the web directory:
   ```bash
   cd web
   ```
2. Install npm packages:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   *The Express server sits on port 3000, hosting the React interface and proxying requests to the Python worker.*

---

## 3. Calibration Sheet Specification

To obtain true 1:1 scale, the object must be photographed on a flat sheet with **4 ArUco markers** at the corners.

### Coordinates & Placement
- **Dictionary**: `DICT_4X4_50` (IDs: 0, 1, 2, 3)
- **Arrangement**:
  - **ID 0**: Top-left corner
  - **ID 1**: Top-right corner
  - **ID 2**: Bottom-right corner
  - **ID 3**: Bottom-left corner
- **Layout Margins**:
  - The expected marker offsets from the sheet corners default to `32.2mm` X and `34.2mm` Y.
  - The expected clearing radius around the center of each marker is `22.0mm`.
  - These values can be fully customized in the **ArUco Calibration** section under Conversion Settings.

---

## 4. Conversion Settings

Users can customize parameters in the settings panel to optimize extraction quality:

- **Sheet Size**:
  - Select between A1, A2, A3, A4, A5, Letter, and Legal templates.
- **Segmentation**:
  - **Mask threshold** (Default: 240, Range: 1–255): Probability threshold for binarizing the AI segmentation mask.
  - **Erosion kernel** (Default: 3, Range: 1–9, odd): Morphological kernel size to clean up mask outlines.
  - **Erosion iterations** (Default: 1, Range: 0–5): Number of erosion passes.
- **Contour Filtering**:
  - **Min hole area** (Default: 500 px²): Contours classified as holes smaller than this threshold are filtered out.
  - **Min outer area** (Default: 100 px²): Main contours smaller than this threshold are ignored.
  - **Circle detection ratio** (Default: 0.85, Range: 0.5–1.0): Contours with area-to-enclosing-circle ratios above this value are fit as circles.
- **Vectorization**:
  - **Epsilon min / max** (Default: 0.5 / 2.5): Controls Douglas-Peucker simplification tolerance based on contour perimeter.
  - **Snap angle** (Default: 10°): Maximum angular difference allowed to snap lines to dominant orthogonal axes.
  - **Snap min length** (Default: 20 px): Minimum segment length eligible for orthogonal snapping.

---

## 5. CAD Toolbar & Canvas Editing

The interface includes a powerful vertex and geometry editor:

1. **Pan / Inspect (↖)**: Navigate the viewport. Click on lines to inspect vertex coordinates. Drag vertex handles (blue) to refine outlines. Drag circle centers (blue) or radial handles (yellow) to translate or resize circles.
2. **Deformation Brush (🖌)**: Bend and shape geometries like a physical ball/cube falling on fabric. Vertices falling within the brush's boundary are pushed outward to its perimeter, letting you shape curves effortlessly. Toggles for Circle (●) and Square (■) brushes are available. Hold **Shift + scroll wheel** to change the brush size.
3. **Snap Toggle (⌖)**: Vertices and circle centers automatically snap to neighboring coordinates within a `6mm` distance for perfect alignments.
4. **Mark Hole (○)**: Select any closed polyline and re-classify it as a hole to assign it to the `HOLES` layer (rendered in red in CAD, indicating a cut profile).
5. **Delete Element (⌫)**: Click on any circle or polyline to delete the entire shape.
6. **Delete Point (−)**: Click on any vertex of a polyline to delete it while keeping the outline connected.
7. **Add Point (+)**: Click anywhere on a polyline's segment to insert a new vertex.
8. **Undo/Redo (↶ / ↷)**: History is saved at the end of each drag, click, or edit stroke so you can undo/redo entire operations at once (`Ctrl+Z` / `Ctrl+Y`).
9. **Grid Toggle**: Overlay a metric CAD grid on the previews.
10. **In-place Splitters**: Hover and drag the thin orange lines at the boundaries of the Left Toolbar or the Bottom Panel row to resize them vertically or horizontally.
