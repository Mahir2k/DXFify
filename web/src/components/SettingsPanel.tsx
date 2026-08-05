import type { ConversionSettings } from '../types';

interface SettingsPanelProps {
  settings: ConversionSettings;
  onChange: (settings: ConversionSettings) => void;
}


interface ParamDef {
  key: keyof ConversionSettings;
  label: string;
  placeholder: string;
  min: number;
  max: number;
  step: number;
}

const SEGMENTATION_PARAMS: ParamDef[] = [
  { key: 'maskThreshold',    label: 'Mask threshold',      placeholder: '240', min: 1,   max: 255,  step: 1   },
  { key: 'erosionKernel',    label: 'Erosion kernel',       placeholder: '3',   min: 1,   max: 9,    step: 2   },
  { key: 'erosionIterations', label: 'Erosion iterations',  placeholder: '1',   min: 0,   max: 5,    step: 1   },
];

const CONTOUR_PARAMS: ParamDef[] = [
  { key: 'minHoleArea',  label: 'Min hole area (px²)',   placeholder: '500',  min: 0,    max: 5000, step: 10  },
  { key: 'minOuterArea', label: 'Min outer area (px²)',  placeholder: '100',  min: 0,    max: 5000, step: 10  },
  { key: 'circleRatio',  label: 'Circle det. ratio',     placeholder: '0.85', min: 0.5,  max: 1.0,  step: 0.01 },
];

const VECTORIZATION_PARAMS: ParamDef[] = [
  { key: 'epsilonMin',    label: 'Epsilon min',          placeholder: '0.5',  min: 0.1,  max: 5.0,  step: 0.1  },
  { key: 'epsilonMax',    label: 'Epsilon max',          placeholder: '2.5',  min: 0.5,  max: 10.0, step: 0.1  },
  { key: 'snapAngle',     label: 'Snap angle (°)',       placeholder: '10',   min: 1,    max: 45,   step: 1    },
  { key: 'snapMinLength', label: 'Snap min length (px)', placeholder: '20',   min: 1,    max: 100,  step: 1    },
];

const ARUCO_PARAMS: ParamDef[] = [
  { key: 'markerOffsetX',    label: 'Marker offset X (mm)',   placeholder: '32.2', min: 0, max: 100, step: 0.1 },
  { key: 'markerOffsetY',    label: 'Marker offset Y (mm)',   placeholder: '34.2', min: 0, max: 100, step: 0.1 },
  { key: 'markerClearRadius', label: 'Marker clear radius (mm)', placeholder: '22', min: 0, max: 60,  step: 0.5 },
];

const DETAILS_PARAMS: ParamDef[] = [
  { key: 'detailsThreshold1', label: 'Sensitivity threshold 1', placeholder: '50',  min: 1, max: 255, step: 1 },
  { key: 'detailsThreshold2', label: 'Sensitivity threshold 2', placeholder: '150', min: 1, max: 255, step: 1 },
];

function ParamGroup({ title, params, settings, onUpdate }: {
  title: string;
  params: ParamDef[];
  settings: ConversionSettings;
  onUpdate: <K extends keyof ConversionSettings>(key: K, value: ConversionSettings[K]) => void;
}) {
  return (
    <details className="settings-section">
      <summary>{title}</summary>
      <div className="settings-grid">
        {params.map((p) => (
          <label key={p.key}>
            <span>{p.label}</span>
            <input
              type="number"
              min={p.min}
              max={p.max}
              step={p.step}
              placeholder={p.placeholder}
              value={(settings[p.key] as number | undefined) ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                onUpdate(
                  p.key,
                  raw === '' ? undefined : Number(raw),
                );
              }}
            />
          </label>
        ))}
      </div>
    </details>
  );
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const update = <K extends keyof ConversionSettings>(key: K, value: ConversionSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const hasCustomParams = Object.keys(settings).some(
    (k) => k !== 'sheetSize' && k !== 'curveStrategy' && settings[k as keyof ConversionSettings] !== undefined,
  );

  const resetParams = () => {
    onChange({ sheetSize: settings.sheetSize, curveStrategy: 'current' });
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
            <option value="a5">A5</option>
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="a2">A2</option>
            <option value="a1">A1</option>
            <option value="letter">Letter</option>
            <option value="legal">Legal</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {settings.sheetSize === 'custom' && (
          <div style={{ display: 'flex', gap: '8px', gridColumn: '1 / -1' }}>
            <label style={{ flex: 1 }}>
              <span>Width (mm)</span>
              <input
                type="number"
                value={settings.customWidthMm ?? 210}
                onChange={(e) => update('customWidthMm', parseFloat(e.target.value) || 100)}
              />
            </label>
            <label style={{ flex: 1 }}>
              <span>Height (mm)</span>
              <input
                type="number"
                value={settings.customHeightMm ?? 297}
                onChange={(e) => update('customHeightMm', parseFloat(e.target.value) || 100)}
              />
            </label>
          </div>
        )}

        <label>
          <span>Curve Strategy</span>
          <select
            value={settings.curveStrategy ?? 'current'}
            onChange={(event) => update('curveStrategy', event.target.value as ConversionSettings['curveStrategy'])}
          >
            <option value="current">Current (Douglas-Peucker)</option>
            <option value="pratt">Strategy 1 (Pratt Corner Fillets)</option>
            <option value="spline">Strategy 2 (Cubic B-Splines)</option>
            <option value="gaussian">Strategy 3 (Gaussian Filter + DP)</option>
            <option value="ransac">Strategy 4 (RANSAC CAD Fillets)</option>
          </select>
        </label>
      </div>

      <ParamGroup title="Segmentation" params={SEGMENTATION_PARAMS} settings={settings} onUpdate={update} />
      <ParamGroup title="Contour Filtering" params={CONTOUR_PARAMS} settings={settings} onUpdate={update} />
      <ParamGroup title="Vectorization" params={VECTORIZATION_PARAMS} settings={settings} onUpdate={update} />
      <ParamGroup title="ArUco Calibration" params={ARUCO_PARAMS} settings={settings} onUpdate={update} />

      <details className="settings-section">
        <summary style={{ display: 'flex', justifyContent: 'space-between', width: '100%', paddingRight: '8px' }}>
          <span>Detail Engraving</span>
          <input
            type="checkbox"
            checked={settings.detectDetails ?? false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => update('detectDetails', e.target.checked)}
          />
        </summary>
        {settings.detectDetails && (
          <div className="settings-grid">
            {DETAILS_PARAMS.map((p) => (
              <label key={p.key}>
                <span>{p.label}</span>
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  placeholder={p.placeholder}
                  value={(settings[p.key] as number | undefined) ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    update(
                      p.key,
                      raw === '' ? undefined : Number(raw),
                    );
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </details>

      {hasCustomParams && (
        <button className="reset-params-btn" onClick={resetParams}>
          Reset to Defaults
        </button>
      )}
    </details>
  );
}
