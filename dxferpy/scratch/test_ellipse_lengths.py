import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np

img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)
contour = contours[1]

n = len(contour)
perimeter = cv2.arcLength(contour, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour, epsilon, True)
num_v = len(approx)
pts = [p[0] for p in approx]

print(f"Ellipse contour points: {n}, approx points: {num_v}, epsilon: {epsilon}")

for j in range(num_v):
    j_next = (j + 1) % num_v
    length = np.hypot(pts[j_next][0] - pts[j][0], pts[j_next][1] - pts[j][1])
    
    # get angle
    dx = pts[j_next][0] - pts[j][0]
    dy = pts[j_next][1] - pts[j][1]
    angle = np.degrees(np.arctan2(dy, dx)) % 180.0
    print(f"Segment {j}: length={length:.2f}, angle={angle:.2f}")

