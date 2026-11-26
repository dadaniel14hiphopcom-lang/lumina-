import { MediaAsset } from '../types';

export function isVideoAsset(media?: Partial<MediaAsset> | null): boolean {
  if (!media?.url) return false;
  if (media.mediaType === 'video') return true;
  if (media.url.startsWith('data:video/')) return true;
  if (/\.(mp4|webm|mov|m4v|ogg|ogv|3gp|3g2|mkv|mpg)(\?|#|$)/i.test(media.url)) return true;
  return false;
}

/**
 * Rewrites /api/media/... URLs saved on another preview origin (e.g. ais-dev vs ais-pre)
 * to a relative path on the active origin so auth proxies do not block <video> playback.
 */
export function resolvePlayableMediaUrl(rawUrl?: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (
      parsed.pathname.startsWith('/api/media/') &&
      typeof window !== 'undefined' &&
      parsed.origin !== window.location.origin
    ) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Keep original URL
  }
  return url;
}

export async function diagnoseVideoPlaybackError(
  playableSrc: string
): Promise<string> {
  if (!playableSrc) return 'Endereço do vídeo não encontrado.';
  if (playableSrc.startsWith('blob:')) {
    return 'Este vídeo expirou porque foi salvo apenas na sessão local anterior. Publique novamente para enviá-lo à nuvem.';
  }
  if (playableSrc.startsWith('/api/media/')) {
    try {
      const res = await fetch(playableSrc, {
        method: 'GET',
        headers: { Range: 'bytes=0-1' },
      });
      if (res.status === 404) {
        return 'Este vídeo antigo não existe mais no armazenamento temporário do servidor. Publique o Reel novamente ou ative a Amazon S3 no Painel ADM.';
      }
      if (res.status === 503) {
        return 'As credenciais da Amazon AWS S3 não estão configuradas no servidor para reproduzir este vídeo.';
      }
    } catch {
      return 'Não foi possível conectar ao servidor para carregar este vídeo.';
    }
  }
  return 'O codec do vídeo não é compatível com este navegador ou o arquivo não pôde ser carregado.';
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

const S3_API_BASE_STORAGE_KEY = 'lumina_s3_api_base_url';

export function normalizeApiBaseUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getConfiguredS3ApiBaseUrl(): string {
  const envUrl =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_S3_API_URL === 'string'
      ? normalizeApiBaseUrl(import.meta.env.VITE_S3_API_URL)
      : '';
  if (typeof window !== 'undefined') {
    try {
      const stored = normalizeApiBaseUrl(window.localStorage.getItem(S3_API_BASE_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Ignore storage access errors
    }
  }
  return envUrl;
}

export function setConfiguredS3ApiBaseUrl(rawUrl: string): string {
  const normalized = normalizeApiBaseUrl(rawUrl);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(S3_API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(S3_API_BASE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return normalized;
}

export function inferMediaMimeType(blob: Blob, fileName?: string): string {
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
  if (ext === 'weba') return 'audio/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'ogv') return 'video/ogg';
  if (ext === '3gp') return 'video/3gpp';
  if (ext === '3g2') return 'video/3gpp2';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mpg' || ext === 'mpeg') return 'video/mpeg';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'opus') return 'audio/opus';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'json') return 'application/json';
  if (ext === 'zip') return 'application/zip';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
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

export async function fetchMediaDeliveryStatus(
  apiBaseUrlOverride?: string
): Promise<MediaStatusInfo | null> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrlOverride) || getConfiguredS3ApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/media/status`, { cache: 'no-store' });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) return null;
    const raw = (await res.json()) as Partial<MediaStatusInfo> & {
      ok?: boolean;
      cloudFrontDomain?: string | null;
    };
    if (typeof raw.uploadAvailable === 'boolean') {
      return raw as MediaStatusInfo;
    }
    if (typeof raw.awsCredentialsConfigured === 'boolean') {
      return {
        uploadAvailable: Boolean(raw.ok ?? raw.awsCredentialsConfigured),
        storageProvider: raw.awsCredentialsConfigured ? 'aws-s3' : 'server-disk',
        awsCredentialsConfigured: raw.awsCredentialsConfigured,
        s3Enabled: Boolean(raw.ok ?? raw.awsCredentialsConfigured),
        cloudFrontActive: Boolean(raw.cloudFrontDomain),
        region: raw.region || 'sa-east-1',
        bucket: raw.bucket || 'lumina-media-prod',
        maxVideoSizeMB: raw.maxVideoSizeMB,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export type MediaUploadProgressCallback = (
  percent: number,
  stage?: string,
  loadedBytes?: number,
  totalBytes?: number
) => void;

interface XhrUploadResponse {
  status: number;
  contentType: string;
  text: string;
}

function sendXhrBinary(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onByteProgress?: (loaded: number, total: number) => void
): Promise<XhrUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onByteProgress) {
        onByteProgress(ev.loaded, ev.total);
      }
    };

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        contentType: (xhr.getResponseHeader('content-type') || '').toLowerCase(),
        text: xhr.responseText || '',
      });
    };
    xhr.onerror = () => reject(new Error('Falha de conexão durante o envio do vídeo.'));
    xhr.onabort = () => reject(new Error('Envio do vídeo cancelado.'));
    xhr.send(body);
  });
}

function isStaticSpaFallbackRaw(status: number, contentType: string): boolean {
  if (
    status === 404 ||
    status === 405 ||
    status === 501 ||
    status === 502 ||
    status === 503
  ) {
    return true;
  }
  if (status >= 200 && status < 300 && contentType && !contentType.includes('application/json')) {
    return true;
  }
  return false;
}

async function uploadMediaChunked(
  blob: Blob,
  contentType: string,
  onProgress?: MediaUploadProgressCallback
): Promise<MediaUploadResult | MediaUploadFallback> {
  onProgress?.(2, 'Iniciando envio para a nuvem...', 0, blob.size);

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

    const chunkXhr = await sendXhrBinary(
      '/api/media/upload-chunk',
      slice,
      {
        'Content-Type': 'application/octet-stream',
        'x-upload-id': initData.uploadId,
        'x-chunk-index': String(index),
      },
      (chunkLoaded) => {
        const overallLoaded = Math.min(blob.size, start + chunkLoaded);
        const pct = Math.min(92, Math.max(4, Math.round((overallLoaded / blob.size) * 92)));
        onProgress?.(
          pct,
          `Enviando parte ${index + 1} de ${totalChunks}...`,
          overallLoaded,
          blob.size
        );
      }
    );

    const chunkData = (() => {
      try {
        return JSON.parse(chunkXhr.text || '{}') as { ok?: boolean; error?: string };
      } catch {
        return {};
      }
    })();

    if (chunkXhr.status < 200 || chunkXhr.status >= 300 || !chunkData.ok) {
      throw new Error(
        chunkData.error ||
          `Falha ao enviar parte ${index + 1}/${totalChunks} do vídeo (HTTP ${chunkXhr.status}).`
      );
    }
  }

  onProgress?.(95, 'Salvando vídeo no armazenamento AWS S3...', blob.size, blob.size);

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

  onProgress?.(100, 'Upload concluído!', blob.size, blob.size);
  return {
    url: completeData.url,
    storageProvider: completeData.storageProvider || 'server-disk',
    fallbackNeeded: false,
  };
}

export async function uploadMediaToCloud(
  blob: Blob,
  fileName?: string,
  onProgress?: MediaUploadProgressCallback
): Promise<MediaUploadResult | MediaUploadFallback> {
  const contentType = inferMediaMimeType(blob, fileName);

  // Videos/files larger than 2.5 MB use chunked upload to avoid reverse-proxy payload caps
  if (blob.size > 2_500_000) {
    return uploadMediaChunked(blob, contentType, onProgress);
  }

  onProgress?.(5, 'Enviando vídeo para a nuvem...', 0, blob.size);

  let xhrRes: XhrUploadResponse;
  try {
    xhrRes = await sendXhrBinary(
      '/api/media/upload',
      blob,
      { 'Content-Type': contentType },
      (loaded, total) => {
        const effectiveTotal = total > 0 ? total : blob.size;
        const pct = Math.min(92, Math.max(8, Math.round((loaded / effectiveTotal) * 92)));
        onProgress?.(pct, 'Enviando vídeo para o servidor...', loaded, effectiveTotal);
      }
    );
  } catch {
    return { fallbackNeeded: true };
  }

  if (isStaticSpaFallbackRaw(xhrRes.status, xhrRes.contentType)) {
    return { fallbackNeeded: true };
  }

  const data = (() => {
    try {
      return JSON.parse(xhrRes.text || '{}') as {
        ok?: boolean;
        url?: string;
        storageProvider?: 'aws-cloudfront' | 'aws-s3' | 'server-disk';
        error?: string;
      };
    } catch {
      return {};
    }
  })();

  if (xhrRes.status === 413) {
    if (!data.error) {
      return uploadMediaChunked(blob, contentType, onProgress);
    }
    throw new Error(data.error);
  }

  if (xhrRes.status < 200 || xhrRes.status >= 300 || !data.ok || !data.url) {
    throw new Error(
      data.error ||
        `O servidor rejeitou o envio deste arquivo de mídia (HTTP ${xhrRes.status}).`
    );
  }

  onProgress?.(100, 'Upload concluído!', blob.size, blob.size);
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
