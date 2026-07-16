import type { ConversionErrorDetails, ConversionResult, ConversionSettings } from '../types';

interface ErrorPayload {
  message?: string;
  detail?: string;
  dxfer?: {
    code?: number | null;
    command?: string;
    stdout?: string;
    stderr?: string;
  };
}

export class ConversionApiError extends Error {
  details: ConversionErrorDetails;

  constructor(details: ConversionErrorDetails) {
    super(details.message);
    this.name = 'ConversionApiError';
    this.details = details;
  }
}

export async function runConversion(
  image: File,
  settings: ConversionSettings,
): Promise<ConversionResult> {
  const body = new FormData();
  body.append('image', image);
  body.append('sheetSize', settings.sheetSize);

  let response: Response;
  try {
    response = await fetch('/api/convert', {
      method: 'POST',
      body,
    });
  } catch (error) {
    throw new ConversionApiError({
      message: 'Backend not running or unreachable.',
      detail: error instanceof Error ? error.message : 'Could not reach /api/convert.',
    });
  }

  const payload = await response.json().catch(() => null) as ErrorPayload | ConversionResult | null;
  if (!response.ok) {
    const errorPayload = payload as ErrorPayload | null;
    throw new ConversionApiError({
      message: errorPayload?.message ?? 'Conversion failed.',
      detail: errorPayload?.detail,
      code: errorPayload?.dxfer?.code,
      command: errorPayload?.dxfer?.command,
      stdout: errorPayload?.dxfer?.stdout,
      stderr: errorPayload?.dxfer?.stderr,
    });
  }

  return payload as ConversionResult;
}
