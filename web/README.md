# DXFify Web Dashboard & Express Gateway (`web`)

The `web` directory contains the modern web application interface for **DXFify**. It includes a high-performance Express Node.js backend server and a React single-page application built with Vite and TypeScript.

---

## Web Architecture Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │               React Client (Vite + TS)                  │
 │                                                         │
 │ ┌─────────────┐  ┌──────────────────┐  ┌──────────────┐ │
 │ │  TopBar.tsx │  │ DxfPreview (CAD) │  │ ImagePreview │ │
 │ └─────────────┘  └──────────────────┘  └──────────────┘ │
 └────────────────────────────┬────────────────────────────┘
                              │ HTTP / JSON & Multipart
 ┌────────────────────────────▼────────────────────────────┐
 │               Express Gateway (server/index.ts)          │
 │                                                         │
 │ • Job Storage (/uploads/jobs/:uuid/)                    │
 │ • ChildProcess Management & Auto-Restart                │
 │ • Concurrency Queue Serialization (enqueue)             │
 └────────────────────────────┬────────────────────────────┘
                              │ HTTP (127.0.0.1:8788)
 ┌────────────────────────────▼────────────────────────────┐
 │             Python Worker (pipeline_worker.py)          │
 └─────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
web/
├── server/
│   └── index.ts               # Express API gateway & process supervisor
├── src/
│   ├── App.tsx                # Main state container & file export generators
│   ├── types.ts               # TypeScript interfaces & domain models
│   ├── api/
│   │   └── convertClient.ts   # Fetch client for conversion API
│   ├── components/
│   │   ├── TopBar.tsx         # Menu bar, file input triggers, export popups
│   │   ├── Workspace.tsx      # Split-pane layout container
│   │   ├── DxfPreview.tsx     # Three.js + SVG interactive CAD canvas editor
│   │   ├── ImagePreview.tsx   # Raster image viewer & vector overlay panel
│   │   ├── SettingsPanel.tsx  # Dynamic conversion parameter controls
│   │   ├── ReportPanel.tsx    # Calibration metrics & error diagnostic report
│   │   ├── Toolbar.tsx        # CAD editing tool selection grid
│   │   ├── Ruler.tsx          # Metric viewport ruler ticks
│   │   ├── ArtifactList.tsx   # Download links panel for generated files
│   │   └── dxf/
│   │       ├── CadStatusBar.tsx # Viewport status bar & cursor tracking
│   │       └── useCadTools.ts   # Interactive drawing tool state machine
│   └── utils/
│       ├── coordinateTransforms.ts # Dual coordinate space transformations
│       └── geometryUtils.ts        # Bounding box & geometry math helpers
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Coordinate Systems & Transformation Pipeline

DXFify operates across two distinct 2D coordinate spaces:

1. **Image Pixel Space** $(x_{px}, y_{px})$:
   - Origin $(0, 0)$ is top-left of the original raster photograph.
   - Used by HTML `<img />` tags, SVG canvas overlays, and raw cursor position listeners.

2. **Millimeter Model Space** $(x_{mm}, y_{mm})$:
   - Origin $(0, 0)$ is at the bottom-left of the physical CAD workspace (matching standard AutoCAD / DXF conventions where $Y$ points upward).
   - All exported DXF entities operate in this 1:1 millimeter space.

The conversion helper functions in [`coordinateTransforms.ts`](file:///home/aledawizard/Files/Work/Internships/orange/code/project/dxfer/web/src/utils/coordinateTransforms.ts) provide bidirectional mapping:
- `dxfModelToImagePixels(x_mm, y_mm)`: Converts CAD model coordinates to raster pixel coordinates.
- `imagePixelsToDxfModel(px, py)`: Converts screen cursor clicks into physical millimeter coordinates.

---

## Interactive CAD Editing Tools

The interactive CAD editor ([`DxfPreview.tsx`](file:///home/aledawizard/Files/Work/Internships/orange/code/project/dxfer/web/src/components/DxfPreview.tsx)) supports 24 specialized editing tools:

| Tool | Icon | Description |
|------|------|-------------|
| **Select** | `↖` | Select elements, drag vertex handles, or rotate geometry. |
| **Line** | `╱` | Draw 2-point line segments. |
| **Arc** | `⌒` | Create 3-point arc curves (Start $\rightarrow$ End $\rightarrow$ Peak). |
| **Polyline** | `N` | Draw multi-point open or closed polylines. |
| **Rectangle 3PT**| `▭` | Create oriented rectangles from 3 corner picks. |
| **Circle 3PT** | `◯` | Fit circles passing through 3 picked points. |
| **Slot 4PT** | `⬭` | Draw stadium slot cutouts from 4 control points. |
| **Centerline** | `✛` | Add bisecting centerlines between selected parallel features. |
| **Chamfer** | `◣` | Apply straight angled cuts at polyline corners. |
| **Fillet** | `╭` | Apply smooth rounded fillets at polyline corners. |
| **Spline** | `S` | Draw Catmull-Rom smooth splines. |
| **Cut / Split** | `✂` | Split polyline segments at click locations. |
| **Fuse / Merge** | `⋃` | Join touching polylines into continuous contours. |
| **Physical Brush**| `🖌` | Push vertices outward using spherical or cubic deformation brushes. |
| **Measure** | `📏` | Drag distance measuring ruler. |
| **Mark Hole** | `○` | Toggle entity layer between `OUTER` and `HOLES`. |
| **Delete** | `🗑` | Remove selected geometry entities. |
| **Sub-Region** | `⬚` | Select a bounding box to reprocess selectively with alternative algorithms. |

---

## Export File Generators

The web frontend includes client-side generators in [`App.tsx`](file:///home/aledawizard/Files/Work/Internships/orange/code/project/dxfer/web/src/App.tsx) for instant file exports:
- **DXF (R2010)**: Generates AutoCAD ASCII DXF files with `HEADER`, `TABLES`, `LTYPE`, and `ENTITIES` sections.
- **SVG**: Generates scalable vector graphics with dark mode styling (`#1c1c1e` background) and layer color coding (`#5b9bd5` for HOLES, `#10b981` for DETAILS, `#ffffff` for OUTER).
- **PDF**: Generates raw PDF 1.4 document streams scaled 1:1 in millimeters suitable for direct printing.

---

## Development Setup

```bash
# Install Dependencies
cd web
npm install

# Run Development Environment (spawns Express API + Vite client + Python worker)
npm run dev

# Run Mock Development Mode (no Python dependencies required)
DXFER_MOCK=1 npm run dev

# Production Build Check
npm run build
```
