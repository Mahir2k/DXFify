# DXFify

DXFify converts photos of flat parts placed on an ArUco target sheet into 1:1 scale DXF vector files for CAD and CNC/laser cutting.

## Requirements

- Python 3.10+
- Node.js 18+ and npm
- OpenCV with ArUco module (`opencv-contrib-python`)

## Running Locally

### Desktop App (Standalone Executable)

Run the prebuilt desktop binary:

```bash
./dist/dxfify/dxfify
```

To rebuild the executable:

```bash
dxferpy/venv/bin/pyinstaller --noconfirm desktop/dxfify.spec
```

### Development Mode

1. **Backend**:
   ```bash
   cd dxferpy
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   python3 pipeline_worker.py
   ```

2. **Frontend**:
   ```bash
   cd web
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`.

## Project Layout

- `desktop/`: Standalone app wrapper (`pywebview` + embedded Flask server).
- `dxferpy/`: Computer vision backend (image warp, BiRefNet segmentation, vector fitting, DXF rendering).
- `web/`: React frontend (workspace UI, canvas editor, settings, ArUco target generator).
- `docs/`: Technical notes and reports.

## Calibration Target

The image processing relies on 4 ArUco markers placed at the corners of the target paper:
- Dictionary: `DICT_4X4_50`
- IDs: 0 (top-left), 1 (top-right), 2 (bottom-right), 3 (bottom-left)
- Default marker offset: 32.2 mm (X), 34.2 mm (Y) from sheet boundaries.

 Printable targets in custom or standard paper sizes (A4, A3, A5, Letter, Legal) can be generated directly from the UI or via `/api/generate-aruco-paper`.

## Pipeline Parameters

- **Mask threshold** (default 240): Cutoff value for binary segmentation.
- **Erosion kernel** (default 3): Edge noise cleanup kernel size.
- **Epsilon min/max** (default 0.5 / 2.5): Polyline simplification bounds.
- **Curve Fitting Strategy**: DP, RANSAC, B-Spline, Gaussian, or Pratt circle fitting.
