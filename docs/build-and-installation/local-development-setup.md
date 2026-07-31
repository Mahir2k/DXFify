# Local Development Setup

This guide details setting up the local development environment for Python processing engine and React web application.

---

## 1. Prerequisites

- **OS**: Linux (Ubuntu 20.04+, RHEL 8+, Arch), macOS, or Windows 10/11
- **Python**: 3.10 or higher
- **Node.js**: 18.0 or higher
- **C++ Build Tools**: GCC/Clang (for OpenCV / C++ camera capture builds)

---

## 2. Python Core Setup (`dxferpy/`)

1. **Create and Activate Virtual Environment**:
   ```bash
   cd dxferpy
   python3 -m venv venv
   source venv/bin/activate
   ```

2. **Upgrade Pip & Install Dependencies**:
   ```bash
   pip install --upgrade pip setuptools wheel
   pip install -r requirements.txt
   pip install PyQt6 PyQt6-WebEngine qtpy pywebview Flask
   ```

3. **Verify OpenCV ArUco Installation**:
   ```bash
   python3 -c "import cv2; print('OpenCV Version:', cv2.__version__); print('ArUco Available:', hasattr(cv2, 'aruco'))"
   ```
   *Note: Standard `opencv-python` may lack ArUco bindings. Ensure `opencv-contrib-python` is installed if ArUco functions are missing.*

4. **Test Python Pipeline Server**:
   ```bash
   python3 pipeline_worker.py
   ```
   Output: `[2026-07-31 11:00:00,000 worker] Serving pipeline worker on port 8788...`

---

## 3. Web Client & Express Gateway Setup (`web/`)

1. **Install Node Dependencies**:
   ```bash
   cd web
   npm install
   ```

2. **Development Execution**:
   - **Combined Server + Client**:
     ```bash
     npm run dev
     ```
     Launches Express backend (`:8787`) and Vite HMR client (`:5173`).

   - **Frontend Mock Mode (No Python/OpenCV Required)**:
     ```bash
     DXFER_MOCK=1 npm run dev
     ```
     Uses mock responses for rapid UI styling and tool development.

3. **Production Build**:
   ```bash
   npm run build
   ```
   Compiles React TypeScript code to static HTML/JS/CSS assets in `web/dist/`.

---

## 4. Run Automated Regression Test Suite

Run Python regression test suite before submitting pull requests:

```bash
cd dxferpy
venv/bin/python3 -m unittest test_regression.py
```

Expected output:

```
[2026-07-31 11:00:00,000 worker] Loading rembg BiRefNet model...
[2026-07-31 11:00:02,000 worker] Model loaded in 2.0s
.
----------------------------------------------------------------------
Ran 1 test in 7.929s

OK
```
