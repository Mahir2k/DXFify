import glob
import os

import cv2
import numpy as np
from rembg import new_session, remove


def order_points_by_id(corners, ids):
    id_to_idx = {2: 0, 3: 1, 0: 2, 1: 3}
    rect = np.zeros((4, 2), dtype="float32")

    ids = ids.flatten()
    for i, marker_id in enumerate(ids):
        if marker_id in id_to_idx:
            c = corners[i][0]
            center = (c[0] + c[1] + c[2] + c[3]) / 4
            rect[id_to_idx[marker_id]] = center

    return rect


def get_aruco_corners(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)

    corners, ids, rejected = detector.detectMarkers(gray)

    if ids is not None and len(ids) == 4:
        return corners, ids
    return None, None


def process_image(img_path, session):
    print(f"Processing {img_path} with BiRefNet...")
    img = cv2.imread(img_path)
    if img is None:
        print(f"Error loading {img_path}")
        return

    corners, ids = get_aruco_corners(img)
    if corners is not None:
        rect = order_points_by_id(corners, ids)
        width, height = 1000, 1577
        if np.linalg.norm(rect[1] - rect[0]) > np.linalg.norm(rect[3] - rect[0]):
            width, height = 1577, 1000

        dst = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype="float32",
        )

        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(img, M, (width, height))
    else:
        print(
            f"Could not find 4 ArUco markers in {img_path}, processing original image."
        )
        warped = img

    rgb_warped = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    rembg_mask = remove(rgb_warped, session=session, only_mask=True)
    mask = (np.array(rembg_mask) > 240).astype(np.uint8) * 255
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)

    base_name = os.path.basename(img_path)
    png_name = base_name.replace(".jpg", ".png")

    rgba = cv2.cvtColor(warped, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = mask
    cv2.imwrite(f"output/rgba_{png_name}", rgba)
    print(f"Saved perfect RGBA output for {png_name}")

    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    outline_img = np.ones((mask.shape[0], mask.shape[1]), dtype=np.uint8) * 255
    cv2.drawContours(outline_img, contours, -1, 0, 2)
    cv2.imwrite(f"output/outline_{png_name}", outline_img)
    print(f"Saved outline output for {png_name}")


if __name__ == "__main__":
    if os.path.exists("output"):
        for f in glob.glob("output/*"):
            try:
                os.remove(f)
            except Exception as e:
                pass
    os.makedirs("output", exist_ok=True)

    import onnxruntime as ort
    from rembg.sessions.birefnet_general_lite import BiRefNetSessionGeneralLite
    sess_opts = ort.SessionOptions()
    sess_opts.enable_cpu_mem_arena = False
    sess_opts.enable_mem_pattern = False
    if "OMP_NUM_THREADS" in os.environ:
        threads = int(os.environ["OMP_NUM_THREADS"])
        sess_opts.inter_op_num_threads = threads
        sess_opts.intra_op_num_threads = threads
    session = BiRefNetSessionGeneralLite("birefnet-general-lite", sess_opts)

    images = glob.glob("samples/*.jpg") + glob.glob("samples/*.png")
    for img_path in images:
        process_image(img_path, session)
