import {
  AlertCircle,
  Check,
  Film,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  Video,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { STUDIO_SAMPLE_IMAGES } from '../data/seed';
import { PostCategory, StudioAdjustments } from '../types';
import {
  buildFilterString,
  DEFAULT_ADJUSTMENTS,
  FILTER_PRESETS,
  renderFilteredImage,
} from '../utils/filters';
import {
  compressImageFile,
  fetchMediaDeliveryStatus,
  MediaStatusInfo,
  resolvePlayableMediaUrl,
  uploadMediaToCloud,
} from '../utils/media';
import { MediaImage } from './MediaImage';

interface CreateModalProps {
  initialMode?: 'post' | 'story' | 'reel';
}

interface DraftMediaItem {
  url: string;
  mediaType: 'image' | 'video';
  durationSec?: number;
}

const CATEGORIES: PostCategory[] = [
  'Fotografia',
  'Arquitetura',
  'Gastronomia',
  'Viagem',
  'Design',
  'Arte',
];

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler mídia'));
    reader.readAsDataURL(blob);
  });
}

function readVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      resolve(d);
    };
    video.onerror = () => resolve(0);
    video.src = url;
  });
}

export function CreateModal({ initialMode = 'post' }: CreateModalProps) {
  const { isCreateOpen, setIsCreateOpen, publishPost, publishStory, showToast, siteMeta } =
    useSocial();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'post' | 'story' | 'reel'>(initialMode);
  const [step, setStep] = useState<'pick' | 'edit' | 'details'>('pick');
  const [mediaItems, setMediaItems] = useState<DraftMediaItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:5' | '16:9' | '9:16'>('4:5');
  const [adjustments, setAdjustments] = useState<StudioAdjustments>(DEFAULT_ADJUSTMENTS);
  const [editTab, setEditTab] = useState<'filters' | 'adjust'>('filters');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<PostCategory>('Fotografia');
  const [audioTrack, setAudioTrack] = useState('Luz Natural · Instrumental');
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadBytes, setUploadBytes] = useState<{ loaded: number; total: number } | null>(null);
  const [mediaDeliveryStatus, setMediaDeliveryStatus] = useState<MediaStatusInfo | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [previewVideoError, setPreviewVideoError] = useState(false);

  // Short-video camera recorder for Reels
  const [camOpen, setCamOpen] = useState(false);
  const [camRecording, setCamRecording] = useState(false);
  const [camSec, setCamSec] = useState(0);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camRecorderRef = useRef<MediaRecorder | null>(null);
  const camChunksRef = useRef<Blob[]>([]);
  const camTimerRef = useRef<number | null>(null);

  const stopCamera = () => {
    if (camTimerRef.current) {
      window.clearInterval(camTimerRef.current);
      camTimerRef.current = null;
    }
    if (camRecorderRef.current && camRecorderRef.current.state !== 'inactive') {
      camRecorderRef.current.onstop = null;
      camRecorderRef.current.stop();
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    camRecorderRef.current = null;
    setCamRecording(false);
    setCamOpen(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!isCreateOpen) return;
    let active = true;
    fetchMediaDeliveryStatus().then((status) => {
      if (active) setMediaDeliveryStatus(status);
    });
    return () => {
      active = false;
    };
  }, [isCreateOpen]);

  if (!isCreateOpen) return null;

  const { maxVideoSizeMB, maxReelDurationSec, allowVideoReels } = siteMeta.videoRules;

  const resetAndClose = () => {
    stopCamera();
    setStep('pick');
    setMediaItems([]);
    setActiveIdx(0);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setCaption('');
    setLocation('');
    setMediaError(null);
    setPreviewVideoError(false);
    setUploadingMedia(false);
    setUploadProgress(0);
    setUploadStage('');
    setUploadBytes(null);
    setIsCreateOpen(false);
  };

  const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const uploadVideoBlobToCloud = async (
    blob: Blob,
    fileName?: string
  ): Promise<string | null> => {
    setUploadingMedia(true);
    setUploadProgress(5);
    setUploadStage('Preparando envio do vídeo...');
    setUploadBytes({ loaded: 0, total: blob.size });
    try {
      const result = await uploadMediaToCloud(
        blob,
        fileName,
        (pct, stage, loadedBytes, totalBytes) => {
          setUploadProgress(pct);
          if (stage) setUploadStage(stage);
          if (typeof loadedBytes === 'number' && typeof totalBytes === 'number') {
            setUploadBytes({ loaded: loadedBytes, total: totalBytes });
          }
        }
      );
      if (!result.fallbackNeeded) {
        if (result.storageProvider === 'aws-cloudfront' || result.storageProvider === 'aws-s3') {
          showToast('Vídeo hospedado na Amazon AWS S3');
        } else {
          showToast('Vídeo enviado para streaming de mídia');
        }
        return result.url;
      }

      if (blob.size <= 3_500_000) {
        return await readBlobAsDataUrl(blob);
      }

      const msg =
        'Este servidor estático não suporta arquivos acima de 3,5 MB. Ative o servidor Lumina + Amazon AWS S3 para hospedar vídeos maiores.';
      setMediaError(msg);
      showToast(msg);
      return null;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível enviar o vídeo para a nuvem.';
      setMediaError(msg);
      showToast(msg);
      return null;
    } finally {
      setUploadingMedia(false);
      setUploadProgress(0);
      setUploadStage('');
      setUploadBytes(null);
    }
  };

  const validateAndLoadVideoFile = async (file: File) => {
    setMediaError(null);
    setPreviewVideoError(false);
    if (!allowVideoReels) {
      const msg = 'Envio de vídeos nos Reels está desativado nas regras do painel admin.';
      setMediaError(msg);
      showToast(msg);
      return;
    }
    const maxBytes = maxVideoSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      const msg = `O vídeo tem ${sizeMb} MB e excede o limite de ${maxVideoSizeMB} MB definido no painel admin.`;
      setMediaError(msg);
      showToast(msg);
      return;
    }

    const tempUrl = URL.createObjectURL(file);
    const duration = await readVideoDuration(tempUrl);
    URL.revokeObjectURL(tempUrl);
    if (duration > maxReelDurationSec + 0.5) {
      const msg = `O vídeo dura ${Math.ceil(duration)}s e excede o máximo permitido de ${maxReelDurationSec}s para Reels.`;
      setMediaError(msg);
      showToast(msg);
      return;
    }

    const uploadedUrl = await uploadVideoBlobToCloud(file, file.name);
    if (!uploadedUrl) return;

    setPreviewVideoError(false);
    setMediaItems([
      {
        url: uploadedUrl,
        mediaType: 'video',
        durationSec: duration > 0 ? Math.round(duration) : undefined,
      },
    ]);
    setActiveIdx(0);
    setAspectRatio('9:16');
    setAudioTrack(`Áudio original · ${file.name.replace(/\.[^.]+$/, '')}`);
    setStep('edit');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setMediaError(null);
    const files = Array.from(e.target.files || []).slice(0, 5);
    e.target.value = '';
    if (files.length === 0) return;

    const firstVideo = files.find(
      (f) =>
        f.type.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|ogv|ogg|3gp|3g2|mkv|mpg)$/i.test(f.name)
    );
    if (firstVideo) {
      if (mode !== 'reel') {
        setMediaError('Vídeos curtos devem ser publicados no modo Reel.');
        showToast('Selecione o modo Reel para enviar vídeos curtos');
        return;
      }
      await validateAndLoadVideoFile(firstVideo);
      return;
    }

    const urls = await Promise.all(
      files.map((file) =>
        compressImageFile(file, {
          maxWidth: 1280,
          maxHeight: 1600,
          quality: 0.82,
          maxChars: 340_000,
        }).catch(() => '')
      )
    );
    const valid = urls.filter(Boolean).map((url) => ({
      url,
      mediaType: 'image' as const,
    }));
    if (valid.length > 0) {
      setMediaItems(valid);
      setActiveIdx(0);
      if (mode === 'story' || mode === 'reel') setAspectRatio('9:16');
      setStep('edit');
    }
  };

  const handleVideoFileOnly = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await validateAndLoadVideoFile(file);
  };

  const openReelCamera = async () => {
    setMediaError(null);
    if (!allowVideoReels) {
      const msg = 'Gravação de vídeo para Reels está desativada no painel admin.';
      setMediaError(msg);
      showToast(msg);
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Câmera indisponível');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      camStreamRef.current = stream;
      setCamOpen(true);
      setCamSec(0);
      window.setTimeout(() => {
        if (camVideoRef.current) {
          camVideoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      const msg = 'Não foi possível abrir a câmera. Envie um arquivo de vídeo curto do dispositivo.';
      setMediaError(msg);
      showToast(msg);
    }
  };

  const startReelRecording = () => {
    if (!camStreamRef.current) return;
    camChunksRef.current = [];
    const rec = new MediaRecorder(camStreamRef.current);
    camRecorderRef.current = rec;
    const startMs = Date.now();

    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) camChunksRef.current.push(ev.data);
    };
    rec.onstop = async () => {
      const mimeType = (rec.mimeType || 'video/webm').split(';')[0] || 'video/webm';
      const blob = new Blob(camChunksRef.current, { type: mimeType });
      const recordedSec = Math.max(1, Math.round((Date.now() - startMs) / 1000));
      stopCamera();

      if (blob.size > maxVideoSizeMB * 1024 * 1024) {
        setMediaError(`Gravação excedeu o limite de ${maxVideoSizeMB} MB.`);
        return;
      }

      const uploadedUrl = await uploadVideoBlobToCloud(
        blob,
        mimeType === 'video/mp4' ? 'camera-reel.mp4' : 'camera-reel.webm'
      );
      if (!uploadedUrl) return;

      setPreviewVideoError(false);
      setMediaItems([
        {
          url: uploadedUrl,
          mediaType: 'video',
          durationSec: recordedSec,
        },
      ]);
      setActiveIdx(0);
      setAspectRatio('9:16');
      setAudioTrack('Áudio original · Câmera');
      setStep('edit');
    };

    rec.start();
    setCamRecording(true);
    setCamSec(0);

    camTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setCamSec(elapsed);
      if (elapsed >= maxReelDurationSec && rec.state === 'recording') {
        rec.stop();
      }
    }, 250);
  };

  const stopReelRecording = () => {
    if (camRecorderRef.current && camRecorderRef.current.state === 'recording') {
      camRecorderRef.current.stop();
    }
  };

  const handlePickSample = (url: string) => {
    setMediaError(null);
    setMediaItems((prev) => {
      if (mode !== 'post') return [{ url, mediaType: 'image' }];
      const exists = prev.some((item) => item.url === url);
      if (exists) return prev.filter((item) => item.url !== url);
      return [...prev, { url, mediaType: 'image' as const }].slice(0, 5);
    });
  };

  const handleProceedFromSamples = () => {
    if (mediaItems.length === 0) return;
    setActiveIdx(0);
    if (mode === 'story' || mode === 'reel') setAspectRatio('9:16');
    setStep('edit');
  };

  const filterCss = buildFilterString(adjustments);
  const activeItem = mediaItems[activeIdx];
  const isActiveVideo = activeItem?.mediaType === 'video';

  const handlePublish = async () => {
    if (mediaItems.length === 0 || isPublishing) return;
    setIsPublishing(true);
    try {
      const targetRatio = mode === 'story' || mode === 'reel' ? '9:16' : aspectRatio;
      const renderedAssets = await Promise.all(
        mediaItems.map(async (item) => {
          if (item.mediaType === 'video') {
            return {
              url: item.url,
              mediaType: 'video' as const,
              durationSec: item.durationSec,
              filterCss: filterCss || undefined,
            };
          }
          const processed = await renderFilteredImage(item.url, filterCss, targetRatio);
          return {
            url: processed,
            mediaType: 'image' as const,
          };
        })
      );

      if (mode === 'story') {
        publishStory({
          mediaUrl: renderedAssets[0].url,
          caption,
          location,
        });
      } else {
        publishPost({
          mediaUrls: renderedAssets.map((a) => a.url),
          mediaAssets: renderedAssets,
          caption,
          location,
          category,
          aspectRatio: targetRatio,
          isReel: mode === 'reel',
          audioTrack: mode === 'reel' ? audioTrack : undefined,
        });
      }
      resetAndClose();
    } catch {
      showToast('Não foi possível processar a mídia');
    } finally {
      setIsPublishing(false);
    }
  };

  const previewRatioClass =
    mode === 'story' || mode === 'reel'
      ? 'aspect-[9/16] max-h-[380px] sm:max-h-[460px]'
      : aspectRatio === '1:1'
      ? 'aspect-square'
      : aspectRatio === '16:9'
      ? 'aspect-video'
      : 'aspect-[4/5]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Estúdio de criação"
      onClick={resetAndClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-white dark:bg-zinc-950 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:border sm:border-zinc-200 dark:sm:border-zinc-800"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {step !== 'pick' ? (
            <button
              type="button"
              onClick={() => setStep(step === 'details' ? 'edit' : 'pick')}
              className="text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
            >
              Voltar
            </button>
          ) : (
            <div className="w-12" />
          )}

          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
            {step === 'pick'
              ? 'Criar novo conteúdo'
              : step === 'edit'
              ? isActiveVideo
                ? 'Filtros e prévia do vídeo'
                : 'Filtros e recorte'
              : mode === 'story'
              ? 'Publicar Story'
              : mode === 'reel'
              ? 'Novo Reel'
              : 'Nova publicação'}
          </h2>

          <div className="flex items-center gap-2">
            {step === 'edit' && (
              <button
                type="button"
                disabled={isActiveVideo && previewVideoError}
                onClick={() => setStep('details')}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Avançar
              </button>
            )}
            {step === 'details' && (
              <button
                type="button"
                disabled={isPublishing}
                onClick={handlePublish}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {isPublishing ? 'Publicando...' : 'Compartilhar'}
              </button>
            )}
            <button
              type="button"
              onClick={resetAndClose}
              aria-label="Fechar estúdio"
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Step 1: Pick Mode & Media */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {/* Format Switcher */}
            <div className="mx-auto mb-6 flex max-w-md items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setMode('post');
                  setMediaError(null);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  mode === 'post'
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                }`}
              >
                <Layers className="h-4 w-4" />
                <span>Publicação</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setMode('story');
                  setMediaError(null);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  mode === 'story'
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                <span>Story</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reel');
                  setMediaError(null);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  mode === 'reel'
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                }`}
              >
                <Film className="h-4 w-4" />
                <span>Reel</span>
              </button>
            </div>

            {mediaError && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{mediaError}</span>
              </div>
            )}

            {uploadingMedia && (
              <div
                className="mb-5 rounded-2xl border border-sky-500/30 bg-sky-50/90 p-4 dark:border-sky-500/25 dark:bg-sky-950/30"
                role="status"
                aria-live="polite"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
                    <span className="truncate text-xs font-semibold text-sky-950 dark:text-sky-100">
                      {mediaDeliveryStatus?.storageProvider === 'aws-s3'
                        ? `Enviando vídeo para Amazon S3 (${mediaDeliveryStatus.bucket})`
                        : 'Enviando vídeo para armazenamento na nuvem'}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-bold text-sky-700 tabular-nums dark:text-sky-300">
                    {uploadProgress}%
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Progresso do envio do vídeo"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2.5 w-full overflow-hidden rounded-full bg-sky-200/80 dark:bg-sky-900/60"
                >
                  <div
                    className="h-full rounded-full bg-sky-600 transition-[width] duration-200 ease-out dark:bg-sky-400"
                    style={{ width: `${Math.min(100, Math.max(4, uploadProgress))}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-sky-800/80 dark:text-sky-200/80">
                  <span className="truncate">
                    {uploadStage || 'Processando arquivo...'}
                  </span>
                  {uploadBytes && uploadBytes.total > 0 && (
                    <span className="shrink-0 font-mono tabular-nums">
                      {formatMegabytes(uploadBytes.loaded)} / {formatMegabytes(uploadBytes.total)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Live Short Video Camera Stage for Reels */}
            {camOpen && mode === 'reel' ? (
              <div className="mb-6 overflow-hidden rounded-2xl border border-zinc-200 bg-black dark:border-zinc-800">
                <div className="relative mx-auto aspect-[9/16] max-h-[340px] w-full max-w-[260px] bg-black">
                  <video
                    ref={camVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute top-3 right-3 left-3 flex items-center justify-between text-xs font-semibold text-white">
                    <span className="rounded-md bg-black/60 px-2 py-1 font-mono tabular-nums">
                      {camSec}s / {maxReelDurationSec}s
                    </span>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="rounded-md bg-black/60 px-2 py-1 hover:bg-black/80"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
                <div className="flex justify-center bg-zinc-950 p-3">
                  {camRecording ? (
                    <button
                      type="button"
                      onClick={stopReelRecording}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-5 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      <Square className="h-3.5 w-3.5 fill-white" />
                      <span>Parar e usar vídeo ({camSec}s)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startReelRecording}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-xs font-semibold text-white hover:bg-sky-700"
                    >
                      <Video className="h-4 w-4" />
                      <span>Iniciar gravação (máx {maxReelDurationSec}s)</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* Device Upload Zone */
              <div className="mb-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                  {mode === 'reel' ? (
                    <Video className="h-5 w-5" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {mode === 'reel'
                    ? 'Envie um vídeo curto ou foto para o seu Reel'
                    : 'Envie fotos do seu dispositivo'}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {mode === 'reel'
                    ? allowVideoReels
                      ? `Regras do site: vídeos até ${maxVideoSizeMB} MB e máximo de ${maxReelDurationSec}s (MP4, WebM, MOV)`
                      : 'Vídeos nos Reels desativados pelo administrador — apenas imagens no momento'
                    : mode === 'post'
                    ? 'Selecione até 5 imagens para criar um carrossel'
                    : 'Selecione uma imagem vertical ou horizontal para editar'}
                </p>
                {mode === 'reel' && allowVideoReels && mediaDeliveryStatus && (
                  <p className="mt-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {mediaDeliveryStatus.storageProvider === 'aws-s3'
                      ? `Entrega na nuvem: Amazon S3 (${mediaDeliveryStatus.bucket})${
                          mediaDeliveryStatus.cloudFrontActive ? ' + CloudFront CDN' : ''
                        }`
                      : 'Entrega por streaming HTTP 206 no servidor (pronto para Amazon S3 nas integrações ADM)'}
                  </p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={mode === 'reel' && allowVideoReels ? 'video/*,image/*' : 'image/*'}
                  multiple={mode === 'post'}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg,.mp4,.webm,.mov,.m4v,.ogv"
                  onChange={handleVideoFileOnly}
                  className="hidden"
                />

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {mode === 'reel' && allowVideoReels && (
                    <>
                      <button
                        type="button"
                        disabled={uploadingMedia}
                        onClick={() => videoInputRef.current?.click()}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        <Film className="h-4 w-4" />
                        <span>{uploadingMedia ? 'Enviando...' : 'Selecionar vídeo curto'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={uploadingMedia}
                        onClick={openReelCamera}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <Video className="h-4 w-4" />
                        <span>Gravar agora</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={() => fileInputRef.current?.click()}
                    className={`inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-50 ${
                      mode === 'reel' && allowVideoReels
                        ? 'border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950'
                    }`}
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span>{mode === 'reel' ? 'Selecionar foto' : 'Selecionar do computador'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Curated Studio Picker */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Ou escolha do acervo do estúdio
                </h3>
                {mediaItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleProceedFromSamples}
                    className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                  >
                    Editar selecionadas ({mediaItems.length})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                {STUDIO_SAMPLE_IMAGES.map((sample) => {
                  const selectedIndex = mediaItems.findIndex((i) => i.url === sample.url);
                  const isSelected = selectedIndex >= 0;
                  return (
                    <button
                      key={sample.url}
                      type="button"
                      onClick={() => handlePickSample(sample.url)}
                      className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-sky-500 ring-2 ring-sky-500/30'
                          : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
                      }`}
                    >
                      <MediaImage
                        src={sample.url}
                        alt={sample.label}
                        className="h-full w-full object-cover"
                      />
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                          {mode === 'post' ? selectedIndex + 1 : <Check className="h-3.5 w-3.5" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 2 & 3: Studio Preview + Filter Engine or Details */}
        {(step === 'edit' || step === 'details') && (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Live Preview Pane */}
            <div className="flex flex-1 flex-col items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-900/70">
              <div
                className={`relative w-full max-w-[380px] overflow-hidden rounded-xl bg-black shadow-sm ${previewRatioClass}`}
              >
                {isActiveVideo ? (
                  previewVideoError ? (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 px-5 text-center text-white">
                      <AlertCircle className="mb-2 h-7 w-7 text-amber-400" />
                      <p className="text-xs font-semibold">
                        O navegador não conseguiu decodificar este formato de vídeo
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Recomendamos exportar o vídeo em MP4 (H.264 + AAC) ou WebM para máxima compatibilidade.
                      </p>
                    </div>
                  ) : (
                    <video
                      src={resolvePlayableMediaUrl(activeItem.url)}
                      controls
                      playsInline
                      loop
                      onError={() => setPreviewVideoError(true)}
                      className="h-full w-full object-cover transition-all duration-150"
                      style={{ filter: filterCss || 'none' }}
                    />
                  )
                ) : (
                  <MediaImage
                    src={activeItem?.url}
                    alt="Pré-visualização da edição"
                    className="h-full w-full object-cover transition-all duration-150"
                    style={{ filter: filterCss || 'none' }}
                  />
                )}
              </div>

              {mediaItems.length > 1 && (
                <div className="mt-3 flex items-center gap-2">
                  {mediaItems.map((item, idx) => (
                    <button
                      key={`${item.url}_${idx}`}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={`h-11 w-11 overflow-hidden rounded-lg border-2 ${
                        idx === activeIdx
                          ? 'border-sky-500'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <MediaImage
                        src={item.url}
                        alt={`Slide ${idx + 1}`}
                        className="h-full w-full object-cover"
                        style={{ filter: filterCss || 'none' }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right Controls */}
            <div className="w-full overflow-y-auto border-t border-zinc-200 p-4 dark:border-zinc-800 md:w-[340px] md:border-t-0 md:border-l">
              {step === 'edit' ? (
                <div className="space-y-5">
                  {mode === 'post' && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        Proporção do recorte
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                        {(['4:5', '1:1', '16:9'] as const).map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => setAspectRatio(ratio)}
                            className={`rounded-lg py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                              aspectRatio === ratio
                                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                                : 'text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Edit Mode Tabs */}
                  <div className="flex border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setEditTab('filters')}
                      className={`flex-1 border-b-2 py-2 text-xs font-semibold ${
                        editTab === 'filters'
                          ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
                          : 'border-transparent text-zinc-500'
                      }`}
                    >
                      Filtros
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTab('adjust')}
                      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-semibold ${
                        editTab === 'adjust'
                          ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
                          : 'border-transparent text-zinc-500'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Ajustes</span>
                    </button>
                  </div>

                  {editTab === 'filters' ? (
                    <div className="grid grid-cols-3 gap-2.5">
                      {FILTER_PRESETS.map((preset) => {
                        const active = adjustments.preset === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() =>
                              setAdjustments((prev) => ({ ...prev, preset: preset.id }))
                            }
                            className="flex flex-col items-center gap-1.5"
                          >
                            <div
                              className={`aspect-square w-full overflow-hidden rounded-xl border-2 bg-zinc-900 ${
                                active ? 'border-sky-500' : 'border-transparent'
                              }`}
                            >
                              {isActiveVideo ? (
                                <video
                                  src={resolvePlayableMediaUrl(activeItem.url)}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="h-full w-full object-cover"
                                  style={{ filter: preset.css || 'none' }}
                                />
                              ) : (
                                <MediaImage
                                  src={activeItem?.url}
                                  alt={preset.name}
                                  className="h-full w-full object-cover"
                                  style={{ filter: preset.css || 'none' }}
                                />
                              )}
                            </div>
                            <span
                              className={`text-xs ${
                                active
                                  ? 'font-semibold text-sky-600 dark:text-sky-400'
                                  : 'text-zinc-600 dark:text-zinc-400'
                              }`}
                            >
                              {preset.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {[
                        {
                          key: 'brightness' as const,
                          label: 'Brilho',
                          min: 60,
                          max: 140,
                        },
                        {
                          key: 'contrast' as const,
                          label: 'Contraste',
                          min: 60,
                          max: 140,
                        },
                        {
                          key: 'saturate' as const,
                          label: 'Saturação',
                          min: 20,
                          max: 180,
                        },
                        {
                          key: 'warmth' as const,
                          label: 'Temperatura',
                          min: -30,
                          max: 30,
                        },
                      ].map((slider) => (
                        <label key={slider.key} className="block space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium text-zinc-700 dark:text-zinc-300">
                              {slider.label}
                            </span>
                            <span className="font-mono text-zinc-500 tabular-nums">
                              {adjustments[slider.key]}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={slider.min}
                            max={slider.max}
                            value={adjustments[slider.key]}
                            onChange={(e) =>
                              setAdjustments((prev) => ({
                                ...prev,
                                [slider.key]: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-sky-600"
                          />
                        </label>
                      ))}

                      <button
                        type="button"
                        onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                        className="w-full rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                      >
                        Redefinir ajustes
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Legenda
                    </label>
                    <textarea
                      rows={4}
                      maxLength={400}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Escreva uma legenda, use #hashtags ou @menções..."
                      className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                    <p className="mt-1 text-right text-[11px] text-zinc-400 tabular-nums">
                      {caption.length}/400
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>Localização</span>
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Ex: São Paulo, Brasil"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>

                  {mode !== 'story' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Categoria no Explorar
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as PostCategory)}
                        className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {mode === 'reel' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Trilha sonora
                      </label>
                      <input
                        type="text"
                        value={audioTrack}
                        onChange={(e) => setAudioTrack(e.target.value)}
                        className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

