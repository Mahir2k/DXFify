import cv2
import numpy as np
import torch
import os
import glob
from segment_anything import SamPredictor, sam_model_registry

images = ["samples/key.jpg", "samples/airpod_case.jpg", "samples/phone_case.jpg", "samples/wood_tilted.jpg", "samples/wood2.jpg"]

# Calibration sheet specs
sheet_w_mm = 210.0
sheet_h_mm = 297.0
marker_size_mm = 40.0
marker_inset_mm = 20.0
pixels_per_mm = 10.0  # Output resolution: 2100 x 2970 px

# Target centers in mm:
# ID 0 -> TL, ID 1 -> TR, ID 2 -> BR, ID 3 -> BL
target_centers_mm = {
    0: (40.0, 40.0),
    1: (170.0, 40.0),
    2: (170.0, 257.0),
    3: (40.0, 257.0)
}

target_centers_px = {
    id_val: (x * pixels_per_mm, y * pixels_per_mm)
    for id_val, (x, y) in target_centers_mm.items()
}

output_w = int(sheet_w_mm * pixels_per_mm)
output_h = int(sheet_h_mm * pixels_per_mm)

# Initialize SAM
print("Initializing SAM model...")
model_type = "vit_b"
checkpoint = "sam_vit_b_01ec64.pth"
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")
sam = sam_model_registry[model_type](checkpoint=checkpoint)
sam.to(device=device)
predictor = SamPredictor(sam)

scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"
os.makedirs(scratch_dir, exist_ok=True)

for img_path in images:
    img = cv2.imread(img_path)
    if img is None:
        print(f"Failed to load {img_path}")
        continue
        
    print(f"\nProcessing {img_path} ({img.shape[1]}x{img.shape[0]})")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 1. Detect ArUco markers
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    if ids is None or len(ids) < 4:
        print(f"Error: Only detected {0 if ids is None else len(ids)} markers in {img_path}")
        continue
        
    # Map detected marker centers
    src_points = []
    dst_points = []
    
    # We will build a mapping from ID to its 4 corners and its center
    marker_data = {}
    ids_flat = ids.flatten()
    for i, marker_id in enumerate(ids_flat):
        if marker_id not in target_centers_px:
            print(f"Warning: Unexpected marker ID {marker_id}")
            continue
        c = corners[i][0]  # Shape: (4, 2)
        center = np.mean(c, axis=0)
        marker_data[marker_id] = {
            'corners': c,
            'center': center
        }
        src_points.append(center)
        dst_points.append(target_centers_px[marker_id])
        
    if len(src_points) < 4:
        print(f"Error: Did not detect all 4 expected markers in {img_path}")
        continue
        
    src_points = np.array(src_points, dtype=np.float32)
    dst_points = np.array(dst_points, dtype=np.float32)
    
    # Compute Homography for warping later
    H, _ = cv2.findHomography(src_points, dst_points)
    
    # 2. Build Region of Interest (ROI) mask in original image coordinates
    # The ROI is the space between the markers. Specifically, we can define it
    # as the polygon connecting the centers of the 4 markers, or their outer corners.
    # Let's use the convex hull of all corners of the 4 markers to define the A4 paper page boundary.
    all_marker_corners = []
    for marker_id, data in marker_data.items():
        all_marker_corners.extend(data['corners'])
    all_marker_corners = np.array(all_marker_corners, dtype=np.int32)
    
    # Create ROI mask
    roi_mask = np.zeros_like(gray, dtype=np.uint8)
    # Get the convex hull or bounding quadrilateral of the markers
    # A simple way is to use the 4 marker centers as vertices of a polygon
    ordered_ids = [0, 1, 2, 3] # clockwise layout
    poly_pts = np.array([marker_data[oid]['center'] for oid in ordered_ids], dtype=np.int32)
    cv2.fillPoly(roi_mask, [poly_pts], 255)
    
    # We also want to mask out (erase) the markers themselves from the ROI.
    # Let's fill the marker regions with black (0) in the ROI mask.
    for marker_id, data in marker_data.items():
        c_poly = data['corners'].astype(np.int32)
        cv2.fillPoly(roi_mask, [c_poly], 0)
        
    # Apply Otsu thresholding on the grayscale image
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Keep only the thresholded pixels that are in the ROI (i.e. between markers)
    thresh_roi = cv2.bitwise_and(thresh, roi_mask)
    
    # Find contours in the ROI thresholded image
    contours, _ = cv2.findContours(thresh_roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter out contours that are too small
    # (Since scale is not rectified yet, we can filter by relative area, e.g. > 100 pixels)
    valid_contours = [c for c in contours if cv2.contourArea(c) > 100]
    
    if len(valid_contours) == 0:
        print(f"Error: No foreground objects found in ROI for {img_path}")
        continue
        
    # Get the bounding box of the combined valid contours
    all_valid_pts = np.vstack(valid_contours)
    x, y, w, h = cv2.boundingRect(all_valid_pts)
    
    # Pad the bounding box slightly for SAM
    pad = 15
    box = np.array([
        max(x - pad, 0),
        max(y - pad, 0),
        min(x + w + pad, img.shape[1]),
        min(y + h + pad, img.shape[0])
    ])
    
    print(f"  SAM Bounding Box: {box.tolist()}")
    
    # 3. Prompt SAM with the bounding box
    image_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    predictor.set_image(image_rgb)
    
    masks, scores, logits = predictor.predict(
        box=box[None, :],
        multimask_output=False,
    )
    
    raw_mask = masks[0]
    
    # Convert mask to uint8 bitmap (0 or 255)
    mask_bitmap = (raw_mask * 255).astype(np.uint8)
    
    # Clean up the mask using morphological operations
    kernel = np.ones((3, 3), np.uint8)
    mask_bitmap = cv2.morphologyEx(mask_bitmap, cv2.MORPH_CLOSE, kernel)
    
    # 4. Warp the mask and the image to A4 coordinates
    warped_mask = cv2.warpPerspective(mask_bitmap, H, (output_w, output_h), flags=cv2.INTER_NEAREST)
    warped_image = cv2.warpPerspective(img, H, (output_w, output_h), flags=cv2.INTER_LINEAR)
    
    # Save output mask and warped debug image
    mask_path = os.path.join(scratch_dir, f"mask_{os.path.basename(img_path)}")
    cv2.imwrite(mask_path, warped_mask)
    
    # Let's create an overlay of the mask on the warped image
    overlay = warped_image.copy()
    overlay[warped_mask > 0] = [0, 255, 0] # Color the object green
    cv2.addWeighted(overlay, 0.4, warped_image, 0.6, 0, warped_image)
    
    # Draw scale marker/grid or boundary
    cv2.rectangle(warped_image, (0,0), (output_w, output_h), (0, 0, 255), 4)
    
    overlay_path = os.path.join(scratch_dir, f"overlay_{os.path.basename(img_path)}")
    cv2.imwrite(overlay_path, warped_image)
    print(f"  Saved mask to {mask_path}")
    print(f"  Saved overlay to {overlay_path}")
