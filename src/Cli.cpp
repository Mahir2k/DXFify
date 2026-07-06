#include "dxfer/Cli.h"
#include "dxfer/Errors.h"
#include <iostream>
#include <cstdlib>

namespace dxfer {

void printHelp() {
    std::cout <<
R"HELP(dxfer — Photo → DXF dimensional reconstruction

Usage:
  dxfer --input <image.jpg> --output <out.dxf> [options]

Required:
  --input <path>        Input photograph (JPEG/PNG).
  --output <path>       Output DXF file path.

Calibration options:
  --marker-size-mm <mm>       ArUco marker side length (default 40)
  --sheet-width-mm <mm>       Calibration sheet width  (default 210, A4)
  --sheet-height-mm <mm>      Calibration sheet height (default 297, A4)
  --marker-inset-mm <mm>      Distance from sheet edge (default 20)
  --aruco-dict <id>           ArUco dictionary id      (default 0 = DICT_4X4_50)
  --pixels-per-mm <ppm>       Output calibrated resolution (default 4.0)
  --intrinsics <path.yaml>    Camera intrinsics (optional, for undistortion)

Segmentation options:
  --seg-method <gradient|otsu|sat|adaptive>
                                      Segmentation method (default gradient)
  --min-object-mm2 <area>           Min object area in mm² (default 100)

Vectorization options:
  --simplify-mm <eps>        Douglas-Peucker epsilon (default 0.15)
  --fit-arcs                 Enable arc fitting (LWPOLYLINE bulges)
  --arc-tol-mm <t>           Arc fit tolerance (default 0.10)
  --snap-right-angles        Snap near-90° corners to exact 90°

Output / debug:
  --debug <path>             Write overlay plus raw/cleaned/filled masks
  --report <path>            Write JSON validation report
  --help                     Show this help

Example:
  dxfer -i part.jpg -o part.dxf \
        --marker-size-mm 40 --sheet-width-mm 210 --sheet-height-mm 297 \
        --fit-arcs --snap-right-angles --report part.report.json --debug part.dbg.png
)HELP";
}

CliArgs parseCli(int argc, char** argv) {
    CliArgs a;
    auto need = [&](int& i, const std::string& flag) -> std::string {
        if (i + 1 >= argc) throw CliError(std::string("Missing value for ") + flag);
        return std::string(argv[++i]);
    };
    for (int i = 1; i < argc; ++i) {
        std::string s(argv[i]);
        if (s == "--help" || s == "-h") { a.showHelp = true; return a; }
        else if (s == "--input"  || s == "-i") a.inputImage = need(i, "--input");
        else if (s == "--output" || s == "-o") a.outputDxf  = need(i, "--output");
        else if (s == "--marker-size-mm")  a.cfg.calib.markerSizeMm     = std::stod(need(i,s));
        else if (s == "--sheet-width-mm")  a.cfg.calib.sheetWidthMm     = std::stod(need(i,s));
        else if (s == "--sheet-height-mm") a.cfg.calib.sheetHeightMm    = std::stod(need(i,s));
        else if (s == "--marker-inset-mm") a.cfg.calib.markerInsetMm    = std::stod(need(i,s));
        else if (s == "--aruco-dict")      a.cfg.calib.arucoDictionaryId= std::stoi(need(i,s));
        else if (s == "--pixels-per-mm")   a.cfg.calib.pixelsPerMmTarget= std::stod(need(i,s));
        else if (s == "--intrinsics")      a.cfg.calib.intrinsicsPath   = need(i,s);
        else if (s == "--seg-method") {
            std::string m = need(i, "--seg-method");
            if (m == "gradient")  a.cfg.seg.method = SegmentationConfig::Method::Gradient;
            else if (m == "otsu") a.cfg.seg.method = SegmentationConfig::Method::Otsu;
            else if (m == "sat")  a.cfg.seg.method = SegmentationConfig::Method::Saturation;
            else if (m == "adaptive") a.cfg.seg.method = SegmentationConfig::Method::Adaptive;
            else throw CliError("Unknown --seg-method: " + m);
        }
        else if (s == "--min-object-mm2")  a.cfg.seg.minObjectAreaMm   = std::stod(need(i,s));
        else if (s == "--morph-close-mm")  a.cfg.seg.morphCloseKernelMm = std::stod(need(i,s));
        else if (s == "--simplify-mm")     a.cfg.vec.simplifyEpsilonMm = std::stod(need(i,s));
        else if (s == "--fit-arcs")        a.cfg.vec.fitArcs = true;
        else if (s == "--arc-tol-mm")      a.cfg.vec.arcFitToleranceMm = std::stod(need(i,s));
        else if (s == "--snap-right-angles") a.cfg.vec.snapRightAngles = true;
        else if (s == "--debug") { a.cfg.debugOverlay = true; a.cfg.debugOutputPath = need(i,s); }
        else if (s == "--report")          a.cfg.reportPath = need(i,s);
        else throw CliError("Unknown argument: " + s);
    }
    if (a.inputImage.empty() || a.outputDxf.empty())
        throw CliError("Both --input and --output are required.");
    return a;
}

} // namespace dxfer
