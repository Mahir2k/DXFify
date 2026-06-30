#include "dxfer/Cli.h"
#include "dxfer/Pipeline.h"
#include "dxfer/Errors.h"
#include <iostream>
#include <cstdlib>

int main(int argc, char** argv) {
    try {
        dxfer::CliArgs args = dxfer::parseCli(argc, argv);
        if (args.showHelp) { dxfer::printHelp(); return 0; }

        auto rep = dxfer::runPipeline(args.inputImage, args.outputDxf, args.cfg);

        std::cout << "DXF written: " << args.outputDxf << "\n";
        std::cout << "  markers detected  : " << rep.markersDetected     << "\n";
        std::cout << "  pixels/mm         : " << rep.pixelsPerMm         << "\n";
        std::cout << "  reprojection err  : " << rep.reprojectionErrorPx << " px\n";
        std::cout << "  outer contours    : " << rep.outerContours       << "\n";
        std::cout << "  hole contours     : " << rep.holeContours        << "\n";
        std::cout << "  bbox (WxH mm)     : " << rep.bboxWidthMm
                  << " x " << rep.bboxHeightMm << "\n";
        std::cout << "  perimeter (mm)    : " << rep.perimeterMm         << "\n";
        return 0;
    }
    catch (const dxfer::DxferError& e) {
        std::cerr << "dxfer error: " << e.what() << "\n";
        return 1;
    }
    catch (const std::exception& e) {
        std::cerr << "unhandled exception: " << e.what() << "\n";
        return 2;
    }
}
