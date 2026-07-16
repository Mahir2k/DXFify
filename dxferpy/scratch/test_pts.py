import cv2
import numpy as np

img_path = 'output/rgba_phone_case.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

orig_path = 'samples/phone_case.jpg'
from vectorize_smart_v8 import get_homography, vectorize_contour
H, scale = get_homography(orig_path)
height = int(297 * scale)

contour = max(contours, key=cv2.contourArea)
contour_f = np.array(contour, dtype=np.float32)
if H is not None:
    contour_f = cv2.perspectiveTransform(contour_f, H)
points = vectorize_contour(contour_f, height, scale)
print(f"Num points: {len(points)}")
