"""
Persistent Python pipeline worker for the DXFify web dashboard.

Runs as a Flask HTTP server on port 8788. Keeps the rembg BiRefNet model
loaded in memory so each conversion request doesn't pay the ~2-5s model
loading cost.

Endpoints:
  POST /process  — run the full pipeline on a single image
  GET  /health   — readiness check
"""

import json
import os
import sys
import time
import traceback

from flask import Flask, jsonify, request

# Ensure dxferpy modules are importable
DXFERPY_DIR = os.path.dirname(os.path.abspath(__file__))
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

import cv2
import numpy as np
import ezdxf
from rembg import new_session, remove

# Import pipeline functions from existing scripts
from segment_object import get_aruco_corners, order_points_by_id
from vectorize_smart import (
    PAPER_SIZES,
    get_homography,
    vectorize_contour,
    smooth_curve,
)
from render_dxf import render_dxf_to_png

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Global rembg session — loaded once at startup
# ---------------------------------------------------------------------------
print("[worker] Loading rembg BiRefNet model...", flush=True)
_t0 = time.time()
rembg_session = new_session("birefnet-general-lite")
print(f"[worker] Model loaded in {time.time() - _t0:.1f}s", flush=True)


# ---------------------------------------------------------------------------
# Pipeline: single-image processing
# ---------------------------------------------------------------------------

def segment_single_image(img_path: str, session) -> tuple:
    """
    Run rembg segmentation on a single image.
    Returns (warped_bgr, mask, used_aruco: bool).
    """
    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Could not read image: {img_path}")

    corners, ids = get_aruco_corners(img)
    used_aruco = corners is not None

    if used_aruco:
        rect = order_points_by_id(corners, ids)
        width, height = 1000, 1577
        if np.linalg.norm(rect[1] - rect[0]) > np.linalg.norm(rect[3] - rect[0]):
            width, height = 1577, 1000

        dst = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype="float32",
        )
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(img, M, (width, height))
    else:
        warped = img

    rgb_warped = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    rembg_mask = remove(rgb_warped, session=session, only_mask=True)
    mask = (np.array(rembg_mask) > 240).astype(np.uint8) * 255
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)

    return warped, mask, used_aruco


