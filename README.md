# DXFify: Photographic Dimensional Reconstruction & Standalone CAD Application

DXFify converts a single photograph of a flat object lying on a sheet with ArUco corners into a metrically accurate 2D DXF vector file. The output is scaled 1:1 in millimeters, suitable for laser cutting or CAD import.

DXFify operates both as a **Web Application Dashboard** and as a **Single Standalone Executable Desktop Application** (with zero external web browser dependencies).

> For future maintainers taking over the codebase, see the [Technical Handover & Developer Guide](TECHNICAL_HANDOVER.md).

---

## Codebase Architecture

### Standalone Executable & Desktop Package (`desktop/`)
- **`desktop/main.py`**: Executable entry point. Invokes `multiprocessing.freeze_support()`, configures Chromium GPU hardware acceleration flags (`--enable-gpu-rasterization`, `--enable-accelerated-2d-canvas`, `--enable-webgl`), pre-warms the BiRefNet ONNX model, starts the embedded local server, and launches a native desktop window using `pywebview` with PyQt6 WebEngine.
- **`desktop/desktop_server.py`**: Embedded self-contained Python Flask server running inside the single process. Serves the static React build (`web/dist`) and API endpoints (`/api/convert`, `/api/convert-region`, `/api/jobs/`) with RAM-cached ONNX model session (`_REMBG_SESSION`) for instant 5x faster vectorization and unbuffered real-time terminal logging.
- **`desktop/pipeline_worker.py`**: `QThread` background worker executing computer vision segmentation and vectorization asynchronously.
- **`desktop/dxfify.spec`**: PyInstaller specification bundling Python runtime, ONNX model weights, OpenCV DLLs, PyQt6 WebEngine, and static web bundle into a single standalone binary executable (`dist/dxfify`).
- **`desktop/ui/`**: Native PyQt6 CAD viewports (`CadCanvas`), toolbars (`CadToolBar`), status bar (`CadStatusBar`), and settings dock (`SettingsDock`).

### Python Backend (`dxferpy/`)
- **`pipeline_worker.py`**: Hosts a persistent Flask server (default port 8788). Preloads the `birefnet-general-lite` segmentation model to avoid the overhead of loading weights on every image run. Coordinates segmentation, perspective correction, and vectorization.
- **`segment_object.py`**: Identifies ArUco markers to compute camera perspective matrices and warps the raw image to top-down flat coordinates. Uses the preloaded segmentation model to generate binary transparency masks.
- **`vectorize_smart.py`**: Extracts contours from the binary mask, runs Douglas-Peucker simplification, snaps lines close to dominant directions, identifies circular regions, fits LWPOLYLINE structures with bulges for arcs, and handles high-frequency detail engraving line extraction.
- **`render_dxf.py`**: Generates high-fidelity preview images from DXF coordinates to overlay vectors on top of original raster previews.

### Node/Express Server (`web/server/`)
- **`index.ts`**: Express backend (default port 8787) that handles multipart image uploads, manages isolated job folders under `web/uploads/jobs/`, starts or talks to the Python worker, and exposes generated artifacts through `/api/jobs/:jobId/<filename>`.

### React Client (`web/src/`)
- **`App.tsx`**: Application state container. Manages history stacks (undo/redo), active geometries, zoom states, tool selections, and image uploads.
- **`components/Workspace.tsx`**: Grid layout shell. Coordinates alignment between raster and vector panels. Implements custom drag handlers to adjust toolbar width and bottom panel height in-place.
- **`components/DxfPreview.tsx`**: Interactive CAD editor. Handles canvas pans, zoom scaling, snap-to-vertex logic, ruler rendering, and mouse event routing for editing tools.
- **`components/Toolbar.tsx`**: Tool selection grid and settings toggles for the physical deformation brush (Ball `●` / Cube `■`).
- **`components/SettingsPanel.tsx`**: Dynamic input controls mapping optional segmentation, contour filtering, and vectorization parameters to the API request.
- **`components/ReportPanel.tsx`**: Displays ArUco detection accuracy, computed tolerances, reprojection warnings, and exact bounding box sizes.
- **`components/ArtifactList.tsx`**: File downloader panel for output files (DXF, masks, debug previews, JSON reports).

