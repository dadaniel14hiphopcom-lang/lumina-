import { MediaAsset } from '../types';

export function isVideoAsset(media?: Partial<MediaAsset> | null): boolean {
  if (!media?.url) return false;
  if (media.mediaType === 'video') return true;
  if (media.url.startsWith('data:video/')) return true;
  if (/\.(mp4|webm|mov|m4v|ogg|ogv|3gp|3g2|mkv|mpg)(\?|#|$)/i.test(media.url)) return true;
  return false;
}

export interface MediaStatusInfo {
  uploadAvailable: boolean;
  storageProvider: 'aws-s3' | 'server-disk';
  awsCredentialsConfigured: boolean;
  s3Enabled: boolean;
  cloudFrontActive: boolean;
  region: string;
  bucket: string;
  maxVideoSizeMB?: number;
}

export interface MediaUploadResult {
  url: string;
  storageProvider: 'aws-cloudfront' | 'aws-s3' | 'server-disk';
  fallbackNeeded: false;
}

export interface MediaUploadFallback {
  fallbackNeeded: true;
}

function inferMediaMimeType(blob: Blob, fileName?: string): string {
  const raw = (blob.type || '').split(';')[0].trim().toLowerCase();
  if (
    raw &&
    raw !== 'application/octet-stream' &&
    raw !== 'binary/octet-stream'
  ) {
    return raw;
  }
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'ogg' || ext === 'ogv') return 'video/ogg';
  if (ext === '3gp') return 'video/3gpp';
  if (ext === '3g2') return 'video/3gpp2';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mpg' || ext === 'mpeg') return 'video/mpeg';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'video/mp4';
}

function isStaticSpaFallbackResponse(res: Response): boolean {
  if (
    res.status === 404 ||
    res.status === 405 ||
    res.status === 501 ||
    res.status === 502 ||
    res.status === 503
  ) {
    return true;
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (res.ok && ct && !ct.includes('application/json')) {
    return true;
  }
  return false;
}

export async function fetchMediaDeliveryStatus(): Promise<MediaStatusInfo | null> {
  try {
    const res = await fetch('/api/media/status');
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) return null;
    const data = (await res.json()) as MediaStatusInfo;
    return data && typeof data.uploadAvailable === 'boolean' ? data : null;
  } catch {
    return null;
  }
}

async function uploadMediaChunked(
  blob: Blob,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<MediaUploadResult | MediaUploadFallback> {
  let initRes: Response;
  try {
    initRes = await fetch('/api/media/upload-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, sizeBytes: blob.size }),
    });
  } catch {
    return { fallbackNeeded: true };
  }

  if (isStaticSpaFallbackResponse(initRes)) {
    return { fallbackNeeded: true };
  }

  const initData = (await initRes.json().catch(() => ({}))) as {
    ok?: boolean;
    uploadId?: string;
    chunkSizeBytes?: number;
    error?: string;
  };
  if (!initRes.ok || !initData.ok || !initData.uploadId) {
    throw new Error(
      initData.error ||
        `Não foi possível iniciar o envio do vídeo (HTTP ${initRes.status}).`
    );
  }

  const chunkSize = Math.max(512 * 1024, initData.chunkSizeBytes || 3 * 1024 * 1024);
  const totalChunks = Math.max(1, Math.ceil(blob.size / chunkSize));

  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(blob.size, start + chunkSize);
    const slice = blob.slice(start, end);

    const chunkRes = await fetch('/api/media/upload-chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-upload-id': initData.uploadId,
        'x-chunk-index': String(index),
      },
      body: slice,
    });

    const chunkData = (await chunkRes.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!chunkRes.ok || !chunkData.ok) {
      throw new Error(
        chunkData.error ||
          `Falha ao enviar parte ${index + 1}/${totalChunks} do vídeo (HTTP ${chunkRes.status}).`
      );
    }

    onProgress?.(Math.min(95, Math.round(((index + 1) / totalChunks) * 90)));
  }

  const completeRes = await fetch('/api/media/upload-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: initData.uploadId }),
  });

  const completeData = (await completeRes.json().catch(() => ({}))) as {
    ok?: boolean;
    url?: string;
    storageProvider?: 'aws-cloudfront' | 'aws-s3' | 'server-disk';
    error?: string;
  };
  if (!completeRes.ok || !completeData.ok || !completeData.url) {
    throw new Error(
      completeData.error ||
        `Não foi possível concluir o armazenamento do vídeo (HTTP ${completeRes.status}).`
    );
  }

  onProgress?.(100);
  return {
    url: completeData.url,
    storageProvider: completeData.storageProvider || 'server-disk',
    fallbackNeeded: false,
  };
}

export async function uploadMediaToCloud(
  blob: Blob,
  fileName?: string,
  onProgress?: (percent: number) => void
): Promise<MediaUploadResult | MediaUploadFallback> {
  const contentType = inferMediaMimeType(blob, fileName);

  // Videos/files larger than 2.5 MB use chunked upload to avoid reverse-proxy payload caps
  if (blob.size > 2_500_000) {
    return uploadMediaChunked(blob, contentType, onProgress);
  }

  let res: Response;
  try {
    res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      body: blob,
    });
  } catch {
    return { fallbackNeeded: true };
  }

  if (isStaticSpaFallbackResponse(res)) {
    return { fallbackNeeded: true };
  }

  if (res.status === 413) {
    const errJson = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!errJson?.error) {
      return uploadMediaChunked(blob, contentType, onProgress);
    }
    throw new Error(errJson.error);
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    url?: string;
    storageProvider?: 'aws-cloudfront' | 'aws-s3' | 'server-disk';
    error?: string;
  };

  if (!res.ok || !data.ok || !data.url) {
    throw new Error(
      data.error || `O servidor rejeitou o envio deste arquivo de mídia (HTTP ${res.status}).`
    );
  }

  onProgress?.(100);
  return {
    url: data.url,
    storageProvider: data.storageProvider || 'server-disk',
    fallbackNeeded: false,
  };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
    img.src = src;
  });
}

/**
 * Resizes and compresses image files so avatars, covers, stories, and feed photos
 * sync reliably across devices via Firestore and fit cleanly within document limits.
 */
export async function compressImageFile(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    maxChars?: number;
  }
): Promise<string> {
  const maxWidth = options?.maxWidth ?? 1280;
  const maxHeight = options?.maxHeight ?? 1280;
  const initialQuality = options?.quality ?? 0.82;
  const maxChars = options?.maxChars ?? 360_000;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let targetWidth = img.naturalWidth || img.width || maxWidth;
    let targetHeight = img.naturalHeight || img.height || maxHeight;

    const widthRatio = maxWidth / targetWidth;
    const heightRatio = maxHeight / targetHeight;
    const scale = Math.min(1, widthRatio, heightRatio);

    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return await readAsDataUrl(file);
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    let quality = initialQuality;
    let output = canvas.toDataURL('image/jpeg', quality);
    while (output.length > maxChars && quality > 0.42) {
      quality = Math.max(0.4, quality - 0.12);
      output = canvas.toDataURL('image/jpeg', quality);
    }

    // If still larger than maxChars, shrink dimensions further
    if (output.length > maxChars) {
      const shrink = Math.sqrt(maxChars / output.length) * 0.9;
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = Math.max(120, Math.round(targetWidth * shrink));
      smallCanvas.height = Math.max(120, Math.round(targetHeight * shrink));
      const smallCtx = smallCanvas.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
        output = smallCanvas.toDataURL('image/jpeg', 0.72);
      }
    }

    return output;
  } catch {
    return await readAsDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
