# DXFify Native PyQt6 Desktop CAD Application

A 100% native single-process desktop CAD application for converting physical photos into 1:1 metric DXF R2010 CAD vector geometry.

---

## Key Features

1. **Zero External Browser / Web Server Dependency**:
   - Runs directly in Python via Qt C++ graphics bindings (`QGraphicsScene` & `QGraphicsView`).
   - No Node.js, Express, or Flask HTTP sockets required.

2. **High-Performance 2D Vector CAD Viewport (`CadCanvas`)**:
   - Sub-millimeter $X, Y$ coordinate tracking.
   - Smooth mouse wheel zoom anchored to cursor.
   - Scale-invariant vertex node handles with hover pulse glow animation.
   - Real-time brush deformation, line snapping, 3-point circle/arc fitting, 3-point rectangle, 4-point slot, chamfer, fillet, and segment alignment.

3. **Asynchronous Non-Blocking AI Pipeline Worker (`QThread`)**:
   - Preloads BiRefNet neural segmentation model at startup.
   - Runs OpenCV homography warping, Pratt circle fitting, and Douglas-Peucker simplification in a background thread to keep the UI smooth and responsive.

4. **Standalone Single Binary Executable**:
   - Compiled with PyInstaller into a single binary (`dist/dxfify/dxfify`).

---

## Directory Structure

```
desktop/
├── main.py                     # Primary executable entry point & dark theme initializer
├── pipeline_worker.py          # QThread background worker executing AI pipeline
├── dxfify.spec                 # PyInstaller single-binary build specification
└── ui/
    ├── main_window.py          # QMainWindow dashboard hosting menu, toolbars & dock
    ├── cad_canvas.py           # High-performance QGraphicsView CAD scene canvas
    ├── toolbar.py              # QToolBar hosting 20+ CAD creation & editing tools
    ├── settings_dock.py        # QDockWidget managing paper calibration & AI sliders
    └── status_bar.py           # QStatusBar rendering X/Y mm coordinates & zoom %
```

---

## Quick Start (Development)

1. **Activate Virtual Environment**:
   ```bash
   cd dxferpy
   venv/bin/python3 ../desktop/main.py
   ```

2. **Keyboard Shortcuts**:
   - **`Ctrl + O`**: Open Photo image file
   - **`Ctrl + E`**: Export DXF (R2010)
   - **`B` / `S`**: Toggle Brush shape between Ball (Circular) and Cube (Square)
   - **`Shift + Mouse Wheel`**: Expand or shrink brush radius (1mm - 150mm)
   - **`Middle-Click Drag` or `Shift + Drag`**: Pan canvas view
   - **`Mouse Wheel`**: Zoom in / out under cursor
   - **`Delete` / `Backspace`**: Delete selected entity or vertex

---

## Single Binary Compilation via PyInstaller

```bash
cd dxferpy
venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec
```

The standalone desktop executable will be built in `dist/dxfify/dxfify`.
