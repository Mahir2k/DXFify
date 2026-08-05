# -*- mode: python ; coding: utf-8 -*-
"""Cross-platform PyInstaller spec for DXFify Desktop Application.

Builds on Linux, macOS, and Windows without modification.
"""
import sys
import os
import platform
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

# Copy package metadata (some may not be installed on all platforms — skip missing)
metadata_packages = ['pymatting', 'rembg', 'torch', 'onnxruntime', 'ezdxf', 'pywebview', 'bottle']

# Platform-specific metadata packages
current_platform = platform.system()
if current_platform == "Linux":
    metadata_packages += ['qtpy', 'PyQt6', 'PyQt6-WebEngine']
elif current_platform == "Darwin":
    pass  # macOS: pywebview uses native Cocoa WebKit — no Qt needed
else:
    pass  # Windows: pywebview uses EdgeChromium — no Qt needed

for pkg_name in metadata_packages:
    try:
        datas += copy_metadata(pkg_name)
    except Exception:
        pass

# --- Hidden imports ---
hiddenimports = [
    # pywebview core
    'pywebview',
    'webview',
    # Core scientific stack
    'cv2',
    'ezdxf',
    'numpy',
    'scipy',
    'rembg',
    'pymatting',
    'onnxruntime',
    'importlib.metadata',
    # Matplotlib backends for PDF/SVG/raster generation
    'matplotlib.backends.backend_pdf',
    'matplotlib.backends.backend_agg',
    'matplotlib.backends.backend_svg',
]

# Platform-specific hidden imports for pywebview GUI backends
if current_platform == "Linux":
    hiddenimports += [
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
    ]
elif current_platform == "Darwin":
    hiddenimports += [
        'webview.platforms.cocoa',
        'objc',
        'Foundation',
        'AppKit',
        'WebKit',
    ]
else:  # Windows
    hiddenimports += [
        'webview.platforms.edgechromium',
        'clr',
        'pythonnet',
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

# Platform-specific EXE options
exe_kwargs = dict(
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

# Windows: add .exe icon
if current_platform == "Windows":
    ico_path = os.path.join(repo_root, "desktop", "icon.ico")
    if os.path.exists(ico_path):
        exe_kwargs["icon"] = ico_path

# macOS: enable argv emulation for Finder double-click launch
if current_platform == "Darwin":
    exe_kwargs["argv_emulation"] = True

exe = EXE(
    pyz,
    a.scripts,
    [],
    **exe_kwargs,
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
