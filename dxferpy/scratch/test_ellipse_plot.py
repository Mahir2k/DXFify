import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np
import matplotlib.pyplot as plt
from vectorize_smart import vectorize_contour, smooth_curve

img_path = 'output/rgba_key.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contours = sorted(contours, key=cv2.contourArea, reverse=True)
contour = contours[1]

raw_pts = [c[0] for c in contour]
smoothed_pts = smooth_curve(raw_pts, window_size=15, iterations=5, closed=True)

sx, sy = zip(*smoothed_pts)
rx, ry = zip(*raw_pts)

plt.plot(rx, ry, label='Raw', marker='.')
plt.plot(sx, sy, label='Smoothed')
plt.legend()
plt.gca().invert_yaxis()
plt.axis('equal')
plt.savefig('scratch/test_ellipse_plot.png')
