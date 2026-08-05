import { useEffect, useRef, useState } from 'react';
import type { ConversionSettings, PreviewTab, StatusMessage, ToolId } from '../types';





interface MenuItemDef {
  label: string;
  action?: () => void;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  type?: 'separator';
}

export interface TopBarProps {
  status: StatusMessage;
  canRun: boolean;
  canDownload: boolean;
  isConverting: boolean;
  dxfUrl: string | null;
  onUpload: (file: File) => void;
  onRun: () => void;
  onReset: () => void;
  selectedTool: ToolId;
  onToolChange: (tool: ToolId) => void;
  gridEnabled: boolean;
  onToggleGrid: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  selectedPreviewTab: PreviewTab;
  onPreviewTabChange: (tab: PreviewTab) => void;
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  showToolbox: boolean;
  onToggleToolbox: () => void;
  showBottomPanels: boolean;
  onToggleBottomPanels: () => void;
  onDownload?: () => void;
  onExportSvg?: () => void;
  onExportPdf?: () => void;
  onOpenArucoGenerator?: () => void;
}





const menuOrder = ['File', 'Edit', 'View', 'Image', 'Select', 'Tools', 'Filters', 'Windows', 'Help'];

const SEP: MenuItemDef = { type: 'separator', label: '' };

function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}





