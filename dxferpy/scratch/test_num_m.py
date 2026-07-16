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

# Just copy the logic to see num_m
n = len(contour_f)
perimeter = cv2.arcLength(contour_f, True)
epsilon = min(2.5, max(0.5, 0.0008 * perimeter))
approx = cv2.approxPolyDP(contour_f, epsilon, True)
pts = [p[0] for p in approx]
print(f"Num approx vertices: {len(pts)}")
