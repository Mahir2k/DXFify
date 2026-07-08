import cv2
import numpy as np
import ezdxf
import os
import glob


def process_image(img_path):
    print(f"Vectorizing {img_path}...")
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4:
        print(f"  Skipping {img_path}, not an RGBA image.")
        return
    
    mask = img[:, :, 3]
    height = mask.shape[0]
    
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    
    count = 0
    
    if hierarchy is not None:
        for i, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            is_hole = hierarchy[0][i][3] != -1
            
            # Skip tiny contours / noise
            if is_hole and area < 500:
                continue
            if not is_hole and area < 100:
                continue
            
            # Douglas-Peucker simplification - very gentle
            perimeter = cv2.arcLength(contour, True)
            if perimeter == 0:
                continue
            approx = cv2.approxPolyDP(contour, 0.0008 * perimeter, True)
            
            points = [(float(p[0][0]), float(height - p[0][1])) for p in approx]
            if len(points) >= 3:
                msp.add_lwpolyline(points, close=True)
                count += 1
    
    print(f"  {count} polylines")
    
    base_name = os.path.basename(img_path)
    dxf_name = base_name.replace('.png', '.dxf').replace('rgba_', '')
    out_path = f"output/{dxf_name}"
    doc.saveas(out_path)
    print(f"  Saved {out_path}")


if __name__ == "__main__":
    images = sorted(glob.glob("output/rgba_*.png"))
    for img_path in images:
        process_image(img_path)
