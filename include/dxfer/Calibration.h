#pragma once
#include <opencv2/core.hpp>
#include <vector>
#include <string>

namespace dxfer {

struct CalibrationConfig {
    double markerSizeMm       = 40.0;   // ArUco marker side length in mm
    double sheetWidthMm       = 210.0;  // A4 landscape
    double sheetHeightMm      = 297.0;
    double markerInsetMm      = 20.0;   // distance from sheet edge to marker
    int    arucoDictionaryId  = 0;      // DICT_4X4_50
    double pixelsPerMmTarget  = 4.0;    // output resolution of calibrated image
    std::string intrinsicsPath;         // optional camera intrinsics YAML
};

struct CalibrationResult {
    cv::Mat calibratedImage;            // top-down, metric
    cv::Mat homography;                 // image → world (mm)
    double  pixelsPerMm{1.0};
    cv::Point2d originPx;               // pixel location of world (0,0) in original
    bool    undistorted{false};
    std::vector<int> detectedIds;
    double  reprojectionErrorPx{0.0};
};

// Detects ArUco markers, builds image↔world correspondences, and warps
// to a metric top-down image.
CalibrationResult calibrateImage(const cv::Mat& input,
                                 const CalibrationConfig& cfg);

} // namespace dxfer
