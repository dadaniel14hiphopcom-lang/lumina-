import {
  ArrowLeftRight,
  BadgeCheck,
  Cloud,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { isUserEffectivelyOnline, useSocial } from '../context/SocialContext';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { ProfileHoverCard } from './ProfileHoverCard';

export function RightSidebar() {
  const {
    currentUser,
    users,
    posts,
    toggleFollow,
    openProfile,
    switchUser,
    loginWithCredentials,
    loginWithGoogle,
    hasPasswordForUser,
    resetDemoData,
    setIsInviteModalOpen,
    openAuthModal,
    isAuthenticated,
    logout,
  } = useSocial();

  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'switch' | 'login'>('login');

  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const registeredAccounts = useMemo(
    () =>
      users.filter(
        (u) => !u.isDemoSeed && (hasPasswordForUser(u.id) || Boolean(u.uid))
      ),
    [users, hasPasswordForUser]
  );

  const trendingUsers = useMemo(() => {
    const metricsByUser = new Map<string, { interactions: number; score: number }>();

    for (const p of posts) {
      const commentCount =
        p.comments.length + p.comments.reduce((acc, c) => acc + c.replies.length, 0);
      const interactions = p.likes.length + commentCount;
      const weighted = p.likes.length * 2 + commentCount * 3;
      const prev = metricsByUser.get(p.authorId) || { interactions: 0, score: 0 };
      metricsByUser.set(p.authorId, {
        interactions: prev.interactions + interactions,
        score: prev.score + weighted,
      });
      if (p.authorUid && p.authorUid !== p.authorId) {
        const prevUid = metricsByUser.get(p.authorUid) || { interactions: 0, score: 0 };
        metricsByUser.set(p.authorUid, {
          interactions: prevUid.interactions + interactions,
          score: prevUid.score + weighted,
        });
      }
    }

    return users
      .filter((u) => u.id !== currentUser.id && !u.restricted)
      .map((u) => {
        const mById = metricsByUser.get(u.id);
        const mByUid = u.uid ? metricsByUser.get(u.uid) : undefined;
        const m = mById || mByUid || { interactions: 0, score: 0 };
        const score = m.score + u.followers.length * 2 + (u.boosted ? 25 : 0);
        return {
          user: u,
          interactions: m.interactions,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [users, posts, currentUser.id]);

  const suggestions = useMemo(() => {
    const trendingIds = new Set(trendingUsers.map((t) => t.user.id));
    const eligible = users.filter((u) => u.id !== currentUser.id && !u.restricted);
    const nonTrending = eligible.filter((u) => !trendingIds.has(u.id));
    const pool = nonTrending.length > 0 ? nonTrending : eligible;
    return [...pool]
      .sort((a, b) => {
        const aReal = a.isDemoSeed ? 0 : 1;
        const bReal = b.isDemoSeed ? 0 : 1;
        return bReal - aReal;
      })
      .slice(0, 6);
  }, [users, currentUser.id, trendingUsers]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginId.trim() || !loginPass) {
      setLoginError('Informe seu @usuário (ou e-mail) e senha.');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await loginWithCredentials(loginId, loginPass);
      if (res.ok) {
        setLoginId('');
        setLoginPass('');
        setSwitchModalOpen(false);
      } else {
        setLoginError(res.error || 'Usuário ou senha inválidos.');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGoogleSwitch = async () => {
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await loginWithGoogle();
      if (res.ok) {
        setSwitchModalOpen(false);
      } else {
        setLoginError(res.error || 'Falha ao entrar com o Google.');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <aside className="hidden w-[320px] shrink-0 xl:block">
      <div className="sticky top-8 space-y-6">
        {/* Current User Summary or Sign-in Prompt */}
        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-3">
            <ProfileHoverCard userId={currentUser.id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => openProfile(currentUser.id)}
                className="flex w-full min-w-0 items-center gap-3 text-left"
              >
                <AvatarRing
                  src={currentUser.avatarUrl}
                  alt={currentUser.username}
                  size="md"
                  showOnlineIndicator={isUserEffectivelyOnline(currentUser, currentUser.id)}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                      {currentUser.username}
                    </span>
                    {currentUser.verified && (
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                    )}
                  </div>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {currentUser.displayName}
                  </p>
                </div>
              </button>
            </ProfileHoverCard>

            <div className="flex shrink-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSwitchModalOpen(true)}
                className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400"
              >
                Trocar
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Sair
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-bold text-zinc-950 dark:text-white">
              Entre na Lumina
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Faça login com sua conta ou cadastre-se com um convite.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Entrar</span>
              </button>
              <button
                type="button"
                onClick={() => openAuthModal('register')}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              >
                Convite
              </button>
            </div>
          </div>
        )}

        {/* Em alta (Trending Users above Suggestions) */}
        {trendingUsers.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                <Flame className="h-4 w-4 text-rose-500" />
                <span>Em alta</span>
              </h2>
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                Mais ativos
              </span>
            </div>

            <div className="space-y-3">
              {trendingUsers.map(({ user, interactions }, idx) => {
                const isFollowing = currentUser.following.includes(user.id);
                return (
                  <div key={user.id} className="flex items-center justify-between gap-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="w-4 shrink-0 text-xs font-bold text-zinc-400 tabular-nums dark:text-zinc-500">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <ProfileHoverCard userId={user.id} className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openProfile(user.id)}
                          className="flex w-full min-w-0 items-center gap-2.5 text-left"
                        >
                          <AvatarRing
                            src={user.avatarUrl}
                            alt={user.username}
                            size="sm"
                            showOnlineIndicator={isUserEffectivelyOnline(user, currentUser.id)}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-sm font-semibold text-zinc-950 hover:underline dark:text-zinc-100">
                                {user.username}
                              </span>
                              {user.verified && (
                                <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                              )}
                            </div>
                            <p className="truncate text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                              {formatCompactCount(interactions)}{' '}
                              {interactions === 1 ? 'interação' : 'interações'} ·{' '}
                              {formatCompactCount(user.followers.length)} seg.
                            </p>
                          </div>
                        </button>
                      </ProfileHoverCard>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleFollow(user.id)}
                      className={`shrink-0 whitespace-nowrap text-xs font-semibold ${
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
        )}

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
                  <ProfileHoverCard userId={user.id} className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => openProfile(user.id)}
                      className="flex w-full min-w-0 items-center gap-3 text-left"
                    >
                      <AvatarRing
                        src={user.avatarUrl}
                        alt={user.username}
                        size="sm"
                        showOnlineIndicator={isUserEffectivelyOnline(user, currentUser.id)}
                      />
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
                  </ProfileHoverCard>

                  <button
                    type="button"
                    onClick={() => toggleFollow(user.id)}
                    className={`shrink-0 whitespace-nowrap text-xs font-semibold ${
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
              onClick={() =>
                isAuthenticated ? setSwitchModalOpen(true) : openAuthModal('login')
              }
              className="hover:underline"
            >
              Contas
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setIsInviteModalOpen(true)}
              className="hover:underline"
            >
              Entrar com convite
            </button>
            <span aria-hidden="true">·</span>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={logout}
                className="hover:underline"
              >
                Sair
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="hover:underline"
              >
                Entrar
              </button>
            )}
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

      {/* Account Switcher / Login / Creator Modal */}
      {switchModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Trocar ou entrar na conta"
          onClick={() => setSwitchModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                {modalTab === 'login' ? (
                  <LogIn className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                ) : (
                  <ArrowLeftRight className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                )}
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  {modalTab === 'login' ? 'Entrar com senha' : 'Trocar de conta'}
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

            <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('switch');
                    setLoginError(null);
                  }}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    modalTab === 'switch'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  Perfis / Novo perfil
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('login');
                    setLoginError(null);
                  }}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    modalTab === 'login'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  Entrar com senha
                </button>
              </div>
            </div>

            {modalTab === 'login' ? (
              <form onSubmit={handlePasswordLogin} className="space-y-3.5 p-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Acesse contas criadas via convite usando seu @usuário ou e-mail e senha de acesso.
                </p>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="@usuario ou e-mail"
                  autoComplete="username"
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <input
                    type={showLoginPass ? 'text' : 'password'}
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    placeholder="Senha de acesso"
                    autoComplete="current-password"
                    className="h-10 w-full bg-transparent text-sm text-zinc-900 focus:outline-none dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPass((s) => !s)}
                    aria-label={showLoginPass ? 'Ocultar senha' : 'Mostrar senha'}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {showLoginPass ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {loginError && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    {loginError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="h-10 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {loginLoading ? 'Verificando...' : 'Entrar na conta'}
                </button>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
                  </div>
                  <div className="relative flex justify-center text-[11px]">
                    <span className="bg-white px-2 text-zinc-400 dark:bg-zinc-950">ou</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={loginLoading}
                  onClick={handleGoogleSwitch}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span>Entrar com Google (Nuvem)</span>
                </button>
              </form>
            ) : (
              <>
                <div className="max-h-64 space-y-1 overflow-y-auto p-3">
                  {registeredAccounts.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      Nenhuma conta cadastrada neste dispositivo ainda. Entre com Google ou cadastre-se com um convite.
                    </p>
                  ) : (
                    registeredAccounts.map((u) => {
                      const active = u.id === currentUser.id && isAuthenticated;
                      const requiresPassword = hasPasswordForUser(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setSwitchModalOpen(false);
                              return;
                            }
                            if (requiresPassword) {
                              setLoginId(`@${u.username}`);
                              setLoginPass('');
                              setLoginError(null);
                              setModalTab('login');
                              return;
                            }
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
                          {active ? (
                            <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                              Ativa
                            </span>
                          ) : requiresPassword ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                              <Lock className="h-3 w-3" />
                              Senha
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="space-y-2.5 border-t border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <button
                    type="button"
                    disabled={loginLoading}
                    onClick={handleGoogleSwitch}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950"
                  >
                    <Cloud className="h-4 w-4 text-sky-500" />
                    <span>Entrar com Google (Nuvem)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSwitchModalOpen(false);
                      openAuthModal('register');
                    }}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Cadastrar nova conta com convite</span>
                  </button>

                  {isAuthenticated && (
                    <button
                      type="button"
                      onClick={() => {
                        setSwitchModalOpen(false);
                        logout();
                      }}
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/60 text-xs font-semibold text-rose-700 hover:bg-rose-100/70 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sair da conta atual</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
