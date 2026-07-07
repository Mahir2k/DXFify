# dxfer — Photo → DXF dimensional reconstruction

## What it does
`dxfer` converts a single photograph of a flat object lying on a calibrated
sheet into a metrically-scaled 2D ASCII DXF file. The output is suitable
for direct import into laser-cutter / CAD software at true 1:1 scale.

## Pipeline overview

```
   ┌────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────┐
   │ photo  │ → │ Calibration   │ → │ Segmentation │ → │ Vectorize    │ → │ DXF      │
   │        │   │ (ArUco+H)     │   │ (multi+holes)│   │ (DP+arcs)    │   │ (mm, Y-up)│
   └────────┘   └───────────────┘   └──────────────┘   └──────────────┘   └──────────┘
```

### 1. Calibration
- **Fiducial system**: 4 ArUco markers from `DICT_4X4_50` placed at known
  positions on an A4 sheet (see `calibration_sheet_spec.md`).
- **Detection**: OpenCV 4.7+ `cv::aruco::ArucoDetector`.
- **Correspondences**: each marker's image-space centroid ↔ known world (mm)
  position from `expectedMarkerCenters()`.
- **Homography**: `cv::findHomography` with RANSAC; reprojection error is
  reported. If `--intrinsics` is supplied, the image is undistorted with
  `cv::undistort` *before* marker detection, eliminating the dominant
  radial-distortion bias near the image border.
- **Warp**: `cv::warpPerspective` produces a top-down image at the requested
  `--pixels-per-mm` (default 4 → 0.25 mm/px, adequate for most laser-cut
  tolerances of ±0.2 mm).

### 2. Segmentation
- Background = calibration sheet → object is isolated with selectable
  segmentation methods: gradient (default), Otsu on inverted grayscale, HSV
  saturation, or adaptive thresholding.
- Morphological close (default 1 mm kernel) bridges small mask gaps from
  shadows / JPEG artifacts.
- `cv::findContours` with `RETR_CCOMP` returns a 2-level hierarchy:
  top-level contours are **outer boundaries**, their direct children are
  **holes** (cutouts). Holes are written to a separate `HOLES` layer.
- A minimum-area filter (`--min-object-mm2`, default 100) removes dust and
  ArUco-detection noise.

### 3. Geometric reconstruction
- **Simplification**: `cv::approxPolyDP` (Douglas-Peucker) with epsilon
  `--simplify-mm` (default 0.15 mm). This is smaller than typical CAM
  kerf (~0.1–0.2 mm) so we preserve real geometric features.
- **Right-angle snapping** (optional): vertices whose neighbors form an
  angle within 3° of 90° are snapped to exact 90°. Useful for sheet-metal
  brackets; do *not* enable for organic shapes.
- **Arc fitting** (optional, `--fit-arcs`): between each consecutive pair
  of simplified vertices, the original contour span is fit to a circle via
  algebraic least squares. If the max residual is below
  `--arc-tol-mm` (default 0.10), the polyline segment is replaced by a
  bulge value (LWPOLYLINE group code 42). Bulge = tan(θ/4), signed by
  arc direction. The sign is computed in CAD Y-up frame, so we flip the
  cross-product sign from image Y-down.

  **Justification**: pure-polyline output is universally compatible but
  produces noisy approximations of true arcs (a 30 mm circle becomes 32+
  short segments). Bulge-encoded LWPOLYLINEs are recognized as arcs by
  AutoCAD, LibreCAD, Fusion 360, and most CAM software, yielding cleaner
  G-code and editable geometry.

### 4. DXF generation
- Hand-rolled ASCII writer (no external libraries), R14 (`AC1014`)
  compatible.
- `HEADER` sets `$INSUNITS=4` (millimeters) so CAD software auto-scales.
- `TABLES` defines `CONTINUOUS` linetype and `0`/`OUTER`/`HOLES` layers.
- `ENTITIES` contains `LWPOLYLINE` records (one per contour). Closed
  outer polylines use flag 1; closed hole polylines also use flag 1 and
  sit on the `HOLES` layer (red, for visual distinction in CAD).
- `EOF` terminates the file.

### 5. Coordinate system
- World origin: top-left of the calibration sheet (center of marker 0's
  bounding box corner).
- After vectorization, Y is flipped so the DXF is in CAD Y-up frame.
  Origin is at (0, sheetHeightMm); the part occupies positive-XY space.

## Accuracy characteristics

### Validation procedure
Use any ISO/IEC 7810 ID-1 card (e.g., credit card: 85.60 × 53.98 mm) as
a known reference. Photograph it on the calibration sheet, run dxfer, and
compare the reported `bboxWidthMm`/`bboxHeightMm` to ground truth.

### Expected error budget
| Source                          | Typical contribution |
|---------------------------------|----------------------|
| Marker detection (pixel)        | ±0.5 px → ±0.13 mm @ 4 px/mm |
| Homography reprojection         | < 0.5 mm             |
| Lens distortion (uncorrected)   | up to 1–3 mm near borders |
| Segmentation edge bias          | ±0.5 px → ±0.13 mm   |
| JPEG compression (q=85)         | ±0.1 mm              |
| **Total (with intrinsics)**     | **~0.3 mm RMS**      |
| **Total (no intrinsics, centered)** | **~0.5–1 mm RMS** |

### Mitigations
- Supply `--intrinsics` for phone cameras.
- Crop tightly around the sheet before running dxfer to maximize pixel
  density at the markers.
- Use matte, glare-free lighting at 45° to the sheet (two light sources,
  opposite sides) to kill shadow edges.
- Increase `--pixels-per-mm` to 6–8 if your camera resolution allows.

## Limitations
- **Planar assumption**: only the top-down silhouette is reconstructed;
  3-D thickness and parts not lying flat are not represented.
- **Single dominant object**: although multi-object detection works at the
  segmentation level, the validation report currently reports stats for the
  largest contour only.
- **Color similarity**: a low-contrast object on a similar calibration sheet
  may fail one segmentation method; compare `--seg-method gradient`, `otsu`,
  `sat`, and `adaptive` with `--debug`.
- **Arc fit false positives**: tiny irregular wiggles can sometimes fit a
  large-radius arc. If you see implausibly large arcs in CAD, raise
  `--arc-tol-mm` to 0.2 mm or disable `--fit-arcs`.

## Build & run
```bash
mkdir build && cd build
cmake .. && make -j

./dxfer -i ../test/part.jpg -o ../test/part.dxf \
        --marker-size-mm 40 --sheet-width-mm 210 --sheet-height-mm 297 \
        --marker-inset-mm 20 \
        --fit-arcs --snap-right-angles \
        --report ../test/part.report.json \
        --debug  ../test/part.dbg.png
```

Requires OpenCV 4.7+ built with the `opencv_contrib` `aruco` module.
