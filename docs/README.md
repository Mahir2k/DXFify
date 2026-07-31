# DXFify Developer & Architecture Documentation

Welcome to the technical documentation for DXFify (`dxfer`), an automated photographic dimensional reconstruction engine and 2D CAD vectorizer.

---

## Documentation Directory

### 1. Architecture & Design
- **[System Overview](architecture/system-overview.md)**: Master pipeline architecture, module boundaries (`dxferpy`, `desktop`, `web`), data flow, and file locations.
- **[Process Isolation & Server Modes](architecture/process-isolation.md)**: Multi-process web server mode vs. standalone single-binary desktop execution.

### 2. Building & Installation
- **[Building Standalone Binary](build-and-installation/building-standalone-binary.md)**: Compiling single-binary desktop executables with PyInstaller (`dxfify.spec`), dist-info metadata hooks, and static asset bundling.
- **[Local Development Setup](build-and-installation/local-development-setup.md)**: Setting up Python virtual environments, Node.js Express server, Vite dev client, and OpenCV build flags.

### 3. Computer Vision & Vectorization
- **[ArUco Detection & Homography](cv-and-vectorization/aruco-and-homography.md)**: Fiducial marker detection, DLT homography calculation, perspective correction, and printer margin scale compensation ($\gamma_{printer}$).
- **[Neural Segmentation](cv-and-vectorization/neural-segmentation.md)**: BiRefNet ONNX model inference, Guided Filter edge sharpening, morphological erosion, and RAM session caching.
- **[Vectorization Algorithms](cv-and-vectorization/vectorization-algorithms.md)**: Contour topology extraction, Douglas-Peucker simplification, Gaussian-smoothed orthogonal angle snapping, circle fitting, and detail engraving.

### 4. Standalone Desktop Application
- **[pywebview & QtEngine Architecture](desktop-application/pywebview-architecture.md)**: Native desktop application window, PyQt6 WebEngine integration, Chromium GPU acceleration flags, and multiprocessing freeze support rules.
- **[Embedded Server & Logging](desktop-application/embedded-server.md)**: Self-contained Python Flask server (`desktop_server.py`), API proxying, and unbuffered real-time terminal stdout logging.

### 5. Web Editor & CAD Workspace
- **[React State & CAD Tools](web-editor/react-state-and-tools.md)**: Application state architecture (`App.tsx`), atomized history stack (undo/redo), and technical specification of all 25+ CAD tools.
- **[WebGL Canvas Renderer](web-editor/webgl-canvas-renderer.md)**: Dual viewport synchronization (`DxfPreview.tsx`), rigid transformation matrix math, SVG overlay rendering, and physical deformation brush mechanics.

### 6. API Reference & Parameters
- **[REST API Specification](api-reference/REST-api-spec.md)**: Full API endpoint specification for `/api/convert`, `/api/convert-region`, and `/api/jobs/<jobId>/<filename>`.
- **[Configuration Parameters](api-reference/configuration-parameters.md)**: Complete parameter dictionary, valid ranges, defaults, and physical effects.

### 7. Maintenance & Engineering Post-Mortems
- **[Regression Testing](maintenance-and-testing/regression-testing.md)**: Automated Python unit test suite (`test_regression.py`), web build verification, and benchmark guidelines.
- **[Troubleshooting & Bug Post-Mortems](maintenance-and-testing/troubleshooting-and-bugs.md)**: In-depth technical post-mortems for 13 production engineering bugs, root cause analyses, and code solutions.