export function TopBar(props: TopBarProps) {
  const {
    status, canRun, canDownload, isConverting, dxfUrl,
    onUpload, onRun, onReset,
    selectedTool, onToolChange,
    gridEnabled, onToggleGrid, onZoomIn, onZoomOut, onFitToView,
    selectedPreviewTab, onPreviewTabChange,
    settings, onSettingsChange,
    showToolbox, onToggleToolbox,
    showBottomPanels, onToggleBottomPanels,
    onDownload,
    onExportSvg,
    onExportPdf,
    onOpenArucoGenerator,
  } = props;

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuActive, setMenuActive] = useState(false);
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMenuActive(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenMenu(null); setMenuActive(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (dialog && e.key === 'Escape') { setDialog(null); return; }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o': e.preventDefault(); fileInputRef.current?.click(); return;
          case 'enter': e.preventDefault(); if (canRun && !isConverting) onRun(); return;
          case 's':
            e.preventDefault();
            if (canDownload) {
              if (onDownload) onDownload();
              else if (dxfUrl) downloadUrl(dxfUrl, 'result.dxf');
            }
            return;
          case 'z':
            e.preventDefault();
            onToolChange(e.shiftKey ? 'redo' : 'undo');
            return;
          case '=': case '+': e.preventDefault(); onZoomIn(); return;
          case '-': e.preventDefault(); onZoomOut(); return;
          case '0': e.preventDefault(); onFitToView(); return;
        }
        return;
      }
      if (e.altKey) return;
      switch (e.key) {
        case 'g': case 'G': onToggleGrid(); break;
        case '1': onPreviewTabChange('original'); break;
        case '2': onPreviewTabChange('debug'); break;
        case '3': onPreviewTabChange('mask'); break;
        case '4': onPreviewTabChange('holes'); break;
        case 'v': case 'V': onToolChange('select'); break;
        case 'n': case 'N': onToolChange('snap'); break;
        case 'l': case 'L': onToolChange('line'); break;
        case 'a': case 'A': onToolChange('arc'); break;
        case 'p': case 'P': onToolChange('polyline'); break;
        case '.': onToolChange('add-point'); break;
        case 'x': case 'X': onToolChange('delete'); break;
        case 'h': case 'H': onToolChange('mark-hole'); break;
        case 'm': case 'M': onToolChange('measure'); break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [canRun, canDownload, isConverting, dxfUrl, dialog, onRun, onToolChange, onZoomIn, onZoomOut, onFitToView, onToggleGrid, onPreviewTabChange, onDownload, onExportSvg, onExportPdf]);

  
  const click = (name: string) => {
    if (openMenu === name) { setOpenMenu(null); setMenuActive(false); }
    else { setOpenMenu(name); setMenuActive(true); }
  };
  const hover = (name: string) => { if (menuActive) setOpenMenu(name); };
  const run = (item: MenuItemDef) => {
    if (item.disabled || !item.action) return;
    item.action();
    setOpenMenu(null);
    setMenuActive(false);
  };
  const openDialog = (d: 'shortcuts' | 'about') => {
    setDialog(d);
    setOpenMenu(null);
    setMenuActive(false);
  };

  const statusClass = status.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  
  const menus: Record<string, MenuItemDef[]> = {
    File: [
      { label: 'Upload Image…', action: () => fileInputRef.current?.click(), shortcut: 'Ctrl+O' },
      { label: isConverting ? 'Running…' : 'Run Conversion', action: onRun, disabled: !canRun || isConverting, shortcut: 'Ctrl+Enter' },
      SEP,
      { label: '🖨 ArUco Paper Generator…', action: onOpenArucoGenerator, shortcut: 'Ctrl+Shift+P' },
      SEP,
      {
        label: 'Download DXF',
        action: onDownload || (() => { if (dxfUrl) downloadUrl(dxfUrl, 'result.dxf'); }),
        disabled: !canDownload,
        shortcut: 'Ctrl+S',
      },
      {
        label: 'Export SVG',
        action: onExportSvg,
        disabled: !canDownload,
      },
      {
        label: 'Export PDF',
        action: onExportPdf,
        disabled: !canDownload,
      },
      SEP,
      { label: 'Reset Workspace', action: onReset },
    ],
    Edit: [
      { label: 'Undo', action: () => onToolChange('undo'), shortcut: 'Ctrl+Z' },
      { label: 'Redo', action: () => onToolChange('redo'), shortcut: 'Ctrl+Shift+Z' },
    ],
    View: [
      { label: 'Zoom In', action: onZoomIn, shortcut: 'Ctrl+=' },
      { label: 'Zoom Out', action: onZoomOut, shortcut: 'Ctrl+−' },
      { label: 'Fit to View', action: onFitToView, shortcut: 'Ctrl+0' },
      SEP,
      { label: 'Show Grid', action: onToggleGrid, checked: gridEnabled, shortcut: 'G' },
    ],
    Image: [
      { label: 'Original', action: () => onPreviewTabChange('original'), checked: selectedPreviewTab === 'original', shortcut: '1' },
      { label: 'Debug Overlay', action: () => onPreviewTabChange('debug'), checked: selectedPreviewTab === 'debug', shortcut: '2' },
      { label: 'Mask', action: () => onPreviewTabChange('mask'), checked: selectedPreviewTab === 'mask', shortcut: '3' },
      { label: 'Holes', action: () => onPreviewTabChange('holes'), checked: selectedPreviewTab === 'holes', shortcut: '4' },
    ],
    Select: [
      { label: 'Pan / Inspect', action: () => onToolChange('select'), checked: selectedTool === 'select', shortcut: 'V' },
      { label: 'Snap', action: () => onToolChange('snap'), checked: selectedTool === 'snap', shortcut: 'N' },
      { label: 'Measure Distance', action: () => onToolChange('measure'), checked: selectedTool === 'measure', shortcut: 'M' },
    ],
    Tools: [
      { label: 'Line', action: () => onToolChange('line'), checked: selectedTool === 'line', shortcut: 'L' },
      { label: 'Arc / Curve', action: () => onToolChange('arc'), checked: selectedTool === 'arc', shortcut: 'A' },
      { label: 'Polyline', action: () => onToolChange('polyline'), checked: selectedTool === 'polyline', shortcut: 'P' },
      { label: 'Add Point', action: () => onToolChange('add-point'), checked: selectedTool === 'add-point', shortcut: '.' },
      SEP,
      { label: 'Delete', action: () => onToolChange('delete'), checked: selectedTool === 'delete', shortcut: 'X' },
      { label: 'Mark Hole', action: () => onToolChange('mark-hole'), checked: selectedTool === 'mark-hole', shortcut: 'H' },
      { label: 'Measure Distance', action: () => onToolChange('measure'), checked: selectedTool === 'measure', shortcut: 'M' },
    ],
    Filters: [
      { label: 'Sheet: A4', action: () => onSettingsChange({ ...settings, sheetSize: 'a4' }), checked: settings.sheetSize === 'a4' },
      { label: 'Sheet: A3', action: () => onSettingsChange({ ...settings, sheetSize: 'a3' }), checked: settings.sheetSize === 'a3' },
      { label: 'Sheet: A5', action: () => onSettingsChange({ ...settings, sheetSize: 'a5' }), checked: settings.sheetSize === 'a5' },
      { label: 'Sheet: Letter', action: () => onSettingsChange({ ...settings, sheetSize: 'letter' }), checked: settings.sheetSize === 'letter' },
      { label: 'Sheet: Legal', action: () => onSettingsChange({ ...settings, sheetSize: 'legal' }), checked: settings.sheetSize === 'legal' },
    ],
    Windows: [
      { label: 'Toolbox', action: onToggleToolbox, checked: showToolbox },
      { label: 'Bottom Panels', action: onToggleBottomPanels, checked: showBottomPanels },
      SEP,
      {
        label: 'Reset Layout',
        action: () => {
          if (!showToolbox) onToggleToolbox();
          if (!showBottomPanels) onToggleBottomPanels();
        },
      },
    ],
    Help: [
      { label: 'Keyboard Shortcuts', action: () => openDialog('shortcuts'), shortcut: '?' },
      SEP,
      { label: 'About DXFify', action: () => openDialog('about') },
    ],
  };

  
  return (
    <>
      <header className="top-bar">
        <div className="menu-row" ref={menuBarRef} role="menubar">
          {menuOrder.map((name) => (
            <div
              key={name}
              className={`menu-item${openMenu === name ? ' open' : ''}`}
              onClick={() => click(name)}
              onMouseEnter={() => hover(name)}
              tabIndex={0}
              role="button"
              aria-haspopup="true"
              aria-expanded={openMenu === name}
              aria-label={`${name} menu`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  click(name);
                }
              }}
            >
              {name}
              {openMenu === name && (
                <div className="menu-dropdown" role="menu" aria-label={`${name} submenu`}>
                  {menus[name].map((item, i) =>
                    item.type === 'separator' ? (
                      <div key={i} className="menu-sep" role="separator" />
                    ) : (
                      <button
                        key={i}
                        className="menu-dd-item"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={(e) => { e.stopPropagation(); run(item); }}
                      >
                        <span className="dd-check">{item.checked ? '✓' : ''}</span>
                        <span className="dd-label">{item.label}</span>
                        {item.shortcut && <span className="dd-shortcut">{item.shortcut}</span>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}

          <span className={`menu-status status-${statusClass}`}>{status}</span>
        </div>
      </header>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Upload photo for conversion"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.currentTarget.value = '';
        }}
      />

      {/* Dialogs */}
      {dialog && (
        <div className="dialog-overlay" onClick={() => setDialog(null)} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            {dialog === 'about' ? (
              <>
                <h3 id="dialog-title">DXFify</h3>
                <p>Image → DXF conversion tool with ArUco marker calibration.</p>
                <p className="dialog-muted">
                  Upload a photo of a part placed on a calibrated ArUco sheet, and DXFify
                  converts it into a dimensionally-accurate DXF file ready for laser
                  cutting or CNC machining.
                </p>
                <button onClick={() => setDialog(null)}>Close</button>
              </>
            ) : (
              <>
                <h3>Keyboard Shortcuts</h3>
                <div className="shortcut-grid">
                  <div className="sc-section">File</div>
                  <div className="sc-row"><span>Ctrl+O</span><span>Upload Image</span></div>
                  <div className="sc-row"><span>Ctrl+Enter</span><span>Run Conversion</span></div>
                  <div className="sc-row"><span>Ctrl+S</span><span>Download DXF</span></div>

                  <div className="sc-section">Edit</div>
                  <div className="sc-row"><span>Ctrl+Z</span><span>Undo</span></div>
                  <div className="sc-row"><span>Ctrl+Shift+Z</span><span>Redo</span></div>

                  <div className="sc-section">View</div>
                  <div className="sc-row"><span>Ctrl+=</span><span>Zoom In</span></div>
                  <div className="sc-row"><span>Ctrl+−</span><span>Zoom Out</span></div>
                  <div className="sc-row"><span>Ctrl+0</span><span>Fit to View</span></div>
                  <div className="sc-row"><span>G</span><span>Toggle Grid</span></div>

                  <div className="sc-section">Image Tabs</div>
                  <div className="sc-row"><span>1</span><span>Original</span></div>
                  <div className="sc-row"><span>2</span><span>Debug Overlay</span></div>
                  <div className="sc-row"><span>3</span><span>Mask</span></div>
                  <div className="sc-row"><span>4</span><span>Holes</span></div>

                  <div className="sc-section">Select</div>
                  <div className="sc-row"><span>V</span><span>Pan / Inspect</span></div>
                  <div className="sc-row"><span>N</span><span>Snap</span></div>

                  <div className="sc-section">Tools</div>
                  <div className="sc-row"><span>L</span><span>Line</span></div>
                  <div className="sc-row"><span>A</span><span>Arc / Curve</span></div>
                  <div className="sc-row"><span>P</span><span>Polyline</span></div>
                  <div className="sc-row"><span>.</span><span>Add Point</span></div>
                  <div className="sc-row"><span>X</span><span>Delete</span></div>
                  <div className="sc-row"><span>H</span><span>Mark Hole</span></div>
                </div>
                <button onClick={() => setDialog(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
