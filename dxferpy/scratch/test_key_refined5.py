import sys
import os
sys.path.append(os.getcwd())
import cv2
import numpy as np

def fix_snapped_dirs(snapped_dir_idx, seg_lengths, num_v):
    # Pass 1: bridge short interruptions
    snapped = list(snapped_dir_idx)
    changed = True
    while changed:
        changed = False
        for j in range(num_v):
            if snapped[j] == -1 or seg_lengths[j] < 15.0:
                # look backwards for a strong dir
                prev_dir = -1
                for step in range(1, num_v // 2):
                    p = (j - step) % num_v
                    if snapped[p] != -1 and seg_lengths[p] >= 5.0:
                        prev_dir = snapped[p]
                        break
                # look forwards for a strong dir
                next_dir = -1
                for step in range(1, num_v // 2):
                    nxt = (j + step) % num_v
                    if snapped[nxt] != -1 and seg_lengths[nxt] >= 5.0:
                        next_dir = snapped[nxt]
                        break
                
                if prev_dir != -1 and prev_dir == next_dir:
                    # check if the total distance of the interruption is short
                    if snapped[j] != prev_dir:
                        snapped[j] = prev_dir
                        changed = True
    return snapped

# Let's test this logic with a dummy array
dirs = [0, -1, 0, 1, -1, -1, 1, 0, 1, 0]
lens = [50, 5, 50, 40, 5, 5, 40, 20, 2, 20]
print("Before:", dirs)
print("After:", fix_snapped_dirs(dirs, lens, len(dirs)))
