import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
from vectorize_smart import vectorize_contour

img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contour = max(contours, key=cv2.contourArea)

print("Number of points in raw contour:", len(contour))
