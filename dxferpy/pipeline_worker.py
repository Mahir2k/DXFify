"""Persistent Flask HTTP worker server for the DXFify computer vision and vectorization pipeline.

This module preloads the BiRefNet neural segmentation model at startup and handles
end-to-end processing requests (/process) and selective sub-region reprocessing (/process_region).
"""

import json
import logging
import os
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, request

DXFERPY_DIR = os.path.dirname(os.path.abspath(__file__))
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

import cv2
import ezdxf
import numpy as np
from render_dxf import render_dxf_to_png
from segment_object import create_birefnet_session, get_aruco_corners, order_points_by_id
from vectorize_smart import (
    PAPER_SIZES,
    extract_details,
    get_homography,
    smooth_curve,
    vectorize_contour,
)

logging.basicConfig(level=logging.INFO, format="[%(asctime)s worker] %(message)s")
logger = logging.getLogger("pipeline_worker")

app = Flask(__name__)

logger.info("Loading rembg BiRefNet model...")
_t0 = time.time()
rembg_session = create_birefnet_session()
logger.info(f"Model loaded in {time.time() - _t0:.1f}s")


def segment_single_image(
    img_path: str,
    session: Any,
    *,
    mask_threshold: int = 240,
    erosion_kernel: int = 3,
    erosion_iterations: int = 1,
) -> Tuple[np.ndarray, np.ndarray, bool]:
    """Segments the primary physical object from a raw photograph.

    Uses BiRefNet neural segmentation combined with OpenCV Guided Filter edge boundary
    refinement and morphological erosion to shave off edge artifacts.

    Args:
        img_path: Absolute path to the source image file (JPG/PNG).
        session: Active ONNX Runtime session for BiRefNet inference.
        mask_threshold: Binarization cutoff threshold (1-255). Defaults to 240.
        erosion_kernel: Size of square structuring element for erosion. Defaults to 3.
        erosion_iterations: Number of morphological erosion passes. Defaults to 1.

    Returns:
        A tuple containing:
            - img (np.ndarray): Original BGR image.
            - mask (np.ndarray): Refined single-channel binary mask (255=foreground, 0=background).
            - used_aruco (bool): True if 4 ArUco markers were detected on the sheet, False otherwise.

    Raises:
        ValueError: If the image cannot be read from `img_path`.
    """
    from rembg import remove

    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Could not read image: {img_path}")

    corners, ids = get_aruco_corners(img)
    used_aruco = corners is not None

    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    rembg_mask = remove(rgb_img, session=session, only_mask=True)
    mask = (np.array(rembg_mask) > mask_threshold).astype(np.uint8) * 255

    # Refine boundaries using Guided Filtering
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    guide_float = gray.astype(np.float32) / 255.0
    mask_float = (mask > 0).astype(np.float32)
    refined_float = cv2.ximgproc.guidedFilter(
        guide=guide_float, src=mask_float, radius=4, eps=1e-4
    )
    mask = (refined_float > 0.5).astype(np.uint8) * 255

    mask = cv2.erode(
        mask,
        np.ones((erosion_kernel, erosion_kernel), np.uint8),
        iterations=erosion_iterations,
    )

    return img, mask, used_aruco


def fit_circle_pratt(points: np.ndarray) -> Tuple[float, float, float]:
    """Fits analytical circle parameters (xc, yc, R) to a 2D point cloud using Pratt's method.

    Solves the algebraic circle equation (x-xc)^2 + (y-yc)^2 = R^2 using linear least squares
    on shifted coordinates.

    Args:
        points: (N, 2) numpy array of 2D point coordinates.

    Returns:
        Tuple of floats (xc, yc, R) representing center X, center Y, and radius.
    """
    x = points[:, 0]
    y = points[:, 1]
    x_m = np.mean(x)
    y_m = np.mean(y)
    u = x - x_m
    v = y - y_m
    X = np.column_stack([u, v, np.ones(len(u))])
    Y = u**2 + v**2
    a, b, c = np.linalg.lstsq(X, Y, rcond=None)[0]
    uc = a / 2
    vc = b / 2
    R = np.sqrt(uc**2 + vc**2 + c)
    xc = uc + x_m
    yc = vc + y_m
    return float(xc), float(yc), float(R)


