# Embedded Server & Unbuffered Terminal Logging

This document details the self-contained embedded Python Flask server (`desktop/desktop_server.py`), API routing, RAM ONNX model session caching, and unbuffered terminal diagnostic logging.

---

## 1. Embedded Server Design (`desktop/desktop_server.py`)

In standalone executable mode, `desktop/desktop_server.py` runs as an embedded HTTP server inside a background thread (`127.0.0.1:3001`).

```python
server_thread = threading.Thread(target=run_server, args=(3001,), daemon=True)
server_thread.start()
```

### Server Responsibilities
1. **Static Asset Serving**: Serves static HTML/JS/CSS assets compiled from `web/dist`.
2. **REST API Endpoints**: Handles `/api/convert`, `/api/convert-region`, and `/api/jobs/<jobId>/<filename>`.
3. **Model Session Lifecycle**: Manages global RAM-cached ONNX model session (`_REMBG_SESSION`).

---

## 2. API Routes & Endpoint Routing

### Static UI Routing
- `GET /` -> Serves `web/dist/index.html`.
- `GET /<path>` -> Serves static JS/CSS bundles from `web/dist/` or falls back to `index.html` for single-page app routing.

### Job File Serving
- `GET /api/jobs/<jobId>/<filename>` -> Serves output DXF vector files, preview PNGs, binary masks, and JSON metric reports from `~/.dxfify_jobs/<jobId>/`.

### Vector Conversion Routing
- `POST /api/convert` -> Receives multipart image upload, parses conversion parameters (`sheetSize`, `maskThreshold`, `erosionKernel`, `curveStrategy`, `detectDetails`), retrieves cached `_REMBG_SESSION`, executes `run_pipeline()`, and returns JSON response.
- `POST /api/convert-region` -> Re-evaluates sub-region bounding box against stored original image.

---

## 3. Unbuffered Terminal Diagnostic Logging

Standard Python output buffering suppresses terminal logs inside PyInstaller executable binaries until application termination.

To provide real-time terminal diagnostics when launching `./dxferpy/dist/dxfify/dxfify`, `desktop/main.py` and `desktop/desktop_server.py` enforce unbuffered stdout streaming:

```python
import sys
import logging

# Force unbuffered stdout & stderr
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, 'reconfigure') else None

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s desktop-server] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("desktop_server")
```

Every API request and pipeline stage executes an explicit `sys.stdout.flush()`, outputting real-time log events:

```
[2026-07-31 11:15:00 desktop-server] Pre-loading BiRefNet ONNX neural segmentation model into RAM...
[2026-07-31 11:15:01 desktop-server] BiRefNet ONNX neural model loaded successfully in 1.82s.
[2026-07-31 11:15:05 desktop-server] [API /convert] Image: 'phone_case.jpg' | Job: e7f8... | Paper: A4 | Thresh: 240
[2026-07-31 11:15:06 desktop-server] [API /convert DONE] Completed in 1.24s | Entities extracted: 14
```
