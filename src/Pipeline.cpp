#include "dxfer/Pipeline.h"
#include "dxfer/Errors.h"
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <cmath>
#include <fstream>
#include <iomanip>

namespace dxfer {

namespace {

Polyline2d toCadFrame(const Polyline2d& imgFrame, double sheetHeightMm) {
    Polyline2d out = imgFrame;
    for (auto& p : out.points) p.y = sheetHeightMm - p.y;
    return out;
}

void writeReport(const std::string& path, const PipelineReport& r) {
    std::ofstream f(path);
    if (!f) return;
    f << std::fixed << std::setprecision(4);
    f << "{\n";
    f << "  \"success\": "            << (r.success ? "true" : "false") << ",\n";
    f << "  \"markersDetected\": "    << r.markersDetected << ",\n";
    f << "  \"pixelsPerMm\": "        << r.pixelsPerMm << ",\n";
    f << "  \"reprojectionErrorPx\": "<< r.reprojectionErrorPx << ",\n";
    f << "  \"outerContours\": "      << r.outerContours << ",\n";
    f << "  \"holeContours\": "       << r.holeContours << ",\n";
    f << "  \"bboxWidthMm\": "        << r.bboxWidthMm << ",\n";
    f << "  \"bboxHeightMm\": "       << r.bboxHeightMm << ",\n";
    f << "  \"perimeterMm\": "        << r.perimeterMm << "\n";
    f << "}\n";
}

} // namespace

PipelineReport runPipeline(const std::string& inputImage,
                           const std::string& outputDxf,
                           const PipelineConfig& cfg) {
    PipelineReport rep;

    cv::Mat img = cv::imread(inputImage, cv::IMREAD_COLOR);
    if (img.empty())
        throw CalibrationError("Could not read image: " + inputImage);

    // 1. Calibration + perspective correction
    CalibrationResult cal = calibrateImage(img, cfg.calib);
    rep.pixelsPerMm         = cal.pixelsPerMm;
    rep.markersDetected     = static_cast<int>(cal.detectedIds.size());
    rep.reprojectionErrorPx = cal.reprojectionErrorPx;

    // Compute ArUco marker bounding boxes in the calibrated image to ignore them
    std::vector<cv::Rect> ignoreRegions;
    double pxPerMm = cal.pixelsPerMm;
    double mSize = cfg.calib.markerSizeMm * pxPerMm;
    double inset = cfg.calib.markerInsetMm * pxPerMm;
    double sheetW_px = cfg.calib.sheetWidthMm * pxPerMm;
    double sheetH_px = cfg.calib.sheetHeightMm * pxPerMm;
    double pad = 5.0; // Slight padding to catch edges

    ignoreRegions.push_back(cv::Rect(inset - pad, inset - pad, mSize + 2*pad, mSize + 2*pad));
    ignoreRegions.push_back(cv::Rect(sheetW_px - inset - mSize - pad, inset - pad, mSize + 2*pad, mSize + 2*pad));
    ignoreRegions.push_back(cv::Rect(sheetW_px - inset - mSize - pad, sheetH_px - inset - mSize - pad, mSize + 2*pad, mSize + 2*pad));
    ignoreRegions.push_back(cv::Rect(inset - pad, sheetH_px - inset - mSize - pad, mSize + 2*pad, mSize + 2*pad));

    // 2. Segmentation (Passing the regions to ignore)
    SegmentationConfig segCfg = cfg.seg;
    segCfg.ignoreRegions = ignoreRegions;
    
    ContourSet cs = segmentObject(cal.calibratedImage, cal.pixelsPerMm, segCfg);
    rep.outerContours = static_cast<int>(cs.outer.size());
    rep.holeContours  = static_cast<int>(cs.holes.size());

    // 3. Vectorize
    Shape shape;
    for (const auto& c : cs.outer)
        shape.outer.push_back(toCadFrame(
            contourToPolyline(c, cal.pixelsPerMm, cfg.vec),
            cfg.calib.sheetHeightMm));
    for (const auto& c : cs.holes)
        shape.holes.push_back(toCadFrame(
            contourToPolyline(c, cal.pixelsPerMm, cfg.vec),
            cfg.calib.sheetHeightMm));

    // 4. Compute bbox & perimeter from outer-most (largest) contour.
    if (!shape.outer.empty()) {
        double minX=1e18,minY=1e18,maxX=-1e18,maxY=-1e18;
        double perim = 0;
        const auto& pl = shape.outer.front();
        for (size_t i = 0; i < pl.points.size(); ++i) {
            const auto& p = pl.points[i];
            minX = std::min(minX, p.x); minY = std::min(minY, p.y);
            maxX = std::max(maxX, p.x); maxY = std::max(maxY, p.y);
            const auto& q = pl.points[(i+1) % pl.points.size()];
            perim += std::hypot(q.x - p.x, q.y - p.y);
        }
        rep.bboxWidthMm  = maxX - minX;
        rep.bboxHeightMm = maxY - minY;
        rep.perimeterMm  = perim;
    }

    // 5. Write DXF
    DxfWriter writer(outputDxf);
    writer.write(shape);

    // 6. Debug overlay
    if (cfg.debugOverlay && !cfg.debugOutputPath.empty()) {
        cv::Mat dbg = cal.calibratedImage.clone();
        cv::drawContours(dbg, cs.outer, -1, cv::Scalar(0,255,0), 2);
        cv::drawContours(dbg, cs.holes, -1, cv::Scalar(0,0,255), 2);
        cv::imwrite(cfg.debugOutputPath, dbg);
    }

    // 7. JSON report
    if (!cfg.reportPath.empty()) {
        rep.success = true;
        writeReport(cfg.reportPath, rep);
    }
    rep.success = true;
    return rep;
}

} // namespace dxfer
