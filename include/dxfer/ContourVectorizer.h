#pragma once
#include "dxfer/Geometry.h"
#include <opencv2/core.hpp>
#include <vector>

namespace dxfer {

struct VectorizeConfig {
  double simplifyEpsilonMm = 0.15;
  bool fitArcs = false;
  double arcFitToleranceMm = 0.10;
  int minArcPoints = 6;
  bool snapRightAngles = false;
};

Polyline2d contourToPolyline(const std::vector<cv::Point> &contourPx,
                             double pixelsPerMm, const VectorizeConfig &cfg);

} // namespace dxfer
