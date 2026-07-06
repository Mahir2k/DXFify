import cv2
import numpy as np
import os

images = ["key", "phone_case"]
results_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/results"
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

for name in images:
    # Load solid rembg mask
    mask_path = os.path.join(scratch_dir, f"rembg_{name}.jpg")
    img = cv2.imread(f"samples/{name}.jpg")
    mask = cv2.imread(mask_path, 0)
    
    # Detect markers
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    pixels_per_mm = 10.0
    target_centers_mm = {0: (40.0, 40.0), 1: (170.0, 40.0), 2: (170.0, 257.0), 3: (40.0, 257.0)}
    target_centers_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in target_centers_mm.items()}
    
    src_pts = []
    dst_pts = []
    ids_flat = ids.flatten()
    marker_centers = {}
    for i, m_id in enumerate(ids_flat):
        if m_id in target_centers_px:
            center = np.mean(corners[i][0], axis=0)
            marker_centers[m_id] = center
            
    for m_id in [0, 1, 2, 3]:
        src_pts.append(marker_centers[m_id])
        dst_pts.append(target_centers_px[m_id])
    src_pts = np.array(src_pts, dtype=np.float32)
    dst_pts = np.array(dst_pts, dtype=np.float32)
    H, _ = cv2.findHomography(src_pts, dst_pts)
    
    output_w = int(210 * pixels_per_mm)
    output_h = int(297 * pixels_per_mm)
    
    # Warp mask to target rectified space first
    mask = cv2.warpPerspective(mask, H, (output_w, output_h), flags=cv2.INTER_NEAREST)
    
    warped_img = cv2.warpPerspective(img, H, (output_w, output_h))
    warped_gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)
    
    # Get paper median
    margin_px = int(25 * pixels_per_mm)
    roi_mask_warped = np.zeros_like(warped_gray)
    cv2.rectangle(roi_mask_warped, (margin_px, margin_px), (output_w - margin_px, output_h - margin_px), 255, -1)
    
    marker_size_px = int(40 * pixels_per_mm)
    for m_id, (cx, cy) in target_centers_px.items():
        cv2.rectangle(roi_mask_warped, (int(cx - marker_size_px/2.0 - 50), int(cy - marker_size_px/2.0 - 50)),
                      (int(cx + marker_size_px/2.0 + 50), int(cy + marker_size_px/2.0 + 50)), 0, -1)
                      
    pts_object = np.argwhere(mask > 0)
    y_min_obj, x_min_obj = pts_object.min(axis=0)
    y_max_obj, x_max_obj = pts_object.max(axis=0)
    
    paper_sample_mask = roi_mask_warped.copy()
    paper_sample_mask[y_min_obj:y_max_obj, x_min_obj:x_max_obj] = 0
    
    paper_pixels = warped_gray[paper_sample_mask > 0]
    paper_median = np.median(paper_pixels)
    
    body_pixels = warped_gray[(mask > 0) & (warped_gray < 0.9 * paper_median)]
    if len(body_pixels) == 0:
        body_pixels = warped_gray[mask > 0]
    body_median = np.median(body_pixels)
    
    thresh_val = body_median + 0.25 * (paper_median - body_median)
    _, thresh_img = cv2.threshold(warped_gray, thresh_val, 255, cv2.THRESH_BINARY)
    detected_holes = cv2.bitwise_and(thresh_img, thresh_img, mask=mask)
    
    contours, hierarchy = cv2.findContours(detected_holes, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    valid_holes = []
    min_hole_area = 2.0 * (pixels_per_mm ** 2)
    max_hole_area = 5000.0 * (pixels_per_mm ** 2)
    
    punched_mask = mask.copy()
    
    print(f"\n--- {name} ---")
    for c in contours:
        area = cv2.contourArea(c)
        if min_hole_area <= area <= max_hole_area:
            perimeter = cv2.arcLength(c, closed=True)
            circularity = 4 * np.pi * area / (perimeter ** 2) if perimeter > 0 else 0
            
            c_mask = np.zeros_like(warped_gray)
            cv2.drawContours(c_mask, [c], -1, 255, -1)
            mean_val = cv2.mean(warped_gray, mask=c_mask)[0]
            
            if circularity >= 0.45 and mean_val >= 0.45 * paper_median:
                print(f"  Punching hole: area={area/100.0:.2f} mm^2, circularity={circularity:.2f}")
                # Fit ellipse
                if len(c) >= 5:
                    ellipse = cv2.fitEllipse(c)
                    cv2.ellipse(punched_mask, ellipse, 0, -1)
                else:
                    cv2.drawContours(punched_mask, [c], -1, 0, -1)
                    
    # Save
    out_mask_path = os.path.join(scratch_dir, f"{name}_ellipse_punched_mask.png")
    cv2.imwrite(out_mask_path, punched_mask)
    
    overlay = warped_img.copy()
    overlay[punched_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_img, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_ellipse_punched_overlay.png"), overlay)
