import {
  Check,
  Film,
  ImagePlus,
  Layers,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { STUDIO_SAMPLE_IMAGES } from '../data/seed';
import { PostCategory, StudioAdjustments } from '../types';
import {
  buildFilterString,
  DEFAULT_ADJUSTMENTS,
  FILTER_PRESETS,
  renderFilteredImage,
} from '../utils/filters';
import { MediaImage } from './MediaImage';

interface CreateModalProps {
  initialMode?: 'post' | 'story' | 'reel';
}

const CATEGORIES: PostCategory[] = [
  'Fotografia',
  'Arquitetura',
  'Gastronomia',
  'Viagem',
  'Design',
  'Arte',
];

export function CreateModal({ initialMode = 'post' }: CreateModalProps) {
  const { isCreateOpen, setIsCreateOpen, publishPost, publishStory, showToast } =
    useSocial();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'post' | 'story' | 'reel'>(initialMode);
  const [step, setStep] = useState<'pick' | 'edit' | 'details'>('pick');
  const [sourceUrls, setSourceUrls] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:5' | '16:9' | '9:16'>('4:5');
  const [adjustments, setAdjustments] = useState<StudioAdjustments>(DEFAULT_ADJUSTMENTS);
  const [editTab, setEditTab] = useState<'filters' | 'adjust'>('filters');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<PostCategory>('Fotografia');
  const [audioTrack, setAudioTrack] = useState('Luz Natural · Instrumental');
  const [isPublishing, setIsPublishing] = useState(false);

  if (!isCreateOpen) return null;

  const resetAndClose = () => {
    setStep('pick');
    setSourceUrls([]);
    setActiveIdx(0);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setCaption('');
    setLocation('');
    setIsCreateOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    if (files.length === 0) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(file);
          })
      )
    ).then((urls) => {
      const valid = urls.filter(Boolean);
      if (valid.length > 0) {
        setSourceUrls(valid);
        setActiveIdx(0);
        if (mode === 'story' || mode === 'reel') setAspectRatio('9:16');
        setStep('edit');
      }
    });
  };

  const handlePickSample = (url: string) => {
    setSourceUrls((prev) => {
      if (mode !== 'post') return [url];
      if (prev.includes(url)) return prev.filter((item) => item !== url);
      return [...prev, url].slice(0, 5);
    });
  };

  const handleProceedFromSamples = () => {
    if (sourceUrls.length === 0) return;
    setActiveIdx(0);
    if (mode === 'story' || mode === 'reel') setAspectRatio('9:16');
    setStep('edit');
  };

  const filterCss = buildFilterString(adjustments);

  const handlePublish = async () => {
    if (sourceUrls.length === 0 || isPublishing) return;
    setIsPublishing(true);
    try {
      const targetRatio = mode === 'story' || mode === 'reel' ? '9:16' : aspectRatio;
      const rendered = await Promise.all(
        sourceUrls.map((url) => renderFilteredImage(url, filterCss, targetRatio))
      );

      if (mode === 'story') {
        publishStory({
          mediaUrl: rendered[0],
          caption,
          location,
        });
      } else {
        publishPost({
          mediaUrls: rendered,
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
      showToast('Não foi possível processar a imagem');
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
              ? 'Filtros e recorte'
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
                onClick={() => setStep('details')}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
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
                onClick={() => setMode('post')}
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
                onClick={() => setMode('story')}
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
                onClick={() => setMode('reel')}
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

            {/* Device Upload Zone */}
            <div className="mb-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                <Upload className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Envie fotos do seu dispositivo
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {mode === 'post'
                  ? 'Selecione até 5 imagens para criar um carrossel'
                  : 'Selecione uma imagem vertical ou horizontal para editar'}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple={mode === 'post'}
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                <ImagePlus className="h-4 w-4" />
                <span>Selecionar do computador</span>
              </button>
            </div>

            {/* Curated Studio Picker */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Ou escolha do acervo do estúdio
                </h3>
                {sourceUrls.length > 0 && (
                  <button
                    type="button"
                    onClick={handleProceedFromSamples}
                    className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                  >
                    Editar selecionadas ({sourceUrls.length})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                {STUDIO_SAMPLE_IMAGES.map((sample) => {
                  const selectedIndex = sourceUrls.indexOf(sample.url);
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
                <MediaImage
                  src={sourceUrls[activeIdx]}
                  alt="Pré-visualização da edição"
                  className="h-full w-full object-cover transition-all duration-150"
                  style={{ filter: filterCss || 'none' }}
                />
              </div>

              {sourceUrls.length > 1 && (
                <div className="mt-3 flex items-center gap-2">
                  {sourceUrls.map((url, idx) => (
                    <button
                      key={`${url}_${idx}`}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={`h-11 w-11 overflow-hidden rounded-lg border-2 ${
                        idx === activeIdx
                          ? 'border-sky-500'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <MediaImage
                        src={url}
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
                              className={`aspect-square w-full overflow-hidden rounded-xl border-2 ${
                                active
                                  ? 'border-sky-500'
                                  : 'border-transparent'
                              }`}
                            >
                              <MediaImage
                                src={sourceUrls[activeIdx]}
                                alt={preset.name}
                                className="h-full w-full object-cover"
                                style={{ filter: preset.css || 'none' }}
                              />
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
