import cv2
import numpy as np

img_path = 'output/rgba_phone_case.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
mask = img[:, :, 3]
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

orig_path = 'samples/phone_case.jpg'
from vectorize_smart_v8 import get_homography
H, scale = get_homography(orig_path)
height = int(297 * scale)

for i, contour in enumerate(contours):
    is_hole = hierarchy[0][i][3] != -1
    contour_f = np.array(contour, dtype=np.float32)
    if H is not None:
        contour_f = cv2.perspectiveTransform(contour_f, H)
    area = cv2.contourArea(contour_f)
    if is_hole and area < 500: continue
    if not is_hole and area < 100: continue
    
    perimeter = cv2.arcLength(contour_f, True)
    circ = 4 * np.pi * area / (perimeter * perimeter)
    print(f"Hole: {is_hole}, Area: {area:.1f}, Perim: {perimeter:.1f}, Circ: {circ:.3f}")
