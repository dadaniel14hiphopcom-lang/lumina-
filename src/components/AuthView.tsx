import {
  BadgeCheck,
  Camera,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Moon,
  Share2,
  Shield,
  Sun,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';

export function AuthView() {
  const {
    users,
    theme,
    toggleTheme,
    loginWithCredentials,
    loginWithGoogle,
    loginWithGoogleRedirect,
    openAuthModal,
    hasPasswordForUser,
    setGuestBrowsing,
    setActiveNav,
    showToast,
  } = useSocial();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Only show genuinely registered non-demo accounts (never demo seed accounts)
  const registeredUsers = useMemo(
    () => users.filter((u) => !u.isDemoSeed && hasPasswordForUser(u.id)),
    [users, hasPasswordForUser]
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setHint(null);
    if (!identifier.trim() || !password) {
      setError('Informe seu @usuário (ou e-mail) e senha de acesso.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await loginWithCredentials(identifier, password);
      if (!result.ok) {
        setError(result.error || 'Usuário/e-mail ou senha incorretos.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setHint(null);
    setGoogleLoading(true);
    try {
      const res = await loginWithGoogle();
      if (!res.ok) {
        setError(res.error || 'Não foi possível entrar com o Google.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRegisteredAccountSelect = (username: string) => {
    setError(null);
    setIdentifier(`@${username}`);
    setPassword('');
    setHint(`Digite a senha cadastrada para @${username} para entrar.`);
    window.setTimeout(() => passwordInputRef.current?.focus(), 40);
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-[#050505] dark:text-zinc-100">
      {/* Top Bar */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 text-white">
            <Camera className="h-5 w-5" />
          </span>
          <span className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Lumina
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const url = `${window.location.origin}${window.location.pathname}`;
              if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                try {
                  await navigator.share({
                    title: 'Lumina — Rede Social Visual',
                    text: 'Conheça a Lumina: feed visual, stories, reels e mensagens diretas.',
                    url,
                  });
                  return;
                } catch {
                  // Fallback to clipboard
                }
              }
              await navigator.clipboard?.writeText(url).catch(() => {});
              showToast('Link da plataforma copiado com cartão de visualização!');
            }}
            aria-label="Compartilhar link da plataforma"
            title="Compartilhar plataforma"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compartilhar</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('admin')}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Painel Admin</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Sign-in Card */}
      <main className="mx-auto my-8 w-full max-w-md space-y-5">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-7">
          <div className="mb-5 space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white">
              Entrar na sua conta
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Acesso exclusivo para usuários cadastrados. Entre com sua conta Google ou com usuário e senha.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="mb-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          >
            <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            <span>
              {googleLoading ? 'Conectando...' : 'Entrar com Google (Nuvem)'}
            </span>
          </button>

          {error && typeof window !== 'undefined' && window.self === window.top && (
            <button
              type="button"
              onClick={async () => {
                setError(null);
                setGoogleLoading(true);
                try {
                  const res = await loginWithGoogleRedirect('feed');
                  if (!res.ok) setError(res.error || 'Falha no redirecionamento Google.');
                } finally {
                  setGoogleLoading(false);
                }
              }}
              disabled={googleLoading}
              className="mb-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span>Tentar Google por redirecionamento</span>
            </button>
          )}

          <div className="mb-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
              ou usuário e senha
            </span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Usuário (@) ou e-mail
              </span>
              <input
                type="text"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setError(null);
                }}
                placeholder="@seu.usuario ou voce@dominio.com.br"
                autoComplete="username"
                className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Senha de acesso
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 dark:border-zinc-800 dark:bg-zinc-900">
                <Lock className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  className="h-11 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            {hint && !error && (
              <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {hint}
              </p>
            )}

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              <span>{submitting ? 'Verificando...' : 'Entrar'}</span>
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
              novo por aqui?
            </span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <button
            type="button"
            onClick={() => openAuthModal('register')}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <KeyRound className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span>Cadastrar com código de convite</span>
          </button>

          {registeredUsers.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800/80">
              <p className="mb-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Contas cadastradas neste dispositivo
              </p>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {registeredUsers.slice(0, 5).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleRegisteredAccountSelect(u.username)}
                    className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-zinc-200/80 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800/80 dark:hover:bg-zinc-900"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AvatarRing src={u.avatarUrl} alt={u.username} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                            @{u.username}
                          </span>
                          {u.verified && (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                          )}
                        </div>
                        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {u.displayName}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                      <Lock className="h-3 w-3" />
                      <span>Senha</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setGuestBrowsing(true)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Explorar o site sem entrar
          </button>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        © 2026 Lumina
      </footer>
    </div>
  );
}
