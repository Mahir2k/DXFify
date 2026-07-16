import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
import math

img_path = 'output/rgba_phone_case.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)

for i, contour in enumerate(contours):
    area = cv2.contourArea(contour)
    perimeter = cv2.arcLength(contour, True)
    if perimeter == 0: continue
    circularity = 4 * math.pi * (area / (perimeter * perimeter))
    print(f"Contour {i}: pts={len(contour)}, area={area:.1f}, perimeter={perimeter:.1f}, circularity={circularity:.4f}")

