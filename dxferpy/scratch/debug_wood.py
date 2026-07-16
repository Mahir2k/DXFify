import cv2
import numpy as np

img = cv2.imread('output/rgba_wood_tilted.png', cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)
contour = contours[0]

n = len(contour)
perimeter = cv2.arcLength(contour, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour, epsilon, True)
num_v = len(approx)

seg_lengths = []
seg_angles = []
for j in range(num_v):
    j_next = (j + 1) % num_v
    dx = approx[j_next][0][0] - approx[j][0][0]
    dy = approx[j_next][0][1] - approx[j][0][1]
    length = np.hypot(dx, dy)
    angle = np.degrees(np.arctan2(dy, dx)) % 180.0
    seg_lengths.append(length)
    seg_angles.append(angle)

num_bins = 180
hist = np.zeros(num_bins)
for j in range(num_v):
    bin_idx = int(round(seg_angles[j])) % num_bins
    hist[bin_idx] += seg_lengths[j]
    
kernel = np.array([0.05, 0.25, 0.4, 0.25, 0.05])
hist_smooth = np.convolve(np.tile(hist, 3), kernel, mode='same')[num_bins:2*num_bins]

peak1 = np.argmax(hist_smooth)
print(f"Peak 1: {peak1}, height: {hist_smooth[peak1]}, total: {np.sum(seg_lengths)}, 10% = {0.1*np.sum(seg_lengths)}")

clear_peak = int(round(peak1))
for k in range(-15, 16):
    hist_smooth[(clear_peak + k) % num_bins] = 0

peak2 = np.argmax(hist_smooth)
print(f"Peak 2: {peak2}, height: {hist_smooth[peak2]}")

