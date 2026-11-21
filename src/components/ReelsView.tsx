import {
  BadgeCheck,
  Bookmark,
  Heart,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { RichCaption } from './RichCaption';

export function ReelsView() {
  const {
    posts,
    currentUser,
    getUserById,
    toggleLikePost,
    toggleSavePost,
    toggleFollow,
    setSelectedPostId,
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center py-4 sm:py-6">
      <div className="w-full max-w-[420px] snap-y snap-mandatory space-y-6 px-2 sm:px-0">
        {reels.map((reel) => {
          const author = getUserById(reel.authorId);
          if (!author) return null;
          const isLiked = reel.likes.includes(currentUser.id);
          const isSaved = reel.savedBy.includes(currentUser.id);
          const isFollowing = currentUser.following.includes(author.id);
          const isOwn = author.id === currentUser.id;
          const isPaused = Boolean(pausedMap[reel.id]);

          const totalComments =
            reel.comments.length +
            reel.comments.reduce((acc, c) => acc + c.replies.length, 0);

          return (
            <section
              key={reel.id}
              className="relative aspect-[9/15] w-full snap-center overflow-hidden rounded-2xl bg-zinc-950 shadow-lg"
            >
              {/* Animated Motion Frame */}
              <div
                onClick={() =>
                  setPausedMap((prev) => ({ ...prev, [reel.id]: !prev[reel.id] }))
                }
                className="relative h-full w-full cursor-pointer overflow-hidden"
              >
                <MediaImage
                  src={reel.media[0]?.url}
                  alt={reel.caption}
                  className={`h-full w-full object-cover ${
                    isPaused ? '' : 'animate-kenburns'
                  }`}
                />

                {/* Top Mute/Play Controls */}
                <div className="absolute top-3 right-3 left-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPausedMap((prev) => ({
                        ...prev,
                        [reel.id]: !prev[reel.id],
                      }));
                    }}
                    aria-label={isPaused ? 'Reproduzir reel' : 'Pausar reel'}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-xs"
                  >
                    {isPaused ? (
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
                  onClick={() => setSelectedPostId(reel.id)}
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
    </div>
  );
}
