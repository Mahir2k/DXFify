import json
import os
import sys
import time
import traceback

from flask import Flask, jsonify, request

DXFERPY_DIR = os.path.dirname(os.path.abspath(__file__))
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

import cv2
import ezdxf
import numpy as np
from rembg import new_session, remove
from render_dxf import render_dxf_to_png
from segment_object import get_aruco_corners, order_points_by_id
from vectorize_smart import PAPER_SIZES, get_homography, smooth_curve, vectorize_contour

app = Flask(__name__)


print("[worker] Loading rembg BiRefNet model...", flush=True)
_t0 = time.time()
rembg_session = new_session("birefnet-general-lite")
print(f"[worker] Model loaded in {time.time() - _t0:.1f}s", flush=True)


def segment_single_image(
    img_path: str,
    session,
    *,
    mask_threshold=240,
    erosion_kernel=3,
    erosion_iterations=1,
) -> tuple:
    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Could not read image: {img_path}")

    corners, ids = get_aruco_corners(img)
    used_aruco = corners is not None

    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    rembg_mask = remove(rgb_img, session=session, only_mask=True)
    mask = (np.array(rembg_mask) > mask_threshold).astype(np.uint8) * 255
    mask = cv2.erode(
        mask,
        np.ones((erosion_kernel, erosion_kernel), np.uint8),
        iterations=erosion_iterations,
    )

    return img, mask, used_aruco


def vectorize_single_image(
    mask,
    scale: float,
    output_dxf: str,
    paper_h: float,
    *,
    min_hole_area: int = 500,
    min_outer_area: int = 100,
    circle_ratio: float = 0.85,
    epsilon_min: float = 0.5,
    epsilon_max: float = 2.5,
    snap_angle: float = 10.0,
    snap_min_length: float = 20.0,
) -> dict:
    height = mask.shape[0]

    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    entity_count = 0
    outer_count = 0
    hole_count = 0
    bbox_min_x, bbox_min_y = float("inf"), float("inf")
    bbox_max_x, bbox_max_y = float("-inf"), float("-inf")
    total_perimeter = 0.0

    entities = []

    if hierarchy is not None:
        for i, contour in enumerate(contours):
            is_hole = hierarchy[0][i][3] != -1
            layer = "HOLES" if is_hole else "OUTER"

            contour_f = np.array(contour, dtype=np.float32)

            area = cv2.contourArea(contour_f)

            if is_hole and area < min_hole_area:
                continue
            if not is_hole and area < min_outer_area:
                continue

            (cx, cy), radius = cv2.minEnclosingCircle(contour_f)
            if radius > 0:
                circle_area = np.pi * radius * radius
                area_ratio = area / circle_area
                if area_ratio > circle_ratio:
                    cx_mm = float(cx) / scale
                    cy_mm = float(height - cy) / scale
                    radius_mm = float(radius) / scale
                    msp.add_circle((cx_mm, cy_mm), radius_mm)

                    entities.append(
                        {
                            "type": "circle",
                            "layer": layer,
                            "cx": round(cx_mm, 4),
                            "cy": round(cy_mm, 4),
                            "r": round(radius_mm, 4),
                        }
                    )

                    entity_count += 1
                    if is_hole:
                        hole_count += 1
                    else:
                        outer_count += 1

                    bbox_min_x = min(bbox_min_x, cx_mm - radius_mm)
                    bbox_min_y = min(bbox_min_y, cy_mm - radius_mm)
                    bbox_max_x = max(bbox_max_x, cx_mm + radius_mm)
                    bbox_max_y = max(bbox_max_y, cy_mm + radius_mm)
                    total_perimeter += 2 * np.pi * radius_mm
                    continue

            points = vectorize_contour(
                contour_f,
                height,
                scale,
                epsilon_min=epsilon_min,
                epsilon_max=epsilon_max,
                snap_angle=snap_angle,
                snap_min_length=snap_min_length,
            )
            if points:
                msp.add_lwpolyline(points, close=True)

                entities.append(
                    {
                        "type": "polyline",
                        "layer": layer,
                        "points": [[round(px, 4), round(py, 4)] for px, py in points],
                        "closed": True,
                    }
                )

                entity_count += 1
                if is_hole:
                    hole_count += 1
                else:
                    outer_count += 1

                for px, py in points:
                    bbox_min_x = min(bbox_min_x, px)
                    bbox_min_y = min(bbox_min_y, py)
                    bbox_max_x = max(bbox_max_x, px)
                    bbox_max_y = max(bbox_max_y, py)

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
        "bboxMinXMm": round(bbox_min_x, 2),
        "bboxMaxYMm": round(bbox_max_y, 2),
        "perimeterMm": round(total_perimeter, 2),
        "markersDetected": 4 if scale != 1.0 else 0,
        "pixelsPerMm": round(scale, 2),
        "entities": entities,
    }


