import cv2
import numpy as np
import ezdxf
import os
import glob
import argparse

def smooth_curve(pts, window_size=7, iterations=3, closed=False):
    if len(pts) < window_size:
        return pts
    pts = np.array(pts, dtype=np.float32)
    for _ in range(iterations):
        if closed:
            padded = np.pad(pts, ((window_size//2, window_size//2), (0, 0)), mode='wrap')
        else:
            padded = np.pad(pts, ((window_size//2, window_size//2), (0, 0)), mode='edge')
            
        smoothed = np.zeros_like(pts)
        for i in range(len(pts)):
            smoothed[i] = np.mean(padded[i:i+window_size], axis=0)
            
        if not closed:
            smoothed[0] = pts[0]
            smoothed[-1] = pts[-1]
        pts = smoothed
    return pts.tolist()

PAPER_SIZES = {
    'a4': (210.0, 297.0),
    'a3': (297.0, 420.0),
    'a2': (420.0, 594.0),
    'a1': (594.0, 841.0),
    'a5': (148.0, 210.0),
    'letter': (215.9, 279.4),
    'legal': (215.9, 355.6)
}

def get_homography(orig_path, paper_w=210.0, paper_h=297.0, *, marker_offset_x=32.2, marker_offset_y=34.2):
    img = cv2.imread(orig_path)
    if img is None: return None, 1.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)

    corners, ids, rejected = detector.detectMarkers(gray)

    if ids is not None and len(ids) == 4:
        marker_centers = {}
        for i in range(len(ids)):
            center = np.mean(corners[i][0], axis=0)
            marker_centers[int(ids[i])] = center
            
        if all(k in marker_centers for k in [0, 1, 2, 3]):
            pts_src = np.array([
                marker_centers[0],
                marker_centers[1],
                marker_centers[2],
                marker_centers[3]
            ], dtype=np.float32)
            
            scale = 10.0
            cx, cy = marker_offset_x, marker_offset_y
            pts_dst = np.array([
                [cx * scale, cy * scale],
                [(paper_w - cx) * scale, cy * scale],
                [(paper_w - cx) * scale, (paper_h - cy) * scale],
                [cx * scale, (paper_h - cy) * scale]
            ], dtype=np.float32)
            
            H = cv2.getPerspectiveTransform(pts_src, pts_dst)
            return H, scale
    return None, 1.0

def intersect_lines(x0_1, y0_1, vx_1, vy_1, x0_2, y0_2, vx_2, vy_2):
    det = vx_1 * vy_2 - vy_1 * vx_2
    if abs(det) < 1e-6:
        return (x0_1, y0_1)
    t = ((x0_2 - x0_1) * vy_2 - (y0_2 - y0_1) * vx_2) / det
    return (x0_1 + t * vx_1, y0_1 + t * vy_1)

def project_point(pt, x0, y0, vx, vy):
    dx = pt[0] - x0
    dy = pt[1] - y0
    t = dx * vx + dy * vy
    return (x0 + t * vx, y0 + t * vy)

def vectorize_contour(contour, height, scale, *, epsilon_min=0.5, epsilon_max=2.5, snap_angle=10.0, snap_min_length=20.0):
    n = len(contour)
    perimeter = cv2.arcLength(contour, True)
    epsilon = min(epsilon_max, max(epsilon_min, 0.0008 * perimeter))
    approx = cv2.approxPolyDP(contour, epsilon, True)
    
    num_v = len(approx)
    if num_v < 3:
        return None
        
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
            if d == 0:
                break
        approx_idx.append(best_i)
        ptr = best_i

    seg_fitted_dirs = []
    for j in range(num_v):
        j_next = (j + 1) % num_v
        idx_start = approx_idx[j]
        idx_end = approx_idx[j_next]
        
        raw_pts = []
        s, e = idx_start, idx_end
        if s > e:
            e += n
        for k in range(s, e + 1):
            raw_pts.append(contour[k % n][0])
            
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
        if vx * dx + vy * dy < 0:
            vx, vy = -vx, -vy

        seg_fitted_dirs.append((vx, vy))

    seg_angles = []
    seg_lengths = []
    for j in range(num_v):
        vx, vy = seg_fitted_dirs[j]
        angle = np.degrees(np.arctan2(vy, vx)) % 180.0
        seg_angles.append(angle)
        j_next = (j + 1) % num_v
        seg_lengths.append(
            np.hypot(pts[j_next][0] - pts[j][0], pts[j_next][1] - pts[j][1])
        )

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
        if hist_copy[peak] < 0.025 * np.sum(seg_lengths):
            break
            
        if len(dom_dirs) > 0:
            diff_to_ortho = abs((peak - dom_dirs[0]) % 180 - 90)
            if diff_to_ortho < 5.0:
                peak = (dom_dirs[0] + 90) % 180
                
        dom_dirs.append(float(peak))
        
        clear_peak = int(round(peak))
        for k in range(-15, 16):
            hist_copy[(clear_peak + k) % num_bins] = 0

    if not dom_dirs:
        points = [(float(p[0])/scale, float(height - p[1])/scale) for p in [c[0] for c in contour]]
        return points if len(points) >= 3 else None

    snapped_dir_idx = []
    for j in range(num_v):
        seg_ang = seg_angles[j]
        best_i = -1
        best_diff = 180
        for di, d in enumerate(dom_dirs):
            diff = abs(seg_ang - d)
            diff = min(abs(seg_ang - d), 180 - abs(seg_ang - d))
            if diff < best_diff:
                best_diff = diff
                best_i = di

        if best_diff < snap_angle and seg_lengths[j] >= snap_min_length:
            snapped_dir_idx.append(best_i)
        else:
            snapped_dir_idx.append(-1)

    
    changed = True
    while changed:
        changed = False
        for j in range(num_v):
            
            if snapped_dir_idx[j] == -1 and seg_lengths[j] < 10.0:
                prev_dir = -1
                
                for step in range(1, 3):
                    p = (j - step) % num_v
                    if snapped_dir_idx[p] != -1 and seg_lengths[p] >= 5.0:
                        prev_dir = snapped_dir_idx[p]
                        break
                next_dir = -1
                for step in range(1, 3):
                    nxt = (j + step) % num_v
                    if snapped_dir_idx[nxt] != -1 and seg_lengths[nxt] >= 5.0:
                        next_dir = snapped_dir_idx[nxt]
                        break
                if prev_dir != -1 and prev_dir == next_dir:
                    if snapped_dir_idx[j] != prev_dir:
                        snapped_dir_idx[j] = prev_dir
                        changed = True

    merged_pts = []
    merged_approx_idx = []
    merged_snapped = []
    
    j = 0
    while j < num_v:
        seg_dir = snapped_dir_idx[j]
        run_end = j
        while run_end < num_v - 1:
            next_idx = (run_end + 1) % num_v
            if snapped_dir_idx[next_idx] != seg_dir:
                break
            run_end += 1
            if run_end - j > num_v:
                break
        
        merged_pts.append(pts[j])
        merged_approx_idx.append(approx_idx[j])
        merged_snapped.append(seg_dir)
        
        j = run_end + 1

    num_m = len(merged_pts)
    print(f"Contour with {len(contour)} pts -> approx {num_v} pts -> merged {num_m} pts")
    if num_m < 3:
        print("  -> using fallback smoothing")
        raw_pts = [c[0] for c in contour]
        smoothed_pts = smooth_curve(raw_pts, window_size=15, iterations=5, closed=True)
        points = [(float(p[0])/scale, float(height - p[1])/scale) for p in smoothed_pts]
        return points if len(points) >= 3 else None

    seg_lines = []
    for j in range(num_m):
        if merged_snapped[j] == -1:
            seg_lines.append(None)
            continue
            
        j_next = (j + 1) % num_m
        idx_start = merged_approx_idx[j]
        idx_end = merged_approx_idx[j_next]
        
        raw_pts = []
        s, e = idx_start, idx_end
        if s > e:
            e += n
        for k in range(s, e + 1):
            raw_pts.append(contour[k % n][0])
        
        if len(raw_pts) >= 3:
            pts_f = np.array(raw_pts, dtype=np.float32).reshape(-1, 2)
            line = cv2.fitLine(pts_f, cv2.DIST_L2, 0, 0.01, 0.01)
            vx, vy, x0, y0 = float(line[0][0]), float(line[1][0]), float(line[2][0]), float(line[3][0])
        else:
            x0, y0 = merged_pts[j]
            dx = merged_pts[j_next][0] - x0
            dy = merged_pts[j_next][1] - y0
            l = np.hypot(dx, dy)
            vx, vy = (dx/l, dy/l) if l > 0 else (1.0, 0.0)
        
        dom_ang = np.radians(dom_dirs[merged_snapped[j]])
        vx_dom, vy_dom = np.cos(dom_ang), np.sin(dom_ang)
        dx = merged_pts[j_next][0] - merged_pts[j][0]
        dy = merged_pts[j_next][1] - merged_pts[j][1]
        if vx_dom * dx + vy_dom * dy < 0:
            vx_dom, vy_dom = -vx_dom, -vy_dom
        vx, vy = vx_dom, vy_dom
        
        seg_lines.append((vx, vy, x0, y0))

    final_vertices = []
    for j in range(num_m):
        j_prev = (j - 1 + num_m) % num_m
        snap1 = merged_snapped[j_prev]
        snap2 = merged_snapped[j]
        
        if snap1 != -1:
            vx_1, vy_1, x0_1, y0_1 = seg_lines[j_prev]
        if snap2 != -1:
            vx_2, vy_2, x0_2, y0_2 = seg_lines[j]
            
        if snap1 != -1 and snap2 != -1:
            pt = intersect_lines(x0_1, y0_1, vx_1, vy_1, x0_2, y0_2, vx_2, vy_2)
        elif snap1 != -1 and snap2 == -1:
            pt = project_point(merged_pts[j], x0_1, y0_1, vx_1, vy_1)
        elif snap1 == -1 and snap2 != -1:
            pt = project_point(merged_pts[j], x0_2, y0_2, vx_2, vy_2)
        else:
            pt = merged_pts[j]
            
        final_vertices.append(pt)
        
    refined = []
    
    for j in range(num_m):
        snap2 = merged_snapped[j]
        start_pt = final_vertices[j]
        end_pt = final_vertices[(j + 1) % num_m]
        
        refined.append((float(start_pt[0]), float(start_pt[1])))
        
        if snap2 == -1:
            idx_start = merged_approx_idx[j]
            idx_end = merged_approx_idx[(j + 1) % num_m]
            
            s, e = idx_start, idx_end
            if s > e:
                e += n
                
            raw_start = contour[idx_start][0]
            raw_end = contour[idx_end][0]
            
            off_start = np.array(start_pt) - raw_start
            off_end = np.array(end_pt) - raw_end
            
            num_pts = e - s
            curve_pts = [start_pt]
            for i in range(1, num_pts):
                k = s + i
                pt = contour[k % n][0]
                t = i / float(num_pts)
                off = (1 - t) * off_start + t * off_end
                blended_pt = pt + off
                curve_pts.append((float(blended_pt[0]), float(blended_pt[1])))
            curve_pts.append(end_pt)
            
            smoothed_curve = smooth_curve(curve_pts)
            for i in range(1, len(smoothed_curve) - 1):
                refined.append(tuple(smoothed_curve[i]))
                
    points = [(float(p[0])/scale, float(height - p[1])/scale) for p in refined]
    return points if len(points) >= 3 else None

def process_image(img_path, paper_w=210.0, paper_h=297.0):
    print(f"Vectorizing {img_path}...")
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4:
        print(f"  Skipping {img_path}, not an RGBA image.")
        return

    mask = img[:, :, 3]
    orig_path = img_path.replace("output/rgba_", "samples/").replace(".png", ".jpg")
    
    H, scale = get_homography(orig_path, paper_w, paper_h)
    if H is not None:
        height = int(paper_h * scale)
    else:
        height = mask.shape[0]

    contours, hierarchy = cv2.findContours(
        mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    count = 0

    if hierarchy is not None:
        for i, contour in enumerate(contours):
            is_hole = hierarchy[0][i][3] != -1
            
            contour_f = np.array(contour, dtype=np.float32)
            if H is not None:
                contour_f = cv2.perspectiveTransform(contour_f, H)

            area = cv2.contourArea(contour_f)

            if is_hole and area < 500:
                continue
            if not is_hole and area < 100:
                continue
                
            (cx, cy), radius = cv2.minEnclosingCircle(contour_f)
            if radius > 0:
                circle_area = np.pi * radius * radius
                area_ratio = area / circle_area
                if area_ratio > 0.85:
                    cx_mm = float(cx) / scale
                    cy_mm = float(height - cy) / scale
                    radius_mm = float(radius) / scale
                    msp.add_circle((cx_mm, cy_mm), radius_mm)
                    count += 1
                    continue

            points = vectorize_contour(contour_f, height, scale)
            if points:
                msp.add_lwpolyline(points, close=True)
                count += 1

    print(f"  {count} entities")

    base_name = os.path.basename(img_path)
    dxf_name = base_name.replace(".png", ".dxf").replace("rgba_", "")
    out_path = f"output/{dxf_name}"
    doc.saveas(out_path)
    print(f"  Saved {out_path}")

def extract_details(
    warped_img,
    warped_mask,
    scale,
    *,
    threshold1=50,
    threshold2=150,
    min_len_mm=2.0,
):
    gray = cv2.cvtColor(warped_img, cv2.COLOR_BGR2GRAY)

    kernel_size = max(3, int(2.5 * scale))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    detail_zone = cv2.erode(warped_mask, kernel, iterations=1)

    contours, hierarchy = cv2.findContours(
        warped_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )
    if hierarchy is not None:
        for i, contour in enumerate(contours):
            if hierarchy[0][i][3] != -1:
                hole_mask = np.zeros_like(warped_mask)
                cv2.drawContours(hole_mask, [contour], -1, 255, -1)
                dilated_hole = cv2.dilate(hole_mask, kernel, iterations=1)
                detail_zone = cv2.bitwise_and(
                    detail_zone, cv2.bitwise_not(dilated_hole)
                )

    smoothed = cv2.bilateralFilter(gray, 7, 50, 50)

    edges = cv2.Canny(smoothed, threshold1, threshold2)

    edges = cv2.bitwise_and(edges, detail_zone)

    detail_contours, _ = cv2.findContours(
        edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE
    )

    entities = []
    min_len_px = min_len_mm * scale

    for contour in detail_contours:
        perimeter = cv2.arcLength(contour, False)
        if perimeter < min_len_px:
            continue

        epsilon = 0.0005 * perimeter + 0.2
        approx = cv2.approxPolyDP(contour, epsilon, False)

        if len(approx) < 2:
            continue

        points = []
        for p in approx:
            px = float(p[0][0]) / scale
            py = float(warped_img.shape[0] - p[0][1]) / scale
            points.append([round(px, 4), round(py, 4)])

        entities.append(
            {
                "type": "polyline",
                "layer": "DETAILS",
                "points": points,
                "closed": False,
            }
        )

    return entities


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vectorize images to DXF.")
    parser.add_argument("--paper", type=str, default="a4", help="Paper size (a4, a3, a5, letter, legal)")
    args = parser.parse_args()
    
    paper_size = args.paper.lower()
    if paper_size not in PAPER_SIZES:
        print(f"Unknown paper size: {args.paper}. Defaulting to A4.")
        paper_size = "a4"
        
    paper_w, paper_h = PAPER_SIZES[paper_size]
    
    pngs = glob.glob("output/rgba_*.png")
    for p in pngs:
        process_image(p, paper_w, paper_h)
