# REST API Specification

This document details the REST API endpoints exposed by Express gateway (`:8787`), Python worker (`:8788`), and standalone desktop Flask server (`:3001`).

---

## Endpoints Summary

| Endpoint | Method | Content-Type | Description |
| :--- | :--- | :--- | :--- |
| `/api/convert` | `POST` | `multipart/form-data` | Upload photo and execute end-to-end vector conversion pipeline. |
| `/api/convert-region` | `POST` | `application/json` | Reprocess sub-region bounding box against stored original image. |
| `/api/jobs/<jobId>/<file>` | `GET` | Binary / JSON | Download generated job output files (DXF, PNG, JSON). |

---

## 1. `POST /api/convert`

Executes image segmentation, homography matrix calculation, and DXF vectorization.

### Request Headers
`Content-Type: multipart/form-data`

### Request Body Parameters
- `image` (File, Required): Target photograph file (JPG/PNG).
- `sheetSize` (string, Optional): Target paper size (`a4`, `a3`, `a5`, `letter`, `legal`). Default `'a4'`.
- `maskThreshold` (int, Optional): Cutoff threshold (1–255). Default `240`.
- `erosionKernel` (int, Optional): Morphological erosion kernel size (1–9). Default `3`.
- `erosionIterations` (int, Optional): Erosion passes. Default `1`.
- `epsilonMin` (float, Optional): Min DP simplification limit. Default `0.5`.
- `epsilonMax` (float, Optional): Max DP simplification limit. Default `2.5`.
- `snapAngle` (float, Optional): Max orthogonal line snap angle (degrees). Default `10.0`.
- `curveStrategy` (string, Optional): Fitting mode (`current`, `arcs`, `polylines`). Default `'current'`.
- `detectDetails` (bool/string, Optional): Extract surface engraving lines. Default `false`.

### Response Payload (`200 OK`)
```json
{
  "success": true,
  "jobId": "e7f8a910-1234-5678-9abc-def012345678",
  "report": {
    "markersDetected": 4,
    "pixelsPerMm": 4.12,
    "reprojectionErrorPx": 0.14,
    "outerContours": 1,
    "holeContours": 2,
    "bboxWidthMm": 82.4,
    "bboxHeightMm": 134.9,
    "perimeterMm": 422.5,
    "totalEntities": 14
  },
  "files": {
    "dxf": "/api/jobs/e7f8a910-1234-5678-9abc-def012345678/result.dxf",
    "preview": "/api/jobs/e7f8a910-1234-5678-9abc-def012345678/result.preview.png",
    "dbg": "/api/jobs/e7f8a910-1234-5678-9abc-def012345678/result.dbg.png",
    "json": "/api/jobs/e7f8a910-1234-5678-9abc-def012345678/result.json"
  }
}
```

---

## 2. `POST /api/convert-region`

Reprocesses a specific sub-region bounding box without re-uploading the original image.

### Request Headers
`Content-Type: application/json`

### Request Body
```json
{
  "jobId": "e7f8a910-1234-5678-9abc-def012345678",
  "bbox": [10.5, 20.0, 100.0, 150.5],
  "sheetSize": "a4",
  "maskThreshold": 240,
  "curveStrategy": "current"
}
```

### Response Payload (`200 OK`)
Same JSON structure as `/api/convert`.
