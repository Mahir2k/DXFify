#pragma once
#include "dxfer/Geometry.h"
#include <fstream>
#include <string>

namespace dxfer {

class DxfWriter {
public:
  explicit DxfWriter(const std::string &path);
  ~DxfWriter();

  void writeHeader();
  void writeTables();
  void writeEntities(const Shape &shape);
  void writeEnd();

  void write(const Shape &shape);

private:
  std::ofstream out_;
  void writePair(int code, const std::string &value);
  void writePair(int code, double value);
  void writePair(int code, int value);
  void writeLWPolyline(const Polyline2d &pl, const char *layer);
  void writeArc(const Arc2d &a, const char *layer);
};

} // namespace dxfer
