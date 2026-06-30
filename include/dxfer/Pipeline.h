#pragma once
#include "dxfer/Geometry.h"
#include "dxfer/Calibration.h"
#include "dxfer/Segmentation.h"
#include "dxfer/ContourVectorizer.h"
#include "dxfer/DxfWriter.h"
#include <string>

namespace dxfer {

struct PipelineConfig {
    CalibrationConfig  calib;
    SegmentationConfig seg;
    VectorizeConfig    vec;
    bool               debugOverlay{false};
    std::string        debugOutputPath;  // if non-empty, write annotated image
    std::string        reportPath;       // optional JSON validation report
};

struct PipelineReport {
    double  pixelsPerMm{0};
    int     markersDetected{0};
    int     outerContours{0};
    int     holeContours{0};
    double  bboxWidthMm{0};
    double  bboxHeightMm{0};
    double  perimeterMm{0};
    double  reprojectionErrorPx{0};
    bool    success{false};
};

PipelineReport runPipeline(const std::string& inputImage,
                           const std::string& outputDxf,
                           const PipelineConfig& cfg);

} // namespace dxfer
