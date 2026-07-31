# 03 - Web Application Architecture & Interactive Editor

## 1. Web Architecture Overview

The web dashboard (`/home/aledawizard/Files/Work/Internships/orange/code/project/dxfer/web/`) is built as a responsive single-page web app using **React 18**, **TypeScript**, **Three.js** (WebGL vector graphics), and **Express.js** (backend API bridge).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WEB CLIENT ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                            TopBar.tsx                                   │
  │     (GIMP Desktop Menu, Keyboard Shortcuts, Conversion Status)         │
  └─────────────────────────────────────────────────────────────────────────┘
  ┌─────────────────────┐ ┌─────────────────────────────────────────────────┐
  │     Toolbar.tsx     │ │                  Workspace.tsx                   │
  │  (25 CAD Tools Strip│ │ ┌───────────────────────┐ ┌───────────────────┐ │
  │  + Brush Settings)  │ │ │    DxfPreview.tsx     │ │ ImagePreview.tsx  │ │
  │                     │ │ │ (Three.js WebGL / SVG)│ │ (Photo/Mask/Sync) │ │
  │                     │ │ └───────────────────────┘ └───────────────────┘ │
  │                     │ │ ┌─────────────────────────────────────────────┐ │
  │                     │ │ │   ReportPanel | SettingsPanel | Artifacts   │ │
  │                     │ │ └─────────────────────────────────────────────┘ │
  └─────────────────────┘ └─────────────────────────────────────────────────┘
```

---

## 2. Component Hierarchy & Responsibilities

The application follows a modular component structure:

### Primary Layout & Control Components
- **`App.tsx`**: Master root state container, global shortcut handlers, API communication hub, and client-side file export generators.
- **`TopBar.tsx`**: Header bar rendering application menus (`File`, `Edit`, `View`, `Tools`, `Help`), keyboard shortcut triggers, active status badges, and help modals.
- **`Toolbar.tsx`**: Vertical tool panel rendering icons for 25 CAD tools organized into four functional tool groups (Selection, Creation, Editing, Utility).
- **`Workspace.tsx`**: Main CSS Grid container hosting dual side-by-side viewports (`DxfPreview` & `ImagePreview`) and collapsible bottom inspector panels with dynamic mouse-drag pane resizers.

### Viewport & Inspection Components
- **`DxfPreview.tsx`**: Dual-layer 2D CAD canvas combining a high-performance **Three.js WebGL** background renderer for vector geometries with an interactive **SVG** foreground layer for vertex handles, marquee selection boxes, measurements, snapping indicators, and transform widgets.
- **`ImagePreview.tsx`**: Inspection panel providing 4 image view tabs (`Original Photo`, `Debug Overlay`, `Binary Mask`, `Holes Mask`). Features homography overlay projection and bidirectional cursor coordinate crosshairs.
- **`Ruler.tsx`**: Edge ruler component placing dynamic tick mark lines along viewport boundaries scaled to physical millimeter dimensions.

### Data & Parameter Inspector Panels
- **`ReportPanel.tsx`**: Displays quantitative conversion metrics (ArUco detection count, pixels/mm scale, reprojection error, tolerance calculation, outer/hole counts, total perimeter) and context warning alerts.
- **`SettingsPanel.tsx`**: Form container for customizing processing parameters across 5 collapsible accordions (Segmentation, Contour, Vectorization, ArUco Calibration, Detail Strategies).
- **`ArtifactList.tsx`**: Download manager presenting links to output files (`result.dxf`, `result.dbg.png`, `result.mask.png`, `result.holes.png`, `result.json`).

---

## 3. State Management & Data Flow

Application state is managed natively in React using top-down unidirectional data flow from `App.tsx`:

```
                    ┌─────────────────────────┐
                    │       App.tsx State     │
                    │                         │
                    │ • entities[]            │
                    │ • rotationTransforms[]  │
                    │ • history[] / redo[]    │
                    │ • viewport {x,y,w,h}    │
                    │ • conversionSettings    │
                    │ • hoveredCoord          │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
 ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
 │  Workspace    │       │  DxfPreview   │       │ ImagePreview  │
 └───────────────┘       └───────────────┘       └───────────────┘
