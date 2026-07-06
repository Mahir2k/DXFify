import os
import sys
import argparse
import numpy as np
import cv2
import torch
from rembg import remove
from segment_anything import sam_model_registry, SamPredictor
from test import (
    log,
    PAPER_SIZES,
    neaten_mask,
    extract_dxf_entities,
    write_dxf
)

VERSION = "8.0_CLEAN_PIPELINE"

# Initialize SAM globally so it's loaded once
log("Loading SAM model (vit_b) …")
sam = sam_model_registry["vit_b"](checkpoint="sam_vit_b_01ec64.pth")
device = "cuda" if torch.cuda.is_available() else "cpu"
sam.to(device=device)
predictor = SamPredictor(sam)

def run_pipeline(image_path, output_dir, paper_size, marker_inset_mm, pixels_per_mm_override=None):
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(image_path))[0]
    
    log("=" * 64)
    log(f"Pipeline v{VERSION} started")
    log("=" * 64)
    log(f"  Image     : {image_path}")
    log(f"  Output    : {output_dir}")
    paper_w_mm, paper_h_mm = PAPER_SIZES[paper_size]
    log(f"  Paper     : A{paper_size}  ({paper_w_mm:.0f} × {paper_h_mm:.0f} mm)")
    log(f"  Marker inset: {marker_inset_mm:.1f} mm")

    # 1. Load image
    log("Loading image …")
    image = cv2.imread(image_path)
    if image is None:
        log("Failed to load image", "ERROR")
        return False
    h, w = image.shape[:2]
    log(f"  Image: {w}×{h} px, {image.shape[2]} ch")
    cv2.imwrite(os.path.join(output_dir, f"{base}_01_original.png"), image)

    # 2. Detect ArUco markers
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

    aruco_vis = image.copy()
    cv2.aruco.drawDetectedMarkers(aruco_vis, corners, ids)
    cv2.imwrite(os.path.join(output_dir, f"{base}_02_aruco_detected.png"), aruco_vis)
    log(f"  Saved {base}_02_aruco_detected.png")

    for needed in (0, 1, 2, 3):
        if needed not in marker_centers_px:
            log(f"Missing required marker ID {needed}", "ERROR")
            return False

    # 3. Compute scale
    marker_mm_positions = {
        0: (marker_inset_mm, marker_inset_mm),
        1: (paper_w_mm - marker_inset_mm, marker_inset_mm),
        2: (paper_w_mm - marker_inset_mm, paper_h_mm - marker_inset_mm),
        3: (marker_inset_mm, paper_h_mm - marker_inset_mm),
    }

    if pixels_per_mm_override is not None:
        pixels_per_mm = pixels_per_mm_override
        log(f"  Using override scale: {pixels_per_mm} px/mm")
    else:
        d01_mm = np.linalg.norm(np.array(marker_mm_positions[1]) - np.array(marker_mm_positions[0]))
        d01_px = np.linalg.norm(marker_centers_px[1] - marker_centers_px[0])
        d03_mm = np.linalg.norm(np.array(marker_mm_positions[3]) - np.array(marker_mm_positions[0]))
        d03_px = np.linalg.norm(marker_centers_px[3] - marker_centers_px[0])
        ppm_x = d01_px / d01_mm
        ppm_y = d03_px / d03_mm
        pixels_per_mm = (ppm_x + ppm_y) / 2.0
        log(f"  Scale from markers:")
        log(f"    Average: {pixels_per_mm:.4f} px/mm")

    # 4. Homography & Warp
    log("Computing homography …")
    target_px = {m_id: (x * pixels_per_mm, y * pixels_per_mm) for m_id, (x, y) in marker_mm_positions.items()}
    H, _ = cv2.findHomography(
        np.array([marker_centers_px[m] for m in (0, 1, 2, 3)], dtype=np.float32),
        np.array([target_px[m]        for m in (0, 1, 2, 3)], dtype=np.float32),
    )
    if H is None:
        log("Homography failed", "ERROR")
        return False

    output_w = int(paper_w_mm * pixels_per_mm)
    output_h = int(paper_h_mm * pixels_per_mm)
    warped_image = cv2.warpPerspective(image, H, (output_w, output_h), flags=cv2.INTER_LINEAR)
    cv2.imwrite(os.path.join(output_dir, f"{base}_03_warped_image.png"), warped_image)
    log(f"  Saved {base}_03_warped_image.png")

    # 5. Background removal (rembg) on the warped image
    log("Background removal (rembg) …")
    rgba = remove(warped_image)
    _, rembg_mask = cv2.threshold(rgba[:, :, 3], 10, 255, cv2.THRESH_BINARY)
    pts_obj = np.argwhere(rembg_mask > 0)
    if len(pts_obj) == 0:
        log("Rembg found no object", "ERROR")
        return False
    y_min, x_min = pts_obj.min(axis=0)
    y_max, x_max = pts_obj.max(axis=0)
    box = np.array([
        max(x_min - 20, 0), max(y_min - 20, 0),
        min(x_max + 20, warped_image.shape[1]),
        min(y_max + 20, warped_image.shape[0])
    ])
    cv2.imwrite(os.path.join(output_dir, f"{base}_04_rembg_mask.png"), rembg_mask)
    log(f"  Saved {base}_04_rembg_mask.png")

    # 6. SAM segmentation on warped image
    log("SAM segmentation …")
    # For accuracy, run SAM on the warped image using the rembg box
    predictor.set_image(warped_image)
    masks, scores, _ = predictor.predict(box=box, multimask_output=False)
    sam_mask = (masks[0].astype(np.uint8) * 255)
    cv2.imwrite(os.path.join(output_dir, f"{base}_05_sam_mask.png"), sam_mask)
    log(f"  Saved {base}_05_sam_mask.png")

    warped_mask = sam_mask.copy() # SAM output on warped image is our perfect outer mask

    # 7. Hole Detection using Shadowless Canny
    log("Hole extraction (Shadowless Canny) …")
    rgb_planes = cv2.split(warped_image)
    result_norm_planes = []
    for plane in rgb_planes:
        dilated_img = cv2.dilate(plane, np.ones((7,7), np.uint8))
        bg_img = cv2.GaussianBlur(dilated_img, (101, 101), 0)
        diff_img = 255 - cv2.absdiff(plane, bg_img)
        norm_img = cv2.normalize(diff_img, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8UC1)
        result_norm_planes.append(norm_img)
    shadowless = cv2.merge(result_norm_planes)
    cv2.imwrite(os.path.join(output_dir, f"{base}_06a_shadowless.png"), shadowless)
    
    gray = cv2.cvtColor(shadowless, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 30, 100)
    
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    edges_closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    cv2.imwrite(os.path.join(output_dir, f"{base}_06b_canny_closed.png"), edges_closed)

    # Find closed contours from edges
    contours, hierarchy = cv2.findContours(edges_closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    if hierarchy is not None:
        hierarchy = hierarchy[0]
        n_holes_punched = 0
        min_hole_area = (0.5 * pixels_per_mm) ** 2  # min 0.5mm x 0.5mm
        
        for i, h in enumerate(hierarchy):
            area = cv2.contourArea(contours[i])
            if area < min_hole_area:
                continue
                
            # Create a mask for just this contour
            c_mask = np.zeros_like(edges_closed)
            cv2.drawContours(c_mask, [contours[i]], -1, 255, -1)
            
            # Condition 1: Must be fully inside the SAM outer mask
            # i.e., bitwise AND with inverted SAM mask should be 0
            # To be safe from border noise, we dilate the contour mask slightly and check
            overlap_with_background = cv2.bitwise_and(c_mask, cv2.bitwise_not(warped_mask))
            if np.sum(overlap_with_background) > 0:
                continue # Not fully inside object
                
            # Condition 2: Must be bright in the ORIGINAL warped image (exposing white paper)
            # Wood is dark, black cases are dark, paper is bright white.
            gray_warped = cv2.cvtColor(warped_image, cv2.COLOR_BGR2GRAY)
            mean_val = cv2.mean(gray_warped, mask=c_mask)[0]
            if mean_val < 180:
                continue # Probably just wood grain, a dark label, or internal object features
                
            # It's a valid hole! Punch it out of the warped mask
            cv2.drawContours(warped_mask, [contours[i]], -1, 0, -1)
            n_holes_punched += 1
            
        log(f"  Punched {n_holes_punched} verified holes into SAM mask")
        
    cv2.imwrite(os.path.join(output_dir, f"{base}_06c_final_mask.png"), warped_mask)
    log(f"  Saved {base}_06c_final_mask.png")

    # 8. Vectorise
    log("Vectorising mask (neaten_mask) …")
    vectorized_mask = neaten_mask(warped_mask, pixels_per_mm)
    cv2.imwrite(os.path.join(output_dir, f"{base}_07_vectorized_mask.png"), vectorized_mask)
    log(f"  Saved {base}_07_vectorized_mask.png")

    # 9. Outline & DXF
    log("Extracting DXF entities …")
    entities = extract_dxf_entities(vectorized_mask, pixels_per_mm)
    
    # Overlay visualization
    log("Building overlay visualisation …")
    contours_vec, _ = cv2.findContours(vectorized_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    overlay_img = warped_image.copy()
    vec_overlay = np.zeros_like(warped_image)
    vec_overlay[vectorized_mask > 0] = (0, 200, 0)
    overlay_img = cv2.addWeighted(overlay_img, 0.6, vec_overlay, 0.4, 0)
    cv2.drawContours(overlay_img, contours_vec, -1, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(output_dir, f"{base}_08_vectorized_overlay.png"), overlay_img)

    if entities:
        dxf_path = os.path.join(output_dir, f"{base}_09_outline.dxf")
        write_dxf(dxf_path, entities, pixels_per_mm, paper_h_mm)
    else:
        log("No entities to export", "WARN")

    log("=" * 64)
    log("Pipeline complete!")
    log("=" * 64)
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"Object → vectorised DXF pipeline v{VERSION}")
    parser.add_argument("image_path", nargs="?", default="samples/wood_tilted.jpg", help="Path to input photograph")
    parser.add_argument("--output-dir", default="outputs", help="Output directory")
    parser.add_argument("--paper-size", type=int, required=True, choices=range(0, 10), help="A-paper size: 0=A0 … 9=A9")
    parser.add_argument("--marker-inset-mm", type=float, default=40.0, help="Marker inset in mm")
    parser.add_argument("--pixels-per-mm", type=float, default=None, help="Override scale")
    args = parser.parse_args()

    ok = run_pipeline(args.image_path, args.output_dir, args.paper_size, args.marker_inset_mm, args.pixels_per_mm)
    if not ok:
        sys.exit(1)
