import { ChevronLeft, ChevronRight, Pause, Play, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

const STORY_DURATION_MS = 5500;
const QUICK_EMOJIS = ['❤️', '🔥', '👏', '😍'];

export function StoryViewer() {
  const {
    activeStoryAuthorId,
    setActiveStoryAuthorId,
    stories,
    getUserById,
    currentUser,
    markStoryViewed,
    reactToStory,
    sendMessage,
    showToast,
    openProfile,
  } = useSocial();

  const authorGroups = useMemo(() => {
    const order: string[] = [];
    for (const s of stories) {
      if (!order.includes(s.authorId)) order.push(s.authorId);
    }
    return order;
  }, [stories]);

  const [slideIndex, setSlideIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');

  const authorStories = useMemo(
    () => stories.filter((s) => s.authorId === activeStoryAuthorId),
    [stories, activeStoryAuthorId]
  );

  const currentStory = authorStories[slideIndex];
  const author = activeStoryAuthorId ? getUserById(activeStoryAuthorId) : undefined;

  useEffect(() => {
    setSlideIndex(0);
    setProgress(0);
    setPaused(false);
  }, [activeStoryAuthorId]);

  useEffect(() => {
    if (currentStory) {
      markStoryViewed(currentStory.id);
    }
  }, [currentStory?.id]);

  const goNext = () => {
    if (slideIndex < authorStories.length - 1) {
      setSlideIndex((i) => i + 1);
      setProgress(0);
    } else if (activeStoryAuthorId) {
      const currGroupIdx = authorGroups.indexOf(activeStoryAuthorId);
      if (currGroupIdx >= 0 && currGroupIdx < authorGroups.length - 1) {
        setActiveStoryAuthorId(authorGroups[currGroupIdx + 1]);
      } else {
        setActiveStoryAuthorId(null);
      }
    }
  };

  const goPrev = () => {
    if (slideIndex > 0) {
      setSlideIndex((i) => i - 1);
      setProgress(0);
    } else if (activeStoryAuthorId) {
      const currGroupIdx = authorGroups.indexOf(activeStoryAuthorId);
      if (currGroupIdx > 0) {
        setActiveStoryAuthorId(authorGroups[currGroupIdx - 1]);
      } else {
        setProgress(0);
      }
    }
  };

  useEffect(() => {
    if (!activeStoryAuthorId || !currentStory || paused) return;
    let last = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setProgress((prev) => {
        const next = prev + (delta / STORY_DURATION_MS) * 100;
        if (next >= 100) {
          goNext();
          return 0;
        }
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [activeStoryAuthorId, currentStory?.id, paused, slideIndex]);

  useEffect(() => {
    if (!activeStoryAuthorId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveStoryAuthorId(null);
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeStoryAuthorId, slideIndex, authorStories.length]);

  if (!activeStoryAuthorId || !currentStory || !author) return null;

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    sendMessage(author.id, replyText, { storyReplyUrl: currentStory.mediaUrl });
    setReplyText('');
    showToast(`Resposta enviada para @${author.username}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95 p-0 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Story de ${author.username}`}
    >
      {/* Desktop Prev Arrow */}
      <button
        type="button"
        onClick={goPrev}
        aria-label="Story anterior"
        className="hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:mr-6 md:flex"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      {/* Story Frame */}
      <div className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden bg-zinc-900 sm:h-[86vh] sm:max-h-[780px] sm:rounded-2xl">
        {/* Progress Bars */}
        <div className="absolute top-0 right-0 left-0 z-20 flex gap-1.5 px-3 pt-3">
          {authorStories.map((st, idx) => {
            const width =
              idx < slideIndex ? 100 : idx === slideIndex ? progress : 0;
            return (
              <div
                key={st.id}
                className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30"
              >
                <div
                  className="h-full bg-white transition-none"
                  style={{ width: `${width}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* Top Header */}
        <div className="absolute top-4 right-0 left-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 pt-2 pb-6">
          <button
            type="button"
            onClick={() => {
              setActiveStoryAuthorId(null);
              openProfile(author.id);
            }}
            className="flex items-center gap-2.5 text-left"
          >
            <AvatarRing src={author.avatarUrl} alt={author.username} size="sm" />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <span>{author.username}</span>
                <span className="text-xs font-normal text-white/75">
                  · {formatRelativeTime(currentStory.createdAt)}
                </span>
              </div>
              {currentStory.location && (
                <p className="text-xs text-white/80">{currentStory.location}</p>
              )}
            </div>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Continuar story' : 'Pausar story'}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setActiveStoryAuthorId(null)}
              aria-label="Fechar story"
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Media Canvas + Tap Zones */}
        <div className="relative flex-1 bg-black">
          <MediaImage
            src={currentStory.mediaUrl}
            alt={currentStory.caption || `Story de ${author.username}`}
            className="h-full w-full object-cover"
          />

          <button
            type="button"
            onClick={goPrev}
            aria-label="Voltar story"
            className="absolute inset-y-16 left-0 z-10 w-1/3 cursor-pointer focus:outline-none"
          />
          <button
            type="button"
            onClick={goNext}
            aria-label="Avançar story"
            className="absolute inset-y-16 right-0 z-10 w-2/3 cursor-pointer focus:outline-none"
          />

          {currentStory.caption && (
            <div className="pointer-events-none absolute right-4 bottom-24 left-4 z-10 text-center">
              <span className="inline-block rounded-lg bg-black/55 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
                {currentStory.caption}
              </span>
            </div>
          )}
        </div>

        {/* Bottom Reply & Quick Reactions */}
        <div className="absolute right-0 bottom-0 left-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-8 pb-4">
          {author.id !== currentUser.id ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-center gap-3">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => reactToStory(currentStory.id, emoji)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg transition-transform hover:scale-110 active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSendReply} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Responder a ${author.username}...`}
                  className="h-11 flex-1 rounded-full border border-white/30 bg-black/35 px-4 text-sm text-white placeholder:text-white/65 focus:border-white focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Enviar resposta"
                  disabled={!replyText.trim()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          ) : (
            <div className="text-center text-xs text-white/80 tabular-nums">
              Visualizado por {currentStory.viewedBy.length} {currentStory.viewedBy.length === 1 ? 'pessoa' : 'pessoas'}
            </div>
          )}
        </div>
      </div>

      {/* Desktop Next Arrow */}
      <button
        type="button"
        onClick={goNext}
        aria-label="Próximo story"
        className="hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:ml-6 md:flex"
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </div>
  );
}
