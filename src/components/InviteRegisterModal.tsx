import {
  BadgeCheck,
  Cloud,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { ASSETS, STUDIO_SAMPLE_IMAGES } from '../data/seed';
import { compressImageFile } from '../utils/media';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

export function InviteRegisterModal() {
  const {
    isInviteModalOpen,
    setIsInviteModalOpen,
    inviteModalMode,
    pendingInviteCode,
    pendingInviteMeta,
    registerRealUser,
    loginWithCredentials,
    loginWithGoogle,
  } = useSocial();

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [code, setCode] = useState(pendingInviteCode || '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(pendingInviteMeta?.invitedName || '');
  const [email, setEmail] = useState(pendingInviteMeta?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>(ASSETS.avatarClara);
  const [coverUrl, setCoverUrl] = useState<string>(ASSETS.postArchitecture);

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const avatarRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isInviteModalOpen) {
      if (pendingInviteCode) {
        setMode('register');
      } else {
        setMode(inviteModalMode);
      }
      setCode(pendingInviteCode || '');
      if (pendingInviteMeta?.email) setEmail(pendingInviteMeta.email);
      if (pendingInviteMeta?.invitedName) setDisplayName(pendingInviteMeta.invitedName);
      setPassword('');
      setConfirmPassword('');
      setLoginPassword('');
      setError(null);
    }
  }, [isInviteModalOpen, inviteModalMode, pendingInviteCode, pendingInviteMeta]);

  if (!isInviteModalOpen) return null;

  const handleImagePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void,
    kind: 'avatar' | 'cover'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const compressed = await compressImageFile(
      file,
      kind === 'avatar'
        ? { maxWidth: 480, maxHeight: 480, quality: 0.82, maxChars: 180_000 }
        : { maxWidth: 1200, maxHeight: 800, quality: 0.8, maxChars: 280_000 }
    );
    if (compressed) setter(compressed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail real válido para criar a conta.');
      return;
    }
    if (!username.trim()) {
      setError('Escolha um nome de usuário (@usuario).');
      return;
    }
    if (password.length < 6) {
      setError('Crie uma senha de acesso com pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerRealUser({
        inviteCode: code.trim() || undefined,
        username,
        displayName,
        email,
        password,
        bio,
        avatarUrl,
        coverUrl,
      });
      if (!result.ok) {
        setError(result.error || 'Não foi possível concluir o cadastro.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!loginIdentifier.trim() || !loginPassword) {
      setError('Informe seu @usuário (ou e-mail) e senha de acesso.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await loginWithCredentials(loginIdentifier, loginPassword);
      if (!result.ok) {
        setError(result.error || 'Não foi possível entrar na conta.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await loginWithGoogle();
      if (!result.ok) {
        setError(result.error || 'Não foi possível conectar com o Google.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'register' ? 'Cadastro de usuário real' : 'Entrar com senha'}
      onClick={() => setIsInviteModalOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              {mode === 'register' ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
            </span>
            <div>
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                {mode === 'register' ? 'Criar Conta Real' : 'Entrar na sua Conta'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {mode === 'register'
                  ? 'Cadastre seu perfil real com e-mail e senha de acesso'
                  : 'Acesse com o @usuário ou e-mail cadastrado'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsInviteModalOpen(false)}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="border-b border-zinc-200 px-5 py-2.5 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
              }`}
            >
              Criar conta real
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
              }`}
            >
              Já tenho conta
            </button>
          </div>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4 p-5">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Nome de usuário (@) ou e-mail
              </span>
              <input
                type="text"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="@ana.fotografia ou voce@dominio.com.br"
                autoComplete="username"
                className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Senha de acesso
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  className="h-10 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((s) => !s)}
                  aria-label={showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showLoginPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {submitting ? 'Verificando...' : 'Entrar na conta'}
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
              disabled={submitting}
              onClick={handleGoogleLogin}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <span>Entrar com Google (Nuvem)</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            {/* Cover & Avatar Preview */}
            <div className="relative mb-8">
              <div className="relative h-28 w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                <MediaImage
                  src={coverUrl}
                  alt="Capa do perfil"
                  className="h-full w-full object-cover"
                />
                <input
                  ref={coverRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleImagePick(e, setCoverUrl, 'cover')}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => coverRef.current?.click()}
                  className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xs hover:bg-black/80"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>Capa</span>
                </button>
              </div>

              <div className="absolute -bottom-7 left-4 flex items-end gap-3">
                <div className="rounded-full ring-4 ring-white dark:ring-zinc-950">
                  <AvatarRing src={avatarUrl} alt={username || 'perfil'} size="lg" />
                </div>
                <input
                  ref={avatarRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleImagePick(e, setAvatarUrl, 'avatar')}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => avatarRef.current?.click()}
                  className="mb-1 inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-800 shadow-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <Upload className="h-3 w-3" />
                  <span>Foto</span>
                </button>
              </div>
            </div>

            {/* Preset covers quick pick */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1">
              {STUDIO_SAMPLE_IMAGES.slice(0, 4).map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  onClick={() => setCoverUrl(sample.url)}
                  className={`h-8 w-14 shrink-0 overflow-hidden rounded-md border ${
                    coverUrl === sample.url
                      ? 'border-sky-500 ring-2 ring-sky-500/30'
                      : 'border-zinc-200 opacity-75 hover:opacity-100 dark:border-zinc-800'
                  }`}
                >
                  <MediaImage src={sample.url} alt={sample.label} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>

            {pendingInviteMeta?.grantVerified && (
              <div className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                <BadgeCheck className="h-4 w-4 shrink-0" />
                <span>Este convite inclui selo de conta verificada.</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  E-mail real *
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <Mail className="h-3.5 w-3.5 text-zinc-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@dominio.com.br"
                    className="h-10 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                  />
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Código de convite (opcional)
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <KeyRound className="h-3.5 w-3.5 text-zinc-400" />
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="LUM-XXXXXX"
                    className="h-10 w-full bg-transparent font-mono text-sm uppercase text-zinc-950 focus:outline-none dark:text-white"
                  />
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Nome de usuário (@)
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex: ana.fotografia"
                  autoComplete="username"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Nome completo
                </span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ana Beatriz"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>
            </div>

            {/* Access Password + Confirmation */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Senha de acesso (mín. 6)
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Crie sua senha"
                    minLength={6}
                    autoComplete="new-password"
                    className="h-10 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Confirmar senha
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    minLength={6}
                    autoComplete="new-password"
                    className="h-10 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                  />
                </div>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Biografia curta
              </span>
              <textarea
                rows={2}
                maxLength={160}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Conte sobre você, seu trabalho ou interesses..."
                className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
              />
            </label>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {submitting ? 'Cadastrando...' : 'Criar conta real e entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
