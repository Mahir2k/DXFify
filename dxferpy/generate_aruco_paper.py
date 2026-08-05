"""
ArUco Marked Paper Calibration Sheet Generator.

Generates high-precision PDF and SVG calibration target sheets for:
- Standard paper sizes: A4, A3, A5, Letter, Legal
- Custom paper dimensions (Width x Height in mm)
- Adjustable ArUco marker size, corner offsets, orientation, and metric rulers.
"""

import os
import io
import math
from typing import Dict, Tuple, Optional, List
import numpy as np
import cv2
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches

PAPER_PRESETS: Dict[str, Tuple[float, float]] = {
    'A4': (210.0, 297.0),
    'A3': (297.0, 420.0),
    'A5': (148.0, 210.0),
    'Letter': (215.9, 279.4),
    'Legal': (215.9, 355.6),
}

def get_aruco_bit_matrix(id_val: int) -> np.ndarray:
    """Extracts 4x4 bit matrix for a given ArUco ID from DICT_4X4_50 dictionary."""
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker_img = cv2.aruco.generateImageMarker(aruco_dict, id_val, 6)
    # Threshold to binary 0 (black) and 1 (white)
    bit_matrix = (marker_img > 127).astype(np.uint8)
    return bit_matrix

def generate_aruco_svg(
    paper_type: str = 'A4',
    custom_w: float = 210.0,
    custom_h: float = 297.0,
    orientation: str = 'portrait',
    marker_size_mm: float = 30.0,
    margin_x_mm: float = 32.2,
    margin_y_mm: float = 34.2,
    show_ruler: bool = True,
    show_header_text: bool = False,
) -> str:
    """Generates a clean 1:1 scale SVG markup string for the ArUco calibration paper."""
    if paper_type in PAPER_PRESETS:
        pw, ph = PAPER_PRESETS[paper_type]
    else:
        pw, ph = float(custom_w), float(custom_h)

    if orientation == 'landscape':
        pw, ph = max(pw, ph), min(pw, ph)
    else:
        pw, ph = min(pw, ph), max(pw, ph)

    ms = float(marker_size_mm)
    half_m = ms / 2.0

    # Ensure offsets leave room for markers
    offset_x = max(half_m + 2.0, float(margin_x_mm))
    offset_y = max(half_m + 2.0, float(margin_y_mm))

    # Corner marker center positions (mm)
    corners = {
        0: (offset_x, offset_y),                          # Top-Left
        1: (pw - offset_x, offset_y),                     # Top-Right
        2: (pw - offset_x, ph - offset_y),                # Bottom-Right
        3: (offset_x, ph - offset_y),                     # Bottom-Left
    }

    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 {pw} {ph}" style="max-width: 100%; max-height: 100%; display: block; margin: auto;">')
    svg.append('  <style>')
    svg.append('    .text-title { font-family: system-ui, sans-serif; font-size: 4px; font-weight: bold; fill: #111; }')
    svg.append('    .text-sub { font-family: system-ui, sans-serif; font-size: 2.8px; fill: #555; }')
    svg.append('    .text-alert { font-family: system-ui, sans-serif; font-size: 3.2px; font-weight: bold; fill: #d32f2f; }')
    svg.append('    .ruler-tick { stroke: #333; stroke-width: 0.2; }')
    svg.append('    .ruler-text { font-family: system-ui, sans-serif; font-size: 2px; fill: #444; }')
    svg.append('    .grid-line { stroke: #e0e0e0; stroke-width: 0.15; stroke-dasharray: 1,1; }')
    svg.append('    .border-line { stroke: #999; stroke-width: 0.3; fill: none; }')
    svg.append('  </style>')

    # Background Paper Rect
    svg.append(f'  <rect x="0" y="0" width="{pw}" height="{ph}" fill="#ffffff" />')
    svg.append(f'  <rect x="1" y="1" width="{pw - 2}" height="{ph - 2}" class="border-line" />')

    # Optional Ruler Ticks along Left and Bottom edges
    if show_ruler:
        # Bottom Ruler
        for x in range(0, int(pw) + 1):
            if x % 10 == 0:
                h_len = 3.5
                svg.append(f'  <line x1="{x}" y1="{ph}" x2="{x}" y2="{ph - h_len}" class="ruler-tick" stroke-width="0.3" />')
                if x > 0 and x < pw - 5:
                    svg.append(f'  <text x="{x}" y="{ph - h_len - 1}" text-anchor="middle" class="ruler-text">{x // 10}</text>')
            elif x % 5 == 0:
                svg.append(f'  <line x1="{x}" y1="{ph}" x2="{x}" y2="{ph - 2.5}" class="ruler-tick" />')
            else:
                svg.append(f'  <line x1="{x}" y1="{ph}" x2="{x}" y2="{ph - 1.2}" class="ruler-tick" />')

        # Left Ruler
        for y in range(0, int(ph) + 1):
            if y % 10 == 0:
                svg.append(f'  <line x1="0" y1="{y}" x2="3.5" y2="{y}" class="ruler-tick" stroke-width="0.3" />')
                if y > 0 and y < ph - 5:
                    svg.append(f'  <text x="4.5" y="{y + 0.8}" class="ruler-text">{y // 10}</text>')
            elif y % 5 == 0:
                svg.append(f'  <line x1="0" y1="{y}" x2="2.5" y2="{y}" class="ruler-tick" />')
            else:
                svg.append(f'  <line x1="0" y1="{y}" x2="1.2" y2="{y}" class="ruler-tick" />')

    # Draw 4 ArUco Markers
    for marker_id, (cx, cy) in corners.items():
        bit_matrix = get_aruco_bit_matrix(marker_id)
        rows, cols = bit_matrix.shape
        cell_w = ms / cols
        cell_h = ms / rows
        start_x = cx - half_m
        start_y = cy - half_m

        # Marker bounding box & white background
        svg.append(f'  <rect x="{start_x}" y="{start_y}" width="{ms}" height="{ms}" fill="#ffffff" stroke="#000000" stroke-width="0.2" />')

        # Draw black bit cells
        for r in range(rows):
            for c in range(cols):
                if bit_matrix[r, c] == 0: # Black bit
                    bx = start_x + c * cell_w
                    by = start_y + r * cell_h
                    svg.append(f'  <rect x="{bx:.3f}" y="{by:.3f}" width="{cell_w:.3f}" height="{cell_h:.3f}" fill="#000000" />')

        # Marker ID label
        svg.append(f'  <text x="{cx}" y="{cy + half_m + 3}" text-anchor="middle" class="text-sub">ID: {marker_id}</text>')

    # Header and Scale Instructions (Optional)
    if show_header_text:
        header_y = offset_y - half_m - 4.0
        if header_y < 12.0:
            header_y = 12.0

        svg.append(f'  <text x="{pw / 2}" y="{header_y}" text-anchor="middle" class="text-title">DXFify Calibration Target — {paper_type} ({pw:.1f} × {ph:.1f} mm)</text>')
        svg.append(f'  <text x="{pw / 2}" y="{header_y + 4.5}" text-anchor="middle" class="text-alert">CRITICAL: PRINT AT 100% SCALE (ACTUAL SIZE). DO NOT SCALE TO FIT.</text>')

        info_str = f'Marker Size: {ms:.1f} mm | Offsets: X={offset_x:.1f} mm, Y={offset_y:.1f} mm | Dictionary: DICT_4X4_50'
        svg.append(f'  <text x="{pw / 2}" y="{header_y + 8.5}" text-anchor="middle" class="text-sub">{info_str}</text>')

    svg.append('</svg>')
    return '\n'.join(svg)