def ransac_line_fit(
    points: np.ndarray, centroid: np.ndarray, max_iterations: int = 400, threshold: float = 1.5
) -> Optional[Tuple[float, float, float]]:
    """Fits 2D line equation parameters (nx, ny, d) to noisy points using RANSAC.

    Args:
        points: (N, 2) array of contour points.
        centroid: (2,) array containing the overall shape centroid [cx, cy].
        max_iterations: Maximum RANSAC iteration count. Defaults to 400.
        threshold: Maximum perpendicular distance for inliers in pixels. Defaults to 1.5.

    Returns:
        Tuple of (nx, ny, d) representing normal vector (nx, ny) and offset d (nx*x + ny*y = d),
        or None if insufficient inliers are found.
    """
    best_line = None
    best_inliers: List[int] = []
    n_pts = len(points)
    if n_pts < 2:
        return None
    for _ in range(max_iterations):
        idx = np.random.choice(n_pts, 2, replace=False)
        p1 = points[idx[0]]
        p2 = points[idx[1]]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        l = np.hypot(dx, dy)
        if l == 0:
            continue
        nx = -dy / l
        ny = dx / l
        d = nx * p1[0] + ny * p1[1]
        dists = np.abs(nx * points[:, 0] + ny * points[:, 1] - d)
        inliers = np.where(dists < threshold)[0]
        if len(inliers) > len(best_inliers):
            best_inliers = list(inliers)
            best_line = (nx, ny, d)
    if best_line is not None and len(best_inliers) >= 2:
        inlier_pts = points[best_inliers]
        vx, vy, x0, y0 = cv2.fitLine(
            inlier_pts.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01
        ).squeeze()
        nx, ny = -vy, vx
        v_out = np.array([x0 - centroid[0], y0 - centroid[1]])
        if nx * v_out[0] + ny * v_out[1] < 0:
            nx, ny = -nx, -ny
        d = nx * x0 + ny * y0
        return (float(nx), float(ny), float(d))
    return None


def get_fillet_arc(
    line1: Tuple[float, float, float],
    line2: Tuple[float, float, float],
    centroid: np.ndarray,
    R: float,
) -> np.ndarray:
    """Computes dense 2D arc points connecting two intersecting line equations with radius R.

    Args:
        line1: (nx1, ny1, d1) normal line parameters.
        line2: (nx2, ny2, d2) normal line parameters.
        centroid: Shape centroid used to orient the arc inward/outward.
        R: Desired fillet radius in pixels/millimeters.

    Returns:
        (30, 2) numpy array of arc points along the fillet curve.
    """
    nx1, ny1, d1 = line1
    nx2, ny2, d2 = line2
    A = np.array([[nx1, ny1], [nx2, ny2]])
    b = np.array([d1, d2])
    I = np.linalg.solve(A, b)
    bisector = np.array([nx1 + nx2, ny1 + ny2])
    bisector = bisector / np.linalg.norm(bisector)
    dot_val = np.clip(nx1 * nx2 + ny1 * ny2, -1.0, 1.0)
    theta = np.arccos(dot_val)
    d_IC = R / np.sin(theta / 2.0)
    C = I - d_IC * bisector
    T1 = C + R * np.array([nx1, ny1])
    T2 = C + R * np.array([nx2, ny2])
    ang1 = np.atan2(T1[1] - C[1], T1[0] - C[0])
    ang2 = np.atan2(T2[1] - C[1], T2[0] - C[0])
    diff = ang2 - ang1
    if diff > np.pi:
        ang2 -= 2 * np.pi
    elif diff < -np.pi:
        ang2 += 2 * np.pi
    arc_thetas = np.linspace(ang1, ang2, 30)
    return np.column_stack([C[0] + R * np.cos(arc_thetas), C[1] + R * np.sin(arc_thetas)])


