"""Self-contained Flask web & API server for the DXFify Standalone Desktop Application."""

import json
import os
import sys
import uuid
from typing import Any, Dict

from flask import Flask, jsonify, request, send_from_directory

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
WEB_DIST_DIR = os.path.join(REPO_ROOT, "web", "dist")

if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

JOBS_DIR = os.path.join(os.path.expanduser("~"), ".dxfify_jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

app = Flask(__name__, static_folder=WEB_DIST_DIR, static_url_path="")

# Cached ONNX BiRefNet Session to avoid reloading model weights on every request
_REMBG_SESSION = None


def get_rembg_session() -> Any:
    """Pre-loads and caches BiRefNet model session in RAM for instant inference."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        try:
            from segment_object import create_birefnet_session
            print("[desktop-server] Pre-loading BiRefNet model session into RAM...")
            _REMBG_SESSION = create_birefnet_session()
            print("[desktop-server] BiRefNet model session ready.")
        except Exception as err:
            print(f"[desktop-server] Warning: Could not pre-load model: {err}")
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
    try:
        from pipeline_worker import run_pipeline

        if "image" not in request.files:
            return jsonify({"success": False, "message": "No image uploaded."}), 400

        file = request.files["image"]
        job_id = str(uuid.uuid4())
        job_folder = os.path.join(JOBS_DIR, job_id)
        os.makedirs(job_folder, exist_ok=True)

        input_path = os.path.join(job_folder, f"uploaded-{file.filename}")
        file.save(input_path)

        sheet_size = request.form.get("sheetSize", "a4")
        mask_threshold = int(request.form.get("maskThreshold", 240))
        erosion_kernel = int(request.form.get("erosionKernel", 3))
        erosion_iterations = int(request.form.get("erosionIterations", 1))
        epsilon_min = float(request.form.get("epsilonMin", 0.5))
        epsilon_max = float(request.form.get("epsilonMax", 2.5))
        curve_strategy = request.form.get("curveStrategy", "current")
        detect_details = request.form.get("detectDetails", "false").lower() in ("true", "1")

        session = get_rembg_session()

        report = run_pipeline(
            input_path,
            job_folder,
            paper_size=sheet_size,
            rembg_session=session,
            mask_threshold=mask_threshold,
            erosion_kernel=erosion_kernel,
            erosion_iterations=erosion_iterations,
            epsilon_min=epsilon_min,
            epsilon_max=epsilon_max,
            curve_strategy=curve_strategy,
            detect_details=detect_details,
        )

        files = get_job_files(job_id)
        return jsonify({
            "success": True,
            "jobId": job_id,
            "report": report,
            "files": files,
        })
    except Exception as err:
        return jsonify({"success": False, "message": str(err)}), 500


@app.route("/api/convert-region", methods=["POST"])
def convert_region():
    """Reprocesses sub-region box using cached model session."""
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
        return jsonify({
            "success": True,
            "jobId": job_id,
            "report": report,
            "files": files,
        })
    except Exception as err:
        return jsonify({"success": False, "message": str(err)}), 500


def run_server(port: int = 3001) -> None:
    """Starts local server."""
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
