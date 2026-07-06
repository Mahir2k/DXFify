import cv2
import numpy as np
import argparse
import sys
import os
import ezdxf

def log(msg, level="INFO"):
    print(f"[{level}] {msg}")

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
    if area < 10: return None
    perimeter = cv2.arcLength(contour, True)
    if perimeter == 0: return None
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    hull_perimeter = cv2.arcLength(hull, True)
    if hull_perimeter == 0: return None
    
    circularity = 4 * np.pi * (hull_area / (hull_perimeter * hull_perimeter))
    if circularity > 0.85:
        (x, y), radius = cv2.minEnclosingCircle(hull)
        return {"type": "circle", "center": (x, y), "radius": radius, "points": contour}
        
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    rect_area = cv2.contourArea(box)
    if rect_area > 0 and (area / rect_area) > 0.95:
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            return {"type": "rectangle", "points": box}
            
    return {"type": "raw", "points": contour}

def build_smooth_mask(outer_shapes, hole_shapes, target_shape):
    h, w = target_shape
    scale = max(1, 4000 // max(w, h))
    hr_w, hr_h = w * scale, h * scale
    
    hr_mask = np.zeros((hr_h, hr_w), dtype=np.uint8)
    
    def process_shapes(shapes, color):
        for shape in shapes:
            t = shape["type"]
            if t == "circle":
                cx, cy = shape["center"]
                r = shape["radius"]
                cv2.circle(hr_mask, (int(cx * scale), int(cy * scale)), int(r * scale), color, -1)
            elif t == "rectangle":
                pts = shape["points"]
                hr_pts = (pts * scale).astype(np.int32)
                cv2.fillPoly(hr_mask, [hr_pts], color)
            elif t == "raw":
                pts = shape["points"]
                pts = np.array(pts).reshape(-1, 1, 2)
                hr_pts = (pts * scale).astype(np.int32)
                cv2.drawContours(hr_mask, [hr_pts], -1, color, -1)

    process_shapes(outer_shapes, 255)
    process_shapes(hole_shapes, 0)
    
    mask = cv2.resize(hr_mask, (w, h), interpolation=cv2.INTER_AREA)
    _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    return mask

def generate_dxf_from_smooth_mask(mask, pixels_per_mm, dxf_path, paper_h_mm, outer_shapes, hole_shapes):
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    n_entities = 0

    # Draw perfect circles and rectangles
    def draw_shapes(shapes, color):
        nonlocal n_entities
        for shape in shapes:
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

    draw_shapes(outer_shapes, 3)
    draw_shapes(hole_shapes, 4)

    # Extract RAW shapes directly from the smooth mask
    # To avoid extracting the circles and rectangles we already drew, we reconstruct a mask with ONLY raw shapes
    raw_outer = [s for s in outer_shapes if s["type"] == "raw"]
    raw_holes = [s for s in hole_shapes if s["type"] == "raw"]
    
    if raw_outer or raw_holes:
        raw_mask = build_smooth_mask(raw_outer, raw_holes, mask.shape)
        contours, hierarchy = cv2.findContours(raw_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        
        if hierarchy is not None:
            for i, c in enumerate(contours):
                is_hole = hierarchy[0][i][3] != -1
                
                # Convert directly to DXF coordinates without approxPolyDP (keep smooth curve)
                final_pts = c.reshape(-1, 2) / pixels_per_mm
                
                dxf_pts = []
                for pt in final_pts:
                    dxf_pts.append((pt[0], paper_h_mm - pt[1]))
                
                if len(dxf_pts) > 2:
                    msp.add_lwpolyline(dxf_pts, close=True, dxfattribs={'color': 2 if is_hole else 1})
                    n_entities += 1

    doc.saveas(dxf_path)
    return n_entities

def run_pipeline(image_path, output_dir, paper_size, marker_inset_mm):
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(image_path))[0]
    
    log("=" * 64)
    log(f"Processing: {image_path}")
    
    if paper_size == 4:
        paper_w_mm, paper_h_mm = 210, 297
    elif paper_size == 3:
        paper_w_mm, paper_h_mm = 297, 420
    else:
        log(f"Unsupported paper size A{paper_size}", "ERROR")
        return False
        
    image = cv2.imread(image_path)
    if image is None:
        log("Failed to load image", "ERROR")
        return False
        
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(dictionary, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    if not corners or len(corners) != 4:
        log(f"Found {len(corners) if corners else 0} markers instead of 4", "ERROR")
        return False
        
    marker_centers = []
    for corner in corners:
        c = corner[0]
        marker_centers.append([np.mean(c[:, 0]), np.mean(c[:, 1])])
    
    # ORDER POINTS FIRST to fix pixels_per_mm bug!
    marker_centers_px = order_points(np.array(marker_centers, dtype="float32"))
    
    marker_mm_positions = {
        0: (marker_inset_mm, marker_inset_mm),
        1: (paper_w_mm - marker_inset_mm, marker_inset_mm),
        2: (paper_w_mm - marker_inset_mm, paper_h_mm - marker_inset_mm),
        3: (marker_inset_mm, paper_h_mm - marker_inset_mm),
    }
    
    d01_mm = paper_w_mm - 2 * marker_inset_mm
    d01_px = np.linalg.norm(marker_centers_px[1] - marker_centers_px[0])
    pixels_per_mm = d01_px / d01_mm
    log(f"Scale: {pixels_per_mm:.4f} px/mm")
    
    output_w = int(paper_w_mm * pixels_per_mm)
    output_h = int(paper_h_mm * pixels_per_mm)
    
    target_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in marker_mm_positions.items()}
    H, _ = cv2.findHomography(
        marker_centers_px,
        np.array([target_px[m] for m in (0, 1, 2, 3)], dtype=np.float32),
    )
    
    warped = cv2.warpPerspective(image, H, (output_w, output_h), borderValue=(255, 255, 255))
    cv2.imwrite(os.path.join(output_dir, f"{base}_01_warped.png"), warped)
    
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    # 1. Otsu for outer contour (handles the dark object on white paper well)
    _, thresh_otsu = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # 2. Adaptive threshold for holes (ignores global shadows)
    thresh_adapt = cv2.adaptiveThreshold(warped_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 101, 5)
    
    # Combine them for the final mask
    # We want to keep everything Otsu says is the object, AND any holes Adaptive finds inside it.
    # Actually, we find the outer contours from Otsu FIRST.
    kernel = np.ones((3, 3), np.uint8)
    thresh_otsu = cv2.morphologyEx(thresh_otsu, cv2.MORPH_CLOSE, kernel, iterations=1)
    thresh_otsu = cv2.morphologyEx(thresh_otsu, cv2.MORPH_OPEN, kernel, iterations=1)
    
    contours_otsu, hierarchy_otsu = cv2.findContours(thresh_otsu, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    outer_indices = []
    h_img, w_img = thresh_otsu.shape
    max_area = 0
    best_idx = -1
    for i, c in enumerate(contours_otsu):
        if hierarchy_otsu[0][i][3] == -1:
            x, y, w_c, h_c = cv2.boundingRect(c)
            if w_c >= w_img - 10 and h_c >= h_img - 10:
                continue # Ignore desk border
            area = cv2.contourArea(c)
            if area > max_area:
                max_area = area
                best_idx = i

    if best_idx != -1:
        outer_indices.append(best_idx)

    if not outer_indices:
        log("No outer contour found", "ERROR")
        return False
        
    outer_shapes = []
    for i in outer_indices:
        shape = fit_perfect_shape(contours_otsu[i])
        if shape:
            outer_shapes.append(shape)
            
    # Find holes using Shadowless Canny
    rgb_planes = cv2.split(warped)
    result_norm_planes = []
    for plane in rgb_planes:
        dilated_img = cv2.dilate(plane, np.ones((7,7), np.uint8))
        bg_img = cv2.GaussianBlur(dilated_img, (101, 101), 0)
        diff_img = 255 - cv2.absdiff(plane, bg_img)
        norm_img = cv2.normalize(diff_img, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8UC1)
        result_norm_planes.append(norm_img)
    shadowless = cv2.merge(result_norm_planes)
    
    gray_shadowless = cv2.cvtColor(shadowless, cv2.COLOR_BGR2GRAY)
    gray_shadowless = cv2.GaussianBlur(gray_shadowless, (5, 5), 0)
    edges = cv2.Canny(gray_shadowless, 50, 150)
    
    kernel_ellipse = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    edges_closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_ellipse)

    contours_holes, hierarchy_holes = cv2.findContours(edges_closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    # Build a solid mask of the mathematical outer shapes to check if holes are inside
    perfect_outer_mask = np.zeros_like(warped_gray)
    for shape in outer_shapes:
        if shape["type"] == "circle":
            cv2.circle(perfect_outer_mask, (int(shape["center"][0]), int(shape["center"][1])), int(shape["radius"]), 255, -1)
        elif shape["type"] == "rectangle":
            cv2.fillPoly(perfect_outer_mask, [np.int32(shape["points"])], 255)
        elif shape["type"] == "raw":
            cv2.fillPoly(perfect_outer_mask, [shape["points"]], 255)

    hole_shapes = []
    if hierarchy_holes is not None:
        for i, c in enumerate(contours_holes):
            c_mask = np.zeros_like(warped_gray)
            cv2.drawContours(c_mask, [c], -1, 255, -1)
            
            overlap = cv2.bitwise_and(c_mask, perfect_outer_mask)
            if np.sum(overlap) > 0.8 * np.sum(c_mask): # Mostly inside
                area = cv2.contourArea(c)
                if area > 30:
                    shape = fit_perfect_shape(c)
                    if shape and shape["type"] != "raw":
                        hole_shapes.append(shape)
                
    # Build smooth mask
    mask = build_smooth_mask(outer_shapes, hole_shapes, warped_gray.shape)
    log(f"Found {len(outer_shapes)} outer shapes and {len(hole_shapes)} hole shapes")
    cv2.imwrite(os.path.join(output_dir, f"{base}_02_smooth_mask.png"), mask)
    
    dxf_path = os.path.join(output_dir, f"{base}_03_outline.dxf")
    n_entities = generate_dxf_from_smooth_mask(mask, pixels_per_mm, dxf_path, paper_h_mm, outer_shapes, hole_shapes)
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
