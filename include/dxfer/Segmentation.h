#pragma once
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <vector>

namespace dxfer {

struct SegmentationConfig {
  enum class Method {
    Otsu,
    Saturation,
    Adaptive,
    Gradient
  } method{Method::Gradient};
  double morphCloseKernelMm = 1.0;
  double minObjectAreaMm = 100.0;
  int blurKernelPx = 5;
  bool returnHoles = true;

  std::vector<cv::Rect> ignoreRegions;
};

struct ContourSet {
  std::vector<std::vector<cv::Point>> outer;
  std::vector<std::vector<cv::Point>> holes;
  cv::Mat rawMask;
  cv::Mat cleanedMask;
  cv::Mat filledMask;
};

ContourSet segmentObject(const cv::Mat &calibratedImage, double pixelsPerMm,
                         const SegmentationConfig &cfg);

} // namespace dxfer
