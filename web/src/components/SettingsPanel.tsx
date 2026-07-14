import type { ConversionSettings, SegmentationMethod, SimplificationStrength } from '../types';

interface SettingsPanelProps {
  settings: ConversionSettings;
  onChange: (settings: ConversionSettings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const update = <K extends keyof ConversionSettings>(key: K, value: ConversionSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <details className="panel settings-panel" open>
      <summary>Conversion Settings</summary>
      <div className="settings-grid">
        <label>
          <span>Segmentation</span>
          <select
            value={settings.segmentationMethod}
            onChange={(event) => update('segmentationMethod', event.target.value as SegmentationMethod)}
          >
            <option value="gradient">gradient</option>
            <option value="otsu">otsu</option>
            <option value="sat">sat</option>
            <option value="adaptive">adaptive</option>
          </select>
        </label>

        <label>
          <span>Pixels / mm</span>
          <input
            type="number"
            min="1"
            step="0.25"
            value={settings.pixelsPerMm}
            onChange={(event) => update('pixelsPerMm', Number(event.target.value))}
          />
        </label>

        <label>
          <span>Marker size mm</span>
          <input
            type="number"
            min="1"
            step="0.5"
            value={settings.markerSize}
            onChange={(event) => update('markerSize', Number(event.target.value))}
          />
        </label>

        <label>
          <span>Sheet size</span>
          <select
            value={settings.sheetSize}
            onChange={(event) => update('sheetSize', event.target.value as ConversionSettings['sheetSize'])}
          >
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="a5">A5</option>
            <option value="letter">Letter</option>
            <option value="legal">Legal</option>
          </select>
        </label>

        <label>
          <span>Simplification</span>
          <select
            value={settings.simplificationStrength}
            onChange={(event) => update('simplificationStrength', event.target.value as SimplificationStrength)}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        <label>
          <span>Hole sensitivity</span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.holeSensitivity}
            onChange={(event) => update('holeSensitivity', Number(event.target.value))}
          />
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.fitArcs}
            onChange={(event) => update('fitArcs', event.target.checked)}
          />
          <span>Fit arcs</span>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.snapRightAngles}
            onChange={(event) => update('snapRightAngles', event.target.checked)}
          />
          <span>Snap right angles</span>
        </label>
      </div>
    </details>
  );
}
