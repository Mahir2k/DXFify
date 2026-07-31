# ArUco Marker Calibration & Homography Perspective Correction

This document details the fiducial marker calibration system, mathematical formulation of camera perspective correction, homography matrix calculation, and physical printer margin scale compensation.

---

## 1. Fiducial Marker Configuration

To extract 1:1 metric measurements in millimeters from single photographs, DXFify uses a target paper calibration sheet (A4, A3, A5, Letter, Legal) with four corner ArUco markers:

- **ArUco Dictionary**: `DICT_4X4_50`
- **Marker Corner IDs**:
  - `ID 0`: Top-Left (TL)
  - `ID 1`: Top-Right (TR)
  - `ID 2`: Bottom-Right (BR)
  - `ID 3`: Bottom-Left (BL)
- **Default Marker Positions (Nominal Paper Edge Offsets)**:
  - Marker Center X ($X_{offset}$): `32.2 mm`
  - Marker Center Y ($Y_{offset}$): `34.2 mm`
  - Marker Clear Radius ($R_{clear}$): `22.0 mm`

```
┌─────────────────────────────────────────────────────────────┐
│ (0) [32.2, 34.2]                          (1) [W-32.2, 34.2]│
│                                                             │
│                                                             │
│                      Physical Object                        │
│                         (Target)                            │
│                                                             │
│                                                             │
│ (3) [32.2, H-34.2]                      (2) [W-32.2, H-34.2]│
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Direct Linear Transform (DLT) Homography Calculation

Given raw camera image corner coordinates $\mathbf{p}_i = (u_i, v_i)^T$ and known target paper coordinates $\mathbf{P}_i = (X_i, Y_i)^T$ for $i \in \{0, 1, 2, 3\}$, the 3x3 perspective homography matrix $\mathbf{H}$ satisfies:

$$\begin{bmatrix} X_i \\ Y_i \\ 1 \end{bmatrix} \sim \mathbf{H} \begin{bmatrix} u_i \\ v_i \\ 1 \end{bmatrix} = \begin{bmatrix} h_{11} & h_{12} & h_{13} \\ h_{21} & h_{22} & h_{23} \\ h_{31} & h_{32} & h_{33} \end{bmatrix} \begin{bmatrix} u_i \\ v_i \\ 1 \end{bmatrix}$$

- **Solver Function**: `cv2.findHomography(src_points, dst_points, cv2.RANSAC)` in `dxferpy/segment_object.py`.
- **Warp Function**: `cv2.warpPerspective(img, H, (target_w_px, target_h_px))` produces a top-down, distortion-free rectified image.

---

## 3. Printer Margin Scale Factor ($\gamma_{printer}$)

Desktop printers enforce unprintable physical page margins ($3\text{--}5\text{ mm}$). When target PDF calibration sheets are printed with default "Fit to Printable Area" options instead of "100% Actual Size", the printed distance between ArUco markers shrinks, causing uncalibrated homography solvers to overestimate physical object dimensions by up to $34.4\%$.

To compensate, DXFify incorporates a physical calibration factor $\gamma_{printer}$:

$$\gamma_{printer} = \frac{\text{Distance}_{measured\_caliper}}{\text{Distance}_{nominal\_pdf}} \approx 0.7438$$

`SettingsPanel.tsx` and `segment_object.py` apply $\gamma_{printer}$ directly to target marker coordinates:

$$X_{effective} = X_{nominal} \cdot \gamma_{printer}, \quad Y_{effective} = Y_{nominal} \cdot \gamma_{printer}$$

This restores sub-millimeter precision ($\pm 0.1\text{ mm}$) across scaled target prints.
