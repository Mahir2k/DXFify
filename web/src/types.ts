export type StatusMessage =
  | 'Waiting for upload'
  | 'Ready to convert'
  | 'Converting...'
  | 'Conversion successful'
  | 'Conversion failed'
  | 'Bad calibration, recapture recommended';

export type PreviewTab = 'original' | 'debug' | 'mask' | 'holes';

export type ToolId =
  | 'select'
  | 'line'
  | 'arc'
  | 'polyline'
  | 'add-point'
  | 'delete'
  | 'snap'
  | 'mark-hole'
  | 'undo'
  | 'redo';

export interface ConversionSettings {
  sheetSize: 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
}

export interface ConversionReport {
  success?: boolean;
  markersDetected?: number;
  pixelsPerMm?: number;
  reprojectionErrorPx?: number;
  outerContours?: number;
  holeContours?: number;
  bboxWidthMm?: number;
  bboxHeightMm?: number;
  perimeterMm?: number;
}

export interface ConversionFiles {
  dxf: string;
  debug: string;
  report: string;
  original?: string;
  preview?: string;
  [key: string]: string | undefined;
}

export interface ConversionResult {
  success: boolean;
  jobId: string;
  report: ConversionReport;
  files: ConversionFiles;
}

export interface ConversionErrorDetails {
  message: string;
  detail?: string;
  code?: number | null;
  command?: string;
  stdout?: string;
  stderr?: string;
}
