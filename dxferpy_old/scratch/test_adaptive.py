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
    
    warped_img = cv2.warpPerspective(img, H, (2100, 2970))
    warped_gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)
    
    # Run adaptive thresholding on the entire warped grayscale image.
    # Adaptive thresholding will make locally dark regions 0 and locally light regions 255.
    # We want to detect the locally light regions (holes) inside the object.
    # Since the paper is white (light) and the object is dark, the object itself will be 0 (black),
    # while the paper (including paper inside holes) will be 255 (white).
    # We use cv2.ADAPTIVE_THRESH_GAUSSIAN_C or cv2.ADAPTIVE_THRESH_MEAN_C.
    # Let's try block size = 101 or 151 (large enough to cover hole sizes).
    block_size = 151
    C = 10
    thresh_adaptive = cv2.adaptiveThreshold(
        warped_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, block_size, C
    )
    
    # We only care about light regions (255) that are INSIDE the object mask.
    # So we intersect thresh_adaptive with the mask.
    detected_holes = cv2.bitwise_and(thresh_adaptive, thresh_adaptive, mask=mask)
    
    # Let's find contours of these detected holes.
    contours, hierarchy = cv2.findContours(detected_holes, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    valid_holes = []
    min_hole_area = 2.0 * (pixels_per_mm ** 2)  # 2 mm^2
    max_hole_area = 5000.0 * (pixels_per_mm ** 2)  # 5000 mm^2
    
    # We also want to sample the paper background to ensure the hole color is close to paper color.
    # Let's get the median value of paper background (say, in the margin area of the warped image).
    # Since margin is 25mm, we can sample the boundary pixels (e.g. first 20px of all 4 borders).
    border_pixels = []
    border_pixels.extend(warped_gray[:200, :].flatten())
    border_pixels.extend(warped_gray[-200:, :].flatten())
    border_pixels.extend(warped_gray[:, :200].flatten())
    border_pixels.extend(warped_gray[:, -200:].flatten())
    paper_median = np.median(border_pixels)
    print(f"\n--- {name} ---")
    print(f"Paper background median intensity: {paper_median:.1f}")
    
    for c in contours:
        area = cv2.contourArea(c)
        if min_hole_area <= area <= max_hole_area:
            # Let's verify that the average color inside this contour is relatively close to the paper background.
            # Create a temporary mask for this single contour
            c_mask = np.zeros_like(warped_gray)
            cv2.drawContours(c_mask, [c], -1, 255, -1)
            mean_val = cv2.mean(warped_gray, mask=c_mask)[0]
            
            # If the mean intensity of the contour is at least 60% of the paper background, it's likely a hole (paper),
            # whereas metal highlights or dark object details will have different intensities or fail this.
            # Also, we check if the contour touches the outer boundary of the object's mask.
            # To do this, we can check if the contour points are strictly inside the mask (i.e. distance from mask boundary is > 0).
            # We can use cv2.pointPolygonTest or simply check if the contour drawn on a boundary image intersects the mask boundary.
            # Let's see: if we erode the mask by 5 pixels, a valid hole should be completely inside the eroded mask.
            eroded_mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
            
            # Check if all points of the contour are inside the eroded mask.
            # (If a point has eroded_mask value of 0, it means it is too close to the boundary).
            # This is a very clean way to filter out any contours that are part of the outer edge.
            is_inside = True
            for pt in c:
                px, py = pt[0]
                if px < 0 or px >= eroded_mask.shape[1] or py < 0 or py >= eroded_mask.shape[0]:
                    is_inside = False
                    break
                if eroded_mask[py, px] == 0:
                    is_inside = False
                    break
            
            # Print candidate info
            # print(f"  Contour area: {area/100.0:.2f} mm^2, mean val: {mean_val:.1f}, inside: {is_inside}")
            
            if is_inside and mean_val >= 0.55 * paper_median:
                valid_holes.append(c)
                
    print(f"Number of valid holes detected: {len(valid_holes)}")
    
    # Create punched mask
    punched_mask = mask.copy()
    cv2.drawContours(punched_mask, valid_holes, -1, 0, -1)
    
    # Save results
    out_mask_path = os.path.join(scratch_dir, f"{name}_adaptive_punched_mask.png")
    cv2.imwrite(out_mask_path, punched_mask)
    
    overlay = warped_img.copy()
    overlay[punched_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_img, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_adaptive_punched_overlay.png"), overlay)
    print(f"Saved adaptive punched mask to {out_mask_path}")
