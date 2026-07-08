import argparse
import os
import sys
import time

import cv2
import numpy as np
import torch
from rembg import remove
from segment_anything import SamPredictor, sam_model_registry

# ----------------------------------------------------------------------
#  VERSION FLAG
# ----------------------------------------------------------------------
VERSION = "7.0_DXF_EXPORT"

# ----------------------------------------------------------------------
#  A-PAPER SIZE TABLE (width_mm, height_mm) — ISO 216 portrait
# ----------------------------------------------------------------------
PAPER_SIZES = {
    0: (841, 1189),
    1: (594, 841),
    2: (420, 594),
    3: (297, 420),
    4: (210, 297),
    5: (148, 210),
    6: (105, 148),
    7: (74, 105),
    8: (52, 74),
    9: (37, 52),
}


# ----------------------------------------------------------------------
#  LOGGING HELPER
# ----------------------------------------------------------------------
def log(msg, level="INFO"):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{level}] {msg}")


# ----------------------------------------------------------------------
#  CORE FUNCTIONS (from original script)
# ----------------------------------------------------------------------
def fit_circle(pts):
    """Fits a circle using least squares. Returns (xc, yc, r) or None."""
    if len(pts) < 3:
        return None
    X = np.empty((len(pts), 3), dtype=np.float64)
    X[:, 0] = pts[:, 0]
    X[:, 1] = pts[:, 1]
    X[:, 2] = 1.0
    Y = pts[:, 0] ** 2 + pts[:, 1] ** 2
    try:
        sol, _, _, _ = np.linalg.lstsq(X, Y, rcond=None)
        xc = sol[0] / 2.0
        yc = sol[1] / 2.0
        r2 = sol[2] + xc**2 + yc**2
        if r2 <= 0.0:
            return None
        return (xc, yc, np.sqrt(r2))
    except Exception:
        return None


def fit_circle_robust(pts, trim_frac=0.15, iters=2):
    """Least-squares circle fit that iteratively drops the worst-fitting fraction of
    points before refitting."""
    working = np.asarray(pts, dtype=np.float64)
    fit = fit_circle(working)
    if fit is None:
        return None
    for _ in range(iters):
        xc, yc, r = fit
        res = np.abs(np.linalg.norm(working - np.array([xc, yc]), axis=1) - r)
        order = np.argsort(res)
        keep_n = max(3, int(len(order) * (1.0 - trim_frac)))
        if keep_n >= len(order):
            break
        working = working[order[:keep_n]]
        refit = fit_circle(working)
        if refit is None:
            break
        fit = refit
    return fit


def smooth_binary_mask(mask, pixels_per_mm):
    """Remove pixel-level staircase noise while preserving sharp corners.

    Hybrid approach:
      1. Morphological close→open preserves sharp 90° corners.
      2. A gentle Gaussian blur (small sigma) anti-aliases curved
         boundaries so that circle-detection still works.
    """
    k_size = max(3, int(round(0.06 * pixels_per_mm)) | 1)  # odd kernel, ~0.06mm
    kernel = np.ones((k_size, k_size), np.uint8)
    # Close fills small gaps; open removes small protrusions
    smooth = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    smooth = cv2.morphologyEx(smooth, cv2.MORPH_OPEN, kernel)
    # Light Gaussian to anti-alias pixel staircases on curves
    sigma = max(0.6, 0.03 * pixels_per_mm)
    k = int(2 * round(2 * sigma) + 1)
    blurred = cv2.GaussianBlur(smooth.astype(np.float32), (k, k), sigma)
    smooth = np.where(blurred >= 127.5, 255, 0).astype(np.uint8)
    return smooth


def _unwrap_angular_span(sub, xc, yc):
    angs = np.arctan2(sub[:, 1] - yc, sub[:, 0] - xc)
    angs = np.unwrap(angs)
    return abs(angs[-1] - angs[0]) * 180.0 / np.pi


