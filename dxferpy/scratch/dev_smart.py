import cv2
import numpy as np
import ezdxf
import os
import glob

# ... (I'll copy vectorize_contour later)
def vectorize_contour(contour, height, scale=1.0):
    n = len(contour)
    perimeter = cv2.arcLength(contour, True)
    epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
    approx = cv2.approxPolyDP(contour, epsilon, True)
    
    num_v = len(approx)
    if num_v < 3:
        return None
        
    pts = [p[0] for p in approx]
    approx_idx = []
    
    ptr = 0
    for p in pts:
        best_i = ptr
        best_dist = 1e9
        for i in range(n):
            idx = (ptr + i) % n
            d = (contour[idx][0][0] - p[0])**2 + (contour[idx][0][1] - p[1])**2
            if d < best_dist:
                best_dist = d
                best_i = idx
            if d == 0:
                break
        approx_idx.append(best_i)
        ptr = best_i

    # ... remaining vectorize_contour logic
