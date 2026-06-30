#pragma once
#include "dxfer/Geometry.h"
#include <opencv2/core.hpp>
#include <vector>

namespace dxfer {

struct VectorizeConfig {
    double  simplifyEpsilonMm   = 0.15;  // Douglas-Peucker tolerance
    bool    fitArcs             = false; // emit ARC/bulge for circular segments
    double  arcFitToleranceMm   = 0.10;  // max residual to accept arc fit
    int     minArcPoints        = 6;     // minimum span to attempt arc fit
    bool    snapRightAngles      = false; // snap near-90° corners exactly
};

// Convert pixel-contour (in calibrated-image coordinates) to a metric polyline.
Polyline2d contourToPolyline(const std::vector<cv::Point>& contourPx,
                             double pixelsPerMm,
                             const VectorizeConfig& cfg);

} // namespace dxfer
