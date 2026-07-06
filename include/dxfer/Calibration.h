#pragma once
#include <opencv2/core.hpp>
#include <string>
#include <vector>

namespace dxfer {

struct CalibrationConfig {
  double markerSizeMm = 40.0;
  double sheetWidthMm = 210.0;
  double sheetHeightMm = 297.0;
  double markerInsetMm = 20.0;
  int arucoDictionaryId = 0;
  double pixelsPerMmTarget = 4.0;
  std::string intrinsicsPath;
};

struct CalibrationResult {
  cv::Mat calibratedImage;
  cv::Mat homography;
  double pixelsPerMm{1.0};
  cv::Point2d originPx;
  bool undistorted{false};
  std::vector<int> detectedIds;
  double reprojectionErrorPx{0.0};
};

CalibrationResult calibrateImage(const cv::Mat &input,
                                 const CalibrationConfig &cfg);

} // namespace dxfer
