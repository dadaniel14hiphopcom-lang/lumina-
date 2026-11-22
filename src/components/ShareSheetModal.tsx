import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  MessageCircle,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [ssrActive, setSsrActive] = useState<boolean | null>(null);

  const targetPost = sharePostId ? posts.find((p) => p.id === sharePostId) : undefined;
  const author = targetPost ? users.find((u) => u.id === targetPost.authorId) : undefined;

  useEffect(() => {
    if (!sharePostId || !targetPost) return;
    let active = true;
    setSsrActive(null);

    const firstImg = targetPost.media.find((m) => m.mediaType !== 'video')?.url;
    const firstVid = targetPost.media.find((m) => m.mediaType === 'video')?.url;

    fetch('/api/social/previews/status')
      .then(async (res) => {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || !ct.includes('application/json')) {
          if (active) setSsrActive(false);
          return;
        }
        const data = (await res.json()) as { ssrActive?: boolean };
        if (active) setSsrActive(Boolean(data.ssrActive));
        await fetch('/api/social/previews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: {
              id: targetPost.id,
              authorUsername: author?.username || 'lumina',
              authorDisplayName: author?.displayName || 'Lumina',
              authorAvatarUrl: author?.avatarUrl,
              caption: (targetPost.caption || '').slice(0, 400),
              isReel: Boolean(targetPost.isReel),
              imageUrl: firstImg,
              videoUrl: firstVid && /^https?:\/\//i.test(firstVid) ? firstVid : undefined,
            },
          }),
        }).catch(() => {});
      })
      .catch(() => {
        if (active) setSsrActive(false);
      });

    return () => {
      active = false;
    };
  }, [sharePostId, targetPost, author]);

  if (!sharePostId) return null;

  const recipients = users.filter((u) => u.id !== currentUser.id);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?post=${encodeURIComponent(sharePostId)}`
      : `https://lumina-rede-social.appwrite.network/?post=${encodeURIComponent(sharePostId)}`;
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

  const shortCaption = previewDesc.slice(0, 140);
  const fullShareText = `${previewTitle}\n\n${shortCaption}\n\n${shareUrl}`;
  const shareBodySummary = `${previewTitle} — ${shortCaption}`;

  const whatsappHref = `https://api.whatsapp.com/send?text=${encodeURIComponent(fullShareText)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(
    shareUrl
  )}&text=${encodeURIComponent(`${previewTitle}\n${shortCaption}`)}`;
  const xTweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `${previewTitle}\n${shortCaption}`
  )}&url=${encodeURIComponent(shareUrl)}`;
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    shareUrl
  )}&quote=${encodeURIComponent(shareBodySummary)}`;

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
      showToast('Link copiado!');
    } catch {
      showToast('Link pronto para compartilhar');
    }
    setSharePostId(null);
  };

  const handleCopyWithDetails = async () => {
    try {
      await navigator.clipboard?.writeText(fullShareText);
      showToast('Título, legenda e link copiados para compartilhar!');
    } catch {
      showToast('Resumo pronto para compartilhar');
    }
    setSharePostId(null);
  };

  const handleExternalShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: previewTitle,
          text: `${previewTitle}\n${shortCaption}`,
          url: shareUrl,
        });
        setSharePostId(null);
        return;
      } catch {
        // User cancelled or Web Share unsupported in context — fall back to full summary copy
      }
    }
    await handleCopyWithDetails();
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

        <div className="max-h-[85vh] overflow-y-auto p-4">
          {/* External Link Preview Card */}
          <div className="mb-3 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200/80 px-3 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-sky-500" />
                <span>Pré-visualização para redes sociais</span>
              </span>
              <ExternalLink className="h-3 w-3" />
            </div>
            <div className="flex gap-3 p-2.5">
              <img
                src={previewImage}
                alt={previewTitle}
                className="h-16 w-24 shrink-0 rounded-lg bg-zinc-200 object-cover dark:bg-zinc-800"
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
            {ssrActive !== null && (
              <div className="border-t border-zinc-200/80 bg-zinc-100/70 px-3 py-1.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
                {ssrActive ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Card OpenGraph dinâmico ativo neste servidor ao colar o link.
                  </span>
                ) : (
                  <span>
                    Hospedagem estática detectada: use os atalhos abaixo ou &ldquo;Copiar post + link&rdquo; para enviar título e legenda juntos.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Direct External Network Buttons (always include title + caption + link) */}
          <div className="mb-4 grid grid-cols-4 gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 py-2 text-[11px] font-semibold text-zinc-800 transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
            >
              <MessageCircle className="h-4 w-4 text-emerald-500" />
              <span>WhatsApp</span>
            </a>
            <a
              href={telegramHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 py-2 text-[11px] font-semibold text-zinc-800 transition-colors hover:bg-sky-50 hover:text-sky-700 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-sky-950/30 dark:hover:text-sky-400"
            >
              <Send className="h-4 w-4 text-sky-500" />
              <span>Telegram</span>
            </a>
            <a
              href={xTweetHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 py-2 text-[11px] font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Share2 className="h-4 w-4" />
              <span>X / Post</span>
            </a>
            <a
              href={facebookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 py-2 text-[11px] font-semibold text-zinc-800 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
            >
              <Globe className="h-4 w-4 text-blue-600" />
              <span>Facebook</span>
            </a>
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escreva uma mensagem opcional para enviar na Lumina..."
            className="mb-3 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="max-h-44 space-y-2 overflow-y-auto">
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

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void handleCopyWithDetails()}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Copiar post + link</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopyShareLink()}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Link2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Copiar só link</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExternalShare()}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-2.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <Share2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Outros apps</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
