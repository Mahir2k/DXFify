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

for pkg_name in ['pymatting', 'rembg', 'torch', 'onnxruntime', 'ezdxf', 'pywebview', 'bottle']:
    try:
        datas += copy_metadata(pkg_name)
    except Exception:
        pass

hiddenimports = [
    'pywebview',
    'bottle',
    'proxy_tools',
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
