# Neural Segmentation & Mask Refinement

This document covers deep learning background subtraction using BiRefNet ONNX model inference, Guided Filter edge sharpening, morphological erosion, and RAM session caching.

---

## 1. BiRefNet Neural Architecture & Model Selection

Standard color thresholding (e.g. Otsu or HSV thresholding) fails on complex objects with shadows, metallic reflections, or surface gradients. DXFify uses **BiRefNet** (`birefnet-general-lite`), a high-resolution neural network optimized for background subtraction.

- **ONNX Model Weights**: Pre-trained ONNX runtime model.
- **Inference Module**: `dxferpy/segment_object.py` -> `create_birefnet_session()`.
- **Input Pre-Processing**: Image resized to $1024 \times 1024$, normalized using standard ImageNet mean $\mathbf{\mu} = [0.485, 0.456, 0.406]$ and standard deviation $\mathbf{\sigma} = [0.229, 0.224, 0.225]$.
- **Output Map**: Continuous probability map $P_{raw} \in [0.0, 1.0]$.

---

## 2. Guided Filter & Morphological Erosion Pipeline

Raw neural network output masks exhibit blurred boundary edges. To restore crisp, sharp edges required for CAD vectorization, `segment_single_image()` in `segment_object.py` executes:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ Raw Neural Mask │ ───► │ Binarization    │ ───► │ Guided Filter   │ ───► │ Morphological   │
│ (BiRefNet ONNX) │      │ (Threshold=240) │      │ Edge Refinement │      │ Erosion (3x3)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘      └─────────────────┘
```

1. **Binarization**:
   $$M_{binary}(x,y) = \begin{cases} 255 & \text{if } P_{raw}(x,y) \cdot 255 \ge \text{maskThreshold} \\ 0 & \text{otherwise} \end{cases}$$
   *Default `maskThreshold` = 240.*

2. **OpenCV Guided Filter Edge Refinement**:
   Uses the warped RGB photograph as a structural guide image to refine binary mask edge boundaries, aligning the mask boundary with color gradient edges.

3. **Morphological Erosion**:
   Applies $k \times k$ square structuring element (default kernel size $3 \times 3$, 1 pass) via `cv2.erode` to shave off stray background pixels and shadow artifacts.

---

## 3. RAM Model Session Caching (`_REMBG_SESSION`)

Loading the 150MB BiRefNet ONNX model from disk into RAM takes ~1.8 seconds. Re-instantiating the session on every API conversion request degrades user experience.

### Implementation Pattern (`desktop/desktop_server.py`)

```python
_REMBG_SESSION = None

def get_rembg_session() -> Any:
    """Pre-loads and caches BiRefNet model session in RAM."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from segment_object import create_birefnet_session
        _REMBG_SESSION = create_birefnet_session()
    return _REMBG_SESSION
```

In `desktop/main.py`, a background thread pre-warms `get_rembg_session()` during application boot. Subsequent conversion requests pass `rembg_session=_REMBG_SESSION` directly to `run_pipeline()`, reducing conversion latency to **<1.5s**.
