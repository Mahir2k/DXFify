import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np

img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

# Find the ellipse contour (the smaller one)
contours = sorted(contours, key=cv2.contourArea, reverse=True)
contour = contours[1]

n = len(contour)
perimeter = cv2.arcLength(contour, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour, epsilon, True)
num_v = len(approx)
print(f"Ellipse contour points: {n}, approx points: {num_v}, epsilon: {epsilon}")
