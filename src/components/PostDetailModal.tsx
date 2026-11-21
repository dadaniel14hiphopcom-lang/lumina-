import {
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatCompactCount, formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { RichCaption } from './RichCaption';

export function PostDetailModal() {
  const {
    selectedPostId,
    setSelectedPostId,
    posts,
    currentUser,
    getUserById,
    toggleLikePost,
    toggleSavePost,
    addComment,
    toggleLikeComment,
    deletePost,
    openProfile,
    setSharePostId,
  } = useSocial();

  const [slide, setSlide] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(null);

  const post = posts.find((p) => p.id === selectedPostId);
  const author = post ? getUserById(post.authorId) : undefined;

  useEffect(() => {
    setSlide(0);
    setCommentText('');
    setReplyingTo(null);
  }, [selectedPostId]);

  useEffect(() => {
    if (!selectedPostId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPostId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPostId]);

  if (!post || !author) return null;

  const isLiked = post.likes.includes(currentUser.id);
  const isSaved = post.savedBy.includes(currentUser.id);
  const isOwn = post.authorId === currentUser.id;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment(post.id, commentText, replyingTo?.id);
    setCommentText('');
    setReplyingTo(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 backdrop-blur-sm md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Publicação de ${author.username}`}
      onClick={() => setSelectedPostId(null)}
    >
      <button
        type="button"
        onClick={() => setSelectedPostId(null)}
        aria-label="Fechar detalhes da publicação"
        className="fixed top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white dark:bg-zinc-950 md:h-[85vh] md:max-h-[760px] md:flex-row md:rounded-2xl md:border md:border-zinc-200 dark:md:border-zinc-800"
      >
        {/* Left: Media Viewer */}
        <div className="relative flex aspect-square w-full shrink-0 items-center justify-center bg-black md:aspect-auto md:h-full md:flex-1">
          <MediaImage
            src={post.media[slide]?.url}
            alt={post.media[slide]?.alt || post.caption}
            className="max-h-full w-full object-contain"
          />

          {post.media.length > 1 && (
            <>
              {slide > 0 && (
                <button
                  type="button"
                  onClick={() => setSlide((s) => s - 1)}
                  aria-label="Imagem anterior"
                  className="absolute top-1/2 left-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              {slide < post.media.length - 1 && (
                <button
                  type="button"
                  onClick={() => setSlide((s) => s + 1)}
                  aria-label="Próxima imagem"
                  className="absolute top-1/2 right-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: Info & Comments Thread */}
        <div className="flex min-h-0 flex-1 flex-col md:w-[400px] md:flex-none md:border-l md:border-zinc-200 dark:md:border-zinc-800">
          {/* Author Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setSelectedPostId(null);
                openProfile(author.id);
              }}
              className="flex items-center gap-3 text-left"
            >
              <AvatarRing src={author.avatarUrl} alt={author.username} size="sm" />
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                    {author.username}
                  </span>
                  {author.verified && <BadgeCheck className="h-4 w-4 text-sky-500" />}
                </div>
                {post.location && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{post.location}</p>
                )}
              </div>
            </button>

            {isOwn && (
              <button
                type="button"
                onClick={() => deletePost(post.id)}
                aria-label="Excluir publicação"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Scrollable Comments */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {/* Caption as top entry */}
            {post.caption && (
              <div className="flex gap-3">
                <AvatarRing src={author.avatarUrl} alt={author.username} size="xs" />
                <div className="flex-1 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPostId(null);
                      openProfile(author.id);
                    }}
                    className="mr-1.5 font-semibold hover:underline"
                  >
                    {author.username}
                  </button>
                  <RichCaption text={post.caption} />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {formatRelativeTime(post.createdAt)} · {post.category}
                  </p>
                </div>
              </div>
            )}

            {post.comments.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Ainda sem comentários
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Inicie a conversa abaixo.
                </p>
              </div>
            ) : (
              post.comments.map((comment) => {
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
                          setSelectedPostId(null);
                          openProfile(cUser.id);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug text-zinc-900 dark:text-zinc-100">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPostId(null);
                              openProfile(cUser.id);
                            }}
                            className="mr-1.5 font-semibold hover:underline"
                          >
                            {cUser.username}
                          </button>
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
                            onClick={() =>
                              setReplyingTo({ id: comment.id, username: cUser.username })
                            }
                            className="font-semibold hover:text-zinc-800 dark:hover:text-zinc-200"
                          >
                            Responder
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleLikeComment(post.id, comment.id)}
                        aria-label="Curtir comentário"
                        className="mt-1 flex h-7 w-7 items-center justify-center text-zinc-400 hover:text-rose-500"
                      >
                        <Heart
                          className={`h-3.5 w-3.5 ${
                            cLiked ? 'fill-rose-500 text-rose-500' : ''
                          }`}
                        />
                      </button>
                    </div>

                    {/* Nested replies */}
                    {comment.replies.length > 0 && (
                      <div className="ml-10 space-y-2.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                        {comment.replies.map((rep) => {
                          const rUser = getUserById(rep.userId);
                          if (!rUser) return null;
                          return (
                            <div key={rep.id} className="flex items-start gap-2.5">
                              <AvatarRing src={rUser.avatarUrl} alt={rUser.username} size="xs" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm leading-snug text-zinc-900 dark:text-zinc-100">
                                  <span className="mr-1.5 font-semibold">{rUser.username}</span>
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

          {/* Actions & Composer */}
          <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleLikePost(post.id)}
                  aria-label="Curtir"
                  className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <Heart
                    className={`h-5 w-5 ${
                      isLiked ? 'fill-rose-500 text-rose-500' : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  aria-label="Comentar"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  <MessageCircle className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSharePostId(post.id)}
                  aria-label="Compartilhar"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => toggleSavePost(post.id)}
                aria-label="Salvar"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <Bookmark
                  className={`h-5 w-5 ${isSaved ? 'fill-zinc-900 dark:fill-zinc-100' : ''}`}
                />
              </button>
            </div>

            <p className="pb-2 text-xs font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
              {formatCompactCount(post.likes.length)}{' '}
              {post.likes.length === 1 ? 'curtida' : 'curtidas'} ·{' '}
              {formatRelativeTime(post.createdAt)}
            </p>

            {replyingTo && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span>Respondendo a @{replyingTo.username}</span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={
                  replyingTo
                    ? `Responder para @${replyingTo.username}...`
                    : 'Adicione um comentário...'
                }
                className="h-10 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={!commentText.trim()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-950"
              >
                Enviar
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
