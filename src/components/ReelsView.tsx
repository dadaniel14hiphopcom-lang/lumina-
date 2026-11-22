import {
  BadgeCheck,
  Bookmark,
  Heart,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { Post } from '../types';
import {
  diagnoseVideoPlaybackError,
  isVideoAsset,
  resolvePlayableMediaUrl,
} from '../utils/media';
import { formatCompactCount, formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { ProfileHoverCard } from './ProfileHoverCard';
import { RichCaption } from './RichCaption';

function ReelVideoFrame({
  src,
  muted,
  active,
  paused,
  filterCss,
  onFallbackMute,
  onDeleteBroken,
}: {
  src: string;
  muted: boolean;
  active: boolean;
  paused: boolean;
  filterCss?: string;
  onFallbackMute: () => void;
  onDeleteBroken?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resolvedSrc = resolvePlayableMediaUrl(src);
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setHasError(false);
    setErrorMessage('');
    setProgress(0);
  }, [resolvedSrc]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted, retryKey]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || hasError) return;

    if (!active || paused) {
      el.pause();
      return;
    }

    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Browser blocked unmuted autoplay on scroll: mute and play immediately
        if (!el.muted) {
          el.muted = true;
          onFallbackMute();
          el.play().catch(() => {});
        }
      });
    }
  }, [active, paused, resolvedSrc, hasError, retryKey, onFallbackMute]);

  if (hasError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 px-6 text-center text-white">
        <p className="text-sm font-semibold">Não foi possível reproduzir este vídeo</p>
        <p className="mt-1.5 text-xs text-zinc-400">
          {errorMessage ||
            (resolvedSrc.startsWith('blob:')
              ? 'Este vídeo antigo expirou porque foi salvo apenas na sessão local.'
              : 'O codec do vídeo não é compatível com este navegador ou a mídia falhou ao carregar.')}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHasError(false);
              setErrorMessage('');
              setRetryKey((k) => k + 1);
            }}
            className="rounded-xl bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25"
          >
            Tentar novamente
          </button>
          {onDeleteBroken && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteBroken();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600/85 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Excluir Reel</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <video
        key={`${resolvedSrc}_${retryKey}`}
        ref={videoRef}
        src={resolvedSrc}
        autoPlay={active}
        loop
        muted={muted}
        playsInline
        preload="auto"
        onError={() => {
          setHasError(true);
          diagnoseVideoPlaybackError(resolvedSrc)
            .then((msg) => setErrorMessage(msg))
            .catch(() => {});
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0) {
            setProgress((v.currentTime / v.duration) * 100);
          }
        }}
        className="h-full w-full object-cover"
        style={{ filter: filterCss || 'none' }}
      />
      {/* Subtle bottom playback progress bar */}
      <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-0.5 bg-white/20">
        <div
          className="h-full bg-white transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}

