import cv2
import numpy as np

img = np.zeros((2000, 1000, 3), dtype=np.uint8)

pts = "295.0,288.0 281.0,304.0 272.0,344.0 262.0,624.0 263.0,759.0 255.0,841.0 237.0,1330.0 240.0,1381.0 258.0,1406.0 273.0,1414.0 292.0,1417.0 695.0,1433.0 737.0,1430.0 755.0,1420.0 768.0,1405.0 775.0,1387.0 778.0,1360.0 796.0,721.0 810.0,345.0 805.0,326.0 798.0,314.0 781.0,299.0 750.0,291.0 320.0,279.0"
pts = pts.split()
green_pts = []
for p in pts:
    x, y = p.split(',')
    green_pts.append([int(float(x)), int(float(y))])
cv2.polylines(img, [np.array(green_pts)], True, (0, 255, 0), 5)

pts = "295.0,288.0 281.0,304.0 255.26530456542966,344.0 255.26530456542972,1381.0 258.0,1406.0 273.0,1424.8800048828125 737.0,1424.8800048828125 755.0,1420.0 768.0,1405.0 792.5,1387.0 792.5,345.0 805.0,326.0 798.0,314.0 781.0,299.0 750.0,284.3999938964844 320.0,284.3999938964844"
pts = pts.split()
red_pts = []
for p in pts:
    x, y = p.split(',')
    red_pts.append([int(float(x)), int(float(y))])
cv2.polylines(img, [np.array(red_pts)], True, (0, 0, 255), 2)

cv2.imwrite("/home/aledawizard/.gemini/antigravity/brain/13e2c01f-bc24-44bb-9f2a-47de4ccf7434/debug.png", img)
