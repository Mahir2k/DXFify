# Vectorization & Geometry Fitting Algorithms

This document details contour topology extraction, circle ratio classification, Douglas-Peucker polyline simplification, Gaussian-smoothed orthogonal angle snapping, and detail engraving line extraction.

---

## 1. Contour Extraction & Hierarchy Topology

Contour extraction is implemented in `dxferpy/vectorize_smart.py` using OpenCV hierarchy retrieval:

```python
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
```

- **Outer Bounds (`OUTER` Layer)**: Contours with no parent (`hierarchy[0][i][3] == -1`). Contours with area $< \text{minOuterArea}$ (default 100 px²) are discarded.
- **Interior Cutouts (`HOLES` Layer)**: Contours with a valid parent index (`hierarchy[0][i][3] != -1`). Contours with area $< \text{minHoleArea}$ (default 500 px²) are discarded to filter out noise and glare.

---

## 2. Circle Ratio Classification ($\rho$)

Standard polyline simplification collapses smooth circular holes (e.g. bolt holes) into octagons. `vectorize_smart.py` evaluates candidate contours against minimum enclosing circle area:

$$\rho = \frac{A_{contour}}{\pi R_{min}^2}$$

where $R_{min}$ is computed via `cv2.minEnclosingCircle(contour)`.

- If $\rho \ge \text{circleRatio}$ (default `0.85`), the contour is classified directly as a CAD `CIRCLE` entity parameterized by center $(X_c, Y_c)$ and radius $R_{min}$, bypassing Douglas-Peucker simplification.

---

## 3. Adaptive Douglas-Peucker Polyline Simplification

For non-circular contours, initial raw pixel boundaries contain thousands of dense, noisy points. Simplification uses Douglas-Peucker (`cv2.approxPolyDP`) with adaptive epsilon formula:

$$\epsilon = \text{clip}(0.003 \cdot P_{contour}, \epsilon_{min}, \epsilon_{max})$$

- `epsilonMin` (default `0.5 px`): Preserves subtle curve features.
- `epsilonMax` (default `2.5 px`): Prevents over-simplification on large perimeters.

---

## 4. Gaussian-Smoothed Orthogonal Angle Snapping

Mechanical components frequently possess orthogonal $90^\circ$ corners (Manhattan-world assumption). Photo noise can skew rectangular corners to $87^\circ$ or $93^\circ$.

```
180° Direction Histogram H
  ├── Calculate segment angle θ = atan2(dy, dx) mod 180° for all polyline segments.
  ├── Weight histogram entries by segment length L.
  ├── Smooth histogram H with 5-tap Gaussian kernel [0.05, 0.25, 0.40, 0.25, 0.05].
  └── Identify primary peak angle θ_dominant.
```

If a line segment's angle lies within $\text{snapAngle}$ (default `10.0°`) of $\theta_{dominant}$ or $\theta_{dominant} + 90^\circ$, its orientation is locked to the orthogonal axis, eliminating "swallowtail" corner distortion.

---

## 5. Detail Engraving Line Extraction (`DETAILS` Layer)

When `detectDetails=True` is requested, `vectorize_smart.py` extracts surface grooves, embossed text, or internal features:

1. Computes double Canny edge detection on the warped RGB image (`threshold1=50, threshold2=150`).
2. Masks out regions outside the primary object body and near ArUco markers.
3. Simplifies open edge paths and assigns them to the `DETAILS` CAD layer (colored green/emerald in CAD previews and exported DXF files).
