import cv2
import numpy as np
import os
from rembg import remove

images = ["airpod_case.jpg", "key.jpg", "phone_case.jpg", "wood_tilted.jpg", "wood2.jpg"]
scratch_dir = "/home/aledawizard/.gemini/antigravity/brain/2e8ae9e6-8b67-4dd2-af44-f64fe3e5f847/scratch"
os.makedirs(scratch_dir, exist_ok=True)

for img_name in images:
    img_path = f"samples/{img_name}"
    img = cv2.imread(img_path)
    if img is None:
        continue
    print(f"\nProcessing {img_name} with rembg...")
    
    # Run rembg
    # rembg expects a PIL image or numpy array
    # If numpy array, it returns a numpy array with alpha channel (RGBA)
    rgba = remove(img)
    alpha = rgba[:, :, 3]
    
    # Threshold alpha to get binary mask
    _, mask = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    
    # Save rembg mask
    out_mask_path = os.path.join(scratch_dir, f"rembg_{img_name}")
    cv2.imwrite(out_mask_path, mask)
    print(f"Saved rembg mask to {out_mask_path}")
    
    # Let's check hierarchy/holes in rembg mask
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    num_holes = 0
    if hierarchy is not None:
        num_holes = np.sum(hierarchy[0, :, 3] != -1)
    print(f"  Total contours = {len(contours)}, holes = {num_holes}")
