import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
from vectorize_smart import get_homography, intersect_lines, project_point

def vectorize_contour_debug(contour, height, scale):
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
        if vx * dx + vy * dy < 0: vx, vy = -vx, -vx
        seg_fitted_dirs.append((vx, vy))

    seg_angles = []
    seg_lengths = []
    for j in range(num_v):
        vx, vy = seg_fitted_dirs[j]
        angle = np.degrees(np.arctan2(vy, vx)) % 180.0
        seg_angles.append(angle)
        j_next = (j + 1) % num_v
        seg_lengths.append(np.hypot(pts[j_next][0] - pts[j][0], pts[j_next][1] - pts[j][1]))

    num_bins = 180
    hist = np.zeros(num_bins)
    for j in range(num_v):
        bin_idx = int(round(seg_angles[j])) % num_bins
        hist[bin_idx] += seg_lengths[j]
    kernel = np.array([0.05, 0.25, 0.4, 0.25, 0.05])
    hist_smooth = np.convolve(np.tile(hist, 3), kernel, mode='same')[num_bins:2*num_bins]
    dom_dirs = []
    hist_copy = hist_smooth.copy()
    for _ in range(4):
        peak = np.argmax(hist_copy)
        if hist_copy[peak] < 0.05 * np.sum(seg_lengths): break
        if len(dom_dirs) > 0:
            diff_to_ortho = abs((peak - dom_dirs[0]) % 180 - 90)
            if diff_to_ortho < 5.0: peak = (dom_dirs[0] + 90) % 180
        dom_dirs.append(float(peak))
        clear_peak = int(round(peak))
        for k in range(-15, 16): hist_copy[(clear_peak + k) % num_bins] = 0

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

    merged_pts = []
    merged_approx_idx = []
    merged_snapped = []
    j = 0
    while j < num_v:
        seg_dir = snapped_dir_idx[j]
        run_end = j
        while run_end < num_v - 1:
            next_idx = (run_end + 1) % num_v
            if snapped_dir_idx[next_idx] != seg_dir: break
            run_end += 1
            if run_end - j > num_v: break
        merged_pts.append(pts[j])
        merged_approx_idx.append(approx_idx[j])
        merged_snapped.append(seg_dir)
        j = run_end + 1

    num_m = len(merged_pts)
    print("num_m merged segments:", num_m)
    for j in range(num_m):
        idx_start = merged_approx_idx[j]
        idx_end = merged_approx_idx[(j + 1) % num_m]
        s, e = idx_start, idx_end
        if s > e: e += n
        print(f"Segment {j}: dir={merged_snapped[j]}, start={s}, end={e}, num_pts={e-s}")
        
img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contour = max(contours, key=cv2.contourArea)
vectorize_contour_debug(contour, 1000, 10.0)
