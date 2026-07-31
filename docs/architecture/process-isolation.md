# Process Isolation & Execution Modes

DXFify supports two distinct execution models: **Multi-Process Microservice Mode** for web/server deployments and **Single-Process Standalone Desktop Executable Mode** for offline workshop deployment.

---

## 1. Execution Modes Comparison

| Feature | Multi-Process Web Server Mode | Single-Process Desktop Binary |
| :--- | :--- | :--- |
| **Primary Entry Point** | `web/server/index.ts` + `dxferpy/pipeline_worker.py` | `./dxferpy/dist/dxfify/dxfify` (`desktop/main.py`) |
| **External Dependencies** | Node.js, Express, Vite, External Browser | **Zero** (Self-contained binary) |
| **API Server** | Express Gateway (`:8787`) + Flask Worker (`:8788`) | Embedded Flask Server (`desktop_server.py` on `:3001`) |
| **UI Window Rendering** | Chrome, Firefox, or Edge browser window | `pywebview` window (PyQt6 WebEngine) |
| **ONNX Model Lifecycle** | Kept in RAM by persistent `pipeline_worker.py` process | Cached in RAM by `_REMBG_SESSION` in `desktop_server.py` |
| **Diagnostic Output** | Node/Express console logs | Unbuffered terminal stdout (`line_buffering=True`) |

---

## 2. Standalone Single-Process Execution Architecture

In standalone executable mode, the binary packages the Python runtime, PyTorch/ONNX libraries, OpenCV DLLs, PyQt6 WebEngine, and pre-compiled static React assets (`web/dist`) into a single executable folder (`dist/dxfify/`).

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

### Multiprocessing Freeze Support
PyInstaller binary executables re-execute the entry-point script (`desktop/main.py`) whenever child process workers are spawned by PyTorch, ONNX Runtime, or OpenCV.

To prevent infinite process spawning (fork bomb), `multiprocessing.freeze_support()` MUST be executed as the very first line of `desktop/main.py`:

```python
import multiprocessing
multiprocessing.freeze_support()
```

---

## 3. Storage & Job Folder Isolation

Both execution modes enforce strict filesystem isolation for conversion jobs.

- **Storage Location**:
  - Web Server Mode: `web/uploads/jobs/<jobId>/`
  - Standalone Desktop Mode: `~/.dxfify_jobs/<jobId>/`
- **Job Directory Contents**:
  - `uploaded-<filename>`: Source input image.
  - `result.dxf`: Final DXF R2010 CAD vector output.
  - `result.json`: Conversion metrics report (bounding boxes, entity count, reprojection error).
  - `result.preview.png`: Rasterized DXF vector overlay preview.
  - `result.dbg.png`: Homography debug visualization.
  - `result.mask.png`: Binary segmentation mask.
