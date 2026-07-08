import cv2
import numpy as np
import os

images = ["key", "phone_case"]
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

for name in images:
    img = cv2.imread(f"samples/{name}.jpg")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # ArUco
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    pixels_per_mm = 10.0
    target_centers_mm = {0: (40.0, 40.0), 1: (170.0, 40.0), 2: (170.0, 257.0), 3: (40.0, 257.0)}
    target_centers_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in target_centers_mm.items()}
    
    src_pts = [np.mean(corners[ids.flatten().tolist().index(m_id)][0], axis=0) for m_id in [0, 1, 2, 3]]
    dst_pts = [target_centers_px[m_id] for m_id in [0, 1, 2, 3]]
    H, _ = cv2.findHomography(np.array(src_pts, dtype=np.float32), np.array(dst_pts, dtype=np.float32))
    
    output_w = int(210 * pixels_per_mm)
    output_h = int(297 * pixels_per_mm)
    warped_img = cv2.warpPerspective(img, H, (output_w, output_h))
    warped_gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)
    
    # SAM + rembg Bbox
    from segment_anything import SamPredictor, sam_model_registry
    from rembg import remove
    print(f"Segmenting {name} with SAM...")
    sam = sam_model_registry['vit_b'](checkpoint='sam_vit_b_01ec64.pth').to(device='cuda')
    predictor = SamPredictor(sam)
    predictor.set_image(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    
    rgba = remove(img)
    alpha = rgba[:, :, 3]
    pts = np.argwhere(alpha > 10)
    y_min, x_min = pts.min(axis=0); y_max, x_max = pts.max(axis=0)
    pad = 20
    box = np.array([max(x_min-pad,0), max(y_min-pad,0), min(x_max+pad,img.shape[1]), min(y_max+pad,img.shape[0])])
    masks, _, _ = predictor.predict(box=box[None, :], multimask_output=False)
    clean_mask = (masks[0]*255).astype(np.uint8)
    warped_mask = cv2.warpPerspective(clean_mask, H, (output_w, output_h), flags=cv2.INTER_NEAREST)
    
    # Paper median
    margin_px = int(25 * pixels_per_mm)
    roi_mask_warped = np.zeros_like(warped_gray)
    cv2.rectangle(roi_mask_warped, (margin_px, margin_px), (output_w - margin_px, output_h - margin_px), 255, -1)
    for m_id, (cx, cy) in target_centers_px.items():
        cv2.rectangle(roi_mask_warped, (int(cx - 200), int(cy - 200)), (int(cx + 200), int(cy + 200)), 0, -1)
        
    pts_object = np.argwhere(warped_mask > 0)
    y_min_obj, x_min_obj = pts_object.min(axis=0); y_max_obj, x_max_obj = pts_object.max(axis=0)
    paper_sample_mask = roi_mask_warped.copy()
    paper_sample_mask[y_min_obj:y_max_obj, x_min_obj:x_max_obj] = 0
    paper_pixels = warped_gray[paper_sample_mask > 0]
    paper_median = np.median(paper_pixels) if len(paper_pixels) > 0 else 200.0
    
    body_pixels = warped_gray[(warped_mask > 0) & (warped_gray < 0.9 * paper_median)]
    body_median = np.median(body_pixels) if len(body_pixels) > 0 else 70.0
    
    hole_thresh = body_median + 0.25 * (paper_median - body_median)
    _, thresh_img = cv2.threshold(warped_gray, hole_thresh, 255, cv2.THRESH_BINARY)
    detected_holes = cv2.bitwise_and(thresh_img, thresh_img, mask=warped_mask)
    
    hole_contours, _ = cv2.findContours(detected_holes, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    punched_mask = warped_mask.copy()
    
    print(f"\n--- {name} ---")
    for c in hole_contours:
        area = cv2.contourArea(c)
        if 200 <= area <= 500000:
            perimeter = cv2.arcLength(c, closed=True)
            circularity = 4 * np.pi * area / (perimeter ** 2) if perimeter > 0 else 0
            
            c_mask = np.zeros_like(warped_gray)
            cv2.drawContours(c_mask, [c], -1, 255, -1)
            mean_val = cv2.mean(warped_gray, mask=c_mask)[0]
            
            is_large_hole = (area >= 8.0 * (pixels_per_mm ** 2)) and (circularity >= 0.20)
            is_valid_small_hole = (area < 8.0 * (pixels_per_mm ** 2)) and (circularity >= 0.60)
            
            if (is_large_hole or is_valid_small_hole) and (mean_val >= 0.45 * paper_median):
                M = cv2.moments(c)
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                
                pts_c = c.reshape(-1, 2)
                dists = np.sqrt((pts_c[:, 0] - cx) ** 2 + (pts_c[:, 1] - cy) ** 2)
                p50 = np.percentile(dists, 50)
                p95 = np.percentile(dists, 95)
                ratio = p50 / p95 if p95 > 0 else 0
                
                if ratio >= 0.70:
                    r_robust = int(p95)
                    print(f"  Detected CIRCULAR hole: area={area/100.0:.2f} mm^2, ratio={ratio:.2f}, r={r_robust/10.0:.2f} mm")
                    # Fill the SAM hole first
                    cv2.drawContours(punched_mask, [c], -1, 255, -1)
                    # Punch perfect circle
                    cv2.circle(punched_mask, (cx, cy), r_robust, 0, -1)
                else:
                    print(f"  Detected RAW contour hole: area={area/100.0:.2f} mm^2, ratio={ratio:.2f}")
                    # Fill the SAM hole first
                    cv2.drawContours(punched_mask, [c], -1, 255, -1)
                    # Punch raw contour
                    cv2.drawContours(punched_mask, [c], -1, 0, -1)
                    
    # Save final
    cv2.imwrite(os.path.join(scratch_dir, f"fill_punched_{name}_mask.png"), punched_mask)
    overlay = warped_img.copy()
    overlay[punched_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_img, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"fill_punched_{name}_overlay.png"), overlay)