def generate_aruco_paper_pdf(
    paper_type: str = 'A4',
    custom_w: float = 210.0,
    custom_h: float = 297.0,
    orientation: str = 'portrait',
    marker_size_mm: float = 30.0,
    margin_x_mm: float = 32.2,
    margin_y_mm: float = 34.2,
    show_ruler: bool = True,
    show_header_text: bool = False,
) -> bytes:
    """Generates a high-precision vector PDF byte stream for the ArUco calibration paper."""
    if paper_type in PAPER_PRESETS:
        pw, ph = PAPER_PRESETS[paper_type]
    else:
        pw, ph = float(custom_w), float(custom_h)

    if orientation == 'landscape':
        pw, ph = max(pw, ph), min(pw, ph)
    else:
        pw, ph = min(pw, ph), max(pw, ph)

    ms = float(marker_size_mm)
    half_m = ms / 2.0
    offset_x = max(half_m + 2.0, float(margin_x_mm))
    offset_y = max(half_m + 2.0, float(margin_y_mm))

    # Convert mm to inches for Matplotlib
    pw_in = pw / 25.4
    ph_in = ph / 25.4

    fig = plt.figure(figsize=(pw_in, ph_in), dpi=300)
    ax = fig.add_axes([0, 0, 1, 1], frameon=False)
    ax.set_xlim(0, pw)
    ax.set_ylim(0, ph)
    ax.invert_yaxis() # Top-left origin
    ax.set_aspect('equal')
    ax.axis('off')

    # Draw border
    rect_border = patches.Rectangle((1, 1), pw - 2, ph - 2, linewidth=0.5, edgecolor='#888888', facecolor='none')
    ax.add_patch(rect_border)

    corners = {
        0: (offset_x, offset_y),
        1: (pw - offset_x, offset_y),
        2: (pw - offset_x, ph - offset_y),
        3: (offset_x, ph - offset_y),
    }

    # Draw Markers
    for marker_id, (cx, cy) in corners.items():
        bit_matrix = get_aruco_bit_matrix(marker_id)
        rows, cols = bit_matrix.shape
        cell_w = ms / cols
        cell_h = ms / rows
        start_x = cx - half_m
        start_y = cy - half_m

        for r in range(rows):
            for c in range(cols):
                if bit_matrix[r, c] == 0:
                    bx = start_x + c * cell_w
                    by = start_y + r * cell_h
                    cell_rect = patches.Rectangle((bx, by), cell_w, cell_h, facecolor='black', edgecolor='none')
                    ax.add_patch(cell_rect)

        ax.text(cx, cy + half_m + 3.0, f'ID: {marker_id}', fontsize=7, ha='center', va='top', color='#333333')

    # Header Text (Optional)
    if show_header_text:
        header_y = max(12.0, offset_y - half_m - 4.0)
        ax.text(pw / 2.0, header_y, f'DXFify Calibration Target — {paper_type} ({pw:.1f} × {ph:.1f} mm)', fontsize=10, fontweight='bold', ha='center', color='#111111')
        ax.text(pw / 2.0, header_y + 4.5, 'CRITICAL: PRINT AT 100% SCALE (ACTUAL SIZE). DO NOT SCALE TO FIT.', fontsize=8, fontweight='bold', ha='center', color='#d32f2f')
        ax.text(pw / 2.0, header_y + 8.5, f'Marker Size: {ms:.1f} mm | Offsets: X={offset_x:.1f} mm, Y={offset_y:.1f} mm | Dictionary: DICT_4X4_50', fontsize=7, ha='center', color='#555555')

    # Ruler ticks
    if show_ruler:
        # Bottom ruler
        for x in range(0, int(pw) + 1):
            if x % 10 == 0:
                ax.plot([x, x], [ph, ph - 3.5], color='#333333', linewidth=0.5)
                if 0 < x < pw - 5:
                    ax.text(x, ph - 4.5, str(x // 10), fontsize=5, ha='center', va='top', color='#444444')
            elif x % 5 == 0:
                ax.plot([x, x], [ph, ph - 2.5], color='#444444', linewidth=0.3)
            else:
                ax.plot([x, x], [ph, ph - 1.2], color='#666666', linewidth=0.2)

        # Left ruler
        for y in range(0, int(ph) + 1):
            if y % 10 == 0:
                ax.plot([0, 3.5], [y, y], color='#333333', linewidth=0.5)
                if 0 < y < ph - 5:
                    ax.text(4.5, y, str(y // 10), fontsize=5, ha='left', va='center', color='#444444')
            elif y % 5 == 0:
                ax.plot([0, 2.5], [y, y], color='#444444', linewidth=0.3)
            else:
                ax.plot([0, 1.2], [y, y], color='#666666', linewidth=0.2)

    buf = io.BytesIO()
    fig.savefig(buf, format='pdf', pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
