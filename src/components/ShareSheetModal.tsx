import { Check, Link2, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';

export function ShareSheetModal() {
  const {
    sharePostId,
    setSharePostId,
    users,
    currentUser,
    sendMessage,
    showToast,
  } = useSocial();

  const [sentIds, setSentIds] = useState<string[]>([]);
  const [note, setNote] = useState('');

  if (!sharePostId) return null;

  const recipients = users.filter((u) => u.id !== currentUser.id);

  const handleSendTo = (userId: string, username: string) => {
    sendMessage(userId, note || 'Olha essa publicação na Lumina', {
      sharedPostId: sharePostId,
    });
    setSentIds((prev) => [...prev, userId]);
    showToast(`Enviado para @${username}`);
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
            Compartilhar por mensagem
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
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escreva uma mensagem opcional..."
            className="mb-3 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="max-h-64 space-y-2 overflow-y-auto">
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

          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href).catch(() => {});
              showToast('Link copiado');
              setSharePostId(null);
            }}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <Link2 className="h-4 w-4" />
            <span>Copiar link da publicação</span>
          </button>
        </div>
      </div>
    </div>
  );
}
