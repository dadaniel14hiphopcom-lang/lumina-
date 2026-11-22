import { BadgeCheck, Globe, Mail, MessageCircle, UserCheck, UserPlus } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSocial } from '../context/SocialContext';
import { ASSETS } from '../data/seed';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

interface ProfileHoverCardProps {
  userId: string;
  children: React.ReactNode;
  className?: string;
  onBeforeNavigate?: () => void;
}

function getSafeExternalUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function ProfileHoverCard({
  userId,
  children,
  className = 'inline-flex min-w-0 items-center',
  onBeforeNavigate,
}: ProfileHoverCardProps) {
  const {
    currentUser,
    getUserById,
    posts,
    toggleFollow,
    openProfile,
    openChatWithUser,
  } = useSocial();

  const user = getUserById(userId);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'bottom' | 'top' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });

  const clearTimers = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const computePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardWidth = 320;
    const estimatedHeight = 290;
    const margin = 12;

    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: 'bottom' | 'top' =
      spaceBelow < estimatedHeight && rect.top > estimatedHeight ? 'top' : 'bottom';

    const top =
      placement === 'bottom'
        ? Math.min(window.innerHeight - estimatedHeight - margin, rect.bottom + 8)
        : Math.max(margin, rect.top - estimatedHeight - 8);

    const maxLeft = Math.max(margin, window.innerWidth - cardWidth - margin);
    const left = Math.min(maxLeft, Math.max(margin, rect.left));

    setCoords({ top, left, placement });
  };

  const scheduleOpen = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    openTimerRef.current = window.setTimeout(() => {
      computePosition();
      setOpen(true);
    }, 150);
  };

  const scheduleClose = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 200);
  };

  useEffect(() => {
    if (!open) return;
    const closeNow = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', closeNow, true);
    window.addEventListener('resize', closeNow);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', closeNow, true);
      window.removeEventListener('resize', closeNow);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  if (!user) {
    return <>{children}</>;
  }

  const isOwn = user.id === currentUser.id;
  const isFollowing = currentUser.following.includes(user.id);
  const userPostCount = posts.filter((p) => p.authorId === user.id).length;
  const safeWebsiteUrl = getSafeExternalUrl(user.website);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className={className}
      >
        {children}
      </span>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-label={`Cartão de visita de @${user.username}`}
            onMouseEnter={() => {
              if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
            }}
            onMouseLeave={scheduleClose}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className="fixed z-[90] w-[320px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-opacity duration-150 dark:border-zinc-800 dark:bg-zinc-950"
          >
            {/* Cover Banner */}
            <div className="relative h-20 w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
              <MediaImage
                src={user.coverUrl || ASSETS.postArchitecture}
                alt={`Capa de ${user.displayName}`}
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
            </div>

            <div className="relative px-4 pb-4">
              {/* Overlapping Avatar + Online Status */}
              <div className="-mt-6 mb-2.5 flex items-end justify-between gap-2">
                <div className="rounded-full bg-white p-0.5 ring-2 ring-white dark:bg-zinc-950 dark:ring-zinc-950">
                  <AvatarRing
                    src={user.avatarUrl}
                    alt={user.username}
                    size="md"
                    showOnlineIndicator={Boolean(user.isOnline)}
                    onClick={() => {
                      setOpen(false);
                      onBeforeNavigate?.();
                      openProfile(user.id);
                    }}
                  />
                </div>
                {user.isOnline && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Ativo agora
                  </span>
                )}
              </div>

              {/* Identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onBeforeNavigate?.();
                      openProfile(user.id);
                    }}
                    className="truncate text-sm font-bold text-zinc-950 hover:underline dark:text-white"
                  >
                    {user.displayName}
                  </button>
                  {user.verified && (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" aria-label="Verificado" />
                  )}
                </div>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  @{user.username}
                  {user.boosted && ' · Em destaque'}
                  {user.restricted && ' · Restrito'}
                </p>
              </div>

              {/* Bio */}
              {user.bio && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {user.bio}
                </p>
              )}

              {/* Contact Details */}
              {(safeWebsiteUrl || user.email) && (
                <div className="mt-2 flex flex-col gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {safeWebsiteUrl && (
                    <a
                      href={safeWebsiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 truncate font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      <Globe className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {user.website?.replace(/^https?:\/\//i, '')}
                      </span>
                    </a>
                  )}
                  {user.email && (
                    <div className="inline-flex items-center gap-1.5 truncate">
                      <Mail className="h-3 w-3 shrink-0 text-zinc-400" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Unboxed Tabular Metrics */}
              <div className="mt-3 flex items-center gap-2 border-y border-zinc-100 py-2 text-xs text-zinc-600 tabular-nums dark:border-zinc-800/80 dark:text-zinc-400">
                <span>
                  <strong className="font-semibold text-zinc-950 dark:text-zinc-100">
                    {formatCompactCount(userPostCount)}
                  </strong>{' '}
                  {userPostCount === 1 ? 'post' : 'posts'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="font-semibold text-zinc-950 dark:text-zinc-100">
                    {formatCompactCount(user.followers.length)}
                  </strong>{' '}
                  seguidores
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="font-semibold text-zinc-950 dark:text-zinc-100">
                    {formatCompactCount(user.following.length)}
                  </strong>{' '}
                  seguindo
                </span>
              </div>

              {/* Business Card Actions */}
              <div className="mt-3 flex items-center gap-2">
                {!isOwn && (
                  <button
                    type="button"
                    onClick={() => toggleFollow(user.id)}
                    className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                      isFollowing
                        ? 'border border-zinc-200 bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    {isFollowing ? (
                      <>
                        <UserCheck className="h-3.5 w-3.5 shrink-0" />
                        <span>Seguindo</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5 shrink-0" />
                        <span>Seguir</span>
                      </>
                    )}
                  </button>
                )}

                {!isOwn && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onBeforeNavigate?.();
                      openChatWithUser(user.id);
                    }}
                    className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Mensagem</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onBeforeNavigate?.();
                    openProfile(user.id);
                  }}
                  className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${
                    isOwn ? 'w-full' : ''
                  }`}
                >
                  Ver perfil
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
