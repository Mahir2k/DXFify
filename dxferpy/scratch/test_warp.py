import cv2
import numpy as np
import glob
import os

images = ["samples/key.jpg", "samples/airpod_case.jpg", "samples/phone_case.jpg", "samples/wood_tilted.jpg"]

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

# In pixels:
target_centers_px = {
    id_val: (x * pixels_per_mm, y * pixels_per_mm)
    for id_val, (x, y) in target_centers_mm.items()
}

output_w = int(sheet_w_mm * pixels_per_mm)
output_h = int(sheet_h_mm * pixels_per_mm)

# Ensure output directory exists in scratch
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"
os.makedirs(scratch_dir, exist_ok=True)

for img_path in images:
    img = cv2.imread(img_path)
    if img is None:
        print(f"Failed to load {img_path}")
        continue
        
    print(f"\nProcessing {img_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect markers
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
    
    ids_flat = ids.flatten()
    for i, marker_id in enumerate(ids_flat):
        if marker_id not in target_centers_px:
            print(f"Warning: Unexpected marker ID {marker_id}")
            continue
        # Average the 4 corners of the marker to find its center
        c = corners[i][0]
        center = np.mean(c, axis=0)
        src_points.append(center)
        dst_points.append(target_centers_px[marker_id])
        
    if len(src_points) < 4:
        print(f"Error: Could not find all 4 required markers in {img_path}")
        continue
        
    src_points = np.array(src_points, dtype=np.float32)
    dst_points = np.array(dst_points, dtype=np.float32)
    
    # Compute Homography
    H, _ = cv2.findHomography(src_points, dst_points)
    
    # Warp perspective to A4 sheet
    warped = cv2.warpPerspective(img, H, (output_w, output_h))
    
    # Create mask to ignore markers and margins
    ignore_mask = np.ones((output_h, output_w), dtype=np.uint8) * 255
    
    # Mask out outer page border (e.g. 15mm from all edges)
    border_px = int(15 * pixels_per_mm)
    cv2.rectangle(ignore_mask, (0, 0), (output_w, border_px), 0, -1)
    cv2.rectangle(ignore_mask, (0, output_h - border_px), (output_w, output_h), 0, -1)
    cv2.rectangle(ignore_mask, (0, 0), (border_px, output_h), 0, -1)
    cv2.rectangle(ignore_mask, (output_w - border_px, 0), (output_w, output_h), 0, -1)
    
    # Mask out markers
    marker_pad_px = int(25 * pixels_per_mm)  # 25mm radius to fully clear 40mm marker
    for marker_id, (cx, cy) in target_centers_px.items():
        x_min = max(0, int(cx - marker_pad_px))
        x_max = min(output_w, int(cx + marker_pad_px))
        y_min = max(0, int(cy - marker_pad_px))
        y_max = min(output_h, int(cy + marker_pad_px))
        cv2.rectangle(ignore_mask, (x_min, y_min), (x_max, y_max), 0, -1)
        
    # Get gray warped image
    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    
    # Apply Otsu thresholding on the entire gray image first
    _, thresh = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Now set the ignored regions to 0 in the binary mask
    thresh[ignore_mask == 0] = 0
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Filter contours by size to ignore small noise
    min_area_px = 50 * pixels_per_mm  # 50 mm^2 or similar
    valid_contours = [c for c in contours if cv2.contourArea(c) > min_area_px]
    
    if len(valid_contours) > 0:
        all_contours = np.vstack(valid_contours)
        x, y, w, h = cv2.boundingRect(all_contours)
        print(f"  Object detected at: x={x}, y={y}, w={w}, h={h}")
        print(f"  Object dimensions in mm: w={w/pixels_per_mm:.1f} mm, h={h/pixels_per_mm:.1f} mm")
        
        # Save debug image
        debug_img = warped.copy()
        # Draw bounding box
        cv2.rectangle(debug_img, (x, y), (x+w, y+h), (0, 255, 0), 3)
        # Draw marker centers and areas masked out
        for marker_id, (cx, cy) in target_centers_px.items():
            cv2.circle(debug_img, (int(cx), int(cy)), 10, (255, 0, 0), -1)
            cv2.rectangle(debug_img, (int(cx - marker_pad_px), int(cy - marker_pad_px)), 
                          (int(cx + marker_pad_px), int(cy + marker_pad_px)), (255, 0, 0), 2)
        # Draw paper border boundary
        cv2.rectangle(debug_img, (border_px, border_px), (output_w - border_px, output_h - border_px), (0, 0, 255), 2)
        
        out_name = os.path.join(scratch_dir, f"rectified_debug_{os.path.basename(img_path)}")
        cv2.imwrite(out_name, debug_img)
        print(f"  Saved debug image to {out_name}")
    else:
        print("  Error: No object detected in masked image.")
