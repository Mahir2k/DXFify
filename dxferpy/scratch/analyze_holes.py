import cv2
import numpy as np
import os
import json

images = ["key", "phone_case"]
results_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/results"
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

for name in images:
    mask_path = os.path.join(results_dir, f"{name}_mask.png")
    
    # Let's run a quick warp and analysis
    img = cv2.imread(f"samples/{name}.jpg")
    mask = cv2.imread(mask_path, 0)
    
    # Find markers in original image to compute H
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    # Target centers
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
    
    # Warp original image to A4 target space
    warped_img = cv2.warpPerspective(img, H, (2100, 2970))
    warped_gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)
    
    # We want to find the holes inside the mask
    # For pixels outside the mask, set them to 0
    masked_gray = cv2.bitwise_and(warped_gray, warped_gray, mask=mask)
    
    # Print intensity statistics inside the mask
    mask_pixels = warped_gray[mask > 0]
    print(f"\n--- {name} Inside Mask Stats ---")
    print(f"Min: {mask_pixels.min()}, Max: {mask_pixels.max()}, Mean: {mask_pixels.mean():.1f}, Std: {mask_pixels.std():.1f}")
    
    # Get paper background sample outside the mask but inside the page (near margin)
    paper_sample = warped_gray[900:1100, 900:1100]
    paper_mean = paper_sample.mean()
    print(f"Paper Background Sample Mean: {paper_mean:.1f}")
    
    # Apply Otsu on the masked region:
    # Since background outside the mask is 0, Otsu will segment the dark object from the light background/holes.
    # But wait, the dark object has low intensities, and the holes have high intensities.
    # Let's run Otsu thresholding.
    _, thresh_otsu = cv2.threshold(masked_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # The Otsu output will make the light regions (background and holes) 255, and the dark object 0.
    # To keep only the holes, we mask this with the original mask.
    detected_holes_otsu = cv2.bitwise_and(thresh_otsu, thresh_otsu, mask=mask)
    
    # Let's count the area of detected holes
    hole_area = np.count_nonzero(detected_holes_otsu)
    print(f"Otsu detected hole area inside mask: {hole_area} pixels ({hole_area/100.0:.2f} mm^2)")
    
    # Save visualization of detected holes
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_detected_holes_otsu.png"), detected_holes_otsu)
    
    # Let's try Canny edges
    edges = cv2.Canny(masked_gray, 50, 150)
    edges_inside = cv2.bitwise_and(edges, edges, mask=mask)
    cv2.imwrite(os.path.join(scratch_dir, f"{name}_edges_inside.png"), edges_inside)
