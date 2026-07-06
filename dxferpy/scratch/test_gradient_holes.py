import cv2
import numpy as np
import os

images = ["key", "phone_case"]
results_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/results"
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

for name in images:
    mask_path = os.path.join(results_dir, f"{name}_mask.png")
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
    warped_img = cv2.warpPerspective(img, H, (output_w, output_h))
    warped_gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)
    
    # Smooth image to reduce noise
    blurred = cv2.GaussianBlur(warped_gray, (5, 5), 0)
    
    # Compute Sobel gradients
    sobelx = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=3)
    sobely = cv2.Sobel(blurred, cv2.CV_64F, 0, 1, ksize=3)
    grad_mag = np.hypot(sobelx, sobely)
    
    # Normalize to 0-255
    grad_mag_8u = cv2.normalize(grad_mag, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    
    # Erode the mask by 9 pixels (~0.9mm) to preserve thin walls but exclude outer boundary edges
    eroded_mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))
    
    grad_inside = cv2.bitwise_and(grad_mag_8u, grad_mag_8u, mask=eroded_mask)
    
    # Threshold gradient magnitude using Otsu
    _, thresh_grad = cv2.threshold(grad_inside, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # Morphological closing
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    closed_grad = cv2.morphologyEx(thresh_grad, cv2.MORPH_CLOSE, kernel)
    
    # Invert edges inside the eroded mask
    inverted_inside = cv2.bitwise_and(cv2.bitwise_not(closed_grad), eroded_mask)
    
    # Find contours
    contours, hierarchy = cv2.findContours(inverted_inside, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    valid_holes = []
    min_hole_area = 2.0 * (pixels_per_mm ** 2)      # 2 mm^2
    max_hole_area = 5000.0 * (pixels_per_mm ** 2)    # 5000 mm^2
    
    print(f"\n--- {name} ---")
    print(f"Total candidate flat region contours: {len(contours)}")
    
    # Erode again for inside boundary check
    double_eroded_mask = cv2.erode(eroded_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    
    for i, c in enumerate(contours):
        area = cv2.contourArea(c)
        if min_hole_area <= area <= max_hole_area:
            is_inside = True
            for pt in c:
                px, py = pt[0]
                if px < 0 or px >= double_eroded_mask.shape[1] or py < 0 or py >= double_eroded_mask.shape[0]:
                    is_inside = False
                    break
                if double_eroded_mask[py, px] == 0:
                    is_inside = False
                    break
            
            if is_inside:
                # Calculate mean intensity of original warped gray image inside this contour
                c_mask = np.zeros_like(warped_gray)
                cv2.drawContours(c_mask, [c], -1, 255, -1)
                mean_val = cv2.mean(warped_gray, mask=c_mask)[0]
                
                print(f"  Valid Hole candidate: area={area/100.0:.2f} mm^2, mean={mean_val:.1f}")
                valid_holes.append(c)
                
    print(f"Number of valid holes detected: {len(valid_holes)}")
    
    # Punched mask
    punched_mask = mask.copy()
    cv2.drawContours(punched_mask, valid_holes, -1, 0, -1)
    
    # Save
    out_mask_path = os.path.join(scratch_dir, f"{name}_gradient_punched_mask.png")
    cv2.imwrite(out_mask_path, punched_mask)
    
    overlay = warped_img.copy()
    overlay[punched_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_img, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_gradient_punched_overlay.png"), overlay)
