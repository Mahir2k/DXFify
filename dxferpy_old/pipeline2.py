import os
import sys
import argparse
import numpy as np
import cv2
import ezdxf

from test import log, PAPER_SIZES

VERSION = "9.0_NEW3_INTEGRATION"

def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]

    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def fit_perfect_shape(contour):
    area = cv2.contourArea(contour)
    if area < 10:
        return None

    perimeter = cv2.arcLength(contour, True)
    if perimeter == 0:
        return None

    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    hull_perimeter = cv2.arcLength(hull, True)
    if hull_perimeter == 0:
        return None

    circularity = 4 * np.pi * (hull_area / (hull_perimeter * hull_perimeter))
    if circularity > 0.85:
        (x, y), radius = cv2.minEnclosingCircle(hull)
        return {"type": "circle", "center": (x, y), "radius": radius}

    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    rect_area = cv2.contourArea(box)

    if rect_area > 0:
        rect_fit = area / rect_area
        if rect_fit > 0.95:
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            if len(approx) == 4:
                return {"type": "rectangle", "points": box}

    return {"type": "raw", "points": contour}

def build_smooth_mask(outer_shapes, hole_shapes, target_shape):
    h, w = target_shape
    # Dynamic scale to prevent OOM on high-res images
    scale = max(1, 4000 // max(w, h))
    hr_w, hr_h = w * scale, h * scale

    hr_outer_raw = np.zeros((hr_h, hr_w), dtype=np.uint8)
    hr_outer_perfect = np.zeros((hr_h, hr_w), dtype=np.uint8)
    hr_holes_raw = np.zeros((hr_h, hr_w), dtype=np.uint8)
    hr_holes_perfect = np.zeros((hr_h, hr_w), dtype=np.uint8)

    def draw_shape(mask, shape, color):
        t = shape["type"]
        if t == "circle":
            c = shape["center"]
            r = shape["radius"]
            cv2.circle(mask, (int(c[0] * scale), int(c[1] * scale)), int(r * scale), color, -1)
        elif t == "rectangle":
            pts = shape["points"]
            hr_pts = np.array(pts * scale, dtype=np.int32).reshape(-1, 1, 2)
            cv2.fillPoly(mask, [hr_pts], color)
        elif t == "raw":
            pts = shape["points"]
            pts = np.array(pts).reshape(-1, 1, 2)
            hr_pts = (pts * scale).astype(np.int32)
            cv2.drawContours(mask, [hr_pts], -1, color, -1)

    for shape in outer_shapes:
        draw_shape(hr_outer_raw if shape["type"] == "raw" else hr_outer_perfect, shape, 255)

    for shape in hole_shapes:
        draw_shape(hr_holes_raw if shape["type"] == "raw" else hr_holes_perfect, shape, 255)

    if scale > 1:
        hr_outer_raw = cv2.GaussianBlur(hr_outer_raw, (7, 7), 0)
        _, hr_outer_raw = cv2.threshold(hr_outer_raw, 127, 255, cv2.THRESH_BINARY)
        hr_holes_raw = cv2.GaussianBlur(hr_holes_raw, (7, 7), 0)
        _, hr_holes_raw = cv2.threshold(hr_holes_raw, 127, 255, cv2.THRESH_BINARY)

    hr_outer = cv2.bitwise_or(hr_outer_raw, hr_outer_perfect)
    hr_holes = cv2.bitwise_or(hr_holes_raw, hr_holes_perfect)
    hr_mask = cv2.bitwise_and(hr_outer, cv2.bitwise_not(hr_holes))

    mask = cv2.resize(hr_mask, (w, h), interpolation=cv2.INTER_AREA)
    _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    return mask

def generate_dxf_from_shapes(outer_shapes, hole_shapes, pixels_per_mm, dxf_path, paper_h_mm, target_shape):
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    n_entities = 0

    def process_shape(shape, is_hole):
        nonlocal n_entities
        color = 1 if is_hole else 3

        if shape["type"] == "circle":
            cx = shape["center"][0] / pixels_per_mm
            cy = paper_h_mm - (shape["center"][1] / pixels_per_mm)
            r = shape["radius"] / pixels_per_mm
            msp.add_circle(center=(cx, cy), radius=r, dxfattribs={'color': color})
            n_entities += 1

        elif shape["type"] == "rectangle":
            pts = shape["points"] / pixels_per_mm
            pts[:, 1] = paper_h_mm - pts[:, 1]
            msp.add_lwpolyline(pts.tolist() + [pts[0].tolist()], format='xy', dxfattribs={'color': color})
            n_entities += 1

        elif shape["type"] == "raw":
            h, w = target_shape
            scale = max(1, 4000 // max(w, h))
            hr_w, hr_h = w * scale, h * scale
            
            mask = np.zeros((hr_h, hr_w), dtype=np.uint8)
            pts = shape["points"]
            pts = np.array(pts).reshape(-1, 1, 2)
            hr_pts = (pts * scale).astype(np.int32)
            cv2.fillPoly(mask, [hr_pts], 255)
            
            if scale > 1:
                mask = cv2.GaussianBlur(mask, (7, 7), 0)
                _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
            
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for smooth_c in contours:
                perimeter = cv2.arcLength(smooth_c, True)
                if perimeter == 0: continue
                
                approx = cv2.approxPolyDP(smooth_c, 0.001 * perimeter, True)
                
                final_pts = (approx.reshape(-1, 2) / float(scale)) / pixels_per_mm
                
                dxf_pts = []
                for pt in final_pts:
                    # Invert Y axis for CAD coordinates
                    dxf_pts.append((pt[0], paper_h_mm - pt[1]))
                
                if len(dxf_pts) > 2:
                    msp.add_lwpolyline(dxf_pts, close=True, dxfattribs={'color': 1 if not is_hole else 2})
                    n_entities += 1

    for s in outer_shapes:
        process_shape(s, is_hole=False)
    for s in hole_shapes:
        process_shape(s, is_hole=True)

    doc.saveas(dxf_path)
    return n_entities

def run_pipeline(image_path, output_dir, paper_size, marker_inset_mm, pixels_per_mm_override=None):
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(image_path))[0]
    
    log("=" * 64)
    log(f"Pipeline v{VERSION} (new3 logic) started")
    log("=" * 64)
    log(f"  Image     : {image_path}")
    paper_w_mm, paper_h_mm = PAPER_SIZES[paper_size]

    image = cv2.imread(image_path)
    if image is None:
        return False

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, _ = detector.detectMarkers(gray)

    if ids is None or len(corners) < 4:
        log("Need 4 markers", "ERROR")
        return False

    ids_flat = ids.flatten()
    marker_centers_px = {}
    for i, m_id in enumerate(ids_flat):
        if m_id in {0, 1, 2, 3}:
            marker_centers_px[m_id] = np.mean(corners[i][0], axis=0)

    for needed in (0, 1, 2, 3):
        if needed not in marker_centers_px:
            log(f"Missing marker {needed}", "ERROR")
            return False

    marker_mm_positions = {
        0: (marker_inset_mm, marker_inset_mm),
        1: (paper_w_mm - marker_inset_mm, marker_inset_mm),
        2: (paper_w_mm - marker_inset_mm, paper_h_mm - marker_inset_mm),
        3: (marker_inset_mm, paper_h_mm - marker_inset_mm),
    }

    if pixels_per_mm_override is not None:
        pixels_per_mm = pixels_per_mm_override
    else:
        d01_mm = np.linalg.norm(np.array(marker_mm_positions[1]) - np.array(marker_mm_positions[0]))
        d01_px = np.linalg.norm(marker_centers_px[1] - marker_centers_px[0])
        d03_mm = np.linalg.norm(np.array(marker_mm_positions[3]) - np.array(marker_mm_positions[0]))
        d03_px = np.linalg.norm(marker_centers_px[3] - marker_centers_px[0])
        ppm_x = d01_px / d01_mm
        ppm_y = d03_px / d03_mm
        pixels_per_mm = (ppm_x + ppm_y) / 2.0

    log(f"Scale: {pixels_per_mm:.4f} px/mm")

    target_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in marker_mm_positions.items()}
    H, _ = cv2.findHomography(
        np.array([marker_centers_px[m] for m in (0, 1, 2, 3)], dtype=np.float32),
        np.array([target_px[m]        for m in (0, 1, 2, 3)], dtype=np.float32),
    )

    output_w = int(paper_w_mm * pixels_per_mm)
    output_h = int(paper_h_mm * pixels_per_mm)
    warped = cv2.warpPerspective(image, H, (output_w, output_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    cv2.imwrite(os.path.join(output_dir, f"{base}_01_warped.png"), warped)

    _, thresh = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or hierarchy is None:
        log("No contours found", "ERROR")
        return False

    outer_indices = []
    h_img, w_img = thresh.shape
    for i, c in enumerate(contours):
        if hierarchy[0][i][3] == -1:
            x, y, w_c, h_c = cv2.boundingRect(c)
            if w_c >= w_img - 10 and h_c >= h_img - 10:
                continue
            area = cv2.contourArea(c)
            if area > 1000: # Any large top-level object is an outer contour
                outer_indices.append((i, c))

    if not outer_indices:
        log("No outer contour", "ERROR")
        return False

    outer_shapes = []
    hole_shapes = []

    for i, c in outer_indices:
        shape = fit_perfect_shape(c)
        if shape:
            outer_shapes.append(shape)

    hsv = cv2.cvtColor(warped, cv2.COLOR_BGR2HSV)
    S = hsv[:, :, 1]

    # Quick set lookup for valid parents
    valid_parents = set([i for i, c in outer_indices])

    for i, c in enumerate(contours):
        if hierarchy[0][i][3] in valid_parents:
            # Check if this is truly a hole exposing white paper
            c_mask = np.zeros_like(thresh)
            cv2.drawContours(c_mask, [c], -1, 255, -1)
                
            mean_sat = cv2.mean(S, mask=c_mask)[0]
            if mean_sat > 30:
                continue # Ignore wood grain (which has higher saturation)
                
            hole_shape = fit_perfect_shape(c)
            if hole_shape:
                hole_shapes.append(hole_shape)

    mask = build_smooth_mask(outer_shapes, hole_shapes, warped_gray.shape)
    log(f"Found {len(outer_shapes)} outer shapes and {len(hole_shapes)} hole shapes")
    cv2.imwrite(os.path.join(output_dir, f"{base}_02_smooth_mask.png"), mask)

    dxf_path = os.path.join(output_dir, f"{base}_03_outline.dxf")
    n_entities = generate_dxf_from_shapes(outer_shapes, hole_shapes, pixels_per_mm, dxf_path, paper_h_mm, warped_gray.shape)
    log(f"Exported {n_entities} entities to {dxf_path}")
    
    # Overlay
    final_contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    overlay = warped.copy()
    cv2.drawContours(overlay, final_contours, -1, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_04_overlay.png"), overlay)
    
    log("Pipeline complete")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--paper-size", type=int, required=True)
    parser.add_argument("--marker-inset-mm", type=float, default=40.0)
    args = parser.parse_args()
    ok = run_pipeline(args.image_path, args.output_dir, args.paper_size, args.marker_inset_mm)
    sys.exit(0 if ok else 1)
