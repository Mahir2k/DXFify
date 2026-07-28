# -*- mode: python ; coding: utf-8 -*-
import sys
import os

block_cipher = None

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(SPEC)))
dxferpy_dir = os.path.join(repo_root, "dxferpy")

datas = [
    (os.path.join(dxferpy_dir, "samples"), "dxferpy/samples"),
]

hiddenimports = [
    'PyQt6',
    'PyQt6.QtCore',
    'PyQt6.QtGui',
    'PyQt6.QtWidgets',
    'cv2',
    'ezdxf',
    'numpy',
    'scipy',
    'scipy.interpolate',
    'rembg',
    'onnxruntime',
    'flask',
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