def run_pipeline(
    input_path: str,
    output_dir: str,
    paper_size: str = "a4",
    *,
    mask_threshold: int = 240,
    erosion_kernel: int = 3,
    erosion_iterations: int = 1,
    min_hole_area: int = 500,
    min_outer_area: int = 100,
    circle_ratio: float = 0.85,
    epsilon_min: float = 0.5,
    epsilon_max: float = 2.5,
    snap_angle: float = 10.0,
    snap_min_length: float = 20.0,
    marker_offset_x: float = 32.2,
    marker_offset_y: float = 34.2,
    marker_clear_radius: float = 22.0,
) -> dict:
    paper_w, paper_h = PAPER_SIZES.get(paper_size.lower(), PAPER_SIZES["a4"])

    result_dxf = os.path.join(output_dir, "result.dxf")
    result_dbg = os.path.join(output_dir, "result.dbg.png")
    result_original = os.path.join(output_dir, "result.original.png")
    result_mask = os.path.join(output_dir, "result.mask.png")
    result_holes = os.path.join(output_dir, "result.holes.png")
    result_json = os.path.join(output_dir, "result.json")

    print(f"[worker] Segmenting {input_path}...", flush=True)
    img, mask, used_aruco = segment_single_image(
        input_path,
        rembg_session,
        mask_threshold=mask_threshold,
        erosion_kernel=erosion_kernel,
        erosion_iterations=erosion_iterations,
    )

    H, scale = get_homography(
        input_path,
        paper_w,
        paper_h,
        marker_offset_x=marker_offset_x,
        marker_offset_y=marker_offset_y,
    )

    if H is not None:
        work_w = int(paper_w * scale)
        work_h = int(paper_h * scale)
        warped_img = cv2.warpPerspective(img, H, (work_w, work_h))
        warped_mask = cv2.warpPerspective(
            mask, H, (work_w, work_h), flags=cv2.INTER_NEAREST
        )

        cx, cy = marker_offset_x, marker_offset_y
        r = int(marker_clear_radius * scale)
        m0_x, m0_y = int(cx * scale), int(cy * scale)
        m1_x, m1_y = int((paper_w - cx) * scale), int(cy * scale)
        m2_x, m2_y = int((paper_w - cx) * scale), int((paper_h - cy) * scale)
        m3_x, m3_y = int(cx * scale), int((paper_h - cy) * scale)
        for mx, my in [(m0_x, m0_y), (m1_x, m1_y), (m2_x, m2_y), (m3_x, m3_y)]:
            cv2.rectangle(warped_mask, (mx - r, my - r), (mx + r, my + r), 0, -1)
    else:
        warped_img = img
        warped_mask = mask

    rgba = cv2.cvtColor(warped_img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = warped_mask
    cv2.imwrite(result_dbg, rgba)

    cv2.imwrite(result_original, warped_img)

    cv2.imwrite(result_mask, warped_mask)

    holes_mask = np.zeros_like(warped_mask)
    contours, hierarchy = cv2.findContours(
        warped_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )
    if hierarchy is not None:
        for i, contour in enumerate(contours):
            if hierarchy[0][i][3] != -1:
                cv2.drawContours(holes_mask, [contour], -1, 255, -1)
    cv2.imwrite(result_holes, holes_mask)

    print(f"[worker] Vectorizing...", flush=True)
    report = vectorize_single_image(
        warped_mask,
        scale,
        result_dxf,
        paper_h=paper_h,
        min_hole_area=min_hole_area,
        min_outer_area=min_outer_area,
        circle_ratio=circle_ratio,
        epsilon_min=epsilon_min,
        epsilon_max=epsilon_max,
        snap_angle=snap_angle,
        snap_min_length=snap_min_length,
    )

    with open(result_json, "w") as f:
        json.dump(report, f, indent=2)

    print(f"[worker] Done — {report['totalEntities']} entities", flush=True)
    return report


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

    params = {}
    param_defs = {
        "maskThreshold": ("mask_threshold", int, 240),
        "erosionKernel": ("erosion_kernel", int, 3),
        "erosionIterations": ("erosion_iterations", int, 1),
        "minHoleArea": ("min_hole_area", int, 500),
        "minOuterArea": ("min_outer_area", int, 100),
        "circleRatio": ("circle_ratio", float, 0.85),
        "epsilonMin": ("epsilon_min", float, 0.5),
        "epsilonMax": ("epsilon_max", float, 2.5),
        "snapAngle": ("snap_angle", float, 10.0),
        "snapMinLength": ("snap_min_length", float, 20.0),
        "markerOffsetX": ("marker_offset_x", float, 32.2),
        "markerOffsetY": ("marker_offset_y", float, 34.2),
        "markerClearRadius": ("marker_clear_radius", float, 22.0),
    }
    for json_key, (py_key, cast, default) in param_defs.items():
        val = data.get(json_key)
        if val is not None:
            try:
                params[py_key] = cast(val)
            except (ValueError, TypeError):
                params[py_key] = default

    if not input_path or not output_dir:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "inputPath and outputDir are required",
                }
            ),
            400,
        )

    if not os.path.isfile(input_path):
        return (
            jsonify(
                {
                    "success": False,
                    "message": f"Input file not found: {input_path}",
                }
            ),
            400,
        )

    os.makedirs(output_dir, exist_ok=True)

    try:
        report = run_pipeline(input_path, output_dir, paper_size, **params)
        return jsonify({"success": True, "report": report})
    except Exception as e:
        traceback.print_exc()
        return (
            jsonify(
                {
                    "success": False,
                    "message": str(e),
                    "traceback": traceback.format_exc(),
                }
            ),
            500,
        )


if __name__ == "__main__":
    port = int(os.environ.get("DXFERPY_PORT", 8788))
    print(f"[worker] Starting on port {port}...", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)
