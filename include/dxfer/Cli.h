#pragma once
#include "dxfer/Pipeline.h"
#include <string>

namespace dxfer {

struct CliArgs {
    std::string inputImage;
    std::string outputDxf;
    PipelineConfig cfg;
    bool showHelp{false};
};

CliArgs parseCli(int argc, char** argv);
void printHelp();

} // namespace dxfer
