# Configuration Parameters Reference

This document provides a comprehensive parameter reference mapping UI controls, API keys, Python variables, default values, valid ranges, and physical effects.

---

## Master Parameter Dictionary

| Parameter Key | API Payload Type | Python Parameter | Default | Range / Allowed Values | Physical Purpose & Effect |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sheetSize` | `string` | `paper_size` | `'a4'` | `'a4'`, `'a3'`, `'a5'`, `'letter'`, `'legal'` | Sets nominal target sheet physical size for metric scaling. |
| `maskThreshold` | `integer` | `mask_threshold` | `240` | `1` to `255` | Binarization cutoff threshold for background subtraction. Lower values expand boundary; higher values shrink boundary. |
| `erosionKernel` | `integer` | `erosion_kernel` | `3` | `1`, `3`, `5`, `7`, `9` (Odd) | Structuring element size for morphological erosion. Higher values shave off thicker edge artifacts. |
| `erosionIterations` | `integer` | `erosion_iterations` | `1` | `0` to `5` | Number of morphological erosion passes. |
| `minHoleArea` | `integer` | `min_hole_area` | `500` | `10` to `10000` px² | Minimum area cutoff for interior cutouts. Filters out glare, marker reflections, and dust particles. |
| `minOuterArea` | `integer` | `min_outer_area` | `100` | `10` to `10000` px² | Minimum area cutoff for standalone outer objects. Discards minor noise blobs. |
| `circleRatio` | `float` | `circle_ratio` | `0.85` | `0.50` to `1.00` | Contour area ratio threshold $\rho = A / \pi R^2$. Contours above cutoff are fit as pure CAD `CIRCLE` entities. |
| `epsilonMin` | `float` | `epsilon_min` | `0.5` | `0.1` to `5.0` px | Lower bound for Douglas-Peucker polyline simplification error. Preserves fine corner features. |
| `epsilonMax` | `float` | `epsilon_max` | `2.5` | `1.0` to `10.0` px | Upper bound for Douglas-Peucker polyline simplification error. Prevents excessive vertex counts on large perimeters. |
| `snapAngle` | `float` | `snap_angle` | `10.0` | `1.0` to `45.0` degrees | Maximum angle deviation allowed for snapping near-orthogonal segments to dominant histogram axes. |
| `snapMinLength` | `float` | `snap_min_length` | `20.0` | `1.0` to `100.0` px | Minimum segment length required to apply orthogonal snapping. Shorter segments bypass snapping. |
| `markerOffsetX` | `float` | `marker_offset_x` | `32.2` | `0.0` to `100.0` mm | Distance from paper left/right edge to ArUco marker center. |
| `markerOffsetY` | `float` | `marker_offset_y` | `34.2` | `0.0` to `100.0` mm | Distance from paper top/bottom edge to ArUco marker center. |
| `markerClearRadius` | `float` | `marker_clear_radius` | `22.0` | `5.0` to `50.0` mm | Radius around each ArUco marker cleared from vectorization. |
| `detectDetails` | `boolean` | `detect_details` | `False` | `True`, `False` | Toggles Canny detail line extraction onto `DETAILS` CAD layer. |
| `detailsThreshold1` | `integer` | `details_threshold1` | `50` | `1` to `255` | Lower Canny edge detection threshold for fine detail engraving. |
| `detailsThreshold2` | `integer` | `details_threshold2` | `150` | `1` to `255` | Upper Canny edge detection threshold for fine detail engraving. |
| `curveStrategy` | `string` | `curve_strategy` | `'current'` | `'current'`, `'arcs'`, `'polylines'` | Polyline arc fitting mode (`arcs` fits bulged polylines; `polylines` retains discrete lines). |
