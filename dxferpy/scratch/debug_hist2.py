import numpy as np

pts = []
angles = [132.6, 102.9, 92.0, 89.5, 94.9, 92.1, 87.1, 58.7, 27.6, 8.1, 2.1, 176.3, 151.3, 130.8, 110.6, 95.4, 91.6, 92.2, 75.5, 59.2, 41.4, 14.0, 1.8, 159.7]
lengths = [21.3, 41.0, 280.2, 135.0, 82.4, 489.3, 51.1, 30.8, 17.0, 19.2, 403.3, 42.1, 20.6, 19.8, 19.3, 27.2, 639.3, 376.3, 19.6, 13.9, 22.7, 32.0, 430.2, 26.6]

num_bins = 180
hist = np.zeros(num_bins)
for j in range(len(angles)):
    bin_idx = int(round(angles[j])) % num_bins
    hist[bin_idx] += lengths[j]
    
kernel = np.array([0.05, 0.25, 0.4, 0.25, 0.05])
hist_smooth = np.convolve(np.tile(hist, 3), kernel, mode='same')[num_bins:2*num_bins]

peak = np.argmax(hist_smooth)
print(f"Peak is {peak}")
for i in range(85, 98):
    print(f"Bin {i}: raw={hist[i]:.1f}, smooth={hist_smooth[i]:.1f}")
