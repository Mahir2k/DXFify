import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np

def smooth_curve(pts, window_size=7, iterations=3):
    if len(pts) < window_size:
        return pts
    pts = np.array(pts, dtype=np.float32)
    for _ in range(iterations):
        padded = np.pad(pts, ((window_size//2, window_size//2), (0, 0)), mode='edge')
        smoothed = np.zeros_like(pts)
        for i in range(len(pts)):
            smoothed[i] = np.mean(padded[i:i+window_size], axis=0)
        # keep endpoints fixed
        smoothed[0] = pts[0]
        smoothed[-1] = pts[-1]
        pts = smoothed
    return pts

# let's generate a staircase line
staircase = []
for i in range(100):
    staircase.append((float(i), float(i//5 * 5)))

smoothed = smooth_curve(staircase)

import matplotlib.pyplot as plt
sx, sy = zip(*staircase)
smx, smy = zip(*smoothed)
plt.plot(sx, sy, label='Staircase')
plt.plot(smx, smy, label='Smoothed')
plt.legend()
plt.savefig('scratch/test_smooth.png')
