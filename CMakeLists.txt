cmake_minimum_required(VERSION 3.16)
project(dxfer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs aruco calib3d)

add_executable(dxfer
    src/main.cpp
    src/DxfWriter.cpp
    src/Calibration.cpp
    src/Segmentation.cpp
    src/ContourVectorizer.cpp
    src/Pipeline.cpp
    src/Cli.cpp
)

target_include_directories(dxfer PRIVATE include)
target_link_libraries(dxfer PRIVATE ${OpenCV_LIBS})
target_compile_options(dxfer PRIVATE -Wall -Wextra -Wpedantic)
