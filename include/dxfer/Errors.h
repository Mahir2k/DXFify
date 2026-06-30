#pragma once
#include <stdexcept>
#include <string>

namespace dxfer {

class DxferError : public std::runtime_error {
public:
    explicit DxferError(const std::string& msg) : std::runtime_error(msg) {}
};

class CalibrationError   : public DxferError { public: using DxferError::DxferError; };
class SegmentationError  : public DxferError { public: using DxferError::DxferError; };
class VectorizeError     : public DxferError { public: using DxferError::DxferError; };
class DxfWriteError      : public DxferError { public: using DxferError::DxferError; };
class CliError           : public DxferError { public: using DxferError::DxferError; };

} // namespace dxfer
