#include "dxfer/DxfWriter.h"
#include "dxfer/Errors.h"
#include <cmath>
#include <fstream>
#include <iomanip>

namespace dxfer {

DxfWriter::DxfWriter(const std::string& path) : out_(path) {
    if (!out_.is_open())
        throw DxfWriteError("Cannot open DXF output: " + path);
    out_ << std::fixed << std::setprecision(6);
}

DxfWriter::~DxfWriter() { if (out_.is_open()) out_.close(); }

void DxfWriter::writePair(int code, const std::string& v) { out_ << code << "\n" << v << "\n"; }
void DxfWriter::writePair(int code, double v)             { out_ << code << "\n" << v << "\n"; }
void DxfWriter::writePair(int code, int v)                { out_ << code << "\n" << v << "\n"; }

void DxfWriter::writeHeader() {
    writePair(0, "SECTION");
    writePair(2, "HEADER");
    writePair(9,  "$ACADVER");   writePair(1, "AC1014");          // R14 compatible
    writePair(9,  "$INSUNITS");  writePair(70, 4);                // 4 = millimeters
    writePair(9,  "$HANDSEED");  writePair(5, "FFFF");
    writePair(0, "ENDSEC");
}

void DxfWriter::writeTables() {
    writePair(0, "SECTION");
    writePair(2, "TABLES");

    // LTYPE table — defines CONTINUOUS (required even for LWPOLYLINEs).
    writePair(0, "TABLE");   writePair(2, "LTYPE");
    writePair(70, 1);
    writePair(0, "LTYPE");   writePair(2, "CONTINUOUS");
    writePair(70, 0);
    writePair(3, "Solid line");
    writePair(72, 65);
    writePair(73, 0);
    writePair(40, 0.0);
    writePair(0, "ENDTAB");

    // LAYER table — layer 0 and layers for OUTER/HOLES.
    writePair(0, "TABLE");   writePair(2, "LAYER");
    writePair(70, 3);
    writePair(0, "LAYER");   writePair(2, "0");
    writePair(70, 0);        writePair(62, 7);   writePair(6, "CONTINUOUS");
    writePair(0, "LAYER");   writePair(2, "OUTER");
    writePair(70, 0);        writePair(62, 3);   writePair(6, "CONTINUOUS");
    writePair(0, "LAYER");   writePair(2, "HOLES");
    writePair(70, 0);        writePair(62, 1);   writePair(6, "CONTINUOUS");
    writePair(0, "ENDTAB");

    writePair(0, "ENDSEC");
}

void DxfWriter::writeLWPolyline(const Polyline2d& pl, const char* layer) {
    if (pl.points.empty()) return;
    writePair(0, "LWPOLYLINE");
    writePair(8, layer);
    writePair(90, static_cast<int>(pl.points.size()));
    writePair(70, (pl.closed ? 1 : 0) | (pl.bulges.empty() ? 0 : 1));
    for (size_t i = 0; i < pl.points.size(); ++i) {
        writePair(10, pl.points[i].x);
        writePair(20, pl.points[i].y);
        if (!pl.bulges.empty())
            writePair(42, pl.bulges[i]);
    }
}

void DxfWriter::writeArc(const Arc2d& a, const char* layer) {
    writePair(0, "ARC");
    writePair(8, layer);
    writePair(10, a.center.x);
    writePair(20, a.center.y);
    writePair(30, 0.0);
    writePair(40, a.radius);
    double s = a.startAngle * 180.0 / M_PI;
    double e = a.endAngle   * 180.0 / M_PI;
    if (!a.ccw) std::swap(s, e);
    writePair(50, s);
    writePair(51, e);
}

void DxfWriter::writeEntities(const Shape& shape) {
    writePair(0, "SECTION");
    writePair(2, "ENTITIES");
    for (const auto& p : shape.outer) writeLWPolyline(p, "OUTER");
    for (const auto& p : shape.holes) writeLWPolyline(p, "HOLES");
    writePair(0, "ENDSEC");
}

void DxfWriter::writeEnd() { writePair(0, "EOF"); }

void DxfWriter::write(const Shape& shape) {
    writeHeader();
    writeTables();
    writeEntities(shape);
    writeEnd();
    out_.flush();
}

} // namespace dxfer
