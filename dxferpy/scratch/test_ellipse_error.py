import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np

img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)
contour = contours[1]

n = len(contour)
perimeter = cv2.arcLength(contour, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour, epsilon, True)
num_v = len(approx)
pts = [p[0] for p in approx]
approx_idx = []
ptr = 0
for p in pts:
    best_i = ptr
    best_dist = 1e9
    for i in range(n):
        idx = (ptr + i) % n
        d = (contour[idx][0][0] - p[0])**2 + (contour[idx][0][1] - p[1])**2
        if d < best_dist:
            best_dist = d
            best_i = idx
        if d == 0: break
    approx_idx.append(best_i)
    ptr = best_i

for j in range(num_v):
    j_next = (j + 1) % num_v
    idx_start = approx_idx[j]
    idx_end = approx_idx[j_next]
    raw_pts = []
    s, e = idx_start, idx_end
    if s > e: e += n
    for k in range(s, e + 1): raw_pts.append(contour[k % n][0])
    pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
    length = np.hypot(pts[j_next][0] - pts[j][0], pts[j_next][1] - pts[j][1])
    
    if len(pts_f) >= 3:
        line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
        vx, vy = float(line[0][0]), float(line[1][0])
        cx, cy = float(line[2][0]), float(line[3][0])
        err = 0
        for p in pts_f:
            err += abs(-vy * (p[0] - cx) + vx * (p[1] - cy))
        err /= len(pts_f)
    else:
        err = 0
    print(f"Segment {j}: length={length:.2f}, pts={len(pts_f)}, error={err:.4f}")
