# DXFify Python Computer Vision & Vectorization Backend (`dxferpy`)

The `dxferpy` package is the core computational engine of **DXFify**. It processes raw photographic images of flat physical objects placed on calibration sheets and outputs metrically accurate, 1:1 scale DXF (Drawing Exchange Format) CAD vector files.

---

## Technical Architecture

```
                       ┌─────────────────────────┐
                       │  Input Image (JPG/PNG)  │
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │  ArUco Marker Detector  │
                       │     (DICT_4X4_50)       │
                       └────────────┬────────────┘
                                    │
             ┌──────────────────────┴──────────────────────┐
             │                                             │
┌────────────▼────────────┐                   ┌────────────▼────────────┐
│  Homography Transform   │                   │   BiRefNet Segmentation │
│   (3x3 Perspective H)   │                   │ (birefnet-general-lite) │
└────────────┬────────────┘                   └────────────┬────────────┘
             │                                             │
             │                                ┌────────────▼────────────┐
             │                                │ Guided Filter Boundary  │
             │                                │       Refinement        │
             └──────────────────────┬──────────────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │  Warped 1:1 Metric Mask │
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │ Smart Vectorizer Engine │
                       │ (DP + Angular Snapping) │
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │   DXF R2010 Generator   │
                       │ (OUTER, HOLES, DETAILS) │
                       └─────────────────────────┘
```

---

## Key Modules & Files

### 1. `pipeline_worker.py`
Persistent Flask HTTP server (`port 8788`) that hosts the preloaded BiRefNet model to eliminate weight loading latency on inference calls.

- **`POST /process`**: Accepts JSON containing `inputPath`, `outputDir`, `paperSize`, and vectorization parameters. Runs full segmentation, homography warping, contour extraction, vector fitting, detail extraction, and exports `result.dxf`, `result.dbg.png`, `result.mask.png`, `result.holes.png`, and `result.json`.
- **`POST /process_region`**: Reprocesses a specific bounding box sub-region with alternative curve fitting strategies without needing to re-segment the entire image.
- **`GET /health`**: Healthcheck endpoint returning model status.

### 2. `segment_object.py`
Provides neural segmentation and ArUco marker location utilities:
- **`create_birefnet_session()`**: Initializes the `birefnet-general-lite` ONNX Runtime session with automatic hardware acceleration detection (`CUDAExecutionProvider` $\rightarrow$ `ROCMExecutionProvider` $\rightarrow$ `CPUExecutionProvider`).
- **`get_aruco_corners(img)`**: Detects 4 ArUco markers using OpenCV's `DICT_4X4_50` dictionary.
- **`order_points_by_id(corners, ids)`**: Orders marker centers by ID: ID 0 (Bottom-Right), ID 1 (Bottom-Left), ID 2 (Top-Left), ID 3 (Top-Right).

### 3. `vectorize_smart.py`
The geometric fitting engine:
- **`get_homography()`**: Computes a $3 \times 3$ perspective transformation matrix $H$ using `cv2.getPerspectiveTransform` mapping pixel coordinates of ArUco marker centers to exact physical millimeter coordinates.
- **`vectorize_contour()`**:
  1. Performs Douglas-Peucker polyline approximation using dynamic $\epsilon = 0.0008 \times \text{perimeter}$.
  2. Computes fitted tangent line direction vectors for every segment using `cv2.fitLine`.
  3. Builds a $180^\circ$ angular histogram weighted by segment length and smooths it using a 5-tap Gaussian kernel (`[0.05, 0.25, 0.4, 0.25, 0.05]`).
  4. Identifies up to 4 dominant orthogonal directions and snaps segments whose angles fall within `--snap-angle` (default $10^\circ$).
  5. Merges adjacent collinear snapped segments and computes exact line-intersection vertices via `intersect_lines()`.
  6. Preserves organic curves for unsnapped segments using moving-average smoothing (`smooth_curve()`).
- **`extract_details()`**: Runs bilateral filtering and adaptive Otsu/Canny edge detection inside the object mask to extract surface textures, grooves, and lettering onto the `DETAILS` CAD layer.

### 4. `render_dxf.py`
Uses `ezdxf.addons.drawing.matplotlib.qsave` to render high-resolution 300 DPI transparent PNG previews of generated DXF files for UI overlays.

### 5. `test_regression.py`
Regression unit test suite built with `unittest`. Tests end-to-end segmentation, homography matrix generation, and DXF vector creation against sample images.

---

## Mathematical Foundations

### Homography Perspective Matrix ($H$)
Given source marker points $P_i = (x_i, y_i)$ and destination millimeter coordinates $P'_i = (x'_i, y'_i)$:

$$
\begin{bmatrix} x' \\ y' \\ 1 \end{bmatrix} \sim H \begin{bmatrix} x \\ y \\ 1 \end{bmatrix} = \begin{bmatrix} h_{11} & h_{12} & h_{13} \\ h_{21} & h_{22} & h_{23} \\ h_{31} & h_{32} & h_{33} \end{bmatrix} \begin{bmatrix} x \\ y \\ 1 \end{bmatrix}
$$

### Pratt Algebraic Circle Fit
For arc segments identified as circular cutouts, center $(x_c, y_c)$ and radius $R$ are calculated by minimizing the algebraic error:

$$
F(x_c, y_c, R) = \sum_{i=1}^N \left( (x_i - x_c)^2 + (y_i - y_c)^2 - R^2 \right)^2
$$

---

## Curve Fitting Strategies

When running selective region reprocessing or full vectorization, the backend supports 5 curve strategies:
1. **`current`**: Standard Douglas-Peucker simplification + orthogonal angular snapping.
2. **`pratt`**: Pratt algebraic circle fitting on corner vertices to fit exact circular fillets.
3. **`spline`**: Cubic B-spline interpolation (`scipy.interpolate.splprep` / `splev`).
4. **`gaussian`**: 1D Gaussian coordinate blurring.
5. **`ransac`**: RANSAC line fitting (`ransac_line_fit`) combined with analytical fillet arc generation (`get_fillet_arc`).

---

## Installation & Running Tests

```bash
# Setup Virtual Environment
cd dxferpy
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run Regression Tests
python3 -m unittest test_regression.py

# Start Worker Standalone
python3 pipeline_worker.py
```
