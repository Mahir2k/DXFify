import cv2
import numpy as np

# Create a circle contour
theta = np.linspace(0, 2*np.pi, 100)
x = 100 + 50 * np.cos(theta)
y = 100 + 50 * np.sin(theta)
contour = np.stack([x, y], axis=1).reshape(-1, 1, 2).astype(np.float32)

# Create a dummy H
H = np.array([
    [1.5, 0.1, 10],
    [0.1, 1.5, 20],
    [0, 0, 1]
], dtype=np.float32)

warped = cv2.perspectiveTransform(contour, H)
print("Warped shape:", warped.shape)
print("Warped dtype:", warped.dtype)

# Test approxPolyDP
approx = cv2.approxPolyDP(warped, 1.0, True)
print("Approx shape:", approx.shape)

