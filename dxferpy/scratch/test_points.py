import cv2
import numpy as np

img_path = 'output/rgba_phone_case.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
contour = max(contours, key=cv2.contourArea)

orig_path = 'samples/phone_case.jpg'
from vectorize_smart_v8 import get_homography, vectorize_contour
H, scale = get_homography(orig_path)
contour_f = cv2.perspectiveTransform(np.array(contour, dtype=np.float32), H)
height = int(297 * scale)

points = vectorize_contour(contour_f, height, scale)
# Let's see the distance between consecutive points!
pts_array = np.array(points)
dists = np.hypot(np.diff(pts_array[:, 0]), np.diff(pts_array[:, 1]))
print(f"Num points: {len(points)}")
print(f"Max distance: {np.max(dists):.2f}, Min: {np.min(dists):.2f}")
print(f"Num large jumps (>1mm): {np.sum(dists > 1.0)}")
