#pragma once
#include <cstdint>
#include <vector>

namespace dxfer {

struct Point2d {
  double x{0}, y{0};
};

struct Polyline2d {
  std::vector<Point2d> points;
  std::vector<double> bulges;
  bool closed{true};
};

struct Arc2d {
  Point2d center;
  double radius{0};
  double startAngle{0};
  double endAngle{0};
  bool ccw{true};
};

struct Shape {
  std::vector<Polyline2d> outer;
  std::vector<Polyline2d> holes;
};

} // namespace dxfer