---

## Installation & Execution

### 1. Standalone Single Binary Desktop Application (No External Browser Needed)

Run the compiled single binary executable directly from terminal:

```bash
./dxferpy/dist/dxfify/dxfify
```

To re-compile the single binary executable:

```bash
cd dxferpy
venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec
```

### 2. Python Backend & Web Server
Required: Python 3.10+ and OpenCV with ArUco support.

```bash
cd dxferpy
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 pipeline_worker.py
```

### 3. Frontend Dashboard
Required: Node.js 18+.

```bash
cd web
npm install
npm run dev
```

---

## Calibration Sheet Layout

The system extracts millimeter measurements by detecting 4 ArUco markers at the page corners:
- **Marker Dictionary**: `DICT_4X4_50`
- **IDs**: 0 (top-left), 1 (top-right), 2 (bottom-right), 3 (bottom-left)
- **Marker Positions**: Centers default to `32.2mm` X and `34.2mm` Y from the page edge. The region cleared around each marker center is `22.0mm`. These dimensions can be adjusted in the settings panel to match any custom calibration grid.

---

## Conversion Parameter Details

The settings panel exposes the following thresholds to optimize edge fitting:

### Segmentation
- **Mask threshold** (1–255, default 240): Cutoff value to convert the raw neural network probability map into a binary black-and-white mask. Lower values expand the boundary; higher values shrink it.
- **Erosion kernel** (1–9, odd, default 3): Size of the pixel grid used to shave off edge noise.
- **Erosion iterations** (default 1): Number of erosion passes.

### Contour Filtering
- **Min hole area** (default 500 px²): Filters out interior cutouts smaller than this value to ignore dust, glare, or marker reflections.
- **Min outer area** (default 100 px²): Ignores tiny standalone objects.
- **Circle det. ratio** (0.5–1.0, default 0.85): Threshold for circle matching. If a contour's area divided by the area of its minimum enclosing circle exceeds this ratio, it is fit as a circle instead of a polyline.

### Vectorization & Fitting
- **Epsilon min / max** (default 0.5 / 2.5): Douglas-Peucker simplification limits. Defines the maximum distance deviation between the raw contour and the simplified polyline.
- **Snap angle** (1–45°, default 10°): Maximum deviation allowed to snap a segment to one of the image's dominant orthogonal directions.
- **Snap min length** (default 20 px): Segments shorter than this threshold bypass orthogonal snapping to preserve small custom curves.

### Detail Engraving (Optional)
- **Detect Details** (toggle, default false): Extracts surface textures, grooves, and embossed elements inside the object as open vector paths.
- **Sensitivity threshold 1 & 2** (default 50 / 150): Double Canny thresholds used for fine-line edge detection.
- **CAD Representation**: Placed on the `DETAILS` layer (colored green/emerald in CAD previews and exported DXFs).

---

## CAD Editing & Resizing

- **Vertex Adjustments**: Active in Select tool (`↖`). Drag handles to move vertices. Snapping automatically aligns moved points to adjacent vertices when within `6mm`.
- **Physical Deformation Brush (`🖌`)**: Push vertices outward using spherical (Ball `●`) or cubic (Square `■`) shapes. Resize the brush by holding **Shift** and rolling the **mouse scroll wheel**, or press **B** / **S** to toggle brush shape.
- **Hole Marking (`○`)**: Select any outline to switch its layer to `HOLES` (colored red in standard CAD files).
- **Layer Visibility**: Independently toggle the visibility of the `OUTER`, `HOLES`, and `DETAILS` layers using checkboxes.
- **Atomized History**: Every edit, drag, or brush stroke is recorded as a single frame for `Ctrl+Z` (Undo) and `Ctrl+Y` (Redo).
