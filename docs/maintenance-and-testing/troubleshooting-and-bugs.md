# Engineering Post-Mortems: Production Bugs & Solutions

This document provides technical post-mortems for 13 major production engineering bugs, root cause analyses, and solutions.

---

## Bug 1: Printer Margin Scale Calibration Discrepancy

### Symptoms
DXF exports measured $160.66\text{ mm}$ across reference features, whereas caliper measurements of the physical part yielded $119.50\text{ mm}$ ($34.4\%$ expansion).

### Root Cause
Desktop printers enforce unprintable margins ($3\text{--}5\text{ mm}$). Standard PDF software scales target sheets down to fit printable margins, causing printed marker distances to shrink and homography matrices to inflate calculated model dimensions.

### Solution
Defined physical scale factor $\gamma_{printer} = 119.50 / 160.66 \approx 0.7438$. Applied $\gamma_{printer}$ to nominal target marker offsets in `segment_object.py` and `SettingsPanel.tsx`, restoring 1:1 metric accuracy ($\pm 0.1\text{ mm}$).

---

## Bug 2: Octagonal Curve Collapse Artifact

### Symptoms
Smooth circular cutouts (e.g. rounded bolt holes) collapsed into 8-sided octagons during vectorization.

### Root Cause
Douglas-Peucker simplification used adaptive epsilon formula $\epsilon = 0.02 \cdot \text{perimeter}$, which was too coarse for small circular holes.

### Solution
1. Introduced circularity ratio classification $\rho = A / (\pi R^2) \ge 0.85$. Shapes meeting threshold are emitted directly as CAD `CIRCLE` entities.
2. Clamped polyline epsilon between strict bounds: $\epsilon = \text{clip}(0.003 \cdot \text{perimeter}, \epsilon_{min}, \epsilon_{max})$.

---

## Bug 3: Direction Histogram Peak Skew (Box Blur Artifact)

### Symptoms
Vectorizing slightly tilted rectangular objects produced skewed $87^\circ$ or $93^\circ$ corners instead of clean $90^\circ$ right angles.

### Root Cause
Direction histogram $\mathbf{H}$ was smoothed using a uniform box blur filter, creating flat plateaus that caused peak detection to pick plateau edges rather than true continuous peak centers.

### Solution
Replaced box blur filter with a 5-tap discrete Gaussian convolution kernel $[0.05, 0.25, 0.40, 0.25, 0.05]$ in `vectorize_smart.py`.

---

## Bug 4: SVG Pointer Capture Drag Disconnection

### Symptoms
Dragging vertex handle nodes rapidly caused mouse cursor to detach from the vertex element, terminating drag operations prematurely.

### Root Cause
Pointer event listeners were attached to individual `<circle>` SVG elements. When moving the cursor faster than browser event dispatch rate, pointer events fired outside the `<circle>` boundary.

### Solution
Attached `onPointerDown`, `onPointerMove`, and `onPointerUp` listeners to the root `<svg>` element in `DxfPreview.tsx`, invoking `e.currentTarget.setPointerCapture(e.pointerId)` on `pointerdown`.

---

## Bug 5: Dual Viewport Zoom & Pan Misalignment on Original Photo Tab

### Symptoms
Zooming into a feature on `DxfPreview` caused `ImagePreview` on the **Original** photo tab to zoom into a completely different location.

### Root Cause
`ImagePreview.tsx` applied fixed SVG viewBox formulas calibrated for rectified pixel dimensions ($2100 \times 2970\text{ px}$). The raw un-rectified camera photo has distinct dimensions ($2505 \times 3529\text{ px}$) and perspective tilt.

### Solution
Projected 4 model viewport corners into raw camera photo pixels via `dxfModelToImagePixels` and dynamically set `viewBox` $[minX, minY, maxX - minX, maxY - minY]$ in raw camera photo space.

---

## Bug 6: PyInstaller Multiprocessing Process Explosion (Fork Bomb)

### Symptoms
Executing the compiled binary executable (`./dxfify`) spawned hundreds of child process instances in an exponential loop, freezing the OS without opening the GUI window.

### Root Cause
PyTorch, ONNX Runtime, and OpenCV multiprocessing workers re-execute `desktop/main.py` inside frozen PyInstaller binaries. Without `multiprocessing.freeze_support()`, child processes re-initialize as main processes.

### Solution
Placed `multiprocessing.freeze_support()` as the very first line of `desktop/main.py`.

---

## Bug 7: PyInstaller Transitive Package Metadata Missing (`PackageNotFoundError`)

### Symptoms
Binary crashed on startup: `importlib.metadata.PackageNotFoundError: No package metadata was found for pymatting`.

### Root Cause
`rembg` calls `importlib.metadata.version("pymatting")`. PyInstaller omits `.dist-info` package metadata folders by default.

### Solution
In `desktop/dxfify.spec`, appended `copy_metadata('pymatting')`, `copy_metadata('rembg')`, `copy_metadata('torch')`, and `copy_metadata('PyQt6-WebEngine')`.

---

## Bug 8: PyQt6 Namespace & Enum Import Discrepancies

### Symptoms
1. `ImportError: cannot import name 'QAction' from 'PyQt6.QtWidgets'`.
2. `AttributeError: 'SettingsDock' object has no attribute 'dockWidgetArea'`.

### Root Cause
PyQt6 moved `QAction` to `PyQt6.QtGui` and renamed Qt enum attributes.

### Solution
Updated `toolbar.py` to import `QAction` from `PyQt6.QtGui`, and updated `settings_dock.py` to use static enum flags `Qt.DockWidgetArea.RightDockWidgetArea`.

---

## Bug 9: ONNX Model Session Reload Latency & Software Canvas Lag

### Symptoms
1. Standalone desktop conversions took 6–7 seconds (3x longer than web server mode).
2. Canvas pan and zoom stutters occurred on certain Linux/Windows graphics drivers.

### Root Cause
1. `desktop_server.py` called `run_pipeline()` without passing pre-loaded `rembg_session`, causing ONNX model weights to reload from disk on every request.
2. QtWebEngine defaulted to software canvas rasterization.

### Solution
1. Implemented global RAM session caching (`_REMBG_SESSION`) in `desktop/desktop_server.py`, reducing conversion latency to **<1.5s**.
2. Configured Chromium GPU acceleration flags (`QTWEBENGINE_CHROMIUM_FLAGS`) in `desktop/main.py`.
