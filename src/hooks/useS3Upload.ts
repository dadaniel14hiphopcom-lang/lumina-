import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getConfiguredS3ApiBaseUrl,
  inferMediaMimeType,
  normalizeApiBaseUrl,
  uploadMediaToCloud,
} from '../utils/media';

export type S3StorageProvider = 'aws-cloudfront' | 'aws-s3' | 'server-disk' | 'local-inline';

export interface S3UploadResult {
  url: string;
  key?: string;
  bucket?: string;
  region?: string;
  storageProvider: S3StorageProvider;
}

export interface UseS3UploadOptions {
  apiBaseUrl?: string;
  fallbackToChunkedServer?: boolean;
  fallbackToInlineMaxBytes?: number;
}

export interface UseS3UploadReturn {
  uploadFile: (file: Blob, fileName?: string) => Promise<S3UploadResult | null>;
  cancelUpload: () => void;
  reset: () => void;
  isUploading: boolean;
  progress: number;
  stage: string;
  loadedBytes: number;
  totalBytes: number;
  error: string | null;
  lastResult: S3UploadResult | null;
}

interface PresignResponse {
  ok?: boolean;
  uploadUrl?: string;
  playbackUrl?: string;
  key?: string;
  bucket?: string;
  region?: string;
  requiredHeaders?: Record<string, string>;
  error?: string;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo selecionado.'));
    reader.readAsDataURL(blob);
  });
}

function putFileToPresignedUrl(params: {
  uploadUrl: string;
  file: Blob;
  headers: Record<string, string>;
  onProgress: (loaded: number, total: number) => void;
  registerXhr: (xhr: XMLHttpRequest | null) => void;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    params.registerXhr(xhr);
    xhr.open('PUT', params.uploadUrl, true);

    Object.entries(params.headers).forEach(([key, value]) => {
      if (value) {
        xhr.setRequestHeader(key, value);
      }
    });

    xhr.upload.onprogress = (ev) => {
      const total = ev.lengthComputable && ev.total > 0 ? ev.total : params.file.size;
      params.onProgress(ev.loaded, total);
    };

    xhr.onload = () => {
      params.registerXhr(null);
      resolve({ status: xhr.status, text: xhr.responseText || '' });
    };

    xhr.onerror = () => {
      params.registerXhr(null);
      reject(
        new Error(
          'Falha de conexão/CORS ao enviar diretamente para o Amazon S3. Verifique a regra CORS do bucket.'
        )
      );
    };

    xhr.onabort = () => {
      params.registerXhr(null);
      reject(new DOMException('Envio cancelado pelo usuário.', 'AbortError'));
    };

    xhr.send(params.file);
  });
}

