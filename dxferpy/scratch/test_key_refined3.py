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

n = len(contour)
perimeter = cv2.arcLength(contour, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour, epsilon, True)
print("Num approx vertices:", len(approx))

# Try vectorizing
height = 1000
scale = 10.0
vectorize_contour(contour, height, scale)
