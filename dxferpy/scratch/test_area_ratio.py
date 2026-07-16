import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
import math

img_path = 'output/rgba_phone_case.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)

for i, contour in enumerate(contours):
    area = cv2.contourArea(contour)
    (cx, cy), radius = cv2.minEnclosingCircle(contour)
    if radius > 0:
        circle_area = np.pi * radius * radius
        area_ratio = area / circle_area
        print(f"Contour {i}: area={area:.1f}, area_ratio={area_ratio:.4f}")