def _max_single_step_turn_deg(sub, stride=None):
    n = len(sub)
    if stride is None:
        stride = max(2, n // 12)
    if n < 3 * stride:
        return 0.0
    idxs = list(range(0, n, stride))
    if idxs[-1] != n - 1:
        idxs.append(n - 1)
    coarse = sub[idxs]
    diffs = np.diff(coarse, axis=0)
    seglen = np.linalg.norm(diffs, axis=1)
    seglen = np.where(seglen < 1e-9, 1e-9, seglen)
    dirs = diffs / seglen[:, None]
    dot = np.clip(np.sum(dirs[:-1] * dirs[1:], axis=1), -1.0, 1.0)
    turns = np.degrees(np.arccos(dot))
    return float(np.max(turns)) if len(turns) else 0.0


def detect_arc_runs(
    pts,
    pixels_per_mm,
    min_angle_deg=20.0,
    min_points=8,
    res_factor=0.15,
    max_radius_mm=500.0,
    max_single_turn_deg=15.0,
):
    n = len(pts)
    assigned = np.zeros(n, dtype=bool)
    arcs = []
    if n < min_points:
        return arcs, assigned
    i = 0
    scanned = 0
    while scanned < n:
        if assigned[i % n]:
            i += 1
            scanned += 1
            continue
        best_end = None
        best_fit = None
        j = i + min_points - 1
        while j < i + n:
            idxs = [k % n for k in range(i, j + 1)]
            sub = pts[idxs]
            fit = fit_circle_robust(sub)
            if fit is None:
                break
            xc, yc, r = fit
            if r > max_radius_mm * pixels_per_mm:
                break
            res = np.abs(np.linalg.norm(sub - np.array([xc, yc]), axis=1) - r)
            p90_res = np.percentile(res, 90)
            if p90_res <= res_factor * pixels_per_mm:
                best_end = j
                best_fit = (xc, yc, r)
                j += 1
            else:
                break
        if best_end is not None:
            idxs = [k % n for k in range(i, best_end + 1)]
            sub = pts[idxs]
            xc, yc, r = best_fit
            ang_span = _unwrap_angular_span(sub, xc, yc)
            p_start, p_end = sub[0], sub[-1]
            chord_vec = p_end - p_start
            chord_len = np.linalg.norm(chord_vec)
            if chord_len > 1e-6:
                chord_dir = chord_vec / chord_len
                perp = np.array([-chord_dir[1], chord_dir[0]])
                devs = (sub - p_start) @ perp
                sagitta = float(np.max(np.abs(devs)))
            else:
                sagitta = 0.0
            is_meaningful_curve = (sagitta >= 0.3 * pixels_per_mm) and (
                chord_len < 1e-6 or (sagitta / max(chord_len, 1e-6)) >= 0.03
            )
            max_turn = _max_single_step_turn_deg(sub)
            is_evenly_curved = max_turn <= max_single_turn_deg
            if ang_span >= min_angle_deg and is_meaningful_curve and is_evenly_curved:
                arcs.append({"i0": i, "i1": best_end, "center": (xc, yc), "r": r})
                for k in idxs:
                    assigned[k % n] = True
                advance = best_end - i
                i = best_end
                scanned += max(1, advance)
                continue
        i += 1
        scanned += 1
    return arcs, assigned


def fit_line_and_intersect(pts1, pts2):
    if len(pts1) < 2 or len(pts2) < 2:
        if len(pts1) > 0 and len(pts2) > 0:
            return (pts1[-1] + pts2[0]) / 2.0
        return np.array([0.0, 0.0])
    line1 = cv2.fitLine(pts1, cv2.DIST_L2, 0, 0.01, 0.01)
    line2 = cv2.fitLine(pts2, cv2.DIST_L2, 0, 0.01, 0.01)
    vx1, vy1, x1, y1 = line1.flatten()
    vx2, vy2, x2, y2 = line2.flatten()
    A = np.array([[vx1, -vx2], [vy1, -vy2]], dtype=np.float64)
    B = np.array([x2 - x1, y2 - y1], dtype=np.float64)
    try:
        t = np.linalg.solve(A, B)
        t1 = t[0]
        return np.array([x1 + vx1 * t1, y1 + vy1 * t1])
    except np.linalg.LinAlgError:
        return (pts1[-1] + pts2[0]) / 2.0


def snap_right_angles(points, angle_tol_deg=5.0):
    pts = [np.array(p, dtype=np.float64) for p in points]
    N = len(pts)
    if N < 3:
        return points
    for i in range(N):
        a = pts[(i - 1) % N]
        b = pts[i]
        c = pts[(i + 1) % N]
        v1 = b - a
        v2 = c - b
        l1 = np.linalg.norm(v1)
        l2 = np.linalg.norm(v2)
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        cos_ang = np.dot(v1, v2) / (l1 * l2)
        ang_deg = np.arccos(np.clip(cos_ang, -1.0, 1.0)) * 180.0 / np.pi
        if abs(ang_deg - 90.0) < angle_tol_deg:
            nx = -v1[1] / l1
            ny = v1[0] / l1
            t = np.dot(c - b, np.array([nx, ny]))
            c_new = b + np.array([nx, ny]) * t
            pts[(i + 1) % N] = c_new
    return [p for p in pts]


def polyline_to_dense_points(points, bulges, closed=True):
    dense_pts = []
    num_pts = len(points)
    limit = num_pts if closed else num_pts - 1
    for i in range(limit):
        p1 = np.array(points[i], dtype=np.float32)
        p2 = np.array(points[(i + 1) % num_pts], dtype=np.float32)
        bulge = bulges[i] if i < len(bulges) else 0.0
        if abs(bulge) < 1e-4:
            dense_pts.append(p1)
        else:
            L = np.linalg.norm(p2 - p1)
            if L < 1e-6:
                dense_pts.append(p1)
                continue
            h = bulge * L / 2.0
            R = (L**2 / (8.0 * h)) + h / 2.0
            mid = (p1 + p2) / 2.0
            chord_dir = (p2 - p1) / L
            perp_dir = np.array([-chord_dir[1], chord_dir[0]])
            d = abs(R) - abs(h)
            center = mid + d * perp_dir * np.sign(bulge)
            r = abs(R)
            v1 = p1 - center
            a1 = np.arctan2(v1[1], v1[0])
            theta = 4.0 * np.arctan(abs(bulge))
            angles = (
                np.linspace(a1, a1 + theta, 30)
                if bulge > 0
                else np.linspace(a1, a1 - theta, 30)
            )
            for ang in angles:
                dense_pts.append(center + r * np.array([np.cos(ang), np.sin(ang)]))
    if closed and len(dense_pts) > 0:
        dense_pts.append(dense_pts[0])
    return np.array(dense_pts, dtype=np.float32)


def adaptive_straighten_contour(
    contour, pixels_per_mm, eps_factor=0.5, line_tolerance=1.0
):
    pts = contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 3:
        return pts
    eps = eps_factor * pixels_per_mm
    approx = cv2.approxPolyDP(contour, eps, True)
    verts = approx.reshape(-1, 2).astype(np.float64)
    if len(verts) < 3:
        return pts
    idxs = [np.argmin(np.sum((pts - v) ** 2, axis=1)) for v in verts]

    def reduce_collinear(v_list, idx_list, angle_tol=165.0):
        keep_v, keep_idx = [], []
        n = len(v_list)
        if n < 3:
            return v_list, idx_list
        for i in range(n):
            prev_v = v_list[(i - 1) % n]
            curr_v = v_list[i]
            next_v = v_list[(i + 1) % n]
            v1, v2 = prev_v - curr_v, next_v - curr_v
            l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
            if l1 < 1e-5 or l2 < 1e-5:
                continue
            ang = np.degrees(np.arccos(np.clip(np.dot(v1, v2) / (l1 * l2), -1.0, 1.0)))
            if ang < angle_tol:
                keep_v.append(curr_v)
                keep_idx.append(idx_list[i])
        return keep_v, keep_idx

    for _ in range(10):
        prev_len = len(verts)
        verts, idxs = reduce_collinear(verts, idxs, angle_tol=170.0)
        if len(verts) == prev_len:
            break
    n = len(verts)
    if n < 3:
        return pts
    final_pts = []
    for i in range(n):
        start, end = idxs[i], idxs[(i + 1) % n]
        seg_pts = (
            pts[start : end + 1]
            if start <= end
            else np.concatenate((pts[start:], pts[: end + 1]), axis=0)
        )
        if len(seg_pts) < 3:
            final_pts.append(verts[i])
            continue
        p1, p2 = seg_pts[0], seg_pts[-1]
        line_vec, line_len = p2 - p1, np.linalg.norm(p2 - p1)
        if line_len < 1e-5:
            final_pts.append(verts[i])
            continue
        norm_dir = np.array([-line_vec[1], line_vec[0]]) / line_len
        dists = np.abs((seg_pts - p1) @ norm_dir)
        if np.percentile(dists, 85) < line_tolerance * pixels_per_mm:
            final_pts.append(p1)
        else:
            final_pts.extend(seg_pts)
    return np.array(final_pts)


def vectorize_contour(contour, pixels_per_mm):
    pts = contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 3:
        return "polyline", pts
    area, perimeter = cv2.contourArea(contour), cv2.arcLength(contour, True)
    circularity = 4.0 * np.pi * area / (perimeter**2) if perimeter > 0 else 0
    rect = cv2.minAreaRect(pts.astype(np.float32))
    aspect_ratio = max(rect[1]) / min(rect[1]) if min(rect[1]) > 0 else 100.0
    c_fit = fit_circle_robust(pts)
    if c_fit is not None and aspect_ratio < 1.15 and circularity >= 0.90:
        xc, yc, r = c_fit
        if (
            np.mean(np.abs(np.linalg.norm(pts - np.array([xc, yc]), axis=1) - r))
            < 0.20 * pixels_per_mm
        ):
            return "circle", (xc, yc, r)
    pts = adaptive_straighten_contour(contour, pixels_per_mm)
    pts_snapped = snap_right_angles(pts.tolist(), angle_tol_deg=8.0)
    return "polyline", np.array(pts_snapped)


def neaten_mask(mask, pixels_per_mm):
    log(f"neaten_mask: VERSION {VERSION} – Hybrid Arcs + Collinear Crusher Active")
    mask = smooth_binary_mask(mask, pixels_per_mm)
    contours, hierarchy = cv2.findContours(
        mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours or hierarchy is None:
        return mask
    hierarchy = hierarchy[0]
    neat_mask = np.zeros_like(mask)
    for i, h in enumerate(hierarchy):
        if h[3] == -1:
            if cv2.contourArea(contours[i]) < 100:
                continue
            ctype, cdata = vectorize_contour(contours[i], pixels_per_mm)
            if ctype == "circle":
                xc, yc, r = cdata
                cv2.circle(
                    neat_mask, (int(round(xc)), int(round(yc))), int(round(r)), 255, -1
                )
            else:
                cv2.drawContours(
                    neat_mask, [cdata.astype(np.int32).reshape(-1, 1, 2)], -1, 255, -1
                )
    for i, h in enumerate(hierarchy):
        if h[3] != -1:
            if cv2.contourArea(contours[i]) < 10:
                continue
            ctype, cdata = vectorize_contour(contours[i], pixels_per_mm)
            if ctype == "circle":
                xc, yc, r = cdata
                cv2.circle(
                    neat_mask, (int(round(xc)), int(round(yc))), int(round(r)), 0, -1
                )
            else:
                cv2.drawContours(
                    neat_mask, [cdata.astype(np.int32).reshape(-1, 1, 2)], -1, 0, -1
                )
    return neat_mask


def compute_angle_at_vertex(a, b, c):
    v1, v2 = a - b, c - b
    l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if l1 < 1e-9 or l2 < 1e-9:
        return 0.0
    return np.degrees(np.arccos(np.clip(np.dot(v1, v2) / (l1 * l2), -1.0, 1.0)))


def annotate_geometry(image, mask, pixels_per_mm):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image
    main_contour = max(contours, key=cv2.contourArea)
    eps = 0.5 * pixels_per_mm
    approx = cv2.approxPolyDP(main_contour, eps, True)
    if len(approx) < 3:
        return image
    pts = approx.reshape(-1, 2).astype(np.float64)
    N = len(pts)
    for i in range(N):
        a, b, c = pts[(i - 1) % N], pts[i], pts[(i + 1) % N]
        angle = compute_angle_at_vertex(a, b, c)
        cv2.circle(image, tuple(b.astype(int)), 8, (0, 0, 255), -1)
        text = f"{angle:.1f}°"
        cv2.putText(
            image,
            text,
            tuple(b.astype(int) + 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 0),
            2,
        )
    return image


# ----------------------------------------------------------------------
#  NEW: DXF BULGE COMPUTATION
# ----------------------------------------------------------------------
def compute_arc_bulge_dxf(p_start, p_end, center, p_mid):
    """Compute DXF bulge for an arc, accounting for Y-axis flip.

    All inputs are in image pixel coordinates (Y-down).
    Returns bulge value for DXF (Y-up): positive = CCW, negative = CW.

    The Y-flip from image→DXF reverses arc orientation, so the bulge
    sign is negated relative to what it would be in image-coord math.
    """
    p_start = np.array(p_start, dtype=np.float64)
    p_end = np.array(p_end, dtype=np.float64)
    center = np.array(center, dtype=np.float64)
    p_mid = np.array(p_mid, dtype=np.float64)

    v1 = p_start - center
    v2 = p_end - center
    v_mid = p_mid - center

    r1 = np.linalg.norm(v1)
    r2 = np.linalg.norm(v2)
    if r1 < 1e-9 or r2 < 1e-9:
        return 0.0

    # Included angle (always positive, 0..pi)
    cos_theta = np.dot(v1, v2) / (r1 * r2)
    cos_theta = np.clip(cos_theta, -1.0, 1.0)
    theta = np.arccos(cos_theta)
    if theta < 0.01:
        return 0.0

    bulge_mag = np.tan(theta / 4.0)

    # Cross product in image coords (Y-down) to determine sweep direction.
    # cross > 0 in image coords = math-CCW in image = visually CW.
    # After Y-flip for DXF: visually CW in image → visually CW in DXF
    # (reflection preserves visual orientation when both are viewed
    #  in their native conventions: image Y-down, DXF Y-up).
    # DXF bulge positive = CCW → visually CW = negative bulge.
    cross = v1[0] * v_mid[1] - v1[1] * v_mid[0]
    if cross > 0:
        return -bulge_mag
    else:
        return bulge_mag


# ----------------------------------------------------------------------
#  NEW: CONTOUR → DXF ENTITY CONVERSION (with arc detection)
# ----------------------------------------------------------------------
def contour_to_dxf_data(contour, pixels_per_mm):
    """Convert a contour into DXF-ready data.

    Returns one of:
      ('circle', (xc, yc, r))           — pixel coords
      ('polyline', (points, bulges))    — pixel coords, bulge per vertex
      None                               — too small / degenerate
    """
    ctype, cdata = vectorize_contour(contour, pixels_per_mm)

    if ctype == "circle":
        return ("circle", cdata)

    pts = cdata.astype(np.float64)
    n = len(pts)
    if n < 3:
        return None

    # Detect arc runs along the contour
    arcs, _ = detect_arc_runs(pts, pixels_per_mm)

    if arcs:
        log(f"    Detected {len(arcs)} arc run(s) across {n} contour points")

    # Build lookup: which indices are arc starts, which are consumed
    arc_start = {}   # start_idx → (end_idx, center)
    consumed = set()  # indices strictly inside an arc (not start, not end)

    for arc in arcs:
        start = arc["i0"] % n
        end = arc["i1"] % n
        # Mark interior points as consumed
        if end >= start:
            for k in range(start + 1, end):
                consumed.add(k)
        else:
            # Arc wraps around the contour seam
            for k in range(start + 1, n):
                consumed.add(k)
            for k in range(0, end):
                consumed.add(k)
        arc_start[start] = (end, arc["center"])

    # Walk the contour and emit vertices with bulges
    vertices = []  # (x, y, bulge)
    for i in range(n):
        if i in consumed:
            continue
        if i in arc_start:
            end, center = arc_start[i]
            p_start = pts[i]
            p_end = pts[end]

            # Determine a midpoint on the arc for direction computation
            if end >= i:
                mid_idx = (i + end) // 2
            else:
                mid_idx = ((i + end + n) // 2) % n
            p_mid = pts[mid_idx]

            bulge = compute_arc_bulge_dxf(
                p_start, p_end, np.array(center), p_mid
            )
            vertices.append((p_start[0], p_start[1], bulge))
        else:
            # Regular point — straight segment starts here
            vertices.append((pts[i][0], pts[i][1], 0.0))

    if len(vertices) < 3:
        return None

    points = np.array([(v[0], v[1]) for v in vertices])
    bulges = [v[2] for v in vertices]
    return ("polyline", (points, bulges))


# ----------------------------------------------------------------------
#  NEW: DXF FILE WRITER
# ----------------------------------------------------------------------
def write_dxf(filepath, entities, pixels_per_mm, paper_h_mm):
    """Write entities to a DXF R14 file in millimetres.

    Coordinates are converted from pixels → mm (÷ pixels_per_mm).
    Y is flipped: y_dxf = paper_h_mm − y_px / pixels_per_mm
    so the geometry appears right-side-up in SolidWorks (Y-up).

    Entities:
      {'type':'circle',  'data':(xc,yc,r), 'layer':'OUTLINE'|'HOLES'}
      {'type':'polyline','data':(pts,bul), 'layer':'OUTLINE'|'HOLES'}
    """
    log(f"Writing DXF → {filepath}")

    with open(filepath, "w") as f:
        # ---- HEADER ----
        f.write("0\nSECTION\n2\nHEADER\n")
        f.write("9\n$ACADVER\n1\nAC1014\n")        # R14
        f.write("9\n$INSUNITS\n70\n4\n")            # 4 = millimetres
        f.write("0\nENDSEC\n")

        # ---- TABLES (layers) ----
        f.write("0\nSECTION\n2\nTABLES\n")
        f.write("0\nTABLE\n2\nLAYER\n70\n2\n")
        f.write("0\nLAYER\n2\nOUTLINE\n70\n0\n62\n7\n6\nCONTINUOUS\n")  # white
        f.write("0\nLAYER\n2\nHOLES\n70\n0\n62\n1\n6\nCONTINUOUS\n")    # red
        f.write("0\nENDTAB\n")
        f.write("0\nENDSEC\n")

        # ---- ENTITIES ----
        f.write("0\nSECTION\n2\nENTITIES\n")
        n_circles = 0
        n_polylines = 0

        for ent in entities:
            layer = ent.get("layer", "OUTLINE")

            if ent["type"] == "circle":
                xc, yc, r = ent["data"]
                xmm = xc / pixels_per_mm
                ymm = paper_h_mm - yc / pixels_per_mm   # flip Y
                rmm = r / pixels_per_mm
                f.write(f"0\nCIRCLE\n8\n{layer}\n")
                f.write(f"10\n{xmm:.6f}\n20\n{ymm:.6f}\n30\n0.0\n")
                f.write(f"40\n{rmm:.6f}\n")
                n_circles += 1

            elif ent["type"] == "polyline":
                points, bulges = ent["data"]
                nv = len(points)
                f.write(f"0\nLWPOLYLINE\n8\n{layer}\n")
                f.write(f"90\n{nv}\n70\n1\n")  # 1 = closed
                for i in range(nv):
                    xmm = points[i][0] / pixels_per_mm
                    ymm = paper_h_mm - points[i][1] / pixels_per_mm
                    f.write(f"10\n{xmm:.6f}\n20\n{ymm:.6f}\n")
                    f.write(f"42\n{bulges[i]:.6f}\n")
                n_polylines += 1

        f.write("0\nENDSEC\n")
        f.write("0\nEOF\n")

    log(f"  DXF entities: {n_circles} circle(s), {n_polylines} polyline(s)")
    log(f"  Unit: millimetres  |  Scale: {pixels_per_mm:.4f} px/mm")
    log(f"  Y-axis flipped for SolidWorks (Y-up) compatibility")


# ----------------------------------------------------------------------
#  NEW: EXTRACT DXF ENTITIES FROM VECTORISED MASK
# ----------------------------------------------------------------------
def extract_dxf_entities(vectorized_mask, pixels_per_mm):
    """Find contours in the vectorised mask and convert to DXF entities."""
    log("Extracting DXF entities from vectorised mask …")
    contours, hierarchy = cv2.findContours(
        vectorized_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours or hierarchy is None:
        log("  No contours found", "WARN")
        return []

    hierarchy = hierarchy[0]
    entities = []

    # --- outer contours ---
    outer = 0
    for i, h in enumerate(hierarchy):
        if h[3] != -1:
            continue
        if cv2.contourArea(contours[i]) < 100:
            continue
        result = contour_to_dxf_data(contours[i], pixels_per_mm)
        if result is None:
            continue
        etype, edata = result
        entities.append({"type": etype, "data": edata, "layer": "OUTLINE"})
        outer += 1
        if etype == "circle":
            log(f"  Outer {i}: CIRCLE  r={edata[2]/pixels_per_mm:.2f}mm")
        else:
            pts, bulges = edata
            arcs = sum(1 for b in bulges if abs(b) > 1e-4)
            log(f"  Outer {i}: POLYLINE  {len(pts)} verts, {arcs} arcs")

    # --- inner contours (holes) ---
    holes = 0
    for i, h in enumerate(hierarchy):
        if h[3] == -1:
            continue
        if cv2.contourArea(contours[i]) < 10:
            continue
        result = contour_to_dxf_data(contours[i], pixels_per_mm)
        if result is None:
            continue
        etype, edata = result
        entities.append({"type": etype, "data": edata, "layer": "HOLES"})
        holes += 1
        if etype == "circle":
            log(f"  Hole  {i}: CIRCLE  r={edata[2]/pixels_per_mm:.2f}mm")
        else:
            pts, bulges = edata
            arcs = sum(1 for b in bulges if abs(b) > 1e-4)
            log(f"  Hole  {i}: POLYLINE  {len(pts)} verts, {arcs} arcs")

    log(f"  Total: {outer} outer + {holes} hole(s) = {len(entities)} entity(ies)")
    return entities


# ----------------------------------------------------------------------
#  MAIN PIPELINE
# ----------------------------------------------------------------------
def run_pipeline(image_path, output_dir, paper_size, marker_inset_mm,
                 pixels_per_mm_override=None):
    log("=" * 64)
    log(f"Pipeline v{VERSION} started")
    log("=" * 64)
    log(f"  Image     : {image_path}")
    log(f"  Output    : {output_dir}")

    # --- validate paper size ---
    if paper_size not in PAPER_SIZES:
        log(f"Invalid paper size {paper_size} (must be 0–9)", "ERROR")
        return False
    paper_w_mm, paper_h_mm = PAPER_SIZES[paper_size]
    log(f"  Paper     : A{paper_size}  ({paper_w_mm} × {paper_h_mm} mm)")

    # --- auto-shrink marker inset if it doesn't fit ---
    max_inset = min(paper_w_mm, paper_h_mm) * 0.40
    if marker_inset_mm > max_inset:
        log(f"  Marker inset {marker_inset_mm:.1f}mm too large for A{paper_size}, "
            f"auto-adjusting to {max_inset:.1f}mm")
        marker_inset_mm = max_inset
    log(f"  Marker inset: {marker_inset_mm:.1f} mm")

    # --- marker real-world positions (mm) on the paper ---
    marker_mm_positions = {
        0: (marker_inset_mm,            marker_inset_mm),
        1: (paper_w_mm - marker_inset_mm, marker_inset_mm),
        2: (paper_w_mm - marker_inset_mm, paper_h_mm - marker_inset_mm),
        3: (marker_inset_mm,            paper_h_mm - marker_inset_mm),
    }

    # --- load image ---
    if not os.path.exists(image_path):
        log(f"Image not found: {image_path}", "ERROR")
        return False
    base = os.path.splitext(os.path.basename(image_path))[0]
    os.makedirs(output_dir, exist_ok=True)

    log("Loading image …")
    image = cv2.imread(image_path)
    if image is None:
        log("cv2.imread returned None", "ERROR")
        return False
    log(f"  Image: {image.shape[1]}×{image.shape[0]} px, {image.shape[2]} ch")

    # --- STEP 01: save original image ---
    cv2.imwrite(os.path.join(output_dir, f"{base}_01_original.png"), image)
    log(f"  Saved {base}_01_original.png")

    # --- detect ArUco markers ---
    log("Detecting ArUco markers (DICT_4X4_50) …")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters  = cv2.aruco.DetectorParameters()
    detector    = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    corners, ids, _ = detector.detectMarkers(gray)

    if ids is None or len(ids) < 4:
        found = len(ids) if ids is not None else 0
        log(f"Need 4 markers (IDs 0-3), found {found}", "ERROR")
        return False

    ids_flat = ids.flatten()
    log(f"  IDs found: {list(ids_flat)}")

    marker_centers_px = {}
    for i, m_id in enumerate(ids_flat):
        if m_id in {0, 1, 2, 3}:
            c = np.mean(corners[i][0], axis=0)
            marker_centers_px[m_id] = c
            log(f"    Marker {m_id}: px ({c[0]:.1f}, {c[1]:.1f})")

    # --- STEP 02: save ArUco detection overlay ---
    aruco_vis = image.copy()
    cv2.aruco.drawDetectedMarkers(aruco_vis, corners, ids)
    for m_id, ctr in marker_centers_px.items():
        cv2.circle(aruco_vis, (int(ctr[0]), int(ctr[1])), 12, (0, 255, 0), 3)
        cv2.putText(aruco_vis, f"ID{m_id}",
                    (int(ctr[0]) + 15, int(ctr[1]) - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_02_aruco_detected.png"), aruco_vis)
    log(f"  Saved {base}_02_aruco_detected.png")

    for needed in (0, 1, 2, 3):
        if needed not in marker_centers_px:
            log(f"Missing required marker ID {needed}", "ERROR")
            return False

    # --- compute scale (pixels_per_mm) from markers ---
    if pixels_per_mm_override is not None:
        pixels_per_mm = pixels_per_mm_override
        log(f"  Using override scale: {pixels_per_mm} px/mm")
    else:
        d01_mm = np.linalg.norm(
            np.array(marker_mm_positions[1]) - np.array(marker_mm_positions[0]))
        d01_px = np.linalg.norm(
            marker_centers_px[1] - marker_centers_px[0])
        d03_mm = np.linalg.norm(
            np.array(marker_mm_positions[3]) - np.array(marker_mm_positions[0]))
        d03_px = np.linalg.norm(
            marker_centers_px[3] - marker_centers_px[0])
        ppm_x = d01_px / d01_mm
        ppm_y = d03_px / d03_mm
        pixels_per_mm = (ppm_x + ppm_y) / 2.0
        log(f"  Scale from markers:")
        log(f"    Horizontal: {d01_px:.1f}px / {d01_mm:.1f}mm = {ppm_x:.4f} px/mm")
        log(f"    Vertical  : {d03_px:.1f}px / {d03_mm:.1f}mm = {ppm_y:.4f} px/mm")
        log(f"    Average   : {pixels_per_mm:.4f} px/mm")

    # --- homography to rectify perspective ---
    log("Computing homography …")
    target_px = {
        m_id: (x * pixels_per_mm, y * pixels_per_mm)
        for m_id, (x, y) in marker_mm_positions.items()
    }
    H, _ = cv2.findHomography(
        np.array([marker_centers_px[m] for m in (0, 1, 2, 3)], dtype=np.float32),
        np.array([target_px[m]        for m in (0, 1, 2, 3)], dtype=np.float32),
    )
    if H is None:
        log("Homography failed", "ERROR")
        return False

    output_w = int(paper_w_mm * pixels_per_mm)
    output_h = int(paper_h_mm * pixels_per_mm)
    log(f"  Warped canvas: {output_w}×{output_h} px "
        f"({paper_w_mm:.0f}×{paper_h_mm:.0f} mm)")

    # --- background removal (rembg) ---
    log("Background removal (rembg) …")
    rgba = remove(image)
    _, rembg_mask = cv2.threshold(rgba[:, :, 3], 10, 255, cv2.THRESH_BINARY)
    pts_obj = np.argwhere(rembg_mask > 0)
    y_min, x_min = pts_obj.min(axis=0)
    y_max, x_max = pts_obj.max(axis=0)
    box = np.array([
        max(x_min - 20, 0), max(y_min - 20, 0),
        min(x_max + 20, image.shape[1]),
        min(y_max + 20, image.shape[0]),
    ])
    log(f"  Object bbox: ({box[0]},{box[1]}) → ({box[2]},{box[3]})")

    # --- STEP 03: save rembg mask ---
    cv2.imwrite(os.path.join(output_dir, f"{base}_03_rembg_mask.png"), rembg_mask)
    log(f"  Saved {base}_03_rembg_mask.png")

    # --- STEP 04: save rembg bbox overlay ---
    bbox_vis = image.copy()
    cv2.rectangle(bbox_vis, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])),
                  (0, 255, 255), 3)
    cv2.imwrite(os.path.join(output_dir, f"{base}_04_rembg_bbox.png"), bbox_vis)
    log(f"  Saved {base}_04_rembg_bbox.png")

    # --- SAM segmentation ---
    log("SAM segmentation …")
    sam = sam_model_registry["vit_b"](checkpoint="sam_vit_b_01ec64.pth")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"  Device: {device}")
    sam.to(device=device)
    predictor = SamPredictor(sam)
    predictor.set_image(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    masks, _, _ = predictor.predict(box=box[None, :], multimask_output=False)
    log(f"  SAM mask: {np.sum(masks[0])} foreground px")

    # --- STEP 05: save SAM mask overlay ---
    sam_vis = image.copy()
    sam_overlay = np.zeros_like(image)
    sam_overlay[masks[0] > 0] = (0, 200, 0)
    sam_vis = cv2.addWeighted(sam_vis, 0.6, sam_overlay, 0.4, 0)
    # draw SAM mask contours
    sam_mask_u8 = (masks[0].astype(np.uint8)) * 255
    sam_contours, _ = cv2.findContours(sam_mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(sam_vis, sam_contours, -1, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_05_sam_mask.png"), sam_vis)
    log(f"  Saved {base}_05_sam_mask.png")

    # --- warp mask + image to paper frame ---
    log("Warping to paper frame …")
    warped_mask = cv2.warpPerspective(
        masks[0].astype(np.uint8) * 255, H, (output_w, output_h),
        flags=cv2.INTER_NEAREST)
    warped_image = cv2.warpPerspective(
        image, H, (output_w, output_h), flags=cv2.INTER_LINEAR)
    log(f"  Warped mask: {np.sum(warped_mask > 0)} foreground px")

    # --- STEP 06: save warped image and warped mask ---
    cv2.imwrite(os.path.join(output_dir, f"{base}_06a_warped_image.png"), warped_image)
    cv2.imwrite(os.path.join(output_dir, f"{base}_06b_warped_mask.png"), warped_mask)
    log(f"  Saved {base}_06a_warped_image.png")
    log(f"  Saved {base}_06b_warped_mask.png")

    # --- STEP 06c: recover holes inside object ---
    # SAM often fills holes (camera cutouts, etc.) because the dark object
    # blends with shadows.  Detect holes by finding regions *inside* the mask
    # that are significantly brighter than the median object colour.
    log("Recovering holes inside object mask …")
    
    # Shadow removal on warped image
    rgb_planes = cv2.split(warped_image)
    result_norm_planes = []
    for plane in rgb_planes:
        dilated_img = cv2.dilate(plane, np.ones((7,7), np.uint8))
        bg_img = cv2.medianBlur(dilated_img, 21)
        diff_img = 255 - cv2.absdiff(plane, bg_img)
        norm_img = cv2.normalize(diff_img,None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8UC1)
        result_norm_planes.append(norm_img)
    warped_image_shadowless = cv2.merge(result_norm_planes)
    cv2.imwrite(os.path.join(output_dir, f"{base}_06c_shadowless_image.png"), warped_image_shadowless)
    log(f"  Saved {base}_06c_shadowless_image.png")

    gray = cv2.cvtColor(warped_image_shadowless, cv2.COLOR_BGR2GRAY)
    obj_pixels = gray[warped_mask > 0]
    if len(obj_pixels) > 0:
        median_val = float(np.median(obj_pixels))
        # Use Otsu on object pixels to split main body vs holes
        # Because of shadow removal, uniform object areas are near 255 (white), and holes/details are dark.
        otsu_thr, _ = cv2.threshold(obj_pixels, 0, 255, cv2.THRESH_OTSU)
        # Only carve holes if there's a meaningful gap
        # (otsu must be well below median to indicate actual dark holes)
        if median_val - otsu_thr > 40:
            # Threshold the full image: pixels darker than otsu inside mask = hole
            hole_mask = np.zeros_like(warped_mask)
            dark = (gray < otsu_thr) & (warped_mask > 0)
            hole_mask[dark] = 255
            # Morphological open to remove tiny noise specks, then close to
            # fill gaps inside the detected hole regions
            hk = max(3, int(round(0.08 * pixels_per_mm)) | 1)
            hkernel = np.ones((hk, hk), np.uint8)
            hole_mask = cv2.morphologyEx(hole_mask, cv2.MORPH_OPEN, hkernel)
            hole_mask = cv2.morphologyEx(hole_mask, cv2.MORPH_CLOSE, hkernel)
            # Only accept holes that are reasonable size (> 0.5mm² and < 30% of object)
            obj_area = np.sum(warped_mask > 0)
            hole_contours, _ = cv2.findContours(
                hole_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            min_hole_area = (0.5 * pixels_per_mm) ** 2  # 0.5mm x 0.5mm
            max_hole_area = 0.30 * obj_area
            valid_holes = np.zeros_like(hole_mask)
            n_holes = 0
            for hc in hole_contours:
                ha = cv2.contourArea(hc)
                if min_hole_area < ha < max_hole_area:
                    cv2.drawContours(valid_holes, [hc], -1, 255, -1)
                    n_holes += 1
            if n_holes > 0:
                warped_mask[valid_holes > 0] = 0
                log(f"  Carved {n_holes} hole(s) from mask "
                    f"(otsu={otsu_thr:.0f}, median={median_val:.0f})")
            else:
                log(f"  No valid holes found (otsu={otsu_thr:.0f}, "
                    f"median={median_val:.0f})")
        else:
            log(f"  No brightness gap for holes "
                f"(otsu={otsu_thr:.0f}, median={median_val:.0f})")
    # Save the corrected mask
    cv2.imwrite(os.path.join(output_dir, f"{base}_06d_mask_with_holes.png"),
                warped_mask)
    log(f"  Saved {base}_06d_mask_with_holes.png")

    # --- vectorise ---
    log("Vectorising mask (neaten_mask) …")
    vectorized_mask = neaten_mask(warped_mask, pixels_per_mm)
    cv2.imwrite(
        os.path.join(output_dir, f"{base}_07_vectorized_mask.png"), vectorized_mask)
    log(f"  Saved {base}_07_vectorized_mask.png")

    # --- outline visualisation ---
    log("Building outline visualisation …")
    contours_vec, _ = cv2.findContours(
        vectorized_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    outline_img = np.zeros((output_h, output_w, 3), dtype=np.uint8)
    cv2.drawContours(outline_img, contours_vec, -1, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_08_outline_only.png"), outline_img)
    log(f"  {len(contours_vec)} contour(s) drawn → {base}_08_outline_only.png")

    # --- annotated overlay ---
    log("Annotated overlay …")
    annotated = annotate_geometry(warped_image.copy(), vectorized_mask, pixels_per_mm)
    cv2.imwrite(os.path.join(output_dir, f"{base}_09_final_annotated_overlay.png"),
                annotated)

    # --- STEP 10: overlay vectorised mask on warped image ---
    log("Overlay visualisation …")
    overlay_img = warped_image.copy()
    vec_overlay = np.zeros_like(warped_image)
    vec_overlay[vectorized_mask > 0] = (0, 200, 0)
    overlay_img = cv2.addWeighted(overlay_img, 0.6, vec_overlay, 0.4, 0)
    cv2.drawContours(overlay_img, contours_vec, -1, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_10_vectorized_overlay.png"),
                overlay_img)
    log(f"  Saved {base}_10_vectorized_overlay.png")

    # --- STEP 11: nodes visualisation ---
    log("Nodes visualisation …")
    nodes_img = (warped_image * 0.4).astype(np.uint8)
    cv2.drawContours(nodes_img, contours_vec, -1, (0, 255, 0), 2)
    for c in contours_vec:
        for pt in c:
            cv2.circle(nodes_img, tuple(pt[0]), 5, (0, 0, 255), -1)
    cv2.imwrite(os.path.join(output_dir, f"{base}_11_aggressive_nodes.png"),
                nodes_img)

    # --- DXF EXPORT ---
    log("-" * 40)
    log("DXF EXPORT")
    log("-" * 40)
    entities = extract_dxf_entities(vectorized_mask, pixels_per_mm)

    if entities:
        dxf_path = os.path.join(output_dir, f"{base}_12_outline.dxf")
        write_dxf(dxf_path, entities, pixels_per_mm, paper_h_mm)

        # log bounding box in mm
        all_pts = []
        for ent in entities:
            if ent["type"] == "circle":
                xc, yc, r = ent["data"]
                all_pts.append([xc - r, yc - r])
                all_pts.append([xc + r, yc + r])
            else:
                pts, _ = ent["data"]
                all_pts.extend(pts.tolist())
        if all_pts:
            all_pts = np.array(all_pts)
            x0 = all_pts[:, 0].min() / pixels_per_mm
            x1 = all_pts[:, 0].max() / pixels_per_mm
            y0 = all_pts[:, 1].min() / pixels_per_mm
            y1 = all_pts[:, 1].max() / pixels_per_mm
            log(f"  Bounding box (mm):")
            log(f"    X: {x0:.2f} → {x1:.2f}  (W = {x1-x0:.2f} mm)")
            log(f"    Y: {y0:.2f} → {y1:.2f}  (H = {y1-y0:.2f} mm)")
        log(f"  ✓ DXF saved: {dxf_path}")
    else:
        log("No entities to export", "WARN")

    log("=" * 64)
    log("Pipeline complete!")
    log("=" * 64)
    return True


# ----------------------------------------------------------------------
#  CLI
# ----------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=f"Object → vectorised DXF pipeline v{VERSION}"
    )
    parser.add_argument("image_path", nargs="?",
                        default="samples/wood_tilted.jpg",
                        help="Path to input photograph")
    parser.add_argument("--output-dir", default="outputs",
                        help="Output directory (default: outputs)")
    parser.add_argument("--paper-size", type=int, required=True,
                        choices=range(0, 10),
                        help="A-paper size: 0=A0 … 9=A9 (required)")
    parser.add_argument("--marker-inset-mm", type=float, default=40.0,
                        help="Marker inset from each paper edge in mm "
                             "(default 40, auto-shrunk for small papers)")
    parser.add_argument("--pixels-per-mm", type=float, default=None,
                        help="Override scale (auto from markers if omitted)")
    args = parser.parse_args()

    ok = run_pipeline(
        args.image_path,
        args.output_dir,
        args.paper_size,
        args.marker_inset_mm,
        args.pixels_per_mm,
    )
    if not ok:
        sys.exit(1)
