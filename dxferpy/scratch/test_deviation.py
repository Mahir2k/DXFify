import cv2
import numpy as np

def analyze_contour(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    mask = img[:, :, 3]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    
    epsilon = 1.0
    approx = cv2.approxPolyDP(contour, epsilon, True)
    
    print(f"--- {img_path} ---")
    n = len(contour)
    num_v = len(approx)
    
    # Map approx back to contour indices
    approx_idx = []
    ptr = 0
    pts = [p[0] for p in approx]
    for p in pts:
        best_i, best_d = ptr, 1e9
        for i in range(n):
            idx = (ptr + i) % n
            d = (contour[idx][0][0] - p[0])**2 + (contour[idx][0][1] - p[1])**2
            if d < best_d: best_d, best_i = d, idx
            if d == 0: break
        approx_idx.append(best_i)
        ptr = best_i
        
    for j in range(num_v):
        idx_start = approx_idx[j]
        idx_end = approx_idx[(j+1)%num_v]
        
        raw_pts = []
        s, e = idx_start, idx_end
        if s > e: e += n
        for k in range(s, e + 1):
            raw_pts.append(contour[k % n][0])
            
        if len(raw_pts) < 5: continue
        
        pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
        line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
        vx, vy, x0, y0 = float(line[0][0]), float(line[1][0]), float(line[2][0]), float(line[3][0])
        
        # calculate max distance
        dx = pts_f[:, 0] - x0
        dy = pts_f[:, 1] - y0
        dists = np.abs(dx * (-vy) - dy * (-vx))
        max_dist = np.max(dists)
        
        if max_dist > 1.0:
            print(f"Segment length {len(raw_pts)}, max_dist: {max_dist:.2f}")

analyze_contour('output/rgba_airpod_case.png')
analyze_contour('output/rgba_wood_tilted.png')
