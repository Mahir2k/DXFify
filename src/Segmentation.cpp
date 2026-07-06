#include "dxfer/Segmentation.h"
#include "dxfer/Errors.h"
#include <opencv2/imgproc.hpp>
#include <algorithm>
#include <cmath>
#include <vector>

namespace dxfer {

namespace {

cv::Mat makeGradientMask(const cv::Mat& gray, double pxPerMm) {
    cv::Mat sx, sy, grad;
    cv::Sobel(gray, sx, CV_32F, 1, 0, 3);
    cv::Sobel(gray, sy, CV_32F, 0, 1, 3);
    cv::magnitude(sx, sy, grad);

    cv::Mat grad8u;
    cv::normalize(grad, grad8u, 0, 255, cv::NORM_MINMAX, CV_8U);

    int borderPx = static_cast<int>(std::round(18.0 * pxPerMm));
    if (borderPx > 0 && borderPx < grad8u.cols / 2 && borderPx < grad8u.rows / 2) {
        grad8u(cv::Rect(0, 0, grad8u.cols, borderPx)).setTo(0);
        grad8u(cv::Rect(0, grad8u.rows - borderPx, grad8u.cols, borderPx)).setTo(0);
        grad8u(cv::Rect(0, 0, borderPx, grad8u.rows)).setTo(0);
        grad8u(cv::Rect(grad8u.cols - borderPx, 0, borderPx, grad8u.rows)).setTo(0);
    }

    cv::Mat mask;
    cv::threshold(grad8u, mask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    return mask;
}

cv::Mat makeOtsuMask(const cv::Mat& gray) {
    cv::Mat mask;
    cv::threshold(gray, mask, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
    return mask;
}

cv::Mat makeSaturationMask(const cv::Mat& bgr) {
    cv::Mat hsv;
    cv::cvtColor(bgr, hsv, cv::COLOR_BGR2HSV);

    std::vector<cv::Mat> channels;
    cv::split(hsv, channels);

    cv::Mat mask;
    cv::threshold(channels[1], mask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    return mask;
}

cv::Mat makeAdaptiveMask(const cv::Mat& gray, double pxPerMm) {
    int blockSize = std::max(15, static_cast<int>(std::round(6.0 * pxPerMm)));
    if (blockSize % 2 == 0) blockSize++;

    cv::Mat mask;
    cv::adaptiveThreshold(gray, mask, 255, cv::ADAPTIVE_THRESH_GAUSSIAN_C,
                          cv::THRESH_BINARY_INV, blockSize, 5.0);
    return mask;
}

} // namespace

ContourSet segmentObject(const cv::Mat& img, double pxPerMm,
                         const SegmentationConfig& cfg) {
    if (img.empty()) throw SegmentationError("Empty image to segment.");

    // 1. Erase ArUco markers by painting over them with the background color
    cv::Scalar meanColor = cv::mean(img);
    cv::Mat tempImg = img.clone();
    for (const auto& r : cfg.ignoreRegions) {
        cv::rectangle(tempImg, r, meanColor, cv::FILLED);
    }

    // Erase the sheet boundary by painting a border around the image (first pass)
    int borderPx = static_cast<int>(std::round(15.0 * pxPerMm));
    if (borderPx > 0 && borderPx < tempImg.cols / 2 && borderPx < tempImg.rows / 2) {
        cv::rectangle(tempImg, cv::Point(0, 0), cv::Point(tempImg.cols, borderPx), meanColor, cv::FILLED);
        cv::rectangle(tempImg, cv::Point(0, tempImg.rows - borderPx), cv::Point(tempImg.cols, tempImg.rows), meanColor, cv::FILLED);
        cv::rectangle(tempImg, cv::Point(0, 0), cv::Point(borderPx, tempImg.rows), meanColor, cv::FILLED);
        cv::rectangle(tempImg, cv::Point(tempImg.cols - borderPx, 0), cv::Point(tempImg.cols, tempImg.rows), meanColor, cv::FILLED);
    }

    cv::Mat gray;
    cv::cvtColor(tempImg, gray, cv::COLOR_BGR2GRAY);

    // Apply Gaussian blur to smooth out texture and noise
    if (cfg.blurKernelPx > 0) {
        int ksize = cfg.blurKernelPx;
        if (ksize % 2 == 0) ksize++;
        cv::GaussianBlur(gray, gray, cv::Size(ksize, ksize), 0);
    }

    cv::Mat mask;
    switch (cfg.method) {
        case SegmentationConfig::Method::Otsu:
            mask = makeOtsuMask(gray);
            break;
        case SegmentationConfig::Method::Saturation:
            mask = makeSaturationMask(tempImg);
            break;
        case SegmentationConfig::Method::Adaptive:
            mask = makeAdaptiveMask(gray, pxPerMm);
            break;
        case SegmentationConfig::Method::Gradient:
            mask = makeGradientMask(gray, pxPerMm);
            break;
    }

    cv::Mat rawMask = mask.clone();
    
    // 3. Clean up the mask
    int k = std::max(3, static_cast<int>(std::round(cfg.morphCloseKernelMm * pxPerMm)));
    if (k % 2 == 0) k++;
    cv::Mat elem = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(k, k));
    cv::morphologyEx(mask, mask, cv::MORPH_CLOSE, elem, cv::Point(-1,-1), 2);
    cv::Mat cleanedMask = mask.clone();
    
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
    out.rawMask = rawMask;
    out.cleanedMask = cleanedMask;
    out.filledMask = filledMask.clone();
    for (size_t i = 0; i < finalContours.size(); i++) {
        if (finalHierarchy[i][3] == -1) {
            if (cv::contourArea(finalContours[i]) >= minAreaPx) {
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
    }
    
    if (out.outer.empty())
        throw SegmentationError("No object large enough after filtering.");

    std::sort(out.outer.begin(), out.outer.end(),
              [](const auto& a, const auto& b){ return cv::contourArea(a) > cv::contourArea(b); });

    return out;
}

} // namespace dxfer
