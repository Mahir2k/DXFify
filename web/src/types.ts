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

export type SegmentationMethod = 'gradient' | 'otsu' | 'sat' | 'adaptive';

export type SimplificationStrength = 'low' | 'medium' | 'high';

export interface ConversionSettings {
  segmentationMethod: SegmentationMethod;
  pixelsPerMm: number;
  markerSize: number;
  sheetSize: 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
  fitArcs: boolean;
  snapRightAngles: boolean;
  simplificationStrength: SimplificationStrength;
  holeSensitivity: number;
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
}

export interface ConversionResult {
  success: boolean;
  jobId: string;
  report: ConversionReport;
  files: ConversionFiles;
}
