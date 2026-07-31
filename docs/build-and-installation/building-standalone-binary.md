# Building Standalone Binary Executable

This guide covers building the self-contained standalone desktop binary executable using PyInstaller.

---

## 1. Build Requirements

Before compiling the standalone binary, ensure the following dependencies are installed inside the Python virtual environment (`dxferpy/venv`):

- **Python**: 3.10+
- **PyInstaller**: 6.0+
- **PyQt6 & PyQt6-WebEngine**: 6.5+
- **qtpy**: 2.4+
- **pywebview**: 5.0+
- **Flask**: 3.0+
- **OpenCV with ArUco**: `opencv-contrib-python` 4.7+
- **ezdxf, rembg, pymatting, torch, onnxruntime**

Verify package installation:

```bash
cd dxferpy
venv/bin/python3 -c "import pywebview, qtpy, PyQt6.QtWebEngineWidgets, rembg, ezdxf; print('Dependencies OK')"
```

---

## 2. Pre-Build Step: Compile Static React Web Assets

PyInstaller bundles the compiled production assets from `web/dist`. You MUST build the React application before compiling the binary.

```bash
cd web
npm run build
```

Verify that `web/dist/index.html`, `web/dist/assets/index-*.js`, and `web/dist/assets/index-*.css` exist.

---

## 3. Executable Specification (`desktop/dxfify.spec`)

The PyInstaller build specification handles data bundling, package metadata inclusion, and hidden imports:

```python
# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import copy_metadata

block_cipher = None

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(SPEC)))
dxferpy_dir = os.path.join(repo_root, "dxferpy")
web_dist_dir = os.path.join(repo_root, "web", "dist")

datas = [
    (os.path.join(dxferpy_dir, "samples"), "dxferpy/samples"),
]

if os.path.exists(web_dist_dir):
    datas.append((web_dist_dir, "web/dist"))

# Preserves .dist-info metadata for packages using importlib.metadata
for pkg_name in ['pymatting', 'rembg', 'torch', 'onnxruntime', 'ezdxf', 'pywebview', 'bottle', 'qtpy', 'PyQt6', 'PyQt6-WebEngine']:
    try:
        datas += copy_metadata(pkg_name)
    except Exception:
        pass

hiddenimports = [
    'pywebview',
    'webview',
    'webview.platforms.qt',
    'qtpy',
    'bottle',
    'proxy_tools',
    'PyQt6',
    'PyQt6.QtCore',
    'PyQt6.QtGui',
    'PyQt6.QtWidgets',
    'PyQt6.QtWebEngineWidgets',
    'PyQt6.QtWebEngineCore',
    'cv2',
    'ezdxf',
    'numpy',
    'scipy',
    'rembg',
    'pymatting',
    'onnxruntime',
    'importlib.metadata',
]

a = Analysis(
    [os.path.join(repo_root, 'desktop', 'main.py')],
    pathex=[repo_root, dxferpy_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='dxfify',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='dxfify',
)
```

---

## 4. Compilation Command

Run PyInstaller from the `dxferpy/` working directory:

```bash
cd dxferpy
venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec
```

The output binary folder will be created at `dxferpy/dist/dxfify/`.

---

## 5. Executable Launch & Verification

Launch the compiled executable directly from terminal:

```bash
./dxferpy/dist/dxfify/dxfify
```

Expected terminal output:

```
[desktop-main] Initializing DXFify Standalone Desktop Application...
[desktop-server] Serving DXFify Desktop API & Static UI on http://127.0.0.1:3001
[desktop-server] Pre-loading BiRefNet ONNX neural segmentation model into RAM...
[desktop-server] BiRefNet ONNX neural model loaded successfully in 1.82s.
[desktop-main] Connecting to embedded server at http://127.0.0.1:3001...
[desktop-main] Opening desktop application window...
```
