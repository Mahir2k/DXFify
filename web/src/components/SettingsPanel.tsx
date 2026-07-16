import type { ConversionSettings } from '../types';

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
      </div>
    </details>
  );
}
