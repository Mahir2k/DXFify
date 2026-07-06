import cv2
import numpy as np
import os

images = ["samples/key.jpg", "samples/airpod_case.jpg", "samples/phone_case.jpg", "samples/wood_tilted.jpg", "samples/wood2.jpg"]

sheet_w_mm = 210.0
sheet_h_mm = 297.0
pixels_per_mm = 10.0

target_centers_mm = {
    0: (40.0, 40.0),
    1: (170.0, 40.0),
    2: (170.0, 257.0),
    3: (40.0, 257.0)
}

target_centers_px = {
    m_id: (x * pixels_per_mm, y * pixels_per_mm)
    for m_id, (x, y) in target_centers_mm.items()
}

margin_mm = 25.0  # Safe margin from paper edges

for img_path in images:
    img = cv2.imread(img_path)
    if img is None:
        continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect markers
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    if ids is None or len(ids) < 4:
        continue
        
    marker_centers = {}
    marker_corners_map = {}
    src_pts = []
    dst_pts = []
    ids_flat = ids.flatten()
    for i, m_id in enumerate(ids_flat):
        if m_id in target_centers_px:
            c = corners[i][0]
            center = np.mean(c, axis=0)
            marker_centers[m_id] = center
            marker_corners_map[m_id] = c
            src_pts.append(center)
            dst_pts.append(target_centers_px[m_id])
            
    if len(src_pts) < 4:
        continue
        
    src_pts = np.array(src_pts, dtype=np.float32)
    dst_pts = np.array(dst_pts, dtype=np.float32)
    
    H, _ = cv2.findHomography(src_pts, dst_pts)
    H_inv = np.linalg.inv(H)
    
    # Inset corners of the paper (using margin_mm)
    inset_corners_mm = [
        (margin_mm, margin_mm),
        (sheet_w_mm - margin_mm, margin_mm),
        (sheet_w_mm - margin_mm, sheet_h_mm - margin_mm),
        (margin_mm, sheet_h_mm - margin_mm)
    ]
    inset_corners_px = np.array([[x * pixels_per_mm, y * pixels_per_mm] for x, y in inset_corners_mm], dtype=np.float32)
    orig_inset_corners = cv2.perspectiveTransform(inset_corners_px.reshape(-1, 1, 2), H_inv).reshape(-1, 2)
    
    # Create the ROI mask
    roi_mask = np.zeros_like(gray, dtype=np.uint8)
    cv2.fillPoly(roi_mask, [orig_inset_corners.astype(np.int32)], 255)
    
    # Black out markers
    for m_id, corners_px in marker_corners_map.items():
        center = marker_centers[m_id]
        expanded_corners = []
        for pt in corners_px:
            vec = pt - center
            expanded_corners.append(center + vec * 1.25)
        expanded_corners = np.array(expanded_corners, dtype=np.int32)
        cv2.fillPoly(roi_mask, [expanded_corners], 0)
        
    # Otsu
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    thresh_roi = cv2.bitwise_and(thresh, roi_mask)
    
    # Find contours
    contours, _ = cv2.findContours(thresh_roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area_px = (2.0 * pixels_per_mm) ** 2
    valid_contours = [c for c in contours if cv2.contourArea(c) > min_area_px]
    
    if len(valid_contours) > 0:
        all_pts = np.vstack(valid_contours)
        x, y, w, h = cv2.boundingRect(all_pts)
        print(f"{img_path}: Bounding box: [{x}, {y}, {w}, {h}]. Touches edge? W_edge={x+w == img.shape[1] or x == 0}, H_edge={y+h == img.shape[0] or y == 0}")
    else:
        print(f"{img_path}: No object detected")
