import cv2
import numpy as np
import ezdxf

def vectorize_contour_debug(contour, height):
    n = len(contour)
    perimeter = cv2.arcLength(contour, True)
    if perimeter == 0: return None
    
    epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
    approx = cv2.approxPolyDP(contour, epsilon, True)
    num_v = len(approx)
    pts = [(float(approx[j][0][0]), float(approx[j][0][1])) for j in range(num_v)]
    
    print(f"Num DP vertices: {num_v}")
    
    approx_idx = []
    for pt in pts:
        dists = (contour[:, 0, 0].astype(float) - pt[0])**2 + \
                (contour[:, 0, 1].astype(float) - pt[1])**2
        approx_idx.append(int(np.argmin(dists)))
    
    seg_fitted_dirs = []
    for j in range(num_v):
        j_next = (j + 1) % num_v
        s, e = approx_idx[j], approx_idx[j_next]
        raw_pts = [contour[k % n][0] for k in range(s, e + 1 if s <= e else e + 1 + n)]
        
        if len(raw_pts) >= 3:
            pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
            line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
            vx, vy = float(line[0][0]), float(line[1][0])
        else:
            dx = pts[j_next][0] - pts[j][0]
            dy = pts[j_next][1] - pts[j][1]
            l = np.hypot(dx, dy)
            vx, vy = (dx/l, dy/l) if l > 0 else (1.0, 0.0)
            
        dx = pts[j_next][0] - pts[j][0]
        dy = pts[j_next][1] - pts[j][1]
        if vx * dx + vy * dy < 0:
            vx, vy = -vx, -vy
        seg_fitted_dirs.append((vx, vy))
        
    seg_angles = [np.degrees(np.arctan2(vy, vx)) % 180.0 for vx, vy in seg_fitted_dirs]
    seg_lengths = [np.hypot(pts[(j+1)%num_v][0] - pts[j][0], pts[(j+1)%num_v][1] - pts[j][1]) for j in range(num_v)]
    
    num_bins = 180
    hist = np.zeros(num_bins)
    for j in range(num_v):
        bin_idx = int(round(seg_angles[j])) % num_bins
        hist[bin_idx] += seg_lengths[j]
        
    kernel = np.ones(5) / 5
    hist_smooth = np.convolve(np.tile(hist, 3), kernel, mode='same')[num_bins:2*num_bins]
    
    dom_dirs = []
    hist_copy = hist_smooth.copy()
    for _ in range(4):
        peak = np.argmax(hist_copy)
        if hist_copy[peak] < 0.01 * np.sum(seg_lengths): break
        dom_dirs.append(float(peak))
        for k in range(-10, 11): hist_copy[(peak + k) % num_bins] = 0
            
    print(f"Dominant directions: {dom_dirs}")
    
    snapped_dir_idx = []
    for j in range(num_v):
        seg_ang = seg_angles[j]
        best_i, best_diff = -1, 180
        for di, d in enumerate(dom_dirs):
            diff = min(abs(seg_ang - d), 180 - abs(seg_ang - d))
            if diff < best_diff: best_diff, best_i = diff, di
        snapped_dir_idx.append(best_i if best_diff < 10.0 else -1)
        print(f"Raw Seg {j}: len={seg_lengths[j]:.1f}, ang={seg_ang:.1f}, snapped_to={best_i} ({dom_dirs[best_i] if best_i != -1 else 'none'})")
        
    # Merge
    merged_pts, merged_approx_idx, merged_snapped = [], [], []
    j = 0
    while j < num_v:
        seg_dir = snapped_dir_idx[j]
        run_end = j
        if seg_dir != -1:
            while run_end < num_v - 1 and snapped_dir_idx[(run_end + 1) % num_v] == seg_dir:
                run_end += 1
        merged_pts.append(pts[j])
        merged_approx_idx.append(approx_idx[j])
        merged_snapped.append(seg_dir)
        j = run_end + 1
        
    if len(merged_snapped) > 1 and merged_snapped[0] == merged_snapped[-1] and merged_snapped[0] != -1:
        merged_pts.pop()
        merged_approx_idx.pop()
        merged_snapped.pop()
        
    num_m = len(merged_pts)
    
    print(f"Num merged segments: {num_m}")
    for j in range(num_m):
        print(f"  Merged Seg {j}: length={np.hypot(merged_pts[(j+1)%num_m][0]-merged_pts[j][0], merged_pts[(j+1)%num_m][1]-merged_pts[j][1]):.1f}, snap={merged_snapped[j]}")
    
    seg_lines = []
    for j in range(num_m):
        if merged_snapped[j] == -1:
            seg_lines.append(None)
            continue
            
        j_next = (j + 1) % num_m
        s, e = merged_approx_idx[j], merged_approx_idx[j_next]
        raw_pts = [contour[k % n][0] for k in range(s, e + 1 if s <= e else e + 1 + n)]
        
        if len(raw_pts) >= 3:
            pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
            line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
            vx, vy, x0, y0 = float(line[0][0]), float(line[1][0]), float(line[2][0]), float(line[3][0])
        else:
            x0, y0 = merged_pts[j]
            dx, dy = merged_pts[j_next][0] - x0, merged_pts[j_next][1] - y0
            l = np.hypot(dx, dy)
            vx, vy = (dx/l, dy/l) if l > 0 else (1.0, 0.0)
            
        dom_ang = np.radians(dom_dirs[merged_snapped[j]])
        vx_dom, vy_dom = np.cos(dom_ang), np.sin(dom_ang)
        dx, dy = merged_pts[j_next][0] - merged_pts[j][0], merged_pts[j_next][1] - merged_pts[j][1]
        if vx_dom * dx + vy_dom * dy < 0: vx_dom, vy_dom = -vx_dom, -vy_dom
        
        seg_lines.append((vx_dom, vy_dom, x0, y0))
        
    refined = []
    for j in range(num_m):
        j_prev = (j - 1 + num_m) % num_m
        snap1, snap2 = merged_snapped[j_prev], merged_snapped[j]
        
        if snap1 != -1 and snap2 != -1:
            vx1, vy1, x1, y1 = seg_lines[j_prev]
            vx2, vy2, x2, y2 = seg_lines[j]
            det = vx1 * (-vy2) - vy1 * (-vx2)
            if abs(det) < 1e-6:
                pt = merged_pts[j]
                t = (pt[0] - x1) * vx1 + (pt[1] - y1) * vy1
                refined.append((x1 + t * vx1, y1 + t * vy1))
                print(f"  V{j}: both snapped (parallel) -> project")
            else:
                t1 = ((x2 - x1) * (-vy2) - (y2 - y1) * (-vx2)) / det
                ix, iy = x1 + vx1 * t1, y1 + vy1 * t1
                if np.hypot(ix - merged_pts[j][0], iy - merged_pts[j][1]) < 50.0:
                    refined.append((ix, iy))
                    print(f"  V{j}: both snapped -> intersect")
                else:
                    refined.append(merged_pts[j])
                    print(f"  V{j}: both snapped (too far) -> orig")
        elif snap1 != -1 and snap2 == -1:
            vx1, vy1, x1, y1 = seg_lines[j_prev]
            pt = merged_pts[j]
            t = (pt[0] - x1) * vx1 + (pt[1] - y1) * vy1
            refined.append((x1 + t * vx1, y1 + t * vy1))
            print(f"  V{j}: prev snapped -> project prev")
        elif snap1 == -1 and snap2 != -1:
            vx2, vy2, x2, y2 = seg_lines[j]
            pt = merged_pts[j]
            t = (pt[0] - x2) * vx2 + (pt[1] - y2) * vy2
            refined.append((x2 + t * vx2, y2 + t * vy2))
            print(f"  V{j}: curr snapped -> project curr")
        else:
            refined.append(merged_pts[j])
            print(f"  V{j}: neither snapped -> orig")
            
    return [(p[0], float(height - p[1])) for p in refined]

img = cv2.imread("output/rgba_phone_case.png", cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
for i, contour in enumerate(contours):
    if cv2.contourArea(contour) > 10000:
        print("Processing main contour...")
        vectorize_contour_debug(contour, mask.shape[0])
        break
