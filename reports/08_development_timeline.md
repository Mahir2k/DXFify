# 08 - Project Development Timeline & Evolution

## 1. Chronological Timeline Overview

The development of the **DXFify** platform progressed across seven distinct evolutionary phases between June 2026 and July 2026.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPMENT TIMELINE                                │
└─────────────────────────────────────────────────────────────────────────────┘
  Phase 1: June 26 ──► Initial C++ OpenCV / ArUco Prototype (pic)
  Phase 2: June 29 ──► Printer Margin Scale Calibration & Orthogonal Snapping
  Phase 3: July 01 ──► Automated DXF Rendering Verification Pipeline
  Phase 4: July 03 ──► Transition to Python Engine (dxferpy) & Circle Fitting
  Phase 5: July 09 ──► BiRefNet Deep Learning AI Segmentation Integration
  Phase 6: July 16 ──► Web Dashboard & Native SVG Vector Renderer
  Phase 7: July 27 ──► Full Interactive Web CAD Workspace & Matrix Sync
```

---

## 2. Evolutionary Phases & Key Milestones

### Phase 1: Initial C++ Concept & Camera Capture (June 26, 2026)
- **Primary Objective**: Establish feasibility of converting physical object photographs into DXF vector files.
- **Key Developments**:
  - Implemented C++ application using OpenCV (`cv2.aruco`) and custom ASCII DXF generator (`DxfWriter`).
  - Target geometry: 4 ArUco markers ($30\text{ mm}$ size) placed at corners of an A4 sheet.
  - Integrated Raspberry Pi camera hardware capture interface (`pic/main.cpp`).
  - First experiments with Canny/Sobel edge detection and Otsu thresholding on sample wood block images.
- **Initial Observations**:
  - Raw edge detection produced double lines (inner and outer edge of high-contrast boundaries).
  - Contour lines exhibited pixel staircase aliasing (wobbliness).

---

### Phase 2: Scale Calibration & Orthogonal Snapping (June 29, 2026)
- **Primary Objective**: Resolve real-world metric scaling errors and correct tilted object scans.
- **Key Developments**:
  - **Printer Scale Fix**: Identified that physical printed A4 calibration sheets yielded $160.66\text{ mm}$ DXF dimensions for a $119.50\text{ mm}$ part due to unprintable printer margins. Introduced printer margin correction factor ($\gamma \approx 0.7438$).
  - **Manhattan-World Orthogonal Snapping**: Introduced segment direction histogram snapping (`angleTolDeg = 46°`) to straighten distorted $90^\circ$ teeth angles on tilted object scans (`wood_tilted`).
  - **Architectural Redesign**: Restructured C++ core pipeline to support separate outer vs. hole hierarchy processing (`RETR_CCOMP`).

---

### Phase 3: Automated DXF Preview Rendering (July 1, 2026)
- **Primary Objective**: Establish automated visual regression testing.
- **Key Developments**:
  - Built automated rendering script (`render_*.png`) generating high-DPI image previews of output DXF files.
  - Enabled rapid visual inspection of vector artifacts (swallowtails, unwanted chamfers, wobbly lines) without launching external CAD software (AutoCAD / LibreCAD).

---

### Phase 4: Python Engine Transition & Hole Handling (July 2–3, 2026)
- **Primary Objective**: Transition algorithm development to Python (`dxferpy`) for rapid mathematical iteration.
- **Key Developments**:
  - Created `dxferpy` package: `vectorize_smart.py`, `segment_object.py`, `render_dxf.py`.
  - Added robust least-squares circle fitting (`fit_circle_robust`) for circular cutouts and bolt holes.
  - Added Gaussian binary mask smoothing (`smooth_binary_mask`) to eliminate pixel staircase aliasing.
  - Implemented arc run detection (`detect_arc_runs`) to preserve true circular arcs on slot end caps instead of polyline facets.

---

### Phase 5: BiRefNet AI Segmentation Integration (July 9, 2026)
- **Primary Objective**: Eliminate shadow artifacts and low-contrast background segmentation failures.
- **Key Developments**:
  - Integrated **BiRefNet** deep-learning model (`output/rgba_*.png`) via ONNX Runtime and `rembg`.
  - Implemented domain transform guided filtering (`cv2.ximgproc.guidedFilter`) to refine binary mask boundaries.
  - **Fixed Octagonal Curve Collapse Bug**: Resolved issue where adaptive epsilon logic turned curved cutouts into octagons.
  - **Fixed 3 Vectorization Bugs**:
    1. *Box Blur Peak Artifact*: Replaced box blur on angle histogram with 5-tap Gaussian convolution.
    2. *Orthogonality Enforcement*: Enforced strict $90^\circ$ orthogonality on secondary directions.
    3. *Wraparound Pop Bug*: Removed index-destroying contour point popping.

---

### Phase 6: Web Dashboard & Flask HTTP Worker (July 16, 2026)
- **Primary Objective**: Replace CLI scripts with a responsive web dashboard.
- **Key Developments**:
  - Created `dxfer/web` React + Vite web application and `pipeline_worker.py` Flask microservice.
  - Preloaded BiRefNet model into RAM at worker launch, eliminating 4-second ONNX load delay per request.
  - Solved 12GB worker memory leak.
  - Replaced static PNG preview displays with native interactive SVG CAD rendering (`DxfPreview.tsx`).

---

### Phase 7: Interactive CAD Editor & Matrix Synchronization (July 20–27, 2026)
- **Primary Objective**: Build desktop-class CAD editing tools and solve coordinate transformation synchronization.
- **Key Developments**:
  - Implemented 25 interactive CAD editing tools (fillet, chamfer, spline, 3-point circle, slot, centerline, brush deformation, marquee selection).
  - Developed Express server parameter forwarding (`/api/convert` and `/api/convert-region`).
  - Added multi-format client-side exporters (ASCII DXF, SVG, raw binary PDF 1.4).
  - **Unified Coordinate System Refactor** (`coordinateTransforms.ts`): Derived exact SVG matrix transform formula (`matrix(a, b, c, d, e, f)`), unifying homography, 2D rigid rotation composition, and image overlay synchronization.

### Phase 8: Standalone Desktop App & CAD Tool Overhaul (August 1–5, 2026)
- **Primary Objective**: Package standalone zero-dependency desktop application and execute deep CAD editing engine refactoring.
- **Key Developments**:
  - **Standalone Executable Packaging**: Bundled Flask backend, PyQt6 window shell, and ONNX Runtime neural weights into single-binary PyInstaller desktop bundle (`dist/dxfify`). Resolved process fork bombs (`freeze_support`) and transitive metadata imports.
  - **2-Point CAD Tool Interaction Engine**: Refactored Fillet, Chamfer, Fuse, and B-Spline tools to support robust 2-point corner selection ($P_1, P_2$).
  - **Inward Quadratic Bézier Fillet Arc Math**: Eliminated $270^\circ$ outward arc ballooning by replacing circular arc math with inward quadratic Bézier curves and maximum distance corner vertex detection.
  - **Centripetal Catmull-Rom B-Splines**: Replaced uniform Catmull-Rom math with centripetal knot parameterization ($\alpha = 0.5$), eliminating overshoot spikes.
  - **Segment-Bounded Polyline Trimming**: Resolved $166\text{ mm}$ spike loops by preserving outer endpoints ($V_0, V_{n-1}$) during 2-point array slice replacement.
  - **Unified Real-Time SVG Preview**: Synchronized SVG dashed preview math 1-to-1 with final committed geometry.

---

## 3. Key Milestones Summary Table

| Date | Phase | Module | Major Technical Breakthrough |
| :--- | :--- | :--- | :--- |
| **June 26** | Phase 1 | `pic` / C++ | Initial OpenCV ArUco homography & C++ DXF writer |
| **June 29** | Phase 2 | C++ Core | Printer margin scale calibration factor & Manhattan snapping |
| **July 01** | Phase 3 | Testing | Automated DXF high-DPI PNG rendering pipeline |
| **July 03** | Phase 4 | `dxferpy` | Python transition, robust circle fitting, arc run detection |
| **July 09** | Phase 5 | `dxferpy` | BiRefNet AI segmentation, guided filter, vectorization bug fixes |
| **July 16** | Phase 6 | `dxfer/web` | Flask HTTP microservice, React web dashboard, SVG CAD viewer |
| **July 27** | Phase 7 | `dxfer/web` | 25 CAD tools, sub-region reprocessing, coordinate transform math |
| **August 05** | Phase 8 | `desktop` / `web` | PyInstaller standalone binary, 2-point CAD tool overhaul, centripetal splines |
