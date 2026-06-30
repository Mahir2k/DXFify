#include "dxfer/Segmentation.h"
#include "dxfer/Errors.h"
#include <opencv2/imgproc.hpp>
#include <algorithm>

namespace dxfer {

ContourSet segmentObject(const cv::Mat& img, double pxPerMm,
                         const SegmentationConfig& cfg) {
    if (img.empty()) throw SegmentationError("Empty image to segment.");

    // 1. Erase ArUco markers by painting over them with the background color
    cv::Scalar meanColor = cv::mean(img);
    cv::Mat tempImg = img.clone();
    for (const auto& r : cfg.ignoreRegions) {
        cv::rectangle(tempImg, r, meanColor, cv::FILLED);
    }

    cv::Mat gray;
    cv::cvtColor(tempImg, gray, cv::COLOR_BGR2GRAY);

    // 2. Gradient-based segmentation (Ignores shadows & handles white objects)
    cv::Mat sx, sy, grad;
    cv::Sobel(gray, sx, CV_32F, 1, 0, 3);
    cv::Sobel(gray, sy, CV_32F, 0, 1, 3);
    cv::magnitude(sx, sy, grad);
    
    cv::Mat grad8u;
    cv::normalize(grad, grad8u, 0, 255, cv::NORM_MINMAX, CV_8U);
    
    // Otsu on the gradient image finds the sharp height-discontinuity edges
    cv::Mat mask;
    cv::threshold(grad8u, mask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    
    // 3. Clean up the mask
    int k = std::max(3, static_cast<int>(std::round(cfg.morphCloseKernelMm * pxPerMm)));
    if (k % 2 == 0) k++;
    cv::Mat elem = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(k, k));
    cv::morphologyEx(mask, mask, cv::MORPH_CLOSE, elem, cv::Point(-1,-1), 2);
    
    // 4. Extract contours and fill solid regions to remove gradient noise inside objects
    std::vector<std::vector<cv::Point>> contours;
    std::vector<cv::Vec4i> hierarchy;
    cv::findContours(mask, contours, hierarchy, cv::RETR_CCOMP, cv::CHAIN_APPROX_SIMPLE);
    
    cv::Mat filledMask = cv::Mat::zeros(mask.size(), CV_8U);
    double minAreaPx = cfg.minObjectAreaMm * pxPerMm * pxPerMm;
    
    for (size_t i = 0; i < contours.size(); i++) {
        if (hierarchy[i][3] == -1) { // Outer contour
            if (cv::contourArea(contours[i]) >= minAreaPx) {
                cv::drawContours(filledMask, contours, i, 255, cv::FILLED);
            }
        } else { // Hole
            int parent = hierarchy[i][3];
            if (cv::contourArea(contours[parent]) >= minAreaPx) {
                cv::drawContours(filledMask, contours, i, 0, cv::FILLED); // Punch hole
            }
        }
    }
    
    // 5. Re-extract clean contours from the solid/filled mask
    std::vector<std::vector<cv::Point>> finalContours;
    std::vector<cv::Vec4i> finalHierarchy;
    cv::findContours(filledMask, finalContours, finalHierarchy, cv::RETR_CCOMP, cv::CHAIN_APPROX_SIMPLE);
    
    ContourSet out;
    for (size_t i = 0; i < finalContours.size(); i++) {
        if (finalHierarchy[i][3] == -1) {
            out.outer.push_back(finalContours[i]);
            if (!cfg.returnHoles) continue;
            int child = finalHierarchy[i][2];
            while (child != -1) {
                if (cv::contourArea(finalContours[child]) >= minAreaPx * 0.05) {
                    out.holes.push_back(finalContours[child]);
                }
                child = finalHierarchy[child][0];
            }
        }
    }
    
    if (out.outer.empty())
        throw SegmentationError("No object large enough after filtering.");

    std::sort(out.outer.begin(), out.outer.end(),
              [](const auto& a, const auto& b){ return cv::contourArea(a) > cv::contourArea(b); });

    return out;
}

} // namespace dxfer
