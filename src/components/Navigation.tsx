import {
  Camera,
  Compass,
  Film,
  Heart,
  Home,
  LogIn,
  LogOut,
  MessageCircle,
  Moon,
  PlusSquare,
  Shield,
  Sun,
} from 'lucide-react';
import { useSocial } from '../context/SocialContext';
import { isExclusiveAdminUser } from '../lib/firebase';
import { NavSection } from '../types';
import { AvatarRing } from './AvatarRing';

interface NavigationProps {
  onOpenCreate: () => void;
}

export function Navigation({ onOpenCreate }: NavigationProps) {
  const {
    activeNav,
    setActiveNav,
    currentUser,
    notifications,
    threads,
    theme,
    toggleTheme,
    isAuthenticated,
    firebaseUser,
    adminMemoryToken,
    logout,
    openAuthModal,
  } = useSocial();

  const canSeeAdminNav =
    !isAuthenticated || isExclusiveAdminUser(firebaseUser) || Boolean(adminMemoryToken);

  const myIds = new Set([currentUser.id, currentUser.uid || ''].filter(Boolean));

  const unreadNotifs = notifications.filter(
    (n) => myIds.has(n.recipientId) && !n.read
  ).length;

  const unreadDMs = threads.filter(
    (t) =>
      t.participantIds.some((pid) => myIds.has(pid)) &&
      t.unreadBy.some((uid) => myIds.has(uid))
  ).length;

  const navItems: {
    id: NavSection;
    label: string;
    icon: typeof Home;
    badge?: number;
  }[] = [
    { id: 'feed', label: 'Página inicial', icon: Home },
    { id: 'explore', label: 'Explorar', icon: Compass },
    { id: 'reels', label: 'Reels', icon: Film },
    { id: 'messages', label: 'Mensagens', icon: MessageCircle, badge: unreadDMs },
    {
      id: 'notifications',
      label: 'Notificações',
      icon: Heart,
      badge: unreadNotifs,
    },
    ...(canSeeAdminNav
      ? [{ id: 'admin' as const, label: 'Painel Admin', icon: Shield }]
      : []),
  ];

  return (
    <>
      {/* Desktop Left Sidebar Rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col justify-between border-r border-zinc-200 bg-white px-3 py-6 dark:border-zinc-800/80 dark:bg-[#050505] lg:flex xl:w-64 xl:px-4">
        <div className="space-y-6">
          {/* Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveNav('feed')}
            className="flex items-center gap-3 px-2.5 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 text-white">
              <Camera className="h-5 w-5" />
            </span>
            <span className="font-display hidden text-2xl font-bold tracking-tight text-zinc-950 dark:text-white xl:inline">
              Lumina
            </span>
          </button>

          {/* Nav Links */}
          <nav className="space-y-1" aria-label="Navegação principal">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-sm transition-colors ${
                    isActive
                      ? 'bg-zinc-100 font-bold text-zinc-950 dark:bg-zinc-900 dark:text-white'
                      : 'font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60'
                  }`}
                >
                  <span className="relative flex shrink-0 items-center justify-center">
                    <Icon
                      className="h-6 w-6"
                      strokeWidth={isActive ? 2.3 : 1.8}
                    />
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span className="hidden truncate xl:inline">{item.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={onOpenCreate}
              className="flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60"
            >
              <PlusSquare className="h-6 w-6 shrink-0" strokeWidth={1.8} />
              <span className="hidden truncate xl:inline">Criar</span>
            </button>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => setActiveNav('profile')}
                className={`flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-sm transition-colors ${
                  activeNav === 'profile'
                    ? 'bg-zinc-100 font-bold text-zinc-950 dark:bg-zinc-900 dark:text-white'
                    : 'font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60'
                }`}
              >
                <AvatarRing
                  src={currentUser.avatarUrl}
                  alt={currentUser.username}
                  size="xs"
                />
                <span className="hidden truncate xl:inline">Perfil</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="flex h-12 w-full items-center gap-3.5 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
              >
                <LogIn className="h-5 w-5 shrink-0" strokeWidth={2} />
                <span className="hidden truncate xl:inline">Entrar</span>
              </button>
            )}
          </nav>
        </div>

        {/* Bottom Session + Theme Switcher */}
        <div className="space-y-2">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={logout}
              aria-label="Sair da conta"
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-900 xl:justify-start"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline">Sair da conta</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              aria-label="Entrar na conta"
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300 xl:justify-start"
            >
              <LogIn className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline">Entrar</span>
            </button>
          )}

          <div
            role="group"
            aria-label="Seletor de tema"
            className="hidden items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900 xl:flex"
          >
            <button
              type="button"
              onClick={() => {
                if (theme !== 'light') toggleTheme();
              }}
              aria-pressed={theme === 'light'}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                theme === 'light'
                  ? 'bg-white text-zinc-950 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              <span>Claro</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (theme !== 'dark') toggleTheme();
              }}
              aria-pressed={theme === 'dark'}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                theme === 'dark'
                  ? 'bg-zinc-800 text-white shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              <span>Escuro</span>
            </button>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="flex h-11 w-full items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 xl:hidden"
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Compact Top Header (<= 52px) */}
      <header className="sticky top-0 z-30 flex h-13 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur-md dark:border-zinc-800/80 dark:bg-[#050505]/95 lg:hidden">
        <button
          type="button"
          onClick={() => setActiveNav('feed')}
          className="flex items-center gap-2"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 text-white">
            <Camera className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-zinc-950 dark:text-white">
            Lumina
          </span>
        </button>

        <div className="flex items-center gap-0.5">
          {canSeeAdminNav && (
            <button
              type="button"
              onClick={() => setActiveNav('admin')}
              aria-label="Painel Admin"
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                activeNav === 'admin'
                  ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-white'
                  : 'text-zinc-800 dark:text-zinc-200'
              }`}
            >
              <Shield className="h-5 w-5" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-200"
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('notifications')}
            aria-label="Notificações"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-200"
          >
            <Heart className="h-5 w-5" />
            {unreadNotifs > 0 && (
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('messages')}
            aria-label="Mensagens"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-200"
          >
            <MessageCircle className="h-5 w-5" />
            {unreadDMs > 0 && (
              <span className="absolute top-2 right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">
                {unreadDMs}
              </span>
            )}
          </button>

          {isAuthenticated ? (
            <button
              type="button"
              onClick={logout}
              aria-label="Sair da conta"
              title="Sair"
              className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <LogOut className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Entrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Fixed Bottom Thumb Bar (<= 56px, 44px+ hitboxes) */}
      <nav
        aria-label="Menu inferior"
        className="fixed right-0 bottom-0 left-0 z-30 grid h-14 grid-cols-5 items-center border-t border-zinc-200 bg-white/95 backdrop-blur-md dark:border-zinc-800/80 dark:bg-[#050505]/95 lg:hidden"
      >
        <button
          type="button"
          onClick={() => setActiveNav('feed')}
          aria-label="Página inicial"
          className="flex h-full items-center justify-center text-zinc-900 dark:text-zinc-100"
        >
          <Home className="h-6 w-6" strokeWidth={activeNav === 'feed' ? 2.4 : 1.8} />
        </button>

        <button
          type="button"
          onClick={() => setActiveNav('explore')}
          aria-label="Explorar"
          className="flex h-full items-center justify-center text-zinc-900 dark:text-zinc-100"
        >
          <Compass className="h-6 w-6" strokeWidth={activeNav === 'explore' ? 2.4 : 1.8} />
        </button>

        <button
          type="button"
          onClick={onOpenCreate}
          aria-label="Criar"
          className="flex h-full items-center justify-center text-zinc-900 dark:text-zinc-100"
        >
          <PlusSquare className="h-6 w-6" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={() => setActiveNav('reels')}
          aria-label="Reels"
          className="flex h-full items-center justify-center text-zinc-900 dark:text-zinc-100"
        >
          <Film className="h-6 w-6" strokeWidth={activeNav === 'reels' ? 2.4 : 1.8} />
        </button>

        <button
          type="button"
          onClick={() => setActiveNav('profile')}
          aria-label="Perfil"
          className="flex h-full items-center justify-center"
        >
          <span
            className={`rounded-full p-0.5 ${
              activeNav === 'profile' ? 'ring-2 ring-zinc-950 dark:ring-white' : ''
            }`}
          >
            <AvatarRing
              src={currentUser.avatarUrl}
              alt={currentUser.username}
              size="xs"
            />
          </span>
        </button>
      </nav>
    </>
  );
}
