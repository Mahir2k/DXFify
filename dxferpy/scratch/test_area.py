import cv2
import numpy as np

theta = np.linspace(0, 2*np.pi, 100)
x = 100 + 50 * np.cos(theta)
y = 100 + 50 * np.sin(theta)
contour = np.stack([x, y], axis=1).reshape(-1, 1, 2).astype(np.float32)

area = cv2.contourArea(contour)
perim = cv2.arcLength(contour, True)
print(f"Area: {area}, Perim: {perim}")
