# System Overview & Architecture

## 1. High-Level Architecture

DXFify is an end-to-end 2D dimensional reconstruction platform designed to convert single photographs of physical objects into 1:1 scale DXF CAD vector files.

The repository is divided into four functional modules:

```
                                  ┌───────────────────────────┐
                                  │   Camera Capture Module   │
                                  │           (pic)           │
                                  └─────────────┬─────────────┘
                                                │ Raw Photo
                                                ▼
┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
│     Desktop Packaging     │ ──► │  Python Vector Engine     │ ──► │     Web CAD Workspace     │
│         (desktop/)        │     │         (dxferpy/)        │     │          (web/)           │
└───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

---

## 2. Module Responsibilities & File Map

### Python Core Engine (`dxferpy/`)
Coordinates image segmentation, homography warping, contour simplification, line snapping, circle/arc fitting, and DXF file rendering.

- **`dxferpy/pipeline_worker.py`**: Pipeline coordinator and microservice API server (default port 8788). Exports `run_pipeline()`.
- **`dxferpy/segment_object.py`**: Identifies ArUco markers, calculates DLT homography matrices, runs BiRefNet ONNX neural segmentation, and applies Guided Filter edge refinement.
- **`dxferpy/vectorize_smart.py`**: Contour topology extraction, Douglas-Peucker simplification, Gaussian-smoothed orthogonal angle snapping, circle ratio matching, and Canny detail engraving.
- **`dxferpy/render_dxf.py`**: DXF R2010 file writer (`ezdxf`) and vector preview rasterizer.
- **`dxferpy/test_regression.py`**: Automated unittest suite validating pipeline output entity counts, layer names, and bounding boxes.

### Standalone Desktop Application (`desktop/`)
Wraps the Python engine and React web application into a single standalone binary executable without external browser dependencies.

- **`desktop/main.py`**: Application entry point. Configures `multiprocessing.freeze_support()`, unbuffered stdout streams, Chromium GPU flags, and spawns `pywebview` window.
- **`desktop/desktop_server.py`**: Embedded self-contained Python Flask server on `127.0.0.1:3001`. Serves static React bundle (`web/dist`) and API routes with RAM ONNX model session caching.
- **`desktop/dxfify.spec`**: PyInstaller build specification file bundling native libraries, package metadata hooks (`copy_metadata`), and web dist assets.
- **`desktop/ui/`**: Fallback native PyQt6 widgets (`cad_canvas.py`, `main_window.py`, `settings_dock.py`).

### Web Application Workspace (`web/`)
Provides a dual-panel interactive CAD editor with 25+ tools, canvas alignment, layer toggles, and measurement tools.

- **`web/src/App.tsx`**: Main React state container. Manages active document geometries, undo/redo history stacks, zoom states, and tool selection.
- **`web/src/components/Workspace.tsx`**: Grid layout container handling interactive splitter dragging between panels.
- **`web/src/components/DxfPreview.tsx`**: Primary SVG/WebGL CAD canvas. Implements mouse/touch interaction routing, vertex drag snapping, ruler rendering, and physical deformation brush routines.
- **`web/src/components/Toolbar.tsx`**: Tool selection grid and brush shape toggle (`● Ball` / `■ Cube`).
- **`web/src/components/SettingsPanel.tsx`**: Input controls mapping segmentation thresholds, paper calibration sizes, and vector parameters to API payloads.
- **`web/src/components/ReportPanel.tsx`**: Metric measurement summary, bounding box dimensions, and reprojection error reports.
- **`web/server/index.ts`**: Node.js/Express gateway (port 8787) handling multipart file uploads, job folder isolation, and proxying requests to `dxferpy`.

---

## 3. End-to-End Data Pipeline Flow

```
1. Image Input
   └── User uploads photo (JPG/PNG) via Web UI or Desktop App window.

2. Job Initialization
   └── Server generates UUID job ID and creates isolated folder under `.dxfify_jobs/<jobId>/`.

3. ArUco Marker Calibration & Homography
   ├── Detects 4 corner markers (DICT_4X4_50, IDs 0, 1, 2, 3).
   ├── Solves 3x3 homography matrix H via Direct Linear Transform (DLT).
   └── Warps input image to top-down flat metric coordinates (e.g. A4: 210mm x 297mm).

4. Neural Segmentation & Mask Refinement
   ├── Passes warped image through BiRefNet ONNX neural network model.
   ├── Applies OpenCV Guided Filter to preserve crisp object boundary edges.
   └── Performs morphological erosion to eliminate background fringe noise.

5. Contour Extraction & Vectorization
   ├── Extracts binary mask contours with hierarchical parent-child relationships.
   ├── Classifies circle candidates via circularity ratio ρ = A / (π R²).
   ├── Simplifies polyline contours using adaptive Douglas-Peucker (approxPolyDP).
   ├── Snaps near-orthogonal line segments to dominant direction histogram peaks.
   └── Optionally extracts interior detail engraving lines via Canny edge detection.

6. CAD File & Preview Generation
   ├── Writes DXF R2010 file using ezdxf with OUTER, HOLES, and DETAILS layers.
   ├── Generates result.preview.png and result.dbg.png vector overlay rasters.
   └── Returns JSON payload containing job file URLs, entity counts, and metric report.
```
