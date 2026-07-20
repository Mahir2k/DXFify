import type { ToolId } from '../types';

interface ToolbarProps {
  selectedTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  brushShape?: 'circle' | 'square';
  brushRadius?: number;
  onBrushShapeChange?: (shape: 'circle' | 'square') => void;
  onResizeStart?: React.PointerEventHandler;
  isResizing?: boolean;
}

const toolMeta: Record<ToolId, { label: string; glyph: string }> = {
  select: { label: 'Pan / Inspect', glyph: '↖' },
  snap: { label: 'Snap', glyph: '⌖' },
  measure: { label: 'Measure Distance', glyph: '📏' },
  brush: { label: 'Proportional Brush', glyph: '🖌' },
  line: { label: 'Line', glyph: '╱' },
  arc: { label: 'Arc / Curve', glyph: '⌒' },
  polyline: { label: 'Polyline', glyph: '⌁' },
  'add-point': { label: 'Add Point', glyph: '+' },
  delete: { label: 'Delete Element', glyph: '⌫' },
  'delete-point': { label: 'Delete Point', glyph: '−' },
  'mark-hole': { label: 'Mark Hole', glyph: '○' },
  undo: { label: 'Undo', glyph: '↶' },
  redo: { label: 'Redo', glyph: '↷' },
};


const toolGroups: ToolId[][] = [
  ['select', 'snap', 'measure', 'brush'],
  ['line', 'arc', 'polyline', 'add-point'],
  ['delete', 'delete-point', 'mark-hole'],
  ['undo', 'redo'],
];

export function Toolbar({
  selectedTool,
  onSelectTool,
  brushShape = 'circle',
  brushRadius = 15,
  onBrushShapeChange,
  onResizeStart,
  isResizing = false,
}: ToolbarProps) {
  const selectedLabel = toolMeta[selectedTool]?.label ?? selectedTool;

  return (
    <aside className="tool-strip" aria-label="DXF edit tools">
      <div className="tool-groups">
        {toolGroups.map((group, groupIndex) => (
          <div className="tool-group" key={groupIndex}>
            {group.map((toolId) => {
              const tool = toolMeta[toolId];
              return (
                <button
                  key={toolId}
                  className={selectedTool === toolId ? 'active' : ''}
                  title={tool.label}
                  aria-label={tool.label}
                  aria-pressed={selectedTool === toolId}
                  onClick={() => {
                    onSelectTool(toolId);
                  }}
                >
                  {tool.glyph}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="tool-options">
        <span className="tool-options-label">Tool Options</span>
        <span className="tool-options-value">{selectedLabel}</span>
        
        {selectedTool === 'brush' && (
          <div className="brush-settings" style={{ marginTop: '8px', display: 'flex', gap: '4px', flexDirection: 'column' }}>
            <span style={{ fontSize: '10px', opacity: 0.8 }}>Shape:</span>
            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
              <button
                className={brushShape === 'circle' ? 'active-option' : ''}
                onClick={() => onBrushShapeChange?.('circle')}
                style={{ width: '25px', height: '22px', fontSize: '12px', padding: 0 }}
                title="Circular Ball Brush"
              >
                ●
              </button>
              <button
                className={brushShape === 'square' ? 'active-option' : ''}
                onClick={() => onBrushShapeChange?.('square')}
                style={{ width: '25px', height: '22px', fontSize: '10px', padding: 0 }}
                title="Square Cube Brush"
              >
                ■
              </button>
            </div>
            <span style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>
              Radius: {brushRadius}mm
            </span>
            <span style={{ fontSize: '9px', opacity: 0.5 }}>
              (Shift+Scroll to resize)
            </span>
          </div>
        )}
      </div>

      {onResizeStart && (
        <div
          className={`resize-handle-x ${isResizing ? 'active' : ''}`}
          onPointerDown={onResizeStart}
        />
      )}
    </aside>
  );
}
