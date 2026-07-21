import os
import unittest
import cv2
import numpy as np
from vectorize_smart import get_homography
from pipeline_worker import segment_single_image, vectorize_single_image

class TestDxferPipelineRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.samples_dir = os.path.join(cls.repo_root, "dxferpy", "samples")
        cls.output_dir = os.path.join(cls.repo_root, "dxferpy", "temp", "test_regression_out")
        os.makedirs(cls.output_dir, exist_ok=True)
        
        # Load rembg session
        from rembg.sessions.birefnet_general_lite import BiRefNetSessionGeneralLite
        import onnxruntime as ort
        sess_opts = ort.SessionOptions()
        sess_opts.enable_cpu_mem_arena = False
        sess_opts.enable_mem_pattern = False
        cls.session = BiRefNetSessionGeneralLite("birefnet-general-lite", sess_opts)

    def test_key_segmentation_and_vectorization(self):
        img_path = os.path.join(self.samples_dir, "key.jpg")
        if not os.path.exists(img_path):
            self.skipTest(f"Sample image not found: {img_path}")

        # 1. Test Segmentation
        img, mask, used_aruco = segment_single_image(
            img_path,
            self.session,
            mask_threshold=240,
            erosion_kernel=3,
            erosion_iterations=1,
        )
        
        self.assertIsNotNone(img)
        self.assertIsNotNone(mask)
        self.assertEqual(mask.shape[:2], img.shape[:2])
        self.assertTrue(used_aruco, "ArUco markers should be detected on key.jpg")

        # 2. Test Homography
        H, scale, marker_centers = get_homography(img_path)
        self.assertIsNotNone(H)
        self.assertGreater(scale, 1.0)
        self.assertTrue(len(marker_centers) >= 4)

        # 3. Warp mask & image
        h_paper = int(297.0 * scale)
        w_paper = int(210.0 * scale)
        warped_mask = cv2.warpPerspective(mask, H, (w_paper, h_paper), flags=cv2.INTER_NEAREST)
        warped_img = cv2.warpPerspective(img, H, (w_paper, h_paper))

        # 4. Test Vectorization
        dxf_path = os.path.join(self.output_dir, "test_key.dxf")
        if os.path.exists(dxf_path):
            os.remove(dxf_path)

        report = vectorize_single_image(
            warped_mask,
            scale,
            dxf_path,
            paper_h=297.0,
            detect_details=True,
            warped_img=warped_img,
        )

        self.assertTrue(report.get("success", False))
        self.assertTrue(os.path.exists(dxf_path))
        self.assertGreater(os.path.getsize(dxf_path), 0)
        self.assertGreater(report.get("totalEntities", 0), 0)

if __name__ == "__main__":
    unittest.main()
