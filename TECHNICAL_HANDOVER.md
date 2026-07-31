# DXFify Technical Handover & Developer Guide

This document details the architecture, codebase structure, computer vision pipeline, web/desktop software design, build configuration, and maintenance procedures for the DXFify platform (`dxfer`).

---

## 1. Repository Structure & System Architecture

The codebase is organized into four main modules:

```
dxfer/
├── dxferpy/                    # Python core processing engine & CV algorithms
│   ├── pipeline_worker.py      # Entry point for image segmentation & vectorization pipeline
│   ├── segment_object.py       # ArUco marker detection, homography matrix & neural segmentation
│   ├── vectorize_smart.py      # Contour extraction, Douglas-Peucker simplification & snapping
│   ├── render_dxf.py           # DXF rendering engine & preview image generator
│   ├── test_regression.py      # Automated regression test suite
│   ├── requirements.txt        # Python dependency manifest
│   └── venv/                   # Python virtual environment
├── desktop/                    # Standalone desktop application wrapper
│   ├── main.py                 # Application entry point, GPU flags & pywebview window launcher
│   ├── desktop_server.py       # Embedded Flask API server with RAM ONNX model session caching
│   ├── pipeline_worker.py      # Async QThread worker (Qt fallback execution)
│   ├── dxfify.spec             # PyInstaller build specification
│   └── ui/                     # Native PyQt6 widget fallbacks
├── web/                        # Web CAD dashboard
│   ├── src/                    # React UI & CAD workspace components
│   │   ├── App.tsx             # Global application state & undo/redo history
│   │   └── components/         # Workspace, DxfPreview canvas, Toolbar, SettingsPanel
│   ├── server/                 # Node.js/Express API server (`index.ts`)
│   └── dist/                   # Static web build assets compiled by Vite
├── reports/                    # Complete technical report suite (00 to 10)
└── TECHNICAL_HANDOVER.md       # Developer maintenance guide (this file)
```

---

## 2. Quick Start & Execution Modes

### Mode A: Standalone Single Binary Executable (Production Desktop)
No external web browser, Node.js, or separate API server required.

```bash
./dxferpy/dist/dxfify/dxfify
```

To recompile the standalone binary after making code changes:

```bash
cd dxferpy
venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec
```

### Mode B: Local Web Application Development
Requires Python 3.10+ and Node.js 18+.

1. **Start Python Microservice**:
   ```bash
   cd dxferpy
   source venv/bin/activate
   python3 pipeline_worker.py
   ```
   Runs on `http://127.0.0.1:8788`.

2. **Start Express API & Vite Dev Client**:
   ```bash
   cd web
   npm run dev
   ```
   Opens Vite client on `http://localhost:5173` with API proxies to Express (`:8787`) and Python (`:8788`).

---

## 3. Core Processing Pipeline (`dxferpy/`)

### 1. Fiducial Metric Calibration & Perspective Warping (`segment_object.py`)
- **ArUco Detection**: Detects 4 corner markers from dictionary `DICT_4X4_50` (IDs 0: TL, 1: TR, 2: BR, 3: BL).
- **Homography Matrix**: Computes homography matrix $\mathbf{H}$ using OpenCV Direct Linear Transform (`cv2.findHomography`).
- **Metric Scaling**: Warps camera image to flat top-down coordinates based on target sheet dimensions (e.g. A4: $210.0\text{ mm} \times 297.0\text{ mm}$).
- **Printer Margin Scale Factor**: Printer unprintable margins scale down printed target sheets. To compensate, physical scale factor $\gamma_{printer} \approx 0.7438$ is applied to marker offsets in settings.

### 2. Neural Background Subtraction (`segment_object.py`)
- **BiRefNet Model**: Uses `birefnet-general-lite` ONNX neural network model to perform foreground object segmentation.
- **Guided Filter & Erosion**: Applies OpenCV Guided Filter edge refinement and morphological erosion to sharpen contours and shave off edge artifacts.
- **Binary Mask Generation**: Output is a single-channel binary mask ($255 = \text{object}, 0 = \text{background}$).

### 3. Vectorization & Geometry Fitting (`vectorize_smart.py`)
- **Contour Extraction**: `cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)`.
- **Circle Detection**: Calculates circularity ratio $\rho = A_{contour} / (\pi R^2)$. If $\rho > 0.85$, shape is emitted directly as a CAD `CIRCLE` entity.
- **Douglas-Peucker Simplification**: Applies `cv2.approxPolyDP` with adaptive epsilon:
  $$\epsilon = \text{clip}(0.003 \cdot \text{perimeter}, \epsilon_{min}, \epsilon_{max})$$
- **Orthogonal Angle Snapping**: Constructs a 180° direction histogram smoothed by a 5-tap Gaussian kernel $[0.05, 0.25, 0.40, 0.25, 0.05]$ to identify dominant orientations and snap near-orthogonal lines ($\pm 10^\circ$).
- **Detail Engraving**: When enabled, applies Canny edge detection to extract fine interior textures onto the `DETAILS` CAD layer.

### 4. DXF Rendering & Multi-Layer Export (`render_dxf.py`)
Outputs DXF R2010 files using `ezdxf` with layer separation:
- `OUTER`: Primary outer object boundaries (White/Black).
- `HOLES`: Interior cutouts and bolt holes (Red).
- `DETAILS`: Fine surface score/engraving lines (Green).

---

## 4. Standalone Desktop Architecture (`desktop/`)

