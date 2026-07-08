import cv2
import numpy as np
import torch
import os
import json
from rembg import remove
from segment_anything import SamPredictor, sam_model_registry

images = ["airpod_case.jpg", "key.jpg", "phone_case.jpg", "wood_tilted.jpg", "wood2.jpg"]
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"
os.makedirs(scratch_dir, exist_ok=True)

# Initialize SAM
print("Initializing SAM model...")
model_type = "vit_b"
checkpoint = "sam_vit_b_01ec64.pth"
device = "cuda" if torch.cuda.is_available() else "cpu"
sam = sam_model_registry[model_type](checkpoint=checkpoint)
sam.to(device=device)
predictor = SamPredictor(sam)

pixels_per_mm = 10.0
target_centers_mm = {
    0: (40.0, 40.0),
    1: (170.0, 40.0),
    2: (170.0, 257.0),
    3: (40.0, 257.0)
}
target_centers_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in target_centers_mm.items()}

for img_name in images:
    img_path = f"samples/{img_name}"
    img = cv2.imread(img_path)
    if img is None:
        continue
    print(f"\n==================================================")
    print(f"Processing: {img_name}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 1. Detect ArUco Markers
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    if ids is None or len(ids) < 4:
        print(f"Error: Missing markers.")
        continue
        
    ids_flat = ids.flatten()
    marker_centers = {}
    for i, m_id in enumerate(ids_flat):
        if m_id in target_centers_px:
            center = np.mean(corners[i][0], axis=0)
            marker_centers[m_id] = center
            
    src_pts = []
    dst_pts = []
    for m_id in [0, 1, 2, 3]:
        src_pts.append(marker_centers[m_id])
        dst_pts.append(target_centers_px[m_id])
    src_pts = np.array(src_pts, dtype=np.float32)
    dst_pts = np.array(dst_pts, dtype=np.float32)
    H, _ = cv2.findHomography(src_pts, dst_pts)
    H_inv = np.linalg.inv(H)
    
    # 2. Get robust bounding box using rembg mask
    print("Running rembg to find robust bounding box...")
    rgba = remove(img)
    alpha = rgba[:, :, 3]
    _, rembg_mask = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    
    pts_original = np.argwhere(rembg_mask > 0)
    if len(pts_original) == 0:
        print("Error: rembg found nothing.")
        continue
        
    y_min_orig, x_min_orig = pts_original.min(axis=0)
    y_max_orig, x_max_orig = pts_original.max(axis=0)
    
    pad = 20
    box = np.array([
        max(x_min_orig - pad, 0),
        max(y_min_orig - pad, 0),
        min(x_max_orig + pad, img.shape[1]),
        min(y_max_orig + pad, img.shape[0])
    ])
    print(f"rembg Bounding Box: {box.tolist()}")
    
    # 3. Prompt SAM with this bounding box
    print("Prompting SAM with bounding box...")
    image_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    predictor.set_image(image_rgb)
    
    masks, scores, logits = predictor.predict(
        box=box[None, :],
        multimask_output=False
    )
    
    clean_mask = (masks[0] * 255).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    clean_mask = cv2.morphologyEx(clean_mask, cv2.MORPH_CLOSE, kernel)
    
    # 4. Warp mask and image
    output_w = int(210 * pixels_per_mm)
    output_h = int(297 * pixels_per_mm)
    warped_mask = cv2.warpPerspective(clean_mask, H, (output_w, output_h), flags=cv2.INTER_NEAREST)
    warped_image = cv2.warpPerspective(img, H, (output_w, output_h), flags=cv2.INTER_LINEAR)
    warped_gray = cv2.cvtColor(warped_image, cv2.COLOR_BGR2GRAY)
    
    # 5. Dynamic Hole Detection
    print("Detecting and punching holes...")
    margin_px = int(25 * pixels_per_mm)
    roi_mask_warped = np.zeros_like(warped_gray)
    cv2.rectangle(roi_mask_warped, (margin_px, margin_px), (output_w - margin_px, output_h - margin_px), 255, -1)
    
    marker_size_px = int(40 * pixels_per_mm)
    for m_id, (cx, cy) in target_centers_px.items():
        cv2.rectangle(roi_mask_warped, (int(cx - marker_size_px/2.0 - 50), int(cy - marker_size_px/2.0 - 50)),
                      (int(cx + marker_size_px/2.0 + 50), int(cy + marker_size_px/2.0 + 50)), 0, -1)
                      
    pts_object = np.argwhere(warped_mask > 0)
    if len(pts_object) > 0:
        y_min_obj, x_min_obj = pts_object.min(axis=0)
        y_max_obj, x_max_obj = pts_object.max(axis=0)
        
        paper_sample_mask = roi_mask_warped.copy()
        paper_sample_mask[y_min_obj:y_max_obj, x_min_obj:x_max_obj] = 0
        
        paper_pixels = warped_gray[paper_sample_mask > 0]
        paper_median = np.median(paper_pixels) if len(paper_pixels) > 0 else 200.0
        
        body_pixels = warped_gray[(warped_mask > 0) & (warped_gray < 0.9 * paper_median)]
        body_median = np.median(body_pixels) if len(body_pixels) > 0 else 70.0
        
        # Threshold: Set back to 25% to ignore key reflections
        hole_thresh = body_median + 0.25 * (paper_median - body_median)
        contrast = paper_median - body_median
        print(f"  Contrast: {contrast:.1f}, Threshold: {hole_thresh:.1f}")
        
        if contrast >= 50.0:
            _, thresh_img = cv2.threshold(warped_gray, hole_thresh, 255, cv2.THRESH_BINARY)
            detected_holes = cv2.bitwise_and(thresh_img, thresh_img, mask=warped_mask)
            
            # Use RETR_CCOMP to cleanly identify inner contours
            hole_contours, _ = cv2.findContours(detected_holes, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            
            valid_holes = []
            min_hole_area = 2.0 * (pixels_per_mm ** 2)      # 2 mm^2
            max_hole_area = 5000.0 * (pixels_per_mm ** 2)    # 5000 mm^2
            
            for c in hole_contours:
                area = cv2.contourArea(c)
                if min_hole_area <= area <= max_hole_area:
                    perimeter = cv2.arcLength(c, closed=True)
                    circularity = 4 * np.pi * area / (perimeter ** 2) if perimeter > 0 else 0
                    
                    c_mask = np.zeros_like(warped_gray)
                    cv2.drawContours(c_mask, [c], -1, 255, -1)
                    mean_val = cv2.mean(warped_gray, mask=c_mask)[0]
                    
                    # 1. Large holes (>= 8.0 mm^2) must have circularity >= 0.25 to catch capsule cutouts
                    # 2. Small holes (< 8.0 mm^2) must be circular (circularity >= 0.60)
                    # 3. Mean intensity must be >= 45% of paper median
                    is_large_hole = (area >= 8.0 * (pixels_per_mm ** 2)) and (circularity >= 0.25)
                    is_valid_small_hole = (area < 8.0 * (pixels_per_mm ** 2)) and (circularity >= 0.60)
                    
                    if (is_large_hole or is_valid_small_hole) and (mean_val >= 0.45 * paper_median):
                        print(f"  Punching hole: area={area/100.0:.2f} mm^2, circularity={circularity:.2f}")
                        valid_holes.append(c)
                        
            if len(valid_holes) > 0:
                # Use raw contours to maintain exact capsule/circular geometry
                cv2.drawContours(warped_mask, valid_holes, -1, 0, -1)
                
    # Save Step 6 final mask
    out_mask_path = os.path.join(scratch_dir, f"hybrid_{img_name}")
    cv2.imwrite(out_mask_path, warped_mask)
    
    # Save Step 7 overlay
    overlay = warped_image.copy()
    overlay[warped_mask > 0] = [0, 255, 0]
    cv2.addWeighted(overlay, 0.4, warped_image, 0.6, 0, overlay)
    cv2.imwrite(os.path.join(scratch_dir, f"hybrid_overlay_{img_name}"), overlay)