function ReelCommentsSheet({
  reel,
  onClose,
}: {
  reel: Post;
  onClose: () => void;
}) {
  const {
    currentUser,
    getUserById,
    addComment,
    toggleLikeComment,
    openProfile,
  } = useSocial();

  const [composerOpen, setComposerOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const author = getUserById(reel.authorId);
  const totalComments =
    reel.comments.length +
    reel.comments.reduce((acc, c) => acc + c.replies.length, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (composerOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [composerOpen, replyingTo]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment(reel.id, commentText, replyingTo?.id);
    setCommentText('');
    setReplyingTo(null);
    setComposerOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Comentários do Reel"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[78vh] max-h-[640px] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Sheet Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            <h3 className="text-sm font-bold text-zinc-950 dark:text-white">
              Comentários
            </h3>
            <span className="text-xs font-medium text-zinc-500 tabular-nums dark:text-zinc-400">
              ({formatCompactCount(totalComments)})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar comentários"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Comments List (unobstructed!) */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          {author && reel.caption && (
            <div className="flex gap-3 border-b border-zinc-100 pb-3.5 dark:border-zinc-800/80">
              <AvatarRing src={author.avatarUrl} alt={author.username} size="xs" />
              <div className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openProfile(author.id);
                  }}
                  className="mr-1.5 font-semibold text-zinc-950 hover:underline dark:text-white"
                >
                  {author.username}
                </button>
                <RichCaption text={reel.caption} />
                <p className="mt-1 text-[11px] text-zinc-400">
                  {formatRelativeTime(reel.createdAt)}
                </p>
              </div>
            </div>
          )}

          {reel.comments.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Nenhum comentário ainda
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Toque no botão abaixo se quiser deixar o primeiro comentário.
              </p>
            </div>
          ) : (
            reel.comments.map((comment) => {
              const cUser = getUserById(comment.userId);
              if (!cUser) return null;
              const cLiked = comment.likes.includes(currentUser.id);

              return (
                <div key={comment.id} className="space-y-3">
                  <div className="flex items-start gap-3">
                    <AvatarRing
                      src={cUser.avatarUrl}
                      alt={cUser.username}
                      size="xs"
                      onClick={() => {
                        onClose();
                        openProfile(cUser.id);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-zinc-900 dark:text-zinc-100">
                        <ProfileHoverCard userId={cUser.id} onBeforeNavigate={onClose}>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              openProfile(cUser.id);
                            }}
                            className="mr-1.5 font-semibold hover:underline"
                          >
                            {cUser.username}
                          </button>
                        </ProfileHoverCard>
                        <RichCaption text={comment.text} />
                      </p>

                      <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{formatRelativeTime(comment.createdAt)}</span>
                        {comment.likes.length > 0 && (
                          <span className="tabular-nums">
                            {comment.likes.length}{' '}
                            {comment.likes.length === 1 ? 'curtida' : 'curtidas'}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo({ id: comment.id, username: cUser.username });
                            setComposerOpen(true);
                          }}
                          className="font-semibold hover:text-zinc-900 dark:hover:text-zinc-200"
                        >
                          Responder
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleLikeComment(reel.id, comment.id)}
                      aria-label="Curtir comentário"
                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 hover:text-rose-500"
                    >
                      <Heart
                        className={`h-3.5 w-3.5 ${
                          cLiked ? 'fill-rose-500 text-rose-500' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {comment.replies.length > 0 && (
                    <div className="ml-9 space-y-2.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                      {comment.replies.map((rep) => {
                        const rUser = getUserById(rep.userId);
                        if (!rUser) return null;
                        return (
                          <div key={rep.id} className="flex items-start gap-2.5">
                            <AvatarRing
                              src={rUser.avatarUrl}
                              alt={rUser.username}
                              size="xs"
                              onClick={() => {
                                onClose();
                                openProfile(rUser.id);
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug text-zinc-900 dark:text-zinc-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    openProfile(rUser.id);
                                  }}
                                  className="mr-1.5 font-semibold hover:underline"
                                >
                                  {rUser.username}
                                </button>
                                <RichCaption text={rep.text} />
                              </p>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {formatRelativeTime(rep.createdAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Collapsible Footer Composer — hidden by default so comments stay 100% readable */}
        <div className="shrink-0 border-t border-zinc-200 bg-zinc-50/70 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
          {composerOpen ? (
            <div className="space-y-2">
              {replyingTo && (
                <div className="flex items-center justify-between rounded-lg bg-zinc-200/70 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  <span>Respondendo a @{replyingTo.username}</span>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="font-semibold hover:underline"
                  >
                    Limpar
                  </button>
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={
                    replyingTo
                      ? `Responder para @${replyingTo.username}...`
                      : 'Escreva seu comentário...'
                  }
                  className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim()}
                  className="h-10 rounded-xl bg-sky-600 px-3.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
                >
                  Enviar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposerOpen(false);
                    setReplyingTo(null);
                  }}
                  aria-label="Ocultar caixa de comentário"
                  className="flex h-10 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="flex h-9 w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3.5 text-xs font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <span>Escrever um comentário...</span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">
                Comentar
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReelsView() {
  const {
    posts,
    currentUser,
    getUserById,
    toggleLikePost,
    toggleSavePost,
    toggleFollow,
    deletePost,
    setSharePostId,
    openProfile,
  } = useSocial();

  const reels = useMemo(
    () =>
      posts.filter(
        (p) => p.isReel || p.aspectRatio === '9:16' || p.aspectRatio === '4:5'
      ),
    [posts]
  );

  const [muted, setMuted] = useState(true);
  const [pausedMap, setPausedMap] = useState<Record<string, boolean>>({});
  const [activeReelId, setActiveReelId] = useState<string | null>(
    () => reels[0]?.id || null
  );
  const [commentsReelId, setCommentsReelId] = useState<string | null>(null);

  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const ratioMapRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (reels.length === 0) {
      setActiveReelId(null);
      return;
    }
    if (!activeReelId || !reels.some((r) => r.id === activeReelId)) {
      setActiveReelId(reels[0].id);
    }
  }, [reels, activeReelId]);

  // Auto-play the Reel visible in the viewport as the user scrolls past Reels
  useEffect(() => {
    if (reels.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute('data-reel-id');
          if (!id) return;
          ratioMapRef.current.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        let bestId: string | null = null;
        let bestRatio = 0.45;
        ratioMapRef.current.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        });

        if (bestId) {
          setActiveReelId(bestId);
        }
      },
      {
        threshold: [0, 0.25, 0.5, 0.75, 0.95],
      }
    );

    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reels]);

  const commentsReel = commentsReelId
    ? reels.find((r) => r.id === commentsReelId) || null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center py-4 sm:py-6">
      {reels.length === 0 ? (
        <div className="w-full max-w-[420px] rounded-2xl border border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nenhum Reel publicado ainda
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Crie um vídeo curto no botão Criar para publicar aqui.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-[420px] snap-y snap-mandatory space-y-6 px-2 sm:px-0">
          {reels.map((reel) => {
            const author = getUserById(reel.authorId);
            if (!author) return null;
            const isLiked = reel.likes.includes(currentUser.id);
            const isSaved = reel.savedBy.includes(currentUser.id);
            const isFollowing = currentUser.following.includes(author.id);
            const isOwn = author.id === currentUser.id;
            const isManuallyPaused = Boolean(pausedMap[reel.id]);
            const isInView = activeReelId === reel.id;
            const isVideo = isVideoAsset(reel.media[0]);

            const totalComments =
              reel.comments.length +
              reel.comments.reduce((acc, c) => acc + c.replies.length, 0);

            return (
              <section
                key={reel.id}
                data-reel-id={reel.id}
                ref={(el) => {
                  if (el) sectionRefs.current.set(reel.id, el);
                  else sectionRefs.current.delete(reel.id);
                }}
                className="relative aspect-[9/15] max-h-[82vh] w-full snap-center overflow-hidden rounded-2xl bg-zinc-950 shadow-lg"
              >
                {/* Video or Animated Motion Frame */}
                <div
                  onClick={() =>
                    setPausedMap((prev) => ({ ...prev, [reel.id]: !prev[reel.id] }))
                  }
                  className="relative h-full w-full cursor-pointer overflow-hidden"
                >
                  {isVideo ? (
                    <ReelVideoFrame
                      src={reel.media[0].url}
                      muted={muted}
                      active={isInView}
                      paused={isManuallyPaused}
                      filterCss={reel.media[0].filterCss}
                      onFallbackMute={() => setMuted(true)}
                      onDeleteBroken={isOwn ? () => deletePost(reel.id) : undefined}
                    />
                  ) : (
                    <MediaImage
                      src={reel.media[0]?.url}
                      alt={reel.caption}
                      className={`h-full w-full object-cover ${
                        isInView && !isManuallyPaused ? 'animate-kenburns' : ''
                      }`}
                    />
                  )}

                  {/* Top Mute/Play Controls */}
                  <div className="absolute top-3 right-3 left-3 z-10 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPausedMap((prev) => ({
                          ...prev,
                          [reel.id]: !prev[reel.id],
                        }));
                      }}
                      aria-label={isManuallyPaused ? 'Reproduzir reel' : 'Pausar reel'}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-xs"
                    >
                      {isManuallyPaused || !isInView ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMuted((m) => !m);
                      }}
                      aria-label={muted ? 'Ativar áudio' : 'Silenciar áudio'}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-xs"
                    >
                      {muted ? (
                        <VolumeX className="h-4 w-4" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Bottom Overlay Metadata */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                </div>

                {/* Right Action Rail */}
                <div className="absolute right-3 bottom-5 z-10 flex flex-col items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleLikePost(reel.id)}
                    aria-label="Curtir reel"
                    className="flex flex-col items-center gap-1 text-white"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-xs">
                      <Heart
                        className={`h-6 w-6 ${
                          isLiked ? 'fill-rose-500 text-rose-500' : 'text-white'
                        }`}
                      />
                    </span>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatCompactCount(reel.likes.length)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCommentsReelId(reel.id)}
                    aria-label="Comentários do reel"
                    className="flex flex-col items-center gap-1 text-white"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-xs">
                      <MessageCircle className="h-6 w-6" />
                    </span>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatCompactCount(totalComments)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSharePostId(reel.id)}
                    aria-label="Compartilhar reel"
                    className="flex flex-col items-center gap-1 text-white"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-xs">
                      <Send className="h-5 w-5" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSavePost(reel.id)}
                    aria-label="Salvar reel"
                    className="flex flex-col items-center gap-1 text-white"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-xs">
                      <Bookmark
                        className={`h-5 w-5 ${isSaved ? 'fill-white' : ''}`}
                      />
                    </span>
                  </button>
                </div>

                {/* Left Author & Caption */}
                <div className="absolute right-16 bottom-5 left-4 z-10 space-y-2.5 text-white">
                  <div className="flex items-center gap-2.5">
                    <AvatarRing
                      src={author.avatarUrl}
                      alt={author.username}
                      size="sm"
                      onClick={() => openProfile(author.id)}
                    />
                    <button
                      type="button"
                      onClick={() => openProfile(author.id)}
                      className="flex items-center gap-1 text-sm font-semibold hover:underline"
                    >
                      <span>{author.username}</span>
                      {author.verified && <BadgeCheck className="h-4 w-4 text-sky-400" />}
                    </button>
                    {!isOwn && (
                      <button
                        type="button"
                        onClick={() => toggleFollow(author.id)}
                        className="rounded-lg border border-white/50 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15"
                      >
                        {isFollowing ? 'Seguindo' : 'Seguir'}
                      </button>
                    )}
                  </div>

                  {reel.caption && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-white/95">
                      <RichCaption text={reel.caption} />
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 text-xs text-white/80">
                    <Music2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {reel.audioTrack || `Áudio original · ${author.username}`}
                    </span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {commentsReel && (
        <ReelCommentsSheet
          reel={commentsReel}
          onClose={() => setCommentsReelId(null)}
        />
      )}
    </div>
  );
}
