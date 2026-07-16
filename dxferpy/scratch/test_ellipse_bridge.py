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

seg_fitted_dirs = []
for j in range(num_v):
    j_next = (j + 1) % num_v
    idx_start = approx_idx[j]
    idx_end = approx_idx[j_next]
    raw_pts = []
    s, e = idx_start, idx_end
    if s > e: e += n
    for k in range(s, e + 1): raw_pts.append(contour[k % n][0])
    pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
    if len(pts_f) >= 2:
        line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
        vx, vy = float(line[0][0]), float(line[1][0])
    else:
        dx = pts[j_next][0] - pts[j][0]
        dy = pts[j_next][1] - pts[j][1]
        l = np.hypot(dx, dy)
        vx, vy = (dx/l, dy/l) if l > 0 else (1.0, 0.0)
    dx = pts[j_next][0] - pts[j][0]
    dy = pts[j_next][1] - pts[j][1]
    if vx * dx + vy * dy < 0: vx, vy = -vx, -vy
    seg_fitted_dirs.append((vx, vy))

seg_angles = []
seg_lengths = []
for j in range(num_v):
    vx, vy = seg_fitted_dirs[j]
    angle = np.degrees(np.arctan2(vy, vx)) % 180.0
    seg_angles.append(angle)
    j_next = (j + 1) % num_v
    seg_lengths.append(np.hypot(pts[j_next][0] - pts[j][0], pts[j_next][1] - pts[j][1]))

dom_dirs = [90.0, 0.0]
snapped_dir_idx = []
for j in range(num_v):
    seg_ang = seg_angles[j]
    best_i = -1
    best_diff = 180
    for di, d in enumerate(dom_dirs):
        diff = min(abs(seg_ang - d), 180 - abs(seg_ang - d))
        if diff < best_diff:
            best_diff = diff
            best_i = di
    if best_diff < 10.0: snapped_dir_idx.append(best_i)
    else: snapped_dir_idx.append(-1)

changed = True
while changed:
    changed = False
    for j in range(num_v):
        if snapped_dir_idx[j] == -1 or seg_lengths[j] < 15.0:
            prev_dir = -1
            for step in range(1, num_v // 2):
                p = (j - step) % num_v
                if snapped_dir_idx[p] != -1 and seg_lengths[p] >= 5.0:
                    prev_dir = snapped_dir_idx[p]
                    break
            next_dir = -1
            for step in range(1, num_v // 2):
                nxt = (j + step) % num_v
                if snapped_dir_idx[nxt] != -1 and seg_lengths[nxt] >= 5.0:
                    next_dir = snapped_dir_idx[nxt]
                    break
            if prev_dir != -1 and prev_dir == next_dir:
                if snapped_dir_idx[j] != prev_dir:
                    print(f"Bridging {j} from {snapped_dir_idx[j]} to {prev_dir}")
                    snapped_dir_idx[j] = prev_dir
                    changed = True

print("After bridging: ", set(snapped_dir_idx))
