import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
import math
from vectorize_smart import get_homography

img_path = 'output/rgba_phone_case.png'
orig_path = 'samples/phone_case.jpg'
H, scale = get_homography(orig_path, 210.0, 297.0)

img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

for i, contour in enumerate(contours):
    contour_f = np.array(contour, dtype=np.float32)
    contour_f = cv2.perspectiveTransform(contour_f, H)
    area = cv2.contourArea(contour_f)
    if area < 500: continue
    
    (cx, cy), radius = cv2.minEnclosingCircle(contour_f)
    if radius > 0:
        circle_area = np.pi * radius * radius
        area_ratio = area / circle_area
        print(f"Contour {i}: area={area:.1f}, radius={radius:.1f}, area_ratio={area_ratio:.4f}")

