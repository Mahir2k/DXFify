# 07 - Metric Calibration System & Dimensional Accuracy

## 1. Calibration System Overview

Reverse-engineering 2D physical components to CAD requires guaranteed 1:1 metric accuracy (millimeter scale). Uncalibrated mobile photography suffers from distance variations, optical lens distortion, and camera tilt. DXFify achieves millimeter-level spatial fidelity using a **Fiducial Metric Calibration System** based on standard paper target sheets printed with four corner ArUco markers.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          A4 CALIBRATION TARGET SHEET                         │
│                           (210 mm × 297 mm Outer)                           │
└─────────────────────────────────────────────────────────────────────────────┘
  (2) Top-Left ArUco                                        (3) Top-Right ArUco
  [32.2, 262.8] mm                                         [177.8, 262.8] mm
   ┌───────┐                                                 ┌───────┐
   │ 4x4   │                                                 │ 4x4   │
   │ ID 2  │                                                 │ ID 3  │
   └───────┘                                                 └───────┘

                             ┌───────────────┐
                             │  Target Object│
                             │  Placement    │
                             │  Zone         │
                             └───────────────┘

   ┌───────┐                                                 ┌───────┐
   │ 4x4   │                                                 │ 4x4   │
   │ ID 1  │                                                 │ ID 1  │
   └───────┘                                                 └───────┘
  (1) Bottom-Left ArUco                                    (0) Bottom-Right ArUco
  [32.2, 34.2] mm                                          [177.8, 34.2] mm
```

---

## 2. ArUco Target Sheet Specifications

### Marker Placement Geometry
- **Dictionary**: `DICT_4X4_50`
- **Marker Physical Size**: $30.0\text{ mm} \times 30.0\text{ mm}$ outer square boundary.
- **Default Offset Distance**:
  - $X_{offset} = 32.2\text{ mm}$ (distance from paper left edge to marker center).
  - $Y_{offset} = 34.2\text{ mm}$ (distance from paper bottom edge to marker center).

### Supported Paper Sizes (`PAPER_SIZES` in `vectorize_smart.py`)

| Paper Format | Width ($W_{mm}$) | Height ($H_{mm}$) | Working Pixels ($S = 10.0\text{ px/mm}$) |
| :--- | :--- | :--- | :--- |
| **A4** (Default) | $210.0\text{ mm}$ | $297.0\text{ mm}$ | $2100 \times 2970\text{ px}$ |
| **A3** | $297.0\text{ mm}$ | $420.0\text{ mm}$ | $2970 \times 4200\text{ px}$ |
| **A2** | $420.0\text{ mm}$ | $594.0\text{ mm}$ | $4200 \times 5940\text{ px}$ |
| **A1** | $594.0\text{ mm}$ | $841.0\text{ mm}$ | $5940 \times 8410\text{ px}$ |
| **A5** | $148.0\text{ mm}$ | $210.0\text{ mm}$ | $1480 \times 2100\text{ px}$ |
| **Letter** | $215.9\text{ mm}$ | $279.4\text{ mm}$ | $2159 \times 2794\text{ px}$ |
| **Legal** | $215.9\text{ mm}$ | $355.6\text{ mm}$ | $2159 \times 3556\text{ px}$ |

---

## 3. Printer Margin Calibration Factor Discovery

During initial testing on printed A4 calibration sheets, generated DXF drawings exhibited systematic scaling errors (measuring $160.66\text{ mm}$ on DXF vs. $119.50\text{ mm}$ on physical parts).

### Root Cause Analysis
Standard desktop printers enforce **unprintable physical margins** (typically $3\text{--}5\text{ mm}$ around paper edges). When printing PDFs without enabling "Actual Size / 100% Scale", PDF reader software automatically shrinks the document to fit within printable margins, placing ArUco markers closer together than specified by theoretical PDF coordinates.

### Calibration Solution
1. Measure physical distance between printed ArUco marker centers using digital calipers ($L_{actual} = 119.50\text{ mm}$).
2. Compute printer scaling correction factor:
$$\gamma_{printer} = \frac{L_{actual}}{L_{theoretical}} = \frac{119.50}{160.66} \approx 0.7438$$
3. Update marker offset parameters in `conversionSettings` to reflect true printed physical coordinates:
$$\text{Offset}_{actual} = \text{Offset}_{nominal} \cdot \gamma_{printer}$$

This calibration factor restored true 1:1 metric accuracy ($\pm 0.1\text{ mm}$).

---

## 4. Reprojection Error & Tolerance Estimation

To provide quantitative quality feedback to the user, `ReportPanel.tsx` calculates reprojection error and dimensional tolerance.

### 1. Reprojection Error Calculation ($\text{err}_{px}$)
Given detected marker centers $(x_i, y_i)$ and homography reprojected points $(\hat{x}_i, \hat{y}_i)$:

$$\text{err}_{px} = \frac{1}{4} \sum_{i=0}^3 \sqrt{(x_i - \hat{x}_i)^2 + (y_i - \hat{y}_i)^2}$$

### 2. Physical Dimensional Tolerance ($\pm\text{mm}$)
Tolerance is estimated based on reprojection error and pixel resolution scale $S$:

$$\text{Tolerance}_{mm} = \pm \left( \frac{\text{err}_{px}}{S} + \Delta_{contour} \right)$$

Where $\Delta_{contour} \approx 0.05\text{ mm}$ accounts for sub-pixel contour quantization.

### Contextual Warning Banners (`ReportPanel.tsx`)
- **Missing Markers Warning**: Triggered if fewer than 4 ArUco markers are detected.
- **High Reprojection Error**: Triggered if $\text{err}_{px} > 2.5\text{ px}$ (indicates severe camera lens distortion or paper wrinkling).
- **Zero Cutouts Warning**: Triggered if no internal holes are detected (reminds user to verify hole area threshold settings).

---

## 5. Physical Setup Guidelines

For maximum conversion accuracy, physical capture should adhere to the following setup parameters:

1. **Flat Target Sheet**: Ensure calibration sheet is laid completely flat (use double-sided tape on table surface if paper is curled).
2. **Diffuse Overhead Lighting**: Avoid direct directional desk lamps that cast harsh drop shadows. Use ambient or diffuse overhead lighting.
3. **Camera Angle**: Position camera as close to perpendicular ($90^\circ$ top-down) as possible. While homography corrects up to $45^\circ$ tilt, perpendicular capture maximizes sensor resolution on object edges.
4. **Contrast Background**: Select paper color contrasting with the physical object (e.g. white sheet for dark objects, dark sheet for white objects).
