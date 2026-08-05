# Building DXFify

Instructions for compiling and packaging DXFify.

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm

## Build Steps

### 1. Web Bundle

```bash
cd web
npm install
npm run build
cd ..
```

This generates production assets in `web/dist/`.

### 2. Desktop Binary

```bash
cd dxferpy
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pyinstaller pywebview PyQt6 PyQt6-WebEngine bottle
cd ..

dxferpy/venv/bin/pyinstaller --noconfirm desktop/dxfify.spec
```

The output binary is placed in `dist/dxfify/`.

## Running the Built Package

- **Linux / macOS**: `./dist/dxfify/dxfify`
- **Windows**: `dist\dxfify\dxfify.exe`