def vectorize_single_image(
    warped_bgr, mask, orig_img_path: str, output_dxf: str,
    paper_w: float = 210.0, paper_h: float = 297.0,
) -> dict:
    """
    Vectorize a segmented image to DXF.
    Returns a report dict with stats.
    """
    H, scale = get_homography(orig_img_path, paper_w, paper_h)
    if H is not None:
        height = int(paper_h * scale)
    else:
        height = mask.shape[0]

    contours, hierarchy = cv2.findContours(
        mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    entity_count = 0
    outer_count = 0
    hole_count = 0
    bbox_min_x, bbox_min_y = float('inf'), float('inf')
    bbox_max_x, bbox_max_y = float('-inf'), float('-inf')
    total_perimeter = 0.0

    if hierarchy is not None:
        for i, contour in enumerate(contours):
            is_hole = hierarchy[0][i][3] != -1

            contour_f = np.array(contour, dtype=np.float32)
            if H is not None:
                contour_f = cv2.perspectiveTransform(contour_f, H)

            area = cv2.contourArea(contour_f)

            if is_hole and area < 500:
                continue
            if not is_hole and area < 100:
                continue

            (cx, cy), radius = cv2.minEnclosingCircle(contour_f)
            if radius > 0:
                circle_area = np.pi * radius * radius
                area_ratio = area / circle_area
                if area_ratio > 0.85:
                    cx_mm = float(cx) / scale
                    cy_mm = float(height - cy) / scale
                    radius_mm = float(radius) / scale
                    msp.add_circle((cx_mm, cy_mm), radius_mm)
                    entity_count += 1
                    if is_hole:
                        hole_count += 1
                    else:
                        outer_count += 1
                    # Update bbox
                    bbox_min_x = min(bbox_min_x, cx_mm - radius_mm)
                    bbox_min_y = min(bbox_min_y, cy_mm - radius_mm)
                    bbox_max_x = max(bbox_max_x, cx_mm + radius_mm)
                    bbox_max_y = max(bbox_max_y, cy_mm + radius_mm)
                    total_perimeter += 2 * np.pi * radius_mm
                    continue

            points = vectorize_contour(contour_f, height, scale)
            if points:
                msp.add_lwpolyline(points, close=True)
                entity_count += 1
                if is_hole:
                    hole_count += 1
                else:
                    outer_count += 1
                # Update bbox from polyline points
                for px, py in points:
                    bbox_min_x = min(bbox_min_x, px)
                    bbox_min_y = min(bbox_min_y, py)
                    bbox_max_x = max(bbox_max_x, px)
                    bbox_max_y = max(bbox_max_y, py)
                # Approximate perimeter
                for j in range(len(points)):
                    p1 = points[j]
                    p2 = points[(j + 1) % len(points)]
                    total_perimeter += np.hypot(p2[0] - p1[0], p2[1] - p1[1])

    doc.saveas(output_dxf)

    bbox_w = (bbox_max_x - bbox_min_x) if bbox_max_x > bbox_min_x else 0
    bbox_h = (bbox_max_y - bbox_min_y) if bbox_max_y > bbox_min_y else 0

    return {
        "success": True,
        "outerContours": outer_count,
        "holeContours": hole_count,
        "totalEntities": entity_count,
        "bboxWidthMm": round(bbox_w, 2),
        "bboxHeightMm": round(bbox_h, 2),
        "perimeterMm": round(total_perimeter, 2),
        "markersDetected": 4 if H is not None else 0,
        "pixelsPerMm": round(scale, 2),
    }


def run_pipeline(
    input_path: str,
    output_dir: str,
    paper_size: str = "a4",
) -> dict:
    """
    Run the full pipeline on a single image.
    Returns a report dict.
    """
    paper_w, paper_h = PAPER_SIZES.get(paper_size.lower(), PAPER_SIZES["a4"])

    # Paths
    result_dxf = os.path.join(output_dir, "result.dxf")
    result_dbg = os.path.join(output_dir, "result.dbg.png")
    result_preview = os.path.join(output_dir, "result.preview.png")
    result_json = os.path.join(output_dir, "result.json")

    # Step 1: Segmentation
    print(f"[worker] Segmenting {input_path}...", flush=True)
    warped, mask, used_aruco = segment_single_image(input_path, rembg_session)

    # Save debug image (RGBA overlay)
    rgba = cv2.cvtColor(warped, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = mask
    cv2.imwrite(result_dbg, rgba)

    # Step 2: Vectorization
    print(f"[worker] Vectorizing...", flush=True)
    report = vectorize_single_image(
        warped, mask, input_path, result_dxf,
        paper_w=paper_w, paper_h=paper_h,
    )

    # Step 3: DXF preview render
    print(f"[worker] Rendering DXF preview...", flush=True)
    try:
        render_dxf_to_png(result_dxf, result_preview)
    except Exception as e:
        print(f"[worker] Preview render failed: {e}", flush=True)

    # Write report JSON
    with open(result_json, "w") as f:
        json.dump(report, f, indent=2)

    print(f"[worker] Done — {report['totalEntities']} entities", flush=True)
    return report


# ---------------------------------------------------------------------------
# Flask endpoints
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "model": "birefnet-general-lite"})


@app.route("/process", methods=["POST"])
def process():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No JSON body"}), 400

    input_path = data.get("inputPath")
    output_dir = data.get("outputDir")
    paper_size = data.get("paperSize", "a4")

    if not input_path or not output_dir:
        return jsonify({
            "success": False,
            "message": "inputPath and outputDir are required",
        }), 400

    if not os.path.isfile(input_path):
        return jsonify({
            "success": False,
            "message": f"Input file not found: {input_path}",
        }), 400

    os.makedirs(output_dir, exist_ok=True)

    try:
        report = run_pipeline(input_path, output_dir, paper_size)
        return jsonify({"success": True, "report": report})
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "message": str(e),
            "traceback": traceback.format_exc(),
        }), 500


if __name__ == "__main__":
    port = int(os.environ.get("DXFERPY_PORT", 8788))
    print(f"[worker] Starting on port {port}...", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)
