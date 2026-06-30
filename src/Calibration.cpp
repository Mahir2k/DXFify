#include "dxfer/Calibration.h"
#include "dxfer/Errors.h"
#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>
#include <opencv2/aruco.hpp>
#include <cmath>
#include <fstream>

namespace dxfer {

namespace {

// Build expected world (mm) positions of the four inner marker corners.
// We assume four markers placed at the corners of the sheet, each marker's
// CENTER is at a known position. ArUco gives us 4 image corners per marker.
std::vector<cv::Point2d> expectedMarkerCenters(const CalibrationConfig& c) {
    double x0 = c.markerInsetMm + c.markerSizeMm / 2.0;
    double x1 = c.sheetWidthMm  - c.markerInsetMm - c.markerSizeMm / 2.0;
    double y0 = c.markerInsetMm + c.markerSizeMm / 2.0;
    double y1 = c.sheetHeightMm - c.markerInsetMm - c.markerSizeMm / 2.0;
    // World frame: top-left of sheet = origin, +X right, +Y DOWN (image convention).
    return { {x0,y0}, {x1,y0}, {x1,y1}, {x0,y1} };
}

} // namespace

CalibrationResult calibrateImage(const cv::Mat& input,
                                 const CalibrationConfig& cfg) {
    if (input.empty())
        throw CalibrationError("Empty input image.");

    CalibrationResult result;

    // --- Optional lens undistortion --------------------------------------
    cv::Mat working = input;
    if (!cfg.intrinsicsPath.empty()) {
        cv::FileStorage fs(cfg.intrinsicsPath, cv::FileStorage::READ);
        if (fs.isOpened()) {
            cv::Mat K, dist;
            fs["camera_matrix"] >> K;
            fs["distortion_coefficients"] >> dist;
            if (!K.empty() && !dist.empty()) {
                cv::Mat tmp;
                cv::undistort(working, tmp, K, dist);
                working = tmp;
                result.undistorted = true;
            }
        }
    }

    // --- ArUco detection -------------------------------------------------
    cv::aruco::Dictionary dictionary =
        cv::aruco::getPredefinedDictionary(
            static_cast<cv::aruco::PredefinedDictionaryType>(cfg.arucoDictionaryId));
    cv::aruco::DetectorParameters dp;
    cv::aruco::ArucoDetector detector(dictionary, dp);

    std::vector<int> ids;
    std::vector<std::vector<cv::Point2f>> corners, rejected;
    detector.detectMarkers(working, corners, ids, rejected);

    result.detectedIds = ids;
    if (ids.size() < 4)
        throw CalibrationError("Fewer than 4 markers detected; cannot compute homography.");

    // --- Build correspondences -------------------------------------------
    // We expect marker IDs {0,1,2,3} arranged clockwise from top-left.
    // For each detected marker, average its 4 corners → image-space center.
    auto expected = expectedMarkerCenters(cfg);

    std::vector<cv::Point2f> imgPts, worldPts;
    for (size_t i = 0; i < ids.size(); ++i) {
        int id = ids[i];
        if (id < 0 || id > 3) continue;
        const auto& c = corners[i];
        cv::Point2f center(0,0);
        for (const auto& p : c) center += p;
        center *= 0.25f;
        imgPts.push_back(center);
        worldPts.push_back(cv::Point2f(
            static_cast<float>(expected[id].x),
            static_cast<float>(expected[id].y)));
    }
    if (imgPts.size() < 4)
        throw CalibrationError("Required marker IDs 0..3 not all present.");

    // --- Compute homography ----------------------------------------------
    result.homography = cv::findHomography(imgPts, worldPts, cv::RANSAC, 3.0);
    if (result.homography.empty())
        throw CalibrationError("Homography estimation failed.");

    // Reprojection error (sanity).
    double errSum = 0;
    for (size_t i = 0; i < imgPts.size(); ++i) {
        cv::Mat p = (cv::Mat_<double>(3,1) << imgPts[i].x, imgPts[i].y, 1.0);
        cv::Mat w = result.homography * p;
        double dx = w.at<double>(0)/w.at<double>(2) - worldPts[i].x;
        double dy = w.at<double>(1)/w.at<double>(2) - worldPts[i].y;
        errSum += std::hypot(dx, dy);
    }
    result.reprojectionErrorPx = errSum / imgPts.size();

    // --- Warp to top-down metric image -----------------------------------
    int outW = static_cast<int>(std::round(cfg.sheetWidthMm  * cfg.pixelsPerMmTarget));
    int outH = static_cast<int>(std::round(cfg.sheetHeightMm * cfg.pixelsPerMmTarget));

    // Build homography from IMAGE → OUTPUT-PIXELS (not mm). Scales world by pixelsPerMm.
    cv::Mat H = result.homography.clone();
    H.at<double>(0,2) *= cfg.pixelsPerMmTarget;
    H.at<double>(1,2) *= cfg.pixelsPerMmTarget;
    H.at<double>(0,0) *= cfg.pixelsPerMmTarget;  H.at<double>(0,1) *= cfg.pixelsPerMmTarget;
    H.at<double>(1,0) *= cfg.pixelsPerMmTarget;  H.at<double>(1,1) *= cfg.pixelsPerMmTarget;

    cv::warpPerspective(working, result.calibratedImage, H, cv::Size(outW, outH),
                        cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar(255,255,255));

    result.pixelsPerMm = cfg.pixelsPerMmTarget;
    return result;
}

} // namespace dxfer