def apply_pratt_arc_fit_contour(
    contour: np.ndarray, x_min: float, y_min: float, w: float, h: float, centroid: np.ndarray
) -> np.ndarray:
    """Refines corner vertices of a contour by fitting Pratt circular arcs.

    Args:
        contour: Input (N, 1, 2) contour array.
        x_min: Bounding box minimum X.
        y_min: Bounding box minimum Y.
        w: Bounding box width.
        h: Bounding box height.
        centroid: (2,) shape centroid point.

    Returns:
        Modified (N, 1, 2) contour array with smooth Pratt arc corners.
    """
    corners = [
        (x_min, y_min),
        (x_min + w, y_min),
        (x_min + w, y_min + h),
        (x_min, y_min + h),
    ]
    modified_contour = contour.copy()
    n = len(contour)
    if n < 80:
        return modified_contour
    for cx, cy in corners:
        dists = (contour[:, 0, 0] - cx) ** 2 + (contour[:, 0, 1] - cy) ** 2
        corner_idx = np.argmin(dists)
        indices = [(corner_idx + j) % n for j in range(-40, 40)]
        corner_pts = contour[indices].squeeze()
        if len(corner_pts.shape) != 2 or corner_pts.shape[0] < 80:
            continue
        arc_points = corner_pts[20:60]
        try:
            xc, yc, R = fit_circle_pratt(arc_points)
            p_start = corner_pts[20]
            p_end = corner_pts[60]
            theta_start = np.atan2(p_start[1] - yc, p_start[0] - xc)
            theta_end = np.atan2(p_end[1] - yc, p_end[0] - xc)
            diff = theta_end - theta_start
            if diff > np.pi:
                theta_end -= 2 * np.pi
            elif diff < -np.pi:
                theta_end += 2 * np.pi
            thetas = np.linspace(theta_start, theta_end, 40)
            arc_pts = np.column_stack([xc + R * np.cos(thetas), yc + R * np.sin(thetas)])
            for k, idx in enumerate(indices[20:61]):
                modified_contour[idx, 0, 0] = arc_pts[min(k, len(arc_pts) - 1), 0]
                modified_contour[idx, 0, 1] = arc_pts[min(k, len(arc_pts) - 1), 1]
        except Exception as err:
            logger.warning(f"Pratt arc fit failed for corner at ({cx}, {cy}): {err}")
    return modified_contour


