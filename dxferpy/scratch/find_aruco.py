import cv2
import numpy as np

img = cv2.imread('samples/phone_case.jpg')
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
parameters = cv2.aruco.DetectorParameters()
detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)

corners, ids, rejected = detector.detectMarkers(gray)

if ids is not None:
    for i in range(len(ids)):
        print(f"Marker {ids[i]}: {corners[i][0]}")
else:
    print("No markers found.")
