# pywebview & QtEngine Desktop Architecture

This document covers the standalone desktop application window architecture, `pywebview` integration, PyQt6 WebEngine configuration, Chromium GPU acceleration flags, and process isolation.

---

## 1. Application Window Architecture (`desktop/main.py`)

The standalone desktop executable provides native desktop window execution using `pywebview` bound to `PyQt6-WebEngine`.

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
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chromium GPU Acceleration Flags

QtWebEngine defaults to software canvas rendering on unlisted GPU drivers, causing frame rate drops during canvas pan and zoom operations.

`desktop/main.py` explicitly injects Chromium GPU hardware acceleration environment flags BEFORE Qt application initialization:

```python
import os

os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
    "--enable-gpu-rasterization "
    "--enable-zero-copy "
    "--ignore-gpu-blocklist "
    "--enable-accelerated-2d-canvas "
    "--enable-webgl"
)
```

### Impact
- **Canvas Rendering**: Restores smooth 60 FPS hardware-accelerated SVG and WebGL canvas rendering.
- **Input Responsiveness**: Eliminates vertex handle drag lag.

---

## 3. Multiprocessing Freeze Support Rule

When PyTorch, ONNX Runtime, or OpenCV spawn internal process pools, PyInstaller frozen binaries re-execute `desktop/main.py`.

Without `multiprocessing.freeze_support()`, child processes re-initialize as main processes, triggering an infinite process loop (fork bomb).

### Implementation
Place `multiprocessing.freeze_support()` as the very first line of `desktop/main.py`:

```python
import multiprocessing
import os
import sys

multiprocessing.freeze_support()

# App entry point continues below...
```

---

## 4. `pywebview` Window Initialization

```python
import webview

def main() -> None:
    port = 3001
    target_url = f"http://127.0.0.1:{port}"
    wait_for_server(target_url, timeout=10)

    window = webview.create_window(
        title="DXFify — Professional CAD Vectorizer",
        url=target_url,
        width=1400,
        height=900,
        min_size=(900, 600),
        resizable=True,
        text_select=False,
    )

    webview.start(gui="qt", private_mode=False)
```

Passing `gui="qt"` explicitly instructs `pywebview` to load PyQt6 WebEngine instead of GTK or external system webviews.
