"""Self-contained Flask web & API server for the DXFify Standalone Desktop Application with realtime terminal logging."""

import json
import logging
import os
import sys
import time
import uuid
from typing import Any, Dict

from flask import Flask, Response, jsonify, request, send_from_directory

# Configure unbuffered stdout logging for real-time terminal diagnostics
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s desktop-server] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("desktop_server")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = REPO_ROOT

DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
WEB_DIST_DIR = os.path.join(BASE_DIR, "web", "dist")

if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

JOBS_DIR = os.path.join(os.path.expanduser("~"), ".dxfify_jobs")
os.makedirs(JOBS_DIR, exist_ok=True)


def _get_downloads_dir() -> str:
    """Return the platform-native Downloads folder path.

    Windows: Uses KNOWNFOLDERID via ctypes (locale-safe).
    macOS:   ~/Downloads (standard on all macOS locales).
    Linux:   Reads XDG user-dirs, falls back to ~/Downloads.
    """
    import platform as _platform
    system = _platform.system()

    if system == "Windows":
        try:
            import ctypes
            from ctypes import wintypes
            GUID = ctypes.c_char * 16
            _SHGetKnownFolderPath = ctypes.windll.shell32.SHGetKnownFolderPath
            _CoTaskMemFree = ctypes.windll.ole32.CoTaskMemFree
            # {374DE290-123F-4565-9164-39C4925E467B} = Downloads
            downloads_guid = GUID(
                b'\x90\xe2\x4d\x37\x3f\x12\x65\x45\x91\x64\x39\xc4\x92\x5e\x46\x7b'
            )
            path_ptr = ctypes.c_wchar_p()
            _SHGetKnownFolderPath(
                ctypes.byref(downloads_guid), 0, None, ctypes.byref(path_ptr)
            )
            result = path_ptr.value
            _CoTaskMemFree(path_ptr)
            if result:
                return result
        except Exception:
            pass
        # Fallback for Windows
        return os.path.join(os.path.expanduser("~"), "Downloads")

    elif system == "Darwin":
        return os.path.join(os.path.expanduser("~"), "Downloads")

    else:  # Linux / other POSIX
        try:
            xdg_config = os.path.join(
                os.environ.get("XDG_CONFIG_HOME", os.path.join(os.path.expanduser("~"), ".config")),
                "user-dirs.dirs",
            )
            if os.path.isfile(xdg_config):
                with open(xdg_config, "r") as f:
                    for line in f:
                        if line.startswith("XDG_DOWNLOAD_DIR"):
                            path = line.split("=", 1)[1].strip().strip('"')
                            path = path.replace("$HOME", os.path.expanduser("~"))
                            if os.path.isdir(path):
                                return path
        except Exception:
            pass
        return os.path.join(os.path.expanduser("~"), "Downloads")


app = Flask(__name__, static_folder=WEB_DIST_DIR, static_url_path="")


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# Cached ONNX BiRefNet Session to avoid reloading model weights on every request
_REMBG_SESSION = None


