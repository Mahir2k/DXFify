/**
 * Utility helper to save files both in Desktop environment (via /api/save-file)
 * and in standard web browsers via fallback download links.
 */

export async function saveFileToDisk(
  filename: string,
  content: string | Blob,
  isBase64: boolean = false
): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> {
  try {
    let payloadContent = '';
    let payloadBase64 = isBase64;

    if (content instanceof Blob) {
      payloadBase64 = true;
      payloadContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const resultStr = reader.result as string;
          const base64 = resultStr.substring(resultStr.indexOf(',') + 1);
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(content);
      });
    } else {
      payloadContent = content;
    }

    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        content: payloadContent,
        isBase64: payloadBase64,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.cancelled) {
        return { success: false, cancelled: true, message: 'Save operation cancelled.' };
      }
      if (data.success) {
        return { success: true, path: data.path, message: `Saved to ${data.path}` };
      }
    }
  } catch (err) {
    console.warn('Backend save-file endpoint unavailable, falling back to browser save picker', err);
  }

  // Native Browser Save File Picker fallback using File System Access API
  if ('showSaveFilePicker' in window) {
    try {
      const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
      const mimeType = ext === '.dxf' ? 'application/dxf' : ext === '.svg' ? 'image/svg+xml' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: ext === '.dxf' ? 'DXF Drawing' : ext === '.svg' ? 'SVG Vector Graphic' : ext === '.pdf' ? 'PDF Document' : 'File',
            accept: { [mimeType]: [ext] },
          },
        ],
      });
      const writable = await handle.createWritable();
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      await writable.write(blob);
      await writable.close();
      return { success: true, message: `Saved ${filename}` };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, cancelled: true, message: 'Save operation cancelled.' };
      }
    }
  }

  // Standard legacy browser download link fallback
  try {
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true, message: `Downloaded ${filename}` };
  } catch (e) {
    return { success: false, message: 'Download failed' };
  }
}

export async function saveUrlToDisk(
  url: string,
  filename: string
): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    return await saveFileToDisk(filename, blob, true);
  } catch (err) {
    console.error('Failed to fetch URL for saving:', err);
    return { success: false, message: 'Failed to download file' };
  }
}
