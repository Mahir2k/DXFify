import cv2
import numpy as np
import torch
import os
from segment_anything import SamPredictor, sam_model_registry

images = ["key", "phone_case"]
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"

# Initialize SAM
print("Initializing SAM model...")
model_type = "vit_b"
checkpoint = "sam_vit_b_01ec64.pth"
device = "cuda" if torch.cuda.is_available() else "cpu"
sam = sam_model_registry[model_type](checkpoint=checkpoint)
sam.to(device=device)
predictor = SamPredictor(sam)

# Target centers in mm:
pixels_per_mm = 10.0
target_centers_mm = {
    0: (40.0, 40.0),
    1: (170.0, 40.0),
    2: (170.0, 257.0),
    3: (40.0, 257.0)
}
target_centers_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in target_centers_mm.items()}

for name in images:
    img_path = f"samples/{name}.jpg"
    img = cv2.imread(img_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect markers
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
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
    H_inv = np.linalg.inv(H)
    
    # Bbox estimation in original space using safe margin
    output_w = int(210 * pixels_per_mm)
    output_h = int(297 * pixels_per_mm)
    
    margin_mm = 25.0
    inset_corners_mm = [
        (margin_mm, margin_mm),
        (sheet_w_mm - margin_mm if 'sheet_w_mm' in globals() else 210.0 - margin_mm, margin_mm),
        (sheet_w_mm - margin_mm if 'sheet_w_mm' in globals() else 210.0 - margin_mm, sheet_h_mm - margin_mm if 'sheet_h_mm' in globals() else 297.0 - margin_mm),
        (margin_mm, sheet_h_mm - margin_mm if 'sheet_h_mm' in globals() else 297.0 - margin_mm)
    ]
    inset_corners_px = np.array([[x * pixels_per_mm, y * pixels_per_mm] for x, y in inset_corners_mm], dtype=np.float32)
    orig_inset_corners = cv2.perspectiveTransform(inset_corners_px.reshape(-1, 1, 2), H_inv).reshape(-1, 2)
    
    roi_mask = np.zeros_like(gray, dtype=np.uint8)
    cv2.fillPoly(roi_mask, [orig_inset_corners.astype(np.int32)], 255)
    
    for m_id, corners_px in marker_centers.items():
        c_poly = corners[ids_flat.tolist().index(m_id)][0].astype(np.int32)
        cv2.fillPoly(roi_mask, [c_poly], 0)
        
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    thresh_roi = cv2.bitwise_and(thresh, roi_mask)
    contours, _ = cv2.findContours(thresh_roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    valid_contours = [c for c in contours if cv2.contourArea(c) > 100]
    all_pts = np.vstack(valid_contours)
    x, y, w, h = cv2.boundingRect(all_pts)
    
    pad = 20
    box = np.array([max(x-pad, 0), max(y-pad, 0), min(x+w+pad, img.shape[1]), min(y+h+pad, img.shape[0])])
    
    # Detect candidate holes in original space inside the ROI thresholded image
    # Let's find contours inside the bounding box that are locally white (paper)
    # The thresh_roi image is THRESH_BINARY_INV, so dark objects are 255, and white paper is 0.
    # In thresh_roi, the holes inside the object will be 0 (black).
    # So if we invert thresh_roi inside the bounding box, the holes will be 255 (white)!
    inverted_bbox = cv2.bitwise_not(thresh_roi[box[1]:box[3], box[0]:box[2]])
    # We also mask it with the object's filled ROI contour to avoid the background outside the object
    # Let's run a simple contour check:
    hole_contours, _ = cv2.findContours(inverted_bbox, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    point_coords = []
    point_labels = []
    
    min_hole_area = 2 * (pixels_per_mm ** 2)
    max_hole_area = 5000 * (pixels_per_mm ** 2)
    
    print(f"\n--- {name} ---")
    for hc in hole_contours:
        area = cv2.contourArea(hc)
        # Check circularity
        perimeter = cv2.arcLength(hc, closed=True)
        circularity = 4 * np.pi * area / (perimeter ** 2) if perimeter > 0 else 0
        
        # Scale area to target space for filter
        # Let's simplify: in original pixels, area should be between 20 and 50000
        if 20 <= area <= 50000 and circularity >= 0.40:
            M = cv2.moments(hc)
            if M["m00"] > 0:
                cx = int(M["m10"] / M["m00"]) + box[0]
                cy = int(M["m01"] / M["m00"]) + box[1]
                point_coords.append([cx, cy])
                point_labels.append(0) # 0 = background (hole)
                print(f"  Hole center detected at: ({cx}, {cy}), area={area:.1f}, circularity={circularity:.2f}")
                
    # Also add a foreground point in the center of the bounding box to anchor the object
    point_coords.append([int((box[0] + box[2])/2), int((box[1] + box[3])/2)])
    point_labels.append(1) # 1 = foreground (object)
    
    point_coords = np.array(point_coords, dtype=np.float32)
    point_labels = np.array(point_labels, dtype=np.int32)
    
    # Feed to SAM
    image_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    predictor.set_image(image_rgb)
    
    masks, scores, logits = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        box=box[None, :],
        multimask_output=False
    )
    
    sam_mask = (masks[0] * 255).astype(np.uint8)
    
    # Save mask
    out_path = os.path.join(scratch_dir, f"sam_prompted_{name}_mask.png")
    cv2.imwrite(out_path, sam_mask)
    print(f"Saved SAM mask with hole prompts to {out_path}")
    
    # Let's check if the mask now has holes!
    contours_final, hierarchy_final = cv2.findContours(sam_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    num_holes_final = 0
    if hierarchy_final is not None:
        num_holes_final = np.sum(hierarchy_final[0, :, 3] != -1)
    print(f"  Final contours = {len(contours_final)}, holes = {num_holes_final}")
