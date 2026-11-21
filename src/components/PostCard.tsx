import {
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, { useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { Post } from '../types';
import { isVideoAsset } from '../utils/media';
import { formatCompactCount, formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { RichCaption } from './RichCaption';

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  const {
    currentUser,
    getUserById,
    stories,
    toggleLikePost,
    toggleSavePost,
    toggleFollow,
    addComment,
    deletePost,
    openProfile,
    setSelectedPostId,
    setActiveStoryAuthorId,
    setSharePostId,
    showToast,
  } = useSocial();

  const author = getUserById(post.authorId);
  const [slide, setSlide] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedCaption, setExpandedCaption] = useState(false);
  const [commentText, setCommentText] = useState('');

  if (!author) return null;

  const isLiked = post.likes.includes(currentUser.id);
  const isSaved = post.savedBy.includes(currentUser.id);
  const isFollowing = currentUser.following.includes(author.id);
  const isOwn = author.id === currentUser.id;

  const authorStories = stories.filter((s) => s.authorId === author.id);
  const hasStory = authorStories.length > 0;
  const hasUnseenStory = authorStories.some((s) => !s.viewedBy.includes(currentUser.id));

  const firstLikedFriend = post.likes
    .map((id) => getUserById(id))
    .find((u) => u && u.id !== currentUser.id);

  const handleDoubleTap = () => {
    if (!isLiked) {
      toggleLikePost(post.id);
    }
    setShowBurst(true);
    window.setTimeout(() => setShowBurst(false), 750);
  };

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment(post.id, commentText);
    setCommentText('');
  };

  const aspectClass =
    post.aspectRatio === '1:1'
      ? 'aspect-square'
      : post.aspectRatio === '16:9'
      ? 'aspect-video'
      : 'aspect-[4/5]';

  const totalComments =
    post.comments.length +
    post.comments.reduce((acc, c) => acc + c.replies.length, 0);

  return (
    <article className="border-b border-zinc-200 bg-white pb-4 dark:border-zinc-800/80 dark:bg-[#050505] sm:rounded-xl sm:border sm:pb-5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarRing
            src={author.avatarUrl}
            alt={author.username}
            size="sm"
            hasStory={hasStory}
            hasUnseenStory={hasUnseenStory}
            onClick={() => {
              if (hasStory) setActiveStoryAuthorId(author.id);
              else openProfile(author.id);
            }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openProfile(author.id)}
                className="truncate text-sm font-semibold text-zinc-950 hover:opacity-75 dark:text-zinc-100"
              >
                {author.username}
              </button>
              {author.verified && (
                <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" aria-label="Perfil verificado" />
              )}
              <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {formatRelativeTime(post.createdAt)}
              </span>
              {author.boosted && (
                <>
                  <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
                  <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                    Impulsionado
                  </span>
                </>
              )}
              {author.restricted && (
                <>
                  <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
                  <span className="shrink-0 text-xs font-medium text-rose-600 dark:text-rose-400">
                    Conta restrita
                  </span>
                </>
              )}
              {!isOwn && !isFollowing && (
                <>
                  <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => toggleFollow(author.id)}
                    className="shrink-0 text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400"
                  >
                    Seguir
                  </button>
                </>
              )}
            </div>
            {post.location && (
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {post.location}
              </p>
            )}
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Mais opções"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>

          {menuOpen && (
            <div
              className="absolute top-11 right-0 z-20 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href).catch(() => {});
                  showToast('Link copiado para a área de transferência');
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Link2 className="h-4 w-4" />
                <span>Copiar link</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleSavePost(post.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Bookmark className="h-4 w-4" />
                <span>{isSaved ? 'Remover dos salvos' : 'Salvar publicação'}</span>
              </button>
              {isOwn && (
                <button
                  type="button"
                  onClick={() => {
                    deletePost(post.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 border-t border-zinc-100 px-4 py-3 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Excluir</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Media Stage with Double-Tap & Carousel */}
      <div
        onDoubleClick={handleDoubleTap}
        className={`relative w-full select-none overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${aspectClass}`}
      >
        {isVideoAsset(post.media[slide]) ? (
          <video
            src={post.media[slide]?.url}
            controls
            playsInline
            loop
            className="h-full w-full object-cover"
            style={{ filter: post.media[slide]?.filterCss || 'none' }}
          />
        ) : (
          <MediaImage
            src={post.media[slide]?.url}
            alt={post.media[slide]?.alt || post.caption}
            className="h-full w-full object-cover"
            fallbackLabel={post.location || author.username}
          />
        )}

        {/* Double-tap Heart Burst */}
        <AnimatePresence>
          {showBurst && (
            <motion.div
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1.15, opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <Heart className="h-24 w-24 fill-white text-white drop-shadow-xl" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Carousel Controls */}
        {post.media.length > 1 && (
          <>
            {slide > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSlide((s) => s - 1);
                }}
                aria-label="Imagem anterior"
                className="absolute top-1/2 left-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform hover:scale-105"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {slide < post.media.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSlide((s) => s + 1);
                }}
                aria-label="Próxima imagem"
                className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform hover:scale-105"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
              {slide + 1}/{post.media.length}
            </div>

            <div className="absolute right-0 bottom-3 left-0 flex justify-center gap-1.5">
              {post.media.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`Ir para imagem ${idx + 1}`}
                  onClick={() => setSlide(idx)}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === slide ? 'w-4 bg-white' : 'w-1.5 bg-white/50'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1 sm:px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleLikePost(post.id)}
            aria-label={isLiked ? 'Descurtir publicação' : 'Curtir publicação'}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
          >
            <Heart
              className={`h-6 w-6 transition-colors ${
                isLiked
                  ? 'fill-rose-500 text-rose-500'
                  : 'text-zinc-900 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400'
              }`}
              strokeWidth={1.9}
            />
          </button>

          <button
            type="button"
            onClick={() => setSelectedPostId(post.id)}
            aria-label="Ver e adicionar comentários"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-900 transition-transform hover:text-zinc-600 active:scale-90 dark:text-zinc-100 dark:hover:text-zinc-400"
          >
            <MessageCircle className="h-6 w-6" strokeWidth={1.9} />
          </button>

          <button
            type="button"
            onClick={() => setSharePostId(post.id)}
            aria-label="Compartilhar por mensagem"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-900 transition-transform hover:text-zinc-600 active:scale-90 dark:text-zinc-100 dark:hover:text-zinc-400"
          >
            <Send className="h-6 w-6" strokeWidth={1.9} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => toggleSavePost(post.id)}
          aria-label={isSaved ? 'Remover dos salvos' : 'Salvar publicação'}
          className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-900 transition-transform hover:text-zinc-600 active:scale-90 dark:text-zinc-100 dark:hover:text-zinc-400"
        >
          <Bookmark
            className={`h-6 w-6 ${isSaved ? 'fill-zinc-900 dark:fill-zinc-100' : ''}`}
            strokeWidth={1.9}
          />
        </button>
      </div>

      {/* Likes & Caption & Inline Comments */}
      <div className="space-y-1.5 px-3 sm:px-4">
        {post.likes.length > 0 && (
          <div className="text-sm text-zinc-900 dark:text-zinc-100">
            {firstLikedFriend && post.likes.length > 1 ? (
              <p>
                Curtido por{' '}
                <button
                  type="button"
                  onClick={() => openProfile(firstLikedFriend.id)}
                  className="font-semibold hover:underline"
                >
                  {firstLikedFriend.username}
                </button>{' '}
                e{' '}
                <button
                  type="button"
                  onClick={() => setSelectedPostId(post.id)}
                  className="font-semibold tabular-nums hover:underline"
                >
                  {formatCompactCount(post.likes.length - 1)}{' '}
                  {post.likes.length - 1 === 1 ? 'outra pessoa' : 'outras pessoas'}
                </button>
              </p>
            ) : (
              <p className="font-semibold tabular-nums">
                {formatCompactCount(post.likes.length)}{' '}
                {post.likes.length === 1 ? 'curtida' : 'curtidas'}
              </p>
            )}
          </div>
        )}

        {post.caption && (
          <div className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">
            <button
              type="button"
              onClick={() => openProfile(author.id)}
              className="mr-1.5 font-semibold hover:opacity-75"
            >
              {author.username}
            </button>
            <span className={expandedCaption ? '' : 'line-clamp-2'}>
              <RichCaption text={post.caption} />
            </span>
            {!expandedCaption && post.caption.length > 110 && (
              <button
                type="button"
                onClick={() => setExpandedCaption(true)}
                className="mt-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
              >
                mais
              </button>
            )}
          </div>
        )}

        {totalComments > 0 && (
          <button
            type="button"
            onClick={() => setSelectedPostId(post.id)}
            className="block text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Ver {totalComments === 1 ? '1 comentário' : `todos os ${totalComments} comentários`}
          </button>
        )}

        {/* Quick inline comment */}
        <form
          onSubmit={handleSubmitComment}
          className="flex items-center gap-2 pt-1"
        >
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Adicione um comentário..."
            className="h-9 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          {commentText.trim().length > 0 && (
            <button
              type="submit"
              className="text-sm font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400"
            >
              Publicar
            </button>
          )}
        </form>
      </div>
    </article>
  );
}
