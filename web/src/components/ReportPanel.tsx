import type { ConversionReport } from '../types';

interface ReportPanelProps {
  report: ConversionReport | null;
  error: string | null;
}

function formatNumber(value: number | undefined, digits = 4) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

export function ReportPanel({ report, error }: ReportPanelProps) {
  const warnings: string[] = [];
  const markers = report?.markersDetected;
  const reprojectionError = report?.reprojectionErrorPx;
  const holes = report?.holeContours;

  if (typeof markers === 'number' && markers < 4) {
    warnings.push(`Only ${markers}/4 ArUco markers detected. Recapture recommended.`);
  }
  if (typeof reprojectionError === 'number' && reprojectionError > 1) {
    warnings.push('Calibration error is high.');
  }
  if (typeof holes === 'number' && holes === 0) {
    warnings.push('No holes detected. Check the debug overlay if holes were expected.');
  }

  return (
    <section className="panel report-panel">
      <div className="panel-header">
        <div>
          <h2>Conversion Report</h2>
          <p>Calibration and contour summary</p>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {report ? (
        <>
          <dl className="report-grid">
            <div><dt>Markers</dt><dd>{report.markersDetected ?? '—'}/4</dd></div>
            <div><dt>Pixels/mm</dt><dd>{formatNumber(report.pixelsPerMm)}</dd></div>
            <div><dt>Reprojection</dt><dd>{formatNumber(report.reprojectionErrorPx)} px</dd></div>
            <div><dt>Outer contours</dt><dd>{report.outerContours ?? '—'}</dd></div>
            <div><dt>Hole contours</dt><dd>{report.holeContours ?? '—'}</dd></div>
            <div><dt>Width</dt><dd>{formatNumber(report.bboxWidthMm, 2)} mm</dd></div>
            <div><dt>Height</dt><dd>{formatNumber(report.bboxHeightMm, 2)} mm</dd></div>
            <div><dt>Perimeter</dt><dd>{formatNumber(report.perimeterMm, 2)} mm</dd></div>
          </dl>

          {warnings.length > 0 ? (
            <div className="warning-list">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : (
            <p className="clean-run">No report warnings.</p>
          )}
        </>
      ) : (
        <div className="empty-state compact">
          <strong>No report yet</strong>
          <span>Conversion metrics appear here after a run.</span>
        </div>
      )}
    </section>
  );
}