```

### Undo / Redo Architecture
State snapshots are preserved in two stack arrays:
```typescript
interface HistoryState {
  entities: GeometryEntity[];
  rotationTransforms: RotationStep[];
}
const [history, setHistory] = useState<HistoryState[]>([]);
const [redoStack, setRedoStack] = useState<HistoryState[]>([]);
```
Any interactive CAD modification (vertex drag, brush deformation, line addition, segment alignment) pushes a snapshot to `history`, ensuring non-destructive editing and full `Ctrl+Z` / `Ctrl+Y` support.

---

## 4. Dual CAD Viewport System

Rendering large CAD drawings (thousands of line segments) in standard DOM SVG elements can cause severe browser lag during panning and zooming. DXFify solves this by pairing WebGL and SVG:

### 1. Three.js WebGL Vector Layer (Background)
- **Role**: Renders static line and circle geometries at 60 FPS.
- **Implementation**: Constructs `THREE.LineSegments` and `THREE.LineLoop` objects with anti-aliased line materials (`THREE.LineBasicMaterial`).
- **Performance**: Capable of handling over 100,000 vertices with zero frame drops during zoom/pan operations.

### 2. Interactive SVG Foreground Layer
- **Role**: Handles pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`).
- **Elements**: Renders draggable vertex handles, circle radius rings, snapping crosshairs, measurement lines, marquee drag boxes, and transformation handles.

---

## 5. Express API Bridge & Endpoints

The web frontend communicates with a local Express server (`web/server/index.ts`, port `8787`) which acts as an isolated job proxy for the Python worker (`dxferpy/pipeline_worker.py`, port `8788`).

### API Endpoints

#### 1. `POST /api/convert`
- **Request**: `multipart/form-data` containing uploaded image file and parameter keys.
- **Action**: Generates unique `jobId` under `web/uploads/jobs/<jobId>/`, saves input image, forwards parameters to Python worker `/process`, returns artifact URLs and JSON metric report.

#### 2. `POST /api/convert-region`
- **Request**: `application/json` payload `{ jobId, bbox: [minX, minY, maxX, maxY], curveStrategy, sheetSize }`.
- **Action**: Triggers Python worker `/process_region` to re-vectorize contours located within the designated bounding box using the target curve fitting strategy.

#### 3. `GET /api/jobs/:jobId/:filename`
- **Action**: Serves generated job artifacts (`result.dxf`, PNG images) for download or browser display.

---

## 6. Client-Side Export Generators (`App.tsx`)

In addition to downloading backend-generated DXF files, the frontend provides instant client-side generation for three file formats:

### 1. Custom ASCII DXF Generator (`generateDxfString`)
Builds a complete, valid ASCII DXF string directly in TypeScript memory:
- Writes `SECTION HEADER`, `TABLES` (LTYPE dashed line definitions, LAYER records for `OUTER` Color 7 and `HOLES` Color 1), and `SECTION ENTITIES`.
- Converts DXF model coordinates $(X_{mm}, Y_{mm})$ into formatted group code pairs:
  - `CIRCLE`: Group code `10` ($c_x$), `20` ($c_y$), `40` ($r$).
  - `LWPOLYLINE`: Group code `90` (vertex count $N$), `70` (flag `1` closed / `0` open), alternating `10` ($x_i$) and `20` ($y_i$).

### 2. Standalone SVG Exporter (`generateSvgString`)
Generates clean SVG XML text containing `<circle>` and `<path>` elements:
- Viewbox scaling: `viewBox="0 0 width_px height_px"`.
- Coordinate transform from model space $(X_{mm}, Y_{mm})$ to SVG pixel space:
  $$px = X_{mm} \cdot S, \quad py = (H_{paper} - Y_{mm}) \cdot S$$
- Emits SVG `<path d="M px0 py0 L px1 py1 ... Z">` strings.

### 3. Pure Binary PDF Exporter (`generatePdfBlob`)
Constructs a valid PDF 1.4 binary Blob in memory without third-party PDF libraries:
- **PDF Coordinate Transformation**:
  Maps model millimeter coordinates $(X_{mm}, Y_{mm})$ to PDF points ($1/72\text{ inch} = 2.83464567\text{ pt/mm}$):
  $$x_{pdf} = X_{mm} \cdot 2.83464567, \quad y_{pdf} = Y_{mm} \cdot 2.83464567$$
- **PDF Graphics Operator Translation**:
  - Move to: `x_pdf y_pdf m`
  - Line to: `x_pdf y_pdf l`
  - Close path: `h`
  - Stroke path: `S`
  - Stroke color (RGB): `r g b RG` (e.g. `1 0 0 RG` for Red holes, `0 0.9 1 RG` for Cyan outer)
  - Line width: `w_pdf w`
- **Byte Offset Cross-Reference Table Calculation (`xref`)**:
  Computes byte-exact offsets $O_i$ for each PDF object ID $i \in [1, N]$:
  $$\text{xref\_start} = \sum_{k=1}^{N} \text{byte\_length}(\text{Object}_k)$$
  Formats 10-digit zero-padded byte offsets `OOOOOOOOOO 00000 n` to guarantee valid PDF 1.4 parsing.

