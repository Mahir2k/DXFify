import cv2
import numpy as np
import os

images = ["key", "phone_case"]
results_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/results"
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

for name in images:
    mask_path = os.path.join(results_dir, f"{name}_mask.png")
    
    # Load warped image and mask
    # Since we saved the mask in the results, we can recreate H to warp the image.
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
    
    # Only get pixels inside the mask
    mask_pixels = warped_gray[mask > 0]
    
    # Compute Otsu threshold on the 1D array of mask pixels
    threshold_value, _ = cv2.threshold(mask_pixels, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    print(f"\n--- {name} ---")
    print(f"Otsu threshold on mask pixels: {threshold_value}")
    
    # Threshold the warped gray image with this value
    _, thresh_img = cv2.threshold(warped_gray, threshold_value, 255, cv2.THRESH_BINARY)
    
    # Keep only the thresholded region that is INSIDE the mask
    detected_holes = cv2.bitwise_and(thresh_img, thresh_img, mask=mask)
    
    # Find contours of the detected holes to filter out small noise and outer edges
    contours, hierarchy = cv2.findContours(detected_holes, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    # We want to identify the holes.
    # A hole inside the object should be fully contained within the object's outer boundary.
    # This means the contour representing the hole should NOT touch the outer boundary of the mask.
    # We can refine this: a hole contour has its points strictly inside the mask.
    # Also, we can filter by size: holes should have a reasonable size (e.g. area between 5 mm^2 and 500 mm^2).
    valid_holes = []
    min_hole_area = 2.0 * (pixels_per_mm ** 2)  # 2 mm^2
    max_hole_area = 5000.0 * (pixels_per_mm ** 2)  # 5000 mm^2
    
    for c in contours:
        area = cv2.contourArea(c)
        if min_hole_area <= area <= max_hole_area:
            # Check if this contour is fully inside the mask (no pixels on mask boundary)
            # A simple check is that the bounding box of the contour does not touch the bounding box of the main object mask
            # Or even better: we can verify if the contour is a child contour, or simply that it is surrounded by the object.
            # Let's draw it and see!
            valid_holes.append(c)
            
    print(f"Number of potential holes detected: {len(valid_holes)}")
    
    # Create output mask with holes punched out
    punched_mask = mask.copy()
    cv2.drawContours(punched_mask, valid_holes, -1, 0, -1) # Draw black filled contours for holes
    
    # Save the punched mask and a visualization
    out_mask_path = os.path.join(scratch_dir, f"{name}_punched_mask.png")
    cv2.imwrite(out_mask_path, punched_mask)
    print(f"Saved punched mask to {out_mask_path}")
    
    # Let's save overlay
    overlay = warped_img.copy()
    overlay[punched_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_img, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_punched_overlay.png"), overlay)