export function useS3Upload(options?: UseS3UploadOptions): UseS3UploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<S3UploadResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);

  const fallbackToChunkedServer = options?.fallbackToChunkedServer ?? true;
  const fallbackToInlineMaxBytes = options?.fallbackToInlineMaxBytes ?? 0;

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeXhrRef.current) {
      activeXhrRef.current.abort();
      activeXhrRef.current = null;
    }
    setIsUploading(false);
    setStage('Envio cancelado');
  }, []);

  const reset = useCallback(() => {
    setIsUploading(false);
    setProgress(0);
    setStage('');
    setLoadedBytes(0);
    setTotalBytes(0);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
      }
    };
  }, []);

  const uploadFile = useCallback(
    async (file: Blob, fileName?: string): Promise<S3UploadResult | null> => {
      const resolvedName =
        fileName || (typeof File !== 'undefined' && file instanceof File ? file.name : undefined);
      const contentType = inferMediaMimeType(file, resolvedName);
      const baseUrl = normalizeApiBaseUrl(options?.apiBaseUrl) || getConfiguredS3ApiBaseUrl();

      if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
        const msg = 'Selecione um arquivo de imagem ou vídeo válido.';
        setError(msg);
        return null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setError(null);
      setIsUploading(true);
      setProgress(4);
      setStage('Solicitando URL assinada na API...');
      setLoadedBytes(0);
      setTotalBytes(file.size);

      try {
        let presignRes: Response | null = null;
        try {
          presignRes = await fetch(`${baseUrl}/api/media/presign-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentType,
              sizeBytes: file.size,
              fileName: resolvedName,
            }),
            signal: controller.signal,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          presignRes = null;
        }

        const presignCt = (presignRes?.headers.get('content-type') || '').toLowerCase();
        const presignJson =
          presignRes && presignCt.includes('application/json')
            ? ((await presignRes.json().catch(() => ({}))) as PresignResponse)
            : null;

        // 1. Direct upload to AWS S3 using SigV4 pre-signed PUT URL
        if (
          presignRes &&
          presignRes.ok &&
          presignJson?.ok &&
          presignJson.uploadUrl &&
          presignJson.playbackUrl
        ) {
          setProgress(8);
          setStage('Enviando arquivo diretamente para Amazon S3...');

          const putHeaders: Record<string, string> = {
            'Content-Type': contentType,
            ...(presignJson.requiredHeaders || {}),
          };

          const putRes = await putFileToPresignedUrl({
            uploadUrl: presignJson.uploadUrl,
            file,
            headers: putHeaders,
            registerXhr: (xhr) => {
              activeXhrRef.current = xhr;
            },
            onProgress: (loaded, total) => {
              const effectiveTotal = total > 0 ? total : file.size;
              const pct =
                effectiveTotal > 0
                  ? Math.min(99, Math.max(8, Math.round((loaded / effectiveTotal) * 99)))
                  : 50;
              setLoadedBytes(loaded);
              setTotalBytes(effectiveTotal);
              setProgress(pct);
              setStage('Enviando arquivo para o bucket S3...');
            },
          });

          if (putRes.status >= 200 && putRes.status < 300) {
            const storageProvider: S3StorageProvider = presignJson.playbackUrl.includes(
              '.amazonaws.com'
            )
              ? 'aws-s3'
              : 'aws-cloudfront';
            const result: S3UploadResult = {
              url: presignJson.playbackUrl,
              key: presignJson.key,
              bucket: presignJson.bucket,
              region: presignJson.region,
              storageProvider,
            };
            setProgress(100);
            setLoadedBytes(file.size);
            setTotalBytes(file.size);
            setStage('Upload concluído no Amazon S3!');
            setLastResult(result);
            return result;
          }

          throw new Error(
            `Amazon S3 recusou o envio (HTTP ${putRes.status}). Verifique permissões IAM e CORS do bucket.`
          );
        }

        // Handle explicit validation errors from the Node API (400 / 413 / 415)
        if (
          presignRes &&
          presignRes.status >= 400 &&
          presignRes.status < 500 &&
          presignRes.status !== 404 &&
          presignJson?.error
        ) {
          throw new Error(presignJson.error);
        }

        // 2. Fallback to same-origin Node server chunked upload when S3 env vars are not set on server.ts (503)
        if (!baseUrl && fallbackToChunkedServer) {
          const cloudRes = await uploadMediaToCloud(
            file,
            resolvedName,
            (pct, nextStage, loaded, total) => {
              setProgress(pct);
              if (nextStage) setStage(nextStage);
              if (typeof loaded === 'number') setLoadedBytes(loaded);
              if (typeof total === 'number') setTotalBytes(total);
            }
          );

          if (!cloudRes.fallbackNeeded) {
            const result: S3UploadResult = {
              url: cloudRes.url,
              storageProvider: cloudRes.storageProvider,
            };
            setProgress(100);
            setLoadedBytes(file.size);
            setTotalBytes(file.size);
            setStage('Upload concluído!');
            setLastResult(result);
            return result;
          }
        }

        // 3. Static-only fallback for small media if enabled by caller
        if (fallbackToInlineMaxBytes > 0 && file.size <= fallbackToInlineMaxBytes) {
          setProgress(85);
          setStage('Processando mídia localmente...');
          const dataUrl = await readBlobAsDataUrl(file);
          const result: S3UploadResult = {
            url: dataUrl,
            storageProvider: 'local-inline',
          };
          setProgress(100);
          setLoadedBytes(file.size);
          setTotalBytes(file.size);
          setStage('Pronto!');
          setLastResult(result);
          return result;
        }

        const serverHint = baseUrl
          ? `Não foi possível assinar o upload em ${baseUrl}/api/media/presign-upload. Verifique se o servidor Node está rodando e com as chaves AWS no .env.`
          : 'Este endereço estático não possui servidor Node (/api) para assinar uploads acima de 3,5 MB. Conecte a URL do servidor Node S3 no Painel Admin.';
        throw new Error(presignJson?.error || serverHint);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setError(null);
          return null;
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Não foi possível concluir o envio do arquivo para o S3.';
        setError(msg);
        return null;
      } finally {
        abortControllerRef.current = null;
        activeXhrRef.current = null;
        setIsUploading(false);
      }
    },
    [options?.apiBaseUrl, fallbackToChunkedServer, fallbackToInlineMaxBytes]
  );

  return {
    uploadFile,
    cancelUpload,
    reset,
    isUploading,
    progress,
    stage,
    loadedBytes,
    totalBytes,
    error,
    lastResult,
  };
}