def fit_contour_spline(contour: np.ndarray) -> np.ndarray:
    """Fits smooth periodic cubic B-spline curves to contour points.

    Args:
        contour: Input (N, 1, 2) contour array.

    Returns:
        Resampled (M, 1, 2) smooth spline contour array.
    """
    n = len(contour)
    if n < 10:
        return contour
    pts = contour.squeeze()
    if len(pts.shape) != 2:
        return contour
    ds_factor = max(1, n // 100)
    contour_ds = pts[::ds_factor]
    if len(contour_ds) < 5:
        return contour
    try:
        from scipy.interpolate import splev, splprep

        tck, u = splprep([contour_ds[:, 0], contour_ds[:, 1]], s=200, per=True)
        u_new = np.linspace(0, 1, min(300, n))
        spline_pts = np.column_stack(splev(u_new, tck))
        return spline_pts.astype(np.float32).reshape(-1, 1, 2)
    except Exception as err:
        logger.warning(f"Spline fitting failed: {err}")
        return contour


def apply_contour_gaussian_filter(contour: np.ndarray) -> np.ndarray:
    """Applies 1D Gaussian blurring across X and Y coordinate arrays of a contour.

    Args:
        contour: Input (N, 1, 2) contour array.

    Returns:
        Smoothed (N, 1, 2) contour array.
    """
    n = len(contour)
    if n < 5:
        return contour
    pts = contour.squeeze()
    if len(pts.shape) != 2:
        return contour
    kernel_size = 15
    sigma = 3.0
    try:
        smooth_x = cv2.GaussianBlur(
            pts[:, 0].astype(np.float32).reshape(-1, 1), (1, kernel_size), sigma
        ).squeeze()
        smooth_y = cv2.GaussianBlur(
            pts[:, 1].astype(np.float32).reshape(-1, 1), (1, kernel_size), sigma
        ).squeeze()
        smooth_pts = np.column_stack([smooth_x, smooth_y])
        return smooth_pts.astype(np.float32).reshape(-1, 1, 2)
    except Exception as err:
        logger.warning(f"Gaussian filtering failed: {err}")
        return contour


def apply_ransac_cad_reconstruction(
    contour: np.ndarray, x_min: float, y_min: float, w: float, h: float, centroid: np.ndarray
) -> Optional[np.ndarray]:
    """Reconstructs CAD rectangle geometry with RANSAC edge fitting and fillet corner arcs.

    Args:
        contour: Input (N, 1, 2) contour.
        x_min: Minimum X bound.
        y_min: Minimum Y bound.
        w: Width of bounding box.
        h: Height of bounding box.
        centroid: (2,) centroid coordinates.

    Returns:
        Reconstructed (M, 1, 2) CAD contour array, or None if RANSAC lines fail to fit.
    """
    n = len(contour)
    if n < 30:
        return None
    pts = contour.squeeze()
    if len(pts.shape) != 2:
        return None
    top_pts = pts[(pts[:, 1] < y_min + 0.15 * h) & (pts[:, 0] > x_min + 0.2 * w) & (pts[:, 0] < x_min + 0.8 * w)]
    bottom_pts = pts[(pts[:, 1] > y_min + 0.85 * h) & (pts[:, 0] > x_min + 0.2 * w) & (pts[:, 0] < x_min + 0.8 * w)]
    left_pts = pts[(pts[:, 0] < x_min + 0.15 * w) & (pts[:, 1] > y_min + 0.2 * h) & (pts[:, 1] < y_min + 0.8 * h)]
    right_pts = pts[(pts[:, 0] > x_min + 0.85 * w) & (pts[:, 1] > y_min + 0.2 * h) & (pts[:, 1] < y_min + 0.8 * h)]
    top_line = ransac_line_fit(top_pts, centroid)
    bottom_line = ransac_line_fit(bottom_pts, centroid)
    left_line = ransac_line_fit(left_pts, centroid)
    right_line = ransac_line_fit(right_pts, centroid)
    if not (top_line and bottom_line and left_line and right_line):
        return None
    try:
        R_fillet = min(w, h) * 0.1
        arc_tl = get_fillet_arc(left_line, top_line, centroid, R_fillet)
        arc_tr = get_fillet_arc(top_line, right_line, centroid, R_fillet)
        arc_br = get_fillet_arc(right_line, bottom_line, centroid, R_fillet)
        arc_bl = get_fillet_arc(bottom_line, left_line, centroid, R_fillet)
        reconstructed = np.vstack([arc_tl, arc_tr, arc_br, arc_bl, arc_tl[0]])
        return reconstructed.astype(np.float32).reshape(-1, 1, 2)
    except Exception as err:
        logger.warning(f"RANSAC CAD reconstruction failed: {err}")
        return None


def transform_contour_by_strategy(
    contour_f: np.ndarray,
    curve_strategy: str,
    x_min_f: float,
    y_min_f: float,
    w_f: float,
    h_f: float,
    centroid_f: np.ndarray,
) -> np.ndarray:
    """Dispatches contour processing to the specified curve fitting strategy.

    Args:
        contour_f: (N, 1, 2) float32 contour coordinates.
        curve_strategy: Strategy name ('current', 'pratt', 'spline', 'gaussian', 'ransac').
        x_min_f: Minimum X bound.
        y_min_f: Minimum Y bound.
        w_f: Width of bounding box.
        h_f: Height of bounding box.
        centroid_f: Shape centroid [cx, cy].

    Returns:
        Transformed (M, 1, 2) contour array.
    """
    working_contour = contour_f.copy()
    if curve_strategy == "pratt":
        return apply_pratt_arc_fit_contour(working_contour, x_min_f, y_min_f, w_f, h_f, centroid_f)
    elif curve_strategy == "spline":
        return fit_contour_spline(working_contour)
    elif curve_strategy == "gaussian":
        return apply_contour_gaussian_filter(working_contour)
    elif curve_strategy == "ransac":
        recon = apply_ransac_cad_reconstruction(working_contour, x_min_f, y_min_f, w_f, h_f, centroid_f)
        if recon is not None:
            return recon
    return working_contour


def vectorize_single_image(
    mask: np.ndarray,
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
    warped_img: Optional[np.ndarray] = None,
    detect_details: bool = False,
    details_threshold1: int = 50,
    details_threshold2: int = 150,
    curve_strategy: str = "current",
) -> dict:
    """Extracts vector geometry entities from binary mask and saves DXF file.

    Args:
        mask: Binary mask image.
        scale: Millimeter scale factor (pixels per mm).
        output_dxf: Absolute path where result.dxf will be saved.
        paper_h: Calibration sheet height in mm.
        min_hole_area: Minimum area cutoff for interior hole cutouts. Defaults to 500.
        min_outer_area: Minimum area cutoff for outer contours. Defaults to 100.
        circle_ratio: Area ratio threshold for circle matching. Defaults to 0.85.
        epsilon_min: Minimum Douglas-Peucker epsilon limits. Defaults to 0.5.
        epsilon_max: Maximum Douglas-Peucker epsilon limits. Defaults to 2.5.
        snap_angle: Orthogonal snap angle limit in degrees. Defaults to 10.0.
        snap_min_length: Minimum segment length for snapping. Defaults to 20.0.
        warped_img: Optional warped RGB image for surface detail extraction.
        detect_details: If True, extracts fine detail lines on DETAILS layer. Defaults to False.
        details_threshold1: Canny threshold 1 for detail extraction. Defaults to 50.
        details_threshold2: Canny threshold 2 for detail extraction. Defaults to 150.
        curve_strategy: Curve fitting strategy algorithm name. Defaults to 'current'.

    Returns:
        Dictionary report containing entity metrics, bounding box dimensions, and entity array.
    """
    height = mask.shape[0]

    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

    doc = ezdxf.new("R2010")
    if "OUTER" not in doc.layers:
        doc.layers.new("OUTER", dxfattribs={"color": 7})
    if "HOLES" not in doc.layers:
        doc.layers.new("HOLES", dxfattribs={"color": 1})
    if "DETAILS" not in doc.layers:
        doc.layers.new("DETAILS", dxfattribs={"color": 3})

    msp = doc.modelspace()

    entity_count = 0
    outer_count = 0
    hole_count = 0
    bbox_min_x, bbox_min_y = float("inf"), float("inf")
    bbox_max_x, bbox_max_y = float("-inf"), float("-inf")
    total_perimeter = 0.0

    entities: List[dict] = []

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
                    msp.add_circle((cx_mm, cy_mm), radius_mm, dxfattribs={"layer": layer})

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

            x_min_f, y_min_f, w_f, h_f = cv2.boundingRect(contour_f)
            centroid_f = np.array([x_min_f + w_f / 2, y_min_f + h_f / 2])

            working_contour = transform_contour_by_strategy(
                contour_f, curve_strategy, x_min_f, y_min_f, w_f, h_f, centroid_f
            )

            if curve_strategy == "current":
                points = vectorize_contour(
                    working_contour,
                    height,
                    scale,
                    epsilon_min=epsilon_min,
                    epsilon_max=epsilon_max,
                    snap_angle=snap_angle,
                    snap_min_length=snap_min_length,
                )
            else:
                points = [
                    (float(p[0, 0]) / scale, float(height - p[0, 1]) / scale)
                    for p in working_contour
                ]
            if points:
                msp.add_lwpolyline(points, close=True, dxfattribs={"layer": layer})

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

    if detect_details and warped_img is not None:
        details_ents = extract_details(
            warped_img,
            mask,
            scale,
            threshold1=details_threshold1,
            threshold2=details_threshold2,
        )
        for dent in details_ents:
            msp.add_lwpolyline(dent["points"], close=False, dxfattribs={"layer": "DETAILS"})
            entities.append(dent)
            entity_count += 1
            for px, py in dent["points"]:
                bbox_min_x = min(bbox_min_x, px)
                bbox_min_y = min(bbox_min_y, py)
                bbox_max_x = max(bbox_max_x, px)
                bbox_max_y = max(bbox_max_y, py)

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
    rembg_session: Optional[Any] = None,
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
    detect_details: bool = False,
    details_threshold1: int = 50,
    details_threshold2: int = 150,
    curve_strategy: str = "current",
    crop_bbox_mm: Optional[list] = None,
) -> dict:
    """Executes end-to-end segmentation, homography warping, and vectorization workflow.

    Args:
        input_path: Path to uploaded photo.
        output_dir: Job output directory.
        paper_size: Standard calibration paper size name ('a4', 'a3', 'a5', 'letter', 'legal').
        mask_threshold: Segmentation threshold (1-255).
        erosion_kernel: Morphological erosion kernel size.
        erosion_iterations: Erosion pass count.
        min_hole_area: Min area threshold for interior hole cutouts.
        min_outer_area: Min area threshold for outer bounds.
        circle_ratio: Area ratio threshold for circle matching.
        epsilon_min: Min Douglas-Peucker epsilon parameter.
        epsilon_max: Max Douglas-Peucker epsilon parameter.
        snap_angle: Max angle tolerance in degrees for orthogonal line snapping.
        snap_min_length: Min segment length for snapping.
        marker_offset_x: ArUco marker center X offset from page boundary in mm.
        marker_offset_y: ArUco marker center Y offset from page boundary in mm.
        marker_clear_radius: Radius around marker centers to clear from mask in mm.
        detect_details: Toggle surface detail extraction onto DETAILS layer.
        details_threshold1: Canny threshold 1.
        details_threshold2: Canny threshold 2.
        curve_strategy: Curve fitting algorithm strategy name.

    Returns:
        JSON-serializable report dictionary containing all CAD vector entities and metrics.
    """
    paper_w, paper_h = PAPER_SIZES.get(paper_size.lower(), PAPER_SIZES["a4"])

    result_dxf = os.path.join(output_dir, "result.dxf")
    result_dbg = os.path.join(output_dir, "result.dbg.png")
    result_original = os.path.join(output_dir, "result.original.png")
    result_mask = os.path.join(output_dir, "result.mask.png")
    result_holes = os.path.join(output_dir, "result.holes.png")
    result_json = os.path.join(output_dir, "result.json")

    if rembg_session is None:
        from segment_object import create_birefnet_session
        logger.info("Initializing BiRefNet neural segmentation session...")
        rembg_session = create_birefnet_session()

    logger.info(f"Segmenting {input_path}...")
    img, mask, used_aruco = segment_single_image(
        input_path,
        rembg_session,
        mask_threshold=mask_threshold,
        erosion_kernel=erosion_kernel,
        erosion_iterations=erosion_iterations,
    )

    H, scale, marker_centers = get_homography(
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
        m2_x, m2_y = int(cx * scale), int(cy * scale)
        m3_x, m3_y = int((paper_w - cx) * scale), int(cy * scale)
        m1_x, m1_y = int(cx * scale), int((paper_h - cy) * scale)
        m0_x, m0_y = int((paper_w - cx) * scale), int((paper_h - cy) * scale)
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

    logger.info("Vectorizing...")
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
        warped_img=warped_img,
        detect_details=detect_details,
        details_threshold1=details_threshold1,
        details_threshold2=details_threshold2,
        curve_strategy=curve_strategy,
    )
    report["markerCenters"] = marker_centers

    with open(result_json, "w") as f:
        json.dump(report, f, indent=2)

    logger.info(f"Done — {report['totalEntities']} entities")
    return report


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint returning worker status."""
    return jsonify({"ok": True, "model": "birefnet-general-lite"})


@app.route("/process", methods=["POST"])
def process():
    """HTTP endpoint processing full photographic image to DXF vector package."""
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
        "detectDetails": ("detect_details", lambda v: str(v).lower() in ("true", "1", "yes"), False),
        "detailsThreshold1": ("details_threshold1", int, 50),
        "detailsThreshold2": ("details_threshold2", int, 150),
        "curveStrategy": ("curve_strategy", str, "current"),
    }
    for json_key, (py_key, cast, default) in param_defs.items():
        val = data.get(json_key)
        if val is not None:
            try:
                params[py_key] = cast(val)
            except (ValueError, TypeError):
                params[py_key] = default

    if not input_path or not output_dir:
        return jsonify({"success": False, "message": "inputPath and outputDir are required"}), 400

    if not os.path.isfile(input_path):
        return jsonify({"success": False, "message": f"Input file not found: {input_path}"}), 400

    os.makedirs(output_dir, exist_ok=True)

    try:
        report = run_pipeline(input_path, output_dir, paper_size, **params)
        return jsonify({"success": True, "report": report})
    except Exception as e:
        logger.error(f"Error processing pipeline: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e), "traceback": traceback.format_exc()}), 500


@app.route("/process_region", methods=["POST"])
def process_region_route():
    """HTTP endpoint reprocessing selective bounding box sub-region with custom curve fitting strategy."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "No JSON body"}), 400

    input_path = data.get("inputPath")
    output_dir = data.get("outputDir")
    bbox = data.get("bbox")
    paper_size = data.get("paperSize", "a4")
    curve_strategy = data.get("curveStrategy", "current")

    if not input_path or not output_dir or not bbox:
        return jsonify({"success": False, "message": "inputPath, outputDir and bbox are required"}), 400

    try:
        paper_w, paper_h = PAPER_SIZES.get(paper_size.lower(), PAPER_SIZES["a4"])
        img, mask, _ = segment_single_image(input_path, rembg_session, mask_threshold=240)

        H, scale, _ = get_homography(input_path, paper_w, paper_h)
        if H is not None:
            work_w = int(paper_w * scale)
            work_h = int(paper_h * scale)
            warped_mask = cv2.warpPerspective(mask, H, (work_w, work_h), flags=cv2.INTER_NEAREST)
        else:
            warped_mask = mask
            scale = mask.shape[0] / paper_h

        height, width = warped_mask.shape[:2]
        min_x, min_y, max_x, max_y = bbox

        contours, hierarchy = cv2.findContours(warped_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        entities: List[dict] = []

        if hierarchy is not None:
            for i, contour in enumerate(contours):
                is_hole = hierarchy[0][i][3] != -1
                layer = "HOLES" if is_hole else "OUTER"
                contour_f = np.array(contour, dtype=np.float32)
                area = cv2.contourArea(contour_f)
                if area < 50:
                    continue

                x_min_f, y_min_f, w_f, h_f = cv2.boundingRect(contour_f)
                centroid_f = np.array([x_min_f + w_f / 2, y_min_f + h_f / 2])

                c_min_x = x_min_f / scale
                c_max_x = (x_min_f + w_f) / scale
                c_min_y = (height - (y_min_f + h_f)) / scale
                c_max_y = (height - y_min_f) / scale
                c_cx = centroid_f[0] / scale
                c_cy = (height - centroid_f[1]) / scale

                overlaps = c_max_x >= min_x and c_min_x <= max_x and c_max_y >= min_y and c_min_y <= max_y
                center_in = min_x <= c_cx <= max_x and min_y <= c_cy <= max_y

                if not (overlaps or center_in):
                    continue

                (cx, cy), radius = cv2.minEnclosingCircle(contour_f)
                circle_area = np.pi * radius * radius if radius > 0 else 0
                area_ratio = (area / circle_area) if circle_area > 0 else 0

                if radius > 0 and area_ratio > 0.85:
                    cx_mm = float(cx) / scale
                    cy_mm = float(height - cy) / scale
                    radius_mm = float(radius) / scale
                    entities.append(
                        {
                            "type": "circle",
                            "layer": layer,
                            "cx": round(cx_mm, 4),
                            "cy": round(cy_mm, 4),
                            "r": round(radius_mm, 4),
                        }
                    )
                else:
                    working_contour = transform_contour_by_strategy(
                        contour_f, curve_strategy, x_min_f, y_min_f, w_f, h_f, centroid_f
                    )

                    if curve_strategy == "current":
                        pts = vectorize_contour(working_contour, height, scale)
                    else:
                        pts = [
                            (float(p[0, 0]) / scale, float(height - p[0, 1]) / scale)
                            for p in working_contour
                        ]

                    if pts:
                        entities.append(
                            {
                                "type": "polyline",
                                "layer": layer,
                                "points": [[round(px, 4), round(py, 4)] for px, py in pts],
                                "closed": True,
                            }
                        )

        return jsonify({"success": True, "entities": entities})
    except Exception as e:
        logger.error(f"Error processing region: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("DXFERPY_PORT", 8788))
    logger.info(f"Starting on port {port}...")
    app.run(host="127.0.0.1", port=port, debug=False)
