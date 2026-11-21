import { ArrowLeftRight, BadgeCheck, UserPlus, X } from 'lucide-react';
import React, { useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';

export function RightSidebar() {
  const {
    currentUser,
    users,
    toggleFollow,
    openProfile,
    switchUser,
    createAccount,
    resetDemoData,
  } = useSocial();

  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');

  const suggestions = users.filter((u) => u.id !== currentUser.id).slice(0, 4);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHandle.trim()) return;
    createAccount({
      username: newHandle,
      displayName: newName,
      bio: newBio,
    });
    setNewHandle('');
    setNewName('');
    setNewBio('');
    setSwitchModalOpen(false);
  };

  return (
    <aside className="hidden w-[320px] shrink-0 xl:block">
      <div className="sticky top-8 space-y-6">
        {/* Current User Summary */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => openProfile(currentUser.id)}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <AvatarRing src={currentUser.avatarUrl} alt={currentUser.username} size="md" />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                  {currentUser.username}
                </span>
                {currentUser.verified && <BadgeCheck className="h-3.5 w-3.5 text-sky-500" />}
              </div>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {currentUser.displayName}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSwitchModalOpen(true)}
            className="shrink-0 text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400"
          >
            Trocar
          </button>
        </div>

        {/* Suggestions */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Sugestões para você
            </h2>
          </div>

          <div className="space-y-3">
            {suggestions.map((user) => {
              const isFollowing = currentUser.following.includes(user.id);
              return (
                <div key={user.id} className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => openProfile(user.id)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <AvatarRing src={user.avatarUrl} alt={user.username} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm font-semibold text-zinc-950 hover:underline dark:text-zinc-100">
                          {user.username}
                        </span>
                        {user.verified && (
                          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {user.displayName}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleFollow(user.id)}
                    className={`shrink-0 text-xs font-semibold ${
                      isFollowing
                        ? 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                        : 'text-sky-600 hover:text-sky-700 dark:text-sky-400'
                    }`}
                  >
                    {isFollowing ? 'Seguindo' : 'Seguir'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quiet Footer Links */}
        <footer className="border-t border-zinc-200/80 pt-4 text-xs leading-relaxed text-zinc-400 dark:border-zinc-800/80 dark:text-zinc-500">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => setSwitchModalOpen(true)}
              className="hover:underline"
            >
              Contas
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={resetDemoData}
              className="hover:underline"
            >
              Restaurar feed inicial
            </button>
          </div>
          <p className="mt-2">© 2026 Lumina</p>
        </footer>
      </div>

      {/* Account Switcher / Creator Modal */}
      {switchModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Trocar ou criar conta"
          onClick={() => setSwitchModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  Trocar de conta
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSwitchModalOpen(false)}
                aria-label="Fechar"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-60 space-y-1 overflow-y-auto p-3">
              {users.map((u) => {
                const active = u.id === currentUser.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      switchUser(u.id);
                      setSwitchModalOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-zinc-100 dark:bg-zinc-900'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <AvatarRing src={u.avatarUrl} alt={u.username} size="sm" />
                      <div>
                        <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                          {u.username}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {u.displayName}
                        </p>
                      </div>
                    </div>
                    {active && (
                      <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                        Ativa
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <form
              onSubmit={handleCreate}
              className="space-y-3 border-t border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <UserPlus className="h-4 w-4" />
                <span>Criar novo perfil local</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newHandle}
                  onChange={(e) => setNewHandle(e.target.value)}
                  placeholder="@usuario"
                  className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome completo"
                  className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>
              <input
                type="text"
                value={newBio}
                onChange={(e) => setNewBio(e.target.value)}
                placeholder="Biografia curta..."
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={!newHandle.trim()}
                className="h-10 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-950"
              >
                Criar e entrar
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
