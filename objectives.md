# Project Objectives

## Goal

Convert a single calibrated photo of a flat object into a clean, metrically
scaled 2D DXF that can be imported into CAD, laser-cutting, CNC, or similar
manufacturing software at true 1:1 scale.

## Current Status

- [x] Detect ArUco calibration markers.
- [x] Correct perspective and scale into millimeters.
- [x] Segment object contours from the calibrated image.
- [x] Export closed contours and holes to DXF.
- [ ] Improve outline quality for noisy photos, shadows, and weak contrast.
- [ ] Remove geometric irregularities such as spikes, gaps, jagged edges, and
      accidental self-intersections.
- [ ] Reconstruct cleaner CAD geometry from imperfect scans.

## Immediate Fixes

1. Improve segmentation reliability.
   - Keep selectable methods: gradient, Otsu, saturation, and adaptive.
   - Use debug masks to compare raw, cleaned, and filled segmentation stages.
   - Tune morphology per input instead of relying on one hardcoded path.

2. Improve outline cleanup.
   - Remove small contour spikes.
   - Close tiny gaps before vectorization.
   - Preserve real holes while filtering dust and marker artifacts.
   - Detect and report suspicious contours before DXF export.

3. Improve CAD reconstruction.
   - Replace near-straight noisy spans with exact line segments.
   - Replace near-circular spans with arcs or circles.
   - Snap mechanical right angles only when the shape clearly supports it.
   - Avoid applying mechanical cleanup to organic/freeform shapes by default.

4. Improve validation.
   - Use known-size reference objects for measurement checks.
   - Compare exported bounding boxes against ground truth dimensions.
   - Save intermediate debug images for failed scans.

## Longer-Term Objectives

- Add mechanical feature detection for holes, slots, circles, rectangles, and
  repeated patterns.
- Add an optional review/edit step before final DXF export.
- Integrate with a fixed camera/stand workflow for repeatable capture.
- Produce manufacturing-ready DXFs with predictable layers, units, and clean
  geometry.

## Out of Scope for the Current Core

- Full 3D reconstruction.
- Thick or non-flat objects.
- General-purpose image editing that tools like Inkscape already handle well.
- Manual CAD editing features unless they directly improve scan-to-DXF cleanup.
