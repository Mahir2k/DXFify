# Calibration Sheet Specification

## Layout
- **Sheet size**: A4 portrait (210 × 297 mm) printed at 1:1 scale.
- **Margin**: 20 mm from each edge.
- **Markers**: 4 ArUco markers from `DICT_4X4_50`, IDs 0, 1, 2, 3.
- **Marker size**: 40 × 40 mm.
- **Marker centers** (mm, origin top-left, +X right, +Y down):

| ID | X     | Y     | Position        |
|----|-------|-------|-----------------|
| 0  | 40    | 40    | top-left        |
| 1  | 170   | 40    | top-right       |
| 2  | 170   | 257   | bottom-right    |
| 3  | 40    | 257   | bottom-left     |

## Printing requirements
- Print on rigid card stock or matte photo paper to avoid curl.
- Verify printed marker side length with calipers; pass the measured value to
  `--marker-size-mm`. Even 0.5 mm of printer scaling error translates
  directly into dimensional error in the output DXF.
- Avoid lamination glare; matte finish preferred.

## Marker ordering
The detector assumes IDs 0..3 arranged clockwise starting at top-left.
If your sheet uses a different layout, edit `expectedMarkerCenters()` in
`src/Calibration.cpp`.

## Optional: camera intrinsics YAML
Useful for phones with significant lens distortion. Format:
```yaml
%YAML:1.0
camera_matrix: !opencv-matrix
   rows: 3
   cols: 3
   dt: d
   data: [ fx, 0, cx, 0, fy, cy, 0, 0, 1 ]
distortion_coefficients: !opencv-matrix
   rows: 1
   cols: 5
   dt: d
   data: [ k1, k2, p1, p2, k3 ]
```
Obtain via `opencv/samples/cpp/calibration.cpp` with a checkerboard.