The standalone desktop executable (`dist/dxfify/dxfify`) runs as a single process containing:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Single Standalone Desktop Binary                     │
│                     (dist/dxfify/dxfify ~78MB)                         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │        Native pywebview Window (PyQt6 WebEngine Render)          │  │
│  │        100% Identical React CAD Dashboard UI & Tools            │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │ HTTP / API (127.0.0.1:3001)      │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │        Embedded Python Flask Server (desktop/desktop_server.py) │  │
│  │                                                                  │  │
│  │  ┌────────────────────────┐      ┌────────────────────────────┐  │  │
│  │  │ RAM Model Cache        │ ────►│ BiRefNet Neural Inference  │  │  │
│  │  │ (_REMBG_SESSION)       │      │ (<1.5s Vectorization)      │  │  │
│  │  └────────────────────────┘      └────────────────────────────┘  │  │
│  │                                                                  │  │
│  │  ┌────────────────────────┐      ┌────────────────────────────┐  │  │
│  │  │ Static UI Assets       │      │ Real-time Terminal Logging │  │  │
│  │  │ (web/dist/index.html)  │      │ (Unbuffered sys.stdout)    │  │  │
│  │  └────────────────────────┘      └────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Execution Rules
1. **PyInstaller Multiprocessing Rule**: `multiprocessing.freeze_support()` MUST be called at line 1 of `desktop/main.py` before importing PyTorch or OpenCV to prevent worker process fork explosions.
2. **RAM Model Session Caching**: `desktop/desktop_server.py` caches global `_REMBG_SESSION` in RAM. Do not remove `rembg_session` from `run_pipeline()` parameters; re-instantiating the model on every request adds 3–5 seconds of disk I/O latency.
3. **Chromium GPU Acceleration Flags**: `os.environ["QTWEBENGINE_CHROMIUM_FLAGS"]` in `desktop/main.py` enables hardware WebGL and accelerated 2D canvas rendering for PyQt6 WebEngine.
4. **PyInstaller Metadata Hooks**: `desktop/dxfify.spec` uses `copy_metadata('pymatting')`, `copy_metadata('rembg')`, `copy_metadata('torch')`, and `copy_metadata('PyQt6-WebEngine')` to preserve package `.dist-info` directories.

---

## 5. Key Configuration Parameters

All pipeline parameters are adjustable via API requests or the web settings panel:

| Parameter | Type | Default | File / Location | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `paperSize` | string | `'a4'` | `pipeline_worker.py` | Calibration sheet dimensions (`a4`, `a3`, `a5`, `letter`, `legal`). |
| `maskThreshold` | int | `240` | `segment_object.py` | Binarization cutoff threshold (1–255) for background removal. |
| `erosionKernel` | int | `3` | `segment_object.py` | Structuring element size for morphological erosion. |
| `erosionIterations` | int | `1` | `segment_object.py` | Number of erosion passes to shave edge noise. |
| `minHoleArea` | int | `500` | `vectorize_smart.py` | Min area threshold (px²) to retain interior cutouts. |
| `minOuterArea` | int | `100` | `vectorize_smart.py` | Min area threshold (px²) to retain standalone objects. |
| `circleRatio` | float | `0.85` | `vectorize_smart.py` | Area ratio cutoff for circle detection ($\rho = A / \pi R^2$). |
| `epsilonMin` | float | `0.5` | `vectorize_smart.py` | Min Douglas-Peucker simplification error limit (px). |
| `epsilonMax` | float | `2.5` | `vectorize_smart.py` | Max Douglas-Peucker simplification error limit (px). |
| `snapAngle` | float | `10.0` | `vectorize_smart.py` | Max deviation angle (degrees) for orthogonal line snapping. |
| `detectDetails` | bool | `False` | `vectorize_smart.py` | Toggle Canny detail engraving line extraction onto `DETAILS` layer. |

---

## 6. Testing & Maintenance Procedures

### Run Python Regression Unit Tests
```bash
cd dxferpy
venv/bin/python3 -m unittest test_regression.py
```
Validates end-to-end segmentation, homography matrix calculation, vector entity extraction, and DXF file generation.

### Run Web Build Verification
```bash
cd web
npm run build
```
Compiles React TypeScript source into production bundle in `web/dist/`. Must be run before compiling the standalone desktop application via PyInstaller.

### Terminal Diagnostic Logs
When running `./dxferpy/dist/dxfify/dxfify` from terminal, stdout streams unbuffered log events:
```
[desktop-main] Initializing DXFify Standalone Desktop Application...
[desktop-server] Serving DXFify Desktop API & Static UI on http://127.0.0.1:3001
[desktop-server] Pre-loading BiRefNet ONNX neural segmentation model into RAM...
[desktop-server] BiRefNet ONNX neural model loaded successfully in 1.82s.
[API /convert] Image: 'phone_case.jpg' | Job: e7f8... | Paper: A4 | Thresh: 240
[API /convert DONE] Completed in 1.24s | Entities extracted: 14
```

---

## 7. Developer Extension Checklist

When modifying or extending the platform:

1. **Adding New Pipeline Parameters**:
   - Add default parameter to `run_pipeline()` in `dxferpy/pipeline_worker.py`.
   - Update parameter parsing in `desktop/desktop_server.py` (`POST /api/convert`).
   - Update parameter parsing in `web/server/index.ts` (`POST /api/convert`).
   - Add UI control component to `web/src/components/SettingsPanel.tsx`.

2. **Modifying Web CAD Canvas / Tools**:
   - Edit `web/src/components/DxfPreview.tsx`.
   - Update tool definitions and shortcuts in `web/src/components/Toolbar.tsx`.
   - Re-build web static assets (`cd web && npm run build`).
   - Re-compile standalone executable (`cd dxferpy && venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec`).

3. **Detailed Documentation Reference**:
   - Refer to `/reports/00_project_overview.md` through `/reports/10_internship_report_strategy.md` for full mathematical proofs, homography derivations, and bug post-mortems.
