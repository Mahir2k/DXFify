import os
import glob
import matplotlib.pyplot as plt
import ezdxf
from ezdxf.addons.drawing.matplotlib import qsave
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy

def render_dxf_to_png(dxf_path, png_path):
    print(f"Rendering {dxf_path} to {png_path}...")
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    
    qsave(msp, png_path, bg="#00000000", fg="#FFFFFF", dpi=300)

if __name__ == "__main__":
    dxfs = glob.glob("output/*.dxf")
    for d in dxfs:
        base = os.path.basename(d)
        png_path = f"output/render_{base.replace('.dxf', '.png')}"
        render_dxf_to_png(d, png_path)
