#pragma once
#include <vector>
#include <cstdint>

namespace dxfer {

struct Point2d { double x{0}, y{0}; };

// A polyline in millimeters, with optional per-vertex bulge values.
// bulge[i] is the arc bulge from vertex i to vertex (i+1) % n.
// bulge = 0  -> straight segment.
// bulge > 0  -> CCW arc (in CAD Y-up coordinates).
// bulge = tan(theta/4) where theta is the included angle.
struct Polyline2d {
    std::vector<Point2d> points;
    std::vector<double>  bulges;   // size == points.size() if non-empty, else no arcs.
    bool                 closed{true};
};

struct Arc2d {
    Point2d center;
    double  radius{0};     // mm
    double  startAngle{0}; // radians, CAD frame (Y up)
    double  endAngle{0};   // radians
    bool    ccw{true};
};

// Shape is the vector representation handed to the DXF writer.
struct Shape {
    std::vector<Polyline2d> outer;   // outer contours (could be >1 for multi-object)
    std::vector<Polyline2d> holes;   // internal contours (cutouts)
};

} // namespace dxfer
