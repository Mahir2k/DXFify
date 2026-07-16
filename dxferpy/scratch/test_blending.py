import cv2
import numpy as np

def intersect_lines(x0_1, y0_1, vx_1, vy_1, x0_2, y0_2, vx_2, vy_2):
    det = vx_1 * vy_2 - vy_1 * vx_2
    if abs(det) < 1e-6:
        return (x0_1, y0_1)
    t = ((x0_2 - x0_1) * vy_2 - (y0_2 - y0_1) * vx_2) / det
    return (x0_1 + t * vx_1, y0_1 + t * vy_1)

def project_point(pt, x0, y0, vx, vy):
    dx = pt[0] - x0
    dy = pt[1] - y0
    t = dx * vx + dy * vy
    return (x0 + t * vx, y0 + t * vy)

# Just run a quick check of the math
start_pt = np.array([0.0, 0.0])
end_pt = np.array([10.0, 10.0])

raw_start = np.array([-1.0, 1.0])
raw_end = np.array([9.0, 11.0])

off_start = start_pt - raw_start
off_end = end_pt - raw_end

print(f"Off start: {off_start}, Off end: {off_end}")
for i in range(5):
    t = i / 4.0
    off = (1 - t) * off_start + t * off_end
    print(f"t={t}, off={off}")
