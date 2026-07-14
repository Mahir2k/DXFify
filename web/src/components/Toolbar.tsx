import type { ToolId } from '../types';

interface ToolbarProps {
  selectedTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
}

const tools: Array<{ id: ToolId; label: string; glyph: string }> = [
  { id: 'select', label: 'Select / Move', glyph: '↖' },
  { id: 'line', label: 'Line', glyph: '╱' },
  { id: 'arc', label: 'Arc / Curve', glyph: '⌒' },
  { id: 'polyline', label: 'Polyline', glyph: '⌁' },
  { id: 'add-point', label: 'Add Point', glyph: '+' },
  { id: 'delete', label: 'Delete', glyph: '⌫' },
  { id: 'snap', label: 'Snap', glyph: '⌖' },
  { id: 'mark-hole', label: 'Mark Hole', glyph: '○' },
  { id: 'undo', label: 'Undo', glyph: '↶' },
  { id: 'redo', label: 'Redo', glyph: '↷' },
];

export function Toolbar({ selectedTool, onSelectTool }: ToolbarProps) {
  return (
    <aside className="tool-strip" aria-label="DXF edit tools">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={selectedTool === tool.id ? 'active' : ''}
          title={tool.label}
          aria-label={tool.label}
          onClick={() => {
            // TODO: connect selected tools to parsed DXF geometry editing.
            onSelectTool(tool.id);
          }}
        >
          {tool.glyph}
        </button>
      ))}
    </aside>
  );
}
