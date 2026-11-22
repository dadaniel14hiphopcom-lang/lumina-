import { Check, ExternalLink, Globe, Link2, Send, Share2, X } from 'lucide-react';
import { useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';

export function ShareSheetModal() {
  const {
    sharePostId,
    setSharePostId,
    posts,
    users,
    currentUser,
    sendMessage,
    showToast,
  } = useSocial();

  const [sentIds, setSentIds] = useState<string[]>([]);
  const [note, setNote] = useState('');

  if (!sharePostId) return null;

  const targetPost = posts.find((p) => p.id === sharePostId);
  const author = targetPost ? users.find((u) => u.id === targetPost.authorId) : undefined;
  const recipients = users.filter((u) => u.id !== currentUser.id);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?post=${encodeURIComponent(sharePostId)}`
      : `?post=${encodeURIComponent(sharePostId)}`;
  const shareHost =
    typeof window !== 'undefined' ? window.location.host : 'lumina-rede-social.appwrite.network';
  const previewTitle = author
    ? `${targetPost?.isReel ? 'Reel' : 'Publicação'} de @${author.username} na Lumina`
    : 'Lumina — Rede Social Visual';
  const previewDesc =
    targetPost?.caption?.trim() ||
    'Veja fotos, stories e reels exclusivos na rede social visual Lumina.';
  const previewImage =
    targetPost?.media.find((m) => m.mediaType !== 'video')?.url || '/og-preview.jpg';

  const handleSendTo = (userId: string, username: string) => {
    sendMessage(userId, note || 'Olha essa publicação na Lumina', {
      sharedPostId: sharePostId,
    });
    setSentIds((prev) => [...prev, userId]);
    showToast(`Enviado para @${username}`);
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard?.writeText(shareUrl);
      showToast('Link com pré-visualização copiado!');
    } catch {
      showToast('Link pronto para compartilhar');
    }
    setSharePostId(null);
  };

  const handleExternalShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: previewTitle,
          text: previewDesc.slice(0, 120),
          url: shareUrl,
        });
        setSharePostId(null);
        return;
      } catch {
        // User cancelled or Web Share unsupported in context — fall back to clipboard copy
      }
    }
    await handleCopyShareLink();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compartilhar publicação"
      onClick={() => setSharePostId(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
            Compartilhar publicação
          </h3>
          <button
            type="button"
            onClick={() => setSharePostId(null)}
            aria-label="Fechar compartilhamento"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {/* External Link Preview Card */}
          <div className="mb-4 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200/80 px-3 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-sky-500" />
                <span>Pré-visualização do link em outros sites</span>
              </span>
              <ExternalLink className="h-3 w-3" />
            </div>
            <div className="flex gap-3 p-2.5">
              <img
                src={previewImage}
                alt={previewTitle}
                className="h-16 w-24 shrink-0 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  {shareHost}
                </p>
                <p className="truncate text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  {previewTitle}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                  {previewDesc}
                </p>
              </div>
            </div>
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escreva uma mensagem opcional..."
            className="mb-3 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="max-h-52 space-y-2 overflow-y-auto">
            {recipients.map((user) => {
              const wasSent = sentIds.includes(user.id);
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="flex items-center gap-3">
                    <AvatarRing src={user.avatarUrl} alt={user.username} size="sm" />
                    <div>
                      <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                        {user.username}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {user.displayName}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={wasSent}
                    onClick={() => handleSendTo(user.id, user.username)}
                    className={`flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                      wasSent
                        ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    {wasSent ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Enviado</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>Enviar</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void handleCopyShareLink()}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Link2 className="h-4 w-4" />
              <span>Copiar link</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExternalShare()}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <Share2 className="h-4 w-4" />
              <span>Outros sites / apps</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
