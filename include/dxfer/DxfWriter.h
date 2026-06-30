#pragma once
#include "dxfer/Geometry.h"
#include <string>
#include <fstream>

namespace dxfer {

// Writes an ASCII DXF (R12/AC1009-compatible LWPOLYLINE/ARC entities
// also accepted by R2000+ viewers). All coordinates are in millimeters
// in a Y-up CAD frame.
class DxfWriter {
public:
    explicit DxfWriter(const std::string& path);
    ~DxfWriter();

    void writeHeader();
    void writeTables();
    void writeEntities(const Shape& shape);
    void writeEnd();

    // Stream-style alternative.
    void write(const Shape& shape);

private:
    std::ofstream out_;
    void writePair(int code, const std::string& value);
    void writePair(int code, double value);
    void writePair(int code, int value);
    void writeLWPolyline(const Polyline2d& pl, const char* layer);
    void writeArc(const Arc2d& a, const char* layer);
};

} // namespace dxfer
