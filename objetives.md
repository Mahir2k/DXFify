# Goal of the project

scan an image to get a 2d object and export a dxf of its shape

## Current

[x] - Scanning
[] - get perfect outline (we only get an okay outline, gotta fix all the kinks)
[] - fix irregularities
[x] - dxf export

## Initial steps

get the shape with edge detection, fix any issues remaining, export

## Unsorted Raw Old Documentation (May be incorrect)

```md
# Orange Internship | Summer 2026

## Project

### Introduction

In the world of tinkers, one of many issues is the issue of 2D scanning to useful file formats(such as .dxf), the goal of this project is to create a solution that practically removes this issue.

### Description

The project is meant to be split into 2 parts(or 5 if we split those parts into more reasonably sized parts):

- The first part is the camera(similar to a scanner), the goal of the "camera" is to keep the surface of the object facing it perfectly parrallel to its lense and completely fixed in its position in their relative space, how that is meant to be done is yet to be seen, there are a few options, the camera is then meant to take a raster image(bitmap) of the targeted surface of the object under its lense.
- The second part is an Image Manipulation Program, this program is meant to take in the bitmap taken by the camera and vectorize it before letting the user manipulate the image to bring changes to it and fix or improve it. The program is finally meant to export the image in a AutoCAD DXF(.dxf) format. (I am nearly certain that InkScape is able to do this, will have to clarify with Project Manager and Internship Mentor)

| Feature                       | InkScape | Unnamed Image Manipulation Software |
| ----------------------------- | -------- | ----------------------------------- |
| raster → vectorized           | Yup      | Yup                                 |
| vectorized → dxf              | Yup      | Yup                                 |
| vectorized image manipulation | Yup      | Yup                                 |

As can be seen in this table, InkScape can actually, and has been able to, accomplish every feature needed by the Image Manipulation Program in the second part of this project.
Making this a specialized CAD-preparation tool would be much more meaningful, that would imply a few features:

- Automatic Detection of mechanical features:
  - Holes
  - Slots
  - Circles
  - Rectangles
  - Dimensions

- Converting hand-drawn or scanned shapes into exact CAD primitives:
  - imperfect circle → perfect circle
  - wobbly line → straight line
  - rough rectangle → exact rectangle

- Automatic scale calibration:
  - user places a ruler/reference object
  - software determines real-world Dimensions

- Compensation for camera distortion and perspective errors.

- Automatic contour extraction from photographed objects.

- Generating manufacturing-ready DXFs for CNC, laser cutting, or PCB milling.

- Tight integration with the custom camera:
  - capture image
  - calibrate
  - vectorize
  - clean geometry
  - export dxf
```

```md
# Orange Internship Project

## Hardware

- Rpi4
- Rpi Camera
- Stand

## Firmware

None really, gonnabe using rpi4

## Software

### Pre-Processing and DXF Conversion Software

ArUco lib to generate templates.
opencv and sub-libs:

- opencv aruco
- perspective correction(I think this is focus)
- scale correction(using aruco markers)
- canny or sobel for edge detection
- cleanup
- vectorization

ezdxf for dxf generation from vectorized image
fix lines and arcs
close gaps
remove intersections(lines that intersect iwht other lines and would cause the object to be divided into multiple)

### Feature Detection and Dxf Manipulation Software

Image Manipulation program, lets user delete and add dxf fetures(e.g. circles, lines, squares), takes in vectorized image or dxf and outputs dxf.
```

```md
# NEW IDEA

# STEP 1 - USE ARUCO MARKERS TO FIX DIMENSIONS AND SCALE

# STEP 2 - USE REMBG TO REMOVE BACKGROUND AND ONLY KEEP NEEDED OBJECT

# STEP 3 - PREPROCESS OBJECT TO REMOVE IRRELEVANT NOISE AND KEEP IT NEAT FOR CLEANER FINAL OUTPUT

# STEP 4 - ONLY GRAB THE OUTER EDGES OF THE OBJECT TO GET SHAPE

# STEP 5 - USE OUTER EDGE TO GET RELEVANT DETAILS INSIDE THE SHAPE

# STEP 6 - VECTORIZE FINAL SHAPE WITH DETAILS

# STEP 7 - CLASSIFY SECTIONS OF SHAPE, CORNERS, SLOPES, LINES, POLYLINES, RECTANGLES, CIRCLES ETC.

# STEP 8 - FIX THE CLASSIFIED SECTIONS TO HAVE PERFECT PROPORTIONS, LIKE A SLIGHTLY IMPERFECT CIRLCE BECOMES A PERFECT CIRCLE AND ANY OTHER ISSUES THAT COULD APPLY TO ALL CLASSES OF SECTIONS

# STEP 9 - OUTPUT FINAL CLEAN DXF
```
