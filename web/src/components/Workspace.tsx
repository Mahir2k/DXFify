import { useState } from 'react';
import type {
  ConversionErrorDetails,
  ConversionResult,
  ConversionSettings,
  PreviewTab,
  ToolId,
  Viewport,
  GeometryEntity,
} from '../types';
import { ArtifactList } from './ArtifactList';
import { DxfPreview } from './DxfPreview';
import { ImagePreview } from './ImagePreview';
import { ReportPanel } from './ReportPanel';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';

interface WorkspaceProps {
  result: ConversionResult | null;
  reportError: ConversionErrorDetails | null;
  originalImageUrl: string | null;
  uploadedFilename: string | null;
  selectedPreviewTab: PreviewTab;
  selectedTool: ToolId;
  settings: ConversionSettings;
  gridEnabled: boolean;
  showToolbox: boolean;
  showBottomPanels: boolean;
  viewport: Viewport | null;
  onViewportChange: (vp: Viewport) => void;
  onImgNaturalSizeChange: (size: { width: number; height: number }) => void;
  onFitToView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUpload: (file: File) => void;
  onPreviewTabChange: (tab: PreviewTab) => void;
  onToolChange: (tool: ToolId) => void;
  onSettingsChange: (settings: ConversionSettings) => void;
  onToggleGrid: () => void;
  entities: GeometryEntity[];
  onEntitiesChange: (entities: GeometryEntity[], commit?: boolean) => void;
  brushShape?: 'circle' | 'square';
  brushRadius?: number;
  onBrushShapeChange?: (shape: 'circle' | 'square') => void;
  onBrushRadiusChange?: (radius: number) => void;
}

export function Workspace({
  result,
  reportError,
  originalImageUrl,
  uploadedFilename,
  selectedPreviewTab,
  selectedTool,
  settings,
  gridEnabled,
  showToolbox,
  showBottomPanels,
  viewport,
  onViewportChange,
  onImgNaturalSizeChange,
  onFitToView,
  onZoomIn,
  onZoomOut,
  onUpload,
  onPreviewTabChange,
  onToolChange,
  onSettingsChange,
  onToggleGrid,
  entities,
  onEntitiesChange,
  brushShape,
  brushRadius,
  onBrushShapeChange,
  onBrushRadiusChange,
}: WorkspaceProps) {
  
  const [toolboxWidth, setToolboxWidth] = useState(72);
  const [bottomHeight, setBottomHeight] = useState(176);

  
  const [isResizingTools, setIsResizingTools] = useState(false);
  const [isResizingBottom, setIsResizingBottom] = useState(false);

  const handleToolsResizeStart = (e: React.PointerEvent) => {
    setIsResizingTools(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleToolsResizeMove = (e: React.PointerEvent) => {
    if (!isResizingTools) return;
    const grid = document.querySelector('.workspace-grid');
    if (grid) {
      const rect = grid.getBoundingClientRect();
      const newWidth = Math.max(50, Math.min(250, e.clientX - rect.left));
      setToolboxWidth(newWidth);
    }
  };

  const handleToolsResizeEnd = (e: React.PointerEvent) => {
    setIsResizingTools(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleBottomResizeStart = (e: React.PointerEvent) => {
    setIsResizingBottom(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleBottomResizeMove = (e: React.PointerEvent) => {
    if (!isResizingBottom) return;
    const grid = document.querySelector('.workspace-grid');
    if (grid) {
      const rect = grid.getBoundingClientRect();
      const newHeight = Math.max(80, Math.min(rect.height - 150, rect.bottom - e.clientY));
      setBottomHeight(newHeight);
    }
  };

  const handleBottomResizeEnd = (e: React.PointerEvent) => {
    setIsResizingBottom(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const gridClass = [
    'workspace-grid',
    !showToolbox && 'no-toolbox',
    !showBottomPanels && 'no-bottom',
  ].filter(Boolean).join(' ');

  
  const gridStyle = {
    gridTemplateColumns: showToolbox ? `${toolboxWidth}px minmax(0, 1fr)` : 'minmax(0, 1fr)',
    gridTemplateRows: showBottomPanels ? `minmax(0, 1fr) ${bottomHeight}px` : 'minmax(0, 1fr)',
  };

  return (
    <section
      className={gridClass}
      style={gridStyle}
      onPointerMove={(e) => {
        handleToolsResizeMove(e);
        handleBottomResizeMove(e);
      }}
      onPointerUp={(e) => {
        handleToolsResizeEnd(e);
        handleBottomResizeEnd(e);
      }}
    >
      {showToolbox && (
        <Toolbar
          selectedTool={selectedTool}
          onSelectTool={onToolChange}
          brushShape={brushShape}
          brushRadius={brushRadius}
          onBrushShapeChange={onBrushShapeChange}
          onResizeStart={handleToolsResizeStart}
          isResizing={isResizingTools}
        />
      )}

      <div className="preview-row">
        <DxfPreview
          result={result}
          selectedTool={selectedTool}
          gridEnabled={gridEnabled}
          onToggleGrid={onToggleGrid}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onFitToView={onFitToView}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          entities={entities}
          onEntitiesChange={onEntitiesChange}
          brushShape={brushShape}
          brushRadius={brushRadius}
          onBrushRadiusChange={onBrushRadiusChange}
        />
        <ImagePreview
          result={result}
          originalImageUrl={originalImageUrl}
          uploadedFilename={uploadedFilename}
          selectedTab={selectedPreviewTab}
          onUpload={onUpload}
          onTabChange={onPreviewTabChange}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onImgNaturalSizeChange={onImgNaturalSizeChange}
          entities={entities}
        />
      </div>

      {showBottomPanels && (
        <div className="bottom-row">
          <div
            className={`resize-handle-y ${isResizingBottom ? 'active' : ''}`}
            onPointerDown={handleBottomResizeStart}
          />
          <ReportPanel result={result} error={reportError} />
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
          <ArtifactList result={result} />
        </div>
      )}
    </section>
  );
}
