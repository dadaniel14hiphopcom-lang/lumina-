import { BadgeCheck, ImagePlus, KeyRound, Mail, Upload, UserPlus, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { ASSETS, STUDIO_SAMPLE_IMAGES } from '../data/seed';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

export function InviteRegisterModal() {
  const {
    isInviteModalOpen,
    setIsInviteModalOpen,
    pendingInviteCode,
    pendingInviteMeta,
    registerWithInvite,
  } = useSocial();

  const [code, setCode] = useState(pendingInviteCode || '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(pendingInviteMeta?.invitedName || '');
  const [email, setEmail] = useState(pendingInviteMeta?.email || '');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>(ASSETS.avatarClara);
  const [coverUrl, setCoverUrl] = useState<string>(ASSETS.postArchitecture);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const avatarRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isInviteModalOpen) {
      setCode(pendingInviteCode || '');
      if (pendingInviteMeta?.email) setEmail(pendingInviteMeta.email);
      if (pendingInviteMeta?.invitedName) setDisplayName(pendingInviteMeta.invitedName);
      setError(null);
    }
  }, [isInviteModalOpen, pendingInviteCode, pendingInviteMeta]);

  if (!isInviteModalOpen) return null;

  const handleImagePick = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) setter(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('Informe o código do convite.');
      return;
    }
    if (!username.trim()) {
      setError('Escolha um nome de usuário (@usuario).');
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerWithInvite({
        code,
        username,
        displayName,
        email,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Cadastro por convite"
      onClick={() => setIsInviteModalOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                Cadastrar com Convite
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Crie sua conta real na rede Lumina
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
                onChange={(e) => handleImagePick(e, setCoverUrl)}
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
                onChange={(e) => handleImagePick(e, setAvatarUrl)}
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
                Código do convite
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

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                E-mail
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                <Mail className="h-3.5 w-3.5 text-zinc-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@dominio.com.br"
                  className="h-10 w-full bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
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
            {submitting ? 'Validando convite...' : 'Concluir cadastro e entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
