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
  | 'redo'
  | 'measure'
  | 'brush'
  | 'delete-point';

export interface ConversionSettings {
  sheetSize: 'a4' | 'a3' | 'a2' | 'a1' | 'a5' | 'letter' | 'legal';
  
  maskThreshold?: number;       
  erosionKernel?: number;       
  erosionIterations?: number;   
  
  minHoleArea?: number;         
  minOuterArea?: number;        
  circleRatio?: number;         
  
  epsilonMin?: number;          
  epsilonMax?: number;          
  snapAngle?: number;           
  snapMinLength?: number;       
  
  markerOffsetX?: number;       
  markerOffsetY?: number;       
  markerClearRadius?: number;   
}

export interface GeometryEntity {
  type: 'circle' | 'polyline';
  layer: 'OUTER' | 'HOLES';
  cx?: number;
  cy?: number;
  r?: number;
  points?: [number, number][];
  closed?: boolean;
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
  bboxMinXMm?: number;
  bboxMaxYMm?: number;
  perimeterMm?: number;
  entities?: GeometryEntity[];
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

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

