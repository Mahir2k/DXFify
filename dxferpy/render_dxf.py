"""Renders DXF files to transparent high-DPI PNG preview images using ezdxf matplotlib addon."""

import glob
import logging
import os

import ezdxf
from ezdxf.addons.drawing.matplotlib import qsave

logger = logging.getLogger(__name__)


def render_dxf_to_png(dxf_path: str, png_path: str, dpi: int = 300) -> bool:
    """Renders entities from modelspace of a DXF file into a transparent PNG.

    Args:
        dxf_path: Path to input .dxf file.
        png_path: Path to output .png file.
        dpi: Dots per inch resolution. Defaults to 300.

    Returns:
        True if rendering succeeded, False otherwise.
    """
    try:
        logger.info(f"Rendering DXF {dxf_path} to {png_path}...")
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
        qsave(msp, png_path, bg="#00000000", fg="#FFFFFF", dpi=dpi)
        return True
    except Exception as err:
        logger.error(f"Failed to render DXF {dxf_path}: {err}")
        return False


if __name__ == "__main__":
    dxfs = glob.glob("output/*.dxf")
    for d in dxfs:
        base = os.path.basename(d)
        png_out = f"output/render_{base.replace('.dxf', '.png')}"
        render_dxf_to_png(d, png_out)
