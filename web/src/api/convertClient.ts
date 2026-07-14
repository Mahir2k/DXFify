import type { ConversionResult, ConversionSettings } from '../types';

export async function runConversion(
  image: File,
  settings: ConversionSettings,
): Promise<ConversionResult> {
  const body = new FormData();
  body.append('image', image);
  body.append('segmentationMethod', settings.segmentationMethod);
  body.append('pixelsPerMm', String(settings.pixelsPerMm));
  body.append('markerSize', String(settings.markerSize));
  body.append('sheetSize', settings.sheetSize);
  body.append('fitArcs', String(settings.fitArcs));
  body.append('snapRightAngles', String(settings.snapRightAngles));
  body.append('simplificationStrength', settings.simplificationStrength);
  body.append('holeSensitivity', String(settings.holeSensitivity));

  const response = await fetch('/api/convert', {
    method: 'POST',
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message ?? 'Conversion failed.';
    throw new Error(message);
  }

  return payload as ConversionResult;
}