def get_rembg_session() -> Any:
    """Pre-loads and caches BiRefNet model session in RAM for instant inference."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        try:
            from segment_object import create_birefnet_session

            logger.info("Pre-loading BiRefNet ONNX neural segmentation model into RAM...")
            sys.stdout.flush()
            start_t = time.time()
            _REMBG_SESSION = create_birefnet_session()
            elapsed = time.time() - start_t
            logger.info(f"BiRefNet ONNX neural model loaded successfully in {elapsed:.2f}s.")
            sys.stdout.flush()
        except Exception as err:
            logger.warning(f"Could not pre-load BiRefNet model: {err}")
            sys.stdout.flush()
    return _REMBG_SESSION


def get_job_files(job_id: str) -> Dict[str, str]:
    """Lists files generated for a conversion job."""
    job_folder = os.path.join(JOBS_DIR, job_id)
    if not os.path.exists(job_folder):
        return {}

    files: Dict[str, str] = {}
    for name in os.listdir(job_folder):
        key = (
            name.replace("result.", "")
            .replace(".", "_")
            .replace("_png", "")
            .replace("_json", "")
            .replace("_dxf", "")
        )
        files[key or name] = f"/api/jobs/{job_id}/{name}"
    return files


@app.route("/")
def index():
    """Serves index.html of static React build."""
    return send_from_directory(WEB_DIST_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path: str):
    """Serves JS/CSS bundle assets."""
    if os.path.exists(os.path.join(WEB_DIST_DIR, path)):
        return send_from_directory(WEB_DIST_DIR, path)
    return send_from_directory(WEB_DIST_DIR, "index.html")


@app.route("/api/jobs/<job_id>/<filename>")
def get_job_file(job_id: str, filename: str):
    """Serves generated job images and DXF files."""
    job_folder = os.path.join(JOBS_DIR, job_id)
    return send_from_directory(job_folder, filename)


@app.route("/api/convert", methods=["POST"])
def convert():
    """Executes computer vision pipeline for uploaded image using cached model session."""
    start_t = time.time()
    try:
        from pipeline_worker import run_pipeline

        if "image" not in request.files:
            logger.error("POST /api/convert failed: No image provided.")
            sys.stdout.flush()
            return jsonify({"success": False, "message": "No image uploaded."}), 400

        file = request.files["image"]
        job_id = str(uuid.uuid4())
        job_folder = os.path.join(JOBS_DIR, job_id)
        os.makedirs(job_folder, exist_ok=True)

        input_path = os.path.join(job_folder, f"uploaded-{file.filename}")
        file.save(input_path)

        sheet_size = request.form.get("sheetSize", "a4")
        custom_w = request.form.get("customWidthMm")
        custom_h = request.form.get("customHeightMm")
        custom_w_mm = float(custom_w) if custom_w else None
        custom_h_mm = float(custom_h) if custom_h else None

        mask_threshold = int(request.form.get("maskThreshold", 240))
        erosion_kernel = int(request.form.get("erosionKernel", 3))
        erosion_iterations = int(request.form.get("erosionIterations", 1))
        min_hole_area = int(request.form.get("minHoleArea", 500))
        min_outer_area = int(request.form.get("minOuterArea", 100))
        circle_ratio = float(request.form.get("circleRatio", 0.85))
        epsilon_min = float(request.form.get("epsilonMin", 0.5))
        epsilon_max = float(request.form.get("epsilonMax", 2.5))
        snap_angle = float(request.form.get("snapAngle", 10.0))
        snap_min_length = float(request.form.get("snapMinLength", 20.0))
        marker_offset_x = float(request.form.get("markerOffsetX", 32.2))
        marker_offset_y = float(request.form.get("markerOffsetY", 34.2))
        marker_clear_radius = float(request.form.get("markerClearRadius", 22.0))
        calibration_scale = float(request.form.get("calibrationScale", 1.0))
        curve_strategy = request.form.get("curveStrategy", "current")
        detect_details = request.form.get("detectDetails", "false").lower() in ("true", "1")
        details_threshold1 = int(request.form.get("detailsThreshold1", 50))
        details_threshold2 = int(request.form.get("detailsThreshold2", 150))

        logger.info(
            f"[API /convert] Image: '{file.filename}' | Job: {job_id} | Paper: {sheet_size.upper()} | "
            f"Thresh: {mask_threshold} | Kernel: {erosion_kernel} | Scale: {calibration_scale} | Strategy: {curve_strategy}"
        )
        sys.stdout.flush()

        session = get_rembg_session()

        report = run_pipeline(
            input_path,
            job_folder,
            paper_size=sheet_size,
            rembg_session=session,
            mask_threshold=mask_threshold,
            erosion_kernel=erosion_kernel,
            erosion_iterations=erosion_iterations,
            min_hole_area=min_hole_area,
            min_outer_area=min_outer_area,
            circle_ratio=circle_ratio,
            epsilon_min=epsilon_min,
            epsilon_max=epsilon_max,
            snap_angle=snap_angle,
            snap_min_length=snap_min_length,
            marker_offset_x=marker_offset_x,
            marker_offset_y=marker_offset_y,
            marker_clear_radius=marker_clear_radius,
            calibration_scale=calibration_scale,
            curve_strategy=curve_strategy,
            detect_details=detect_details,
            details_threshold1=details_threshold1,
            details_threshold2=details_threshold2,
            custom_w_mm=custom_w_mm,
            custom_h_mm=custom_h_mm,
        )

        files = get_job_files(job_id)
        elapsed = time.time() - start_t
        total_ents = report.get("totalEntities", 0)
        logger.info(f"[API /convert DONE] Completed in {elapsed:.2f}s | Entities extracted: {total_ents}")
        sys.stdout.flush()

        return jsonify({
            "success": True,
            "jobId": job_id,
            "report": report,
            "files": files,
        })
    except Exception as err:
        logger.error(f"[API /convert ERROR] {err}", exc_info=True)
        sys.stdout.flush()
        return jsonify({"success": False, "message": str(err)}), 500


@app.route("/api/convert-region", methods=["POST"])
def convert_region():
    """Reprocesses sub-region box using cached model session."""
    start_t = time.time()
    try:
        from pipeline_worker import run_pipeline

        data = request.json or {}
        job_id = data.get("jobId")
        if not job_id:
            return jsonify({"success": False, "message": "Job ID required."}), 400

        job_folder = os.path.join(JOBS_DIR, job_id)
        if not os.path.exists(job_folder):
            return jsonify({"success": False, "message": "Job folder not found."}), 404

        uploaded_files = [f for f in os.listdir(job_folder) if f.startswith("uploaded-")]
        if not uploaded_files:
            return jsonify({"success": False, "message": "Original image not found."}), 404

        input_path = os.path.join(job_folder, uploaded_files[0])
        bbox = data.get("bbox")

        logger.info(f"[API /convert-region] Job: {job_id} | BBox: {bbox}")
        sys.stdout.flush()

        session = get_rembg_session()

        report = run_pipeline(
            input_path,
            job_folder,
            paper_size=data.get("sheetSize", "a4"),
            rembg_session=session,
            crop_bbox_mm=bbox,
            mask_threshold=int(data.get("maskThreshold", 240)),
            erosion_kernel=int(data.get("erosionKernel", 3)),
            erosion_iterations=int(data.get("erosionIterations", 1)),
            epsilon_min=float(data.get("epsilonMin", 0.5)),
            epsilon_max=float(data.get("epsilonMax", 2.5)),
            curve_strategy=data.get("curveStrategy", "current"),
            detect_details=bool(data.get("detectDetails", False)),
        )

        files = get_job_files(job_id)
        elapsed = time.time() - start_t
        logger.info(f"[API /convert-region DONE] Completed in {elapsed:.2f}s")
        sys.stdout.flush()

        return jsonify({
            "success": True,
            "jobId": job_id,
            "report": report,
            "files": files,
        })
    except Exception as err:
        logger.error(f"[API /convert-region ERROR] {err}", exc_info=True)
        sys.stdout.flush()
        return jsonify({"success": False, "message": str(err)}), 500


@app.route("/api/generate-aruco-paper", methods=["GET", "POST"])
def generate_aruco_paper_route():
    """API endpoint to generate printable ArUco calibration paper (PDF/SVG)."""
    try:
        from generate_aruco_paper import generate_aruco_svg, generate_aruco_paper_pdf

        if request.method == "POST" and request.is_json:
            data = request.get_json() or {}
        else:
            data = request.args.to_dict()

        paper_type = data.get("paper_type", "A4")
        custom_w = float(data.get("custom_w", 210.0))
        custom_h = float(data.get("custom_h", 297.0))
        orientation = data.get("orientation", "portrait")
        marker_size_mm = float(data.get("marker_size_mm", 30.0))
        margin_x_mm = float(data.get("margin_x_mm", 32.2))
        margin_y_mm = float(data.get("margin_y_mm", 34.2))
        show_ruler = str(data.get("show_ruler", "true")).lower() in ["true", "1", "yes"]
        show_header_text = str(data.get("show_header_text", "false")).lower() in ["true", "1", "yes"]
        fmt = data.get("format", "pdf").lower()

        if fmt == "svg":
            svg_str = generate_aruco_svg(
                paper_type=paper_type,
                custom_w=custom_w,
                custom_h=custom_h,
                orientation=orientation,
                marker_size_mm=marker_size_mm,
                margin_x_mm=margin_x_mm,
                margin_y_mm=margin_y_mm,
                show_ruler=show_ruler,
                show_header_text=show_header_text,
            )
            return Response(
                svg_str,
                mimetype="image/svg+xml",
                headers={"Content-Disposition": f'inline; filename="dxfify_aruco_{paper_type}.svg"'},
            )
        else:
            pdf_bytes = generate_aruco_paper_pdf(
                paper_type=paper_type,
                custom_w=custom_w,
                custom_h=custom_h,
                orientation=orientation,
                marker_size_mm=marker_size_mm,
                margin_x_mm=margin_x_mm,
                margin_y_mm=margin_y_mm,
                show_ruler=show_ruler,
                show_header_text=show_header_text,
            )
            return Response(
                pdf_bytes,
                mimetype="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="dxfify_aruco_{paper_type}.pdf"'},
            )
    except Exception as err:
        logger.error(f"[API /generate-aruco-paper ERROR] {err}", exc_info=True)
        return jsonify({"success": False, "message": str(err)}), 500


@app.route("/api/save-aruco-paper", methods=["GET", "POST"])
def save_aruco_paper_route():
    """Generate ArUco paper and save to a user-chosen file location."""
    try:
        import subprocess
        from generate_aruco_paper import generate_aruco_svg, generate_aruco_paper_pdf

        if request.method == "POST" and request.is_json:
            data = request.get_json() or {}
        else:
            data = request.args.to_dict()

        paper_type = data.get("paper_type", "A4")
        custom_w = float(data.get("custom_w", 210.0))
        custom_h = float(data.get("custom_h", 297.0))
        orientation = data.get("orientation", "portrait")
        marker_size_mm = float(data.get("marker_size_mm", 30.0))
        margin_x_mm = float(data.get("margin_x_mm", 32.2))
        margin_y_mm = float(data.get("margin_y_mm", 34.2))
        show_ruler = str(data.get("show_ruler", "true")).lower() in ["true", "1", "yes"]
        show_header_text = str(data.get("show_header_text", "false")).lower() in ["true", "1", "yes"]
        fmt = data.get("format", "pdf").lower()

        default_name = f"dxfify_aruco_{paper_type}_{orientation}.{fmt}"

        # Cross-platform Downloads folder detection
        downloads_dir = _get_downloads_dir()
        os.makedirs(downloads_dir, exist_ok=True)
        save_path = os.path.join(downloads_dir, default_name)

        if fmt == "svg":
            content = generate_aruco_svg(
                paper_type=paper_type,
                custom_w=custom_w,
                custom_h=custom_h,
                orientation=orientation,
                marker_size_mm=marker_size_mm,
                margin_x_mm=margin_x_mm,
                margin_y_mm=margin_y_mm,
                show_ruler=show_ruler,
                show_header_text=show_header_text,
            )
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(content)
        else:
            content = generate_aruco_paper_pdf(
                paper_type=paper_type,
                custom_w=custom_w,
                custom_h=custom_h,
                orientation=orientation,
                marker_size_mm=marker_size_mm,
                margin_x_mm=margin_x_mm,
                margin_y_mm=margin_y_mm,
                show_ruler=show_ruler,
                show_header_text=show_header_text,
            )
            with open(save_path, "wb") as f:
                f.write(content)

        logger.info(f"[save-aruco-paper] Saved {fmt.upper()} to: {save_path}")
        return jsonify({"success": True, "message": f"Saved to {save_path}", "path": save_path, "filename": default_name})

    except Exception as err:
        logger.error(f"[API /save-aruco-paper ERROR] {err}", exc_info=True)
        return jsonify({"success": False, "message": str(err)}), 500


@app.route("/api/save-file", methods=["POST"])
def save_file_route():
    """Generic endpoint to save text or binary (base64) files to user's Downloads folder."""
    try:
        data = request.get_json() or {}
        filename = data.get("filename", "export.file")
        content = data.get("content", "")
        is_base64 = data.get("isBase64", False)

        downloads_dir = _get_downloads_dir()
        os.makedirs(downloads_dir, exist_ok=True)
        save_path = os.path.join(downloads_dir, filename)

        if is_base64:
            import base64
            file_bytes = base64.b64decode(content)
            with open(save_path, "wb") as f:
                f.write(file_bytes)
        else:
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(content)

        logger.info(f"[save-file] Saved {filename} to: {save_path}")
        return jsonify({"success": True, "message": f"Saved to {save_path}", "path": save_path, "filename": filename})
    except Exception as err:
        logger.error(f"[API /save-file ERROR] {err}", exc_info=True)
        return jsonify({"success": False, "message": str(err)}), 500


def run_server(port: int = 3001) -> None:
    """Starts local server."""
    logger.info(f"[desktop-server] Serving DXFify Desktop API & Static UI on http://127.0.0.1:{port}")
    sys.stdout.flush()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)

