#include "dxfer/ContourVectorizer.h"
#include "dxfer/Errors.h"
#include <opencv2/imgproc.hpp>
#include <cmath>
#include <algorithm>

namespace dxfer {

namespace {

// Fits mathematical lines to two point sets and returns their exact intersection
cv::Point2d fitLineAndIntersect(const std::vector<cv::Point>& pts1, const std::vector<cv::Point>& pts2) {
    if (pts1.size() < 2 || pts2.size() < 2) {
        if (!pts1.empty() && !pts2.empty())
            return cv::Point2d((pts1.back().x + pts2.front().x)/2.0, (pts1.back().y + pts2.front().y)/2.0);
        return cv::Point2d(0,0);
    }
    cv::Vec4f line1, line2;
    cv::fitLine(pts1, line1, cv::DIST_L2, 0, 0.01, 0.01);
    cv::fitLine(pts2, line2, cv::DIST_L2, 0, 0.01, 0.01);

    double vx1 = line1[0], vy1 = line1[1], x1 = line1[2], y1 = line1[3];
    double vx2 = line2[0], vy2 = line2[1], x2 = line2[2], y2 = line2[3];

    // Solve for intersection: x1 + t1*vx1 = x2 + t2*vx2  and  y1 + t1*vy1 = y2 + t2*vy2
    cv::Mat A = (cv::Mat_<double>(2,2) << vx1, -vx2, vy1, -vy2);
    cv::Mat B = (cv::Mat_<double>(2,1) << x2 - x1, y2 - y1);
    cv::Mat T;
    if (!cv::solve(A, B, T)) {
        // Parallel lines, fallback to midpoint
        return cv::Point2d((pts1.back().x + pts2.front().x)/2.0, (pts1.back().y + pts2.front().y)/2.0);
    }
    double t1 = T.at<double>(0);
    return cv::Point2d(x1 + vx1 * t1, y1 + vy1 * t1);
}

} // namespace

Polyline2d contourToPolyline(const std::vector<cv::Point>& contourPx,
                             double pxPerMm,
                             const VectorizeConfig& cfg) {
    if (contourPx.empty()) throw VectorizeError("Empty contour.");

    // Light initial simplification to find corner regions
    double epsPx = cfg.simplifyEpsilonMm * pxPerMm;
    std::vector<cv::Point> approx;
    cv::approxPolyDP(contourPx, approx, epsPx, true);
    if (approx.size() < 3) throw VectorizeError("Contour collapsed under simplification.");

    // Map simplified corners back to original contour indices to extract precise point segments
    std::vector<int> approxIdx(approx.size());
    for (size_t i = 0; i < approx.size(); ++i) {
        int best = 0; long bestD = LONG_MAX;
        for (int j = 0; j < (int)contourPx.size(); ++j) {
            long d = (long)(contourPx[j].x - approx[i].x)*(contourPx[j].x - approx[i].x)
                   + (long)(contourPx[j].y - approx[i].y)*(contourPx[j].y - approx[i].y);
            if (d < bestD) { bestD = d; best = j; }
        }
        approxIdx[i] = best;
    }

    Polyline2d pl;
    pl.closed = true;
    pl.points.reserve(approx.size());
    int n = contourPx.size();

    // Reconstruct every corner by intersecting fitted lines of its adjacent segments
    for (size_t i = 0; i < approx.size(); ++i) {
        int idx_curr = approxIdx[i];
        int idx_prev = approxIdx[(i + approx.size() - 1) % approx.size()];
        int idx_next = approxIdx[(i + 1) % approx.size()];

        std::vector<cv::Point> pts_prev, pts_next;
        
        // Extract points for previous segment
        int p_start = idx_prev, p_end = idx_curr;
        if (p_start > p_end) p_end += n;
        for (int k = p_start; k <= p_end; ++k) pts_prev.push_back(contourPx[k % n]);

        // Extract points for next segment
        int n_start = idx_curr, n_end = idx_next;
        if (n_start > n_end) n_end += n;
        for (int k = n_start; k <= n_end; ++k) pts_next.push_back(contourPx[k % n]);

        cv::Point2d refined = fitLineAndIntersect(pts_prev, pts_next);
        pl.points.push_back({ refined.x / pxPerMm, refined.y / pxPerMm });
    }

    // Optional right-angle snapping
    if (cfg.snapRightAngles) {
        for (size_t i = 0; i < pl.points.size(); ++i) {
            auto& a = pl.points[(i + pl.points.size() - 1) % pl.points.size()];
            auto& b = pl.points[i];
            auto& c = pl.points[(i + 1) % pl.points.size()];
            double v1x = b.x - a.x, v1y = b.y - a.y;
            double v2x = c.x - b.x, v2y = c.y - b.y;
            double l1 = std::hypot(v1x,v1y), l2 = std::hypot(v2x,v2y);
            if (l1 < 1e-9 || l2 < 1e-9) continue;
            double cosAng = (v1x*v2x + v1y*v2y) / (l1*l2);
            double ang = std::acos(std::clamp(cosAng, -1.0, 1.0)) * 180.0 / M_PI;
            if (std::abs(ang - 90.0) < 5.0) {
                double nx = -v1y / l1, ny = v1x / l1;
                double t = (c.x - b.x) * nx + (c.y - b.y) * ny;
                c.x = b.x + nx * t;
                c.y = b.y + ny * t;
            }
        }
    }

    return pl;
}

} // namespace dxfer
