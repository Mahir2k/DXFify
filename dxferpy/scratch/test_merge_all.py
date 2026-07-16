import cv2
import numpy as np
from vectorize_smart import get_homography

def analyze_phone():
    img_path = 'output/rgba_phone_case.png'
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    mask = img[:, :, 3]
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    
    epsilon = 2.5
    approx = cv2.approxPolyDP(contour, epsilon, True)
    pts = [p[0] for p in approx]
    num_v = len(approx)
    
    seg_angles = []
    seg_lengths = []
    for j in range(num_v):
        j_next = (j + 1) % num_v
        dx = pts[j_next][0] - pts[j][0]
        dy = pts[j_next][1] - pts[j][1]
        angle = np.degrees(np.arctan2(dy, dx)) % 180.0
        seg_angles.append(angle)
        seg_lengths.append(np.hypot(dx, dy))
        
    dom_dirs = [0.0, 90.0]
    
    snapped_dir_idx = []
    for j in range(num_v):
        ang = seg_angles[j]
        best_i = -1
        best_diff = 180
        for di, d in enumerate(dom_dirs):
            diff = min(abs(ang - d), 180 - abs(ang - d))
            if diff < best_diff:
                best_diff = diff
                best_i = di
                
        if best_diff < 10.0:
            snapped_dir_idx.append(best_i)
        else:
            snapped_dir_idx.append(-1)
            
    print("Snapped original:", snapped_dir_idx)
    
    merged_snapped = []
    j = 0
    while j < num_v:
        seg_dir = snapped_dir_idx[j]
        run_end = j
        # NEW LOGIC: MERGE ALL
        while run_end < num_v - 1:
            next_idx = (run_end + 1) % num_v
            if snapped_dir_idx[next_idx] != seg_dir:
                break
            run_end += 1
            if run_end - j > num_v:
                break
        
        merged_snapped.append(seg_dir)
        j = run_end + 1
        
    print("Merged snapped:", merged_snapped)
    
analyze_phone()
