import { AlertTriangle, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminPanelView } from './components/AdminPanelView';
import { AuthView } from './components/AuthView';
import { CallOverlay } from './components/CallOverlay';
import { CreateModal } from './components/CreateModal';
import { ExploreView } from './components/ExploreView';
import { InviteRegisterModal } from './components/InviteRegisterModal';
import { MessagesView } from './components/MessagesView';
import { Navigation } from './components/Navigation';
import { NotificationsView } from './components/NotificationsView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PostCard } from './components/PostCard';
import { PostDetailModal } from './components/PostDetailModal';
import { ProfileView } from './components/ProfileView';
import { ReelsView } from './components/ReelsView';
import { RightSidebar } from './components/RightSidebar';
import { ShareSheetModal } from './components/ShareSheetModal';
import { StoryBar } from './components/StoryBar';
import { StoryViewer } from './components/StoryViewer';
import { SocialProvider, useSocial } from './context/SocialContext';

function FeedStage({ onAddStory }: { onAddStory: () => void }) {
  const { posts, currentUser, users } = useSocial();
  const [feedFilter, setFeedFilter] = useState<'all' | 'following'>('all');

  const visiblePosts = useMemo(() => {
    const filtered =
      feedFilter === 'all'
        ? posts
        : posts.filter(
            (p) =>
              p.authorId === currentUser.id ||
              currentUser.following.includes(p.authorId)
          );
    const boostedIds = new Set<string>();
    for (const u of users) {
      if (!u.boosted) continue;
      boostedIds.add(u.id);
      if (u.uid) boostedIds.add(u.uid);
    }
    return [...filtered].sort((a, b) => {
      const aBoost =
        boostedIds.has(a.authorId) || (a.authorUid && boostedIds.has(a.authorUid)) ? 1 : 0;
      const bBoost =
        boostedIds.has(b.authorId) || (b.authorUid && boostedIds.has(b.authorUid)) ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;
      return b.createdAt - a.createdAt;
    });
  }, [posts, feedFilter, currentUser, users]);

  return (
    <div className="mx-auto flex w-full max-w-5xl justify-center gap-12 px-0 py-0 sm:px-6 sm:py-6">
      <div className="w-full max-w-[540px] space-y-5">
        <StoryBar onAddStory={onAddStory} />

        {/* Subtle Feed Scope Switch */}
        <div className="flex items-center justify-between px-3 sm:px-0">
          <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setFeedFilter('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                feedFilter === 'all'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
              }`}
            >
              Para você
            </button>
            <button
              type="button"
              onClick={() => setFeedFilter('following')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                feedFilter === 'following'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400'
              }`}
            >
              Seguindo
            </button>
          </div>
          <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
            {visiblePosts.length}{' '}
            {visiblePosts.length === 1 ? 'publicação' : 'publicações'}
          </span>
        </div>

        {/* Feed Posts */}
        {visiblePosts.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white py-14 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Nenhuma publicação de quem você segue
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Siga novos perfis ou alterne para &ldquo;Para você&rdquo;.
            </p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {visiblePosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>

      <RightSidebar />
    </div>
  );
}

function LuminaShell() {
  const {
    activeNav,
    setActiveNav,
    isCreateOpen,
    setIsCreateOpen,
    toastMessage,
    siteMeta,
    isAuthenticated,
    guestBrowsing,
    isExclusiveAdmin,
    currentUser,
    notifications,
    markNotificationsRead,
  } = useSocial();
  const canSeeAdminEntry = isExclusiveAdmin;
  const [createMode, setCreateMode] = useState<'post' | 'story' | 'reel'>('post');

  useEffect(() => {
    if (activeNav !== 'notifications') return;
    const myIds = new Set([currentUser.id, currentUser.uid || ''].filter(Boolean));
    const hasUnread = notifications.some((n) => !n.read && myIds.has(n.recipientId));
    if (hasUnread) {
      markNotificationsRead();
    }
  }, [activeNav, notifications, currentUser.id, currentUser.uid, markNotificationsRead]);

  const openCreateWithMode = (mode: 'post' | 'story' | 'reel') => {
    setCreateMode(mode);
    setIsCreateOpen(true);
  };

  if (!isAuthenticated && !guestBrowsing && !canSeeAdminEntry) {
    return (
      <>
        <AuthView />
        <InviteRegisterModal />
        {toastMessage && (
          <div
            role="status"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-950"
          >
            {toastMessage}
          </div>
        )}
      </>
    );
  }

  const isMessagesView = activeNav === 'messages';

  return (
    <div
      className={`bg-zinc-50/40 text-zinc-950 dark:bg-[#050505] dark:text-zinc-100 lg:pl-20 xl:pl-64 ${
        isMessagesView
          ? 'flex h-[100dvh] flex-col overflow-hidden pb-14 lg:block lg:h-auto lg:min-h-screen lg:overflow-visible lg:pb-0'
          : 'min-h-screen pb-16 lg:pb-0'
      }`}
    >
      <Navigation onOpenCreate={() => openCreateWithMode('post')} />

      <OfflineIndicator />

      {siteMeta.announcementBanner.trim().length > 0 && (
        <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2 text-center text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          <span>{siteMeta.announcementBanner}</span>
          <span className="mx-2 text-zinc-400" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-zinc-500">v{siteMeta.version}</span>
        </div>
      )}

      {siteMeta.maintenanceMode && activeNav !== 'admin' && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Modo de manutenção ativo no painel administrativo. A visualização pública está sinalizada.
              </span>
            </div>
            {canSeeAdminEntry && (
              <button
                type="button"
                onClick={() => setActiveNav('admin')}
                className="inline-flex items-center gap-1.5 font-semibold underline hover:opacity-80"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>Gerenciar no Painel Admin</span>
              </button>
            )}
          </div>
        </div>
      )}

      <main className={isMessagesView ? 'min-h-0 flex-1 overflow-hidden lg:min-h-screen lg:overflow-visible' : 'min-h-screen'}>
        {activeNav === 'feed' && (
          <FeedStage onAddStory={() => openCreateWithMode('story')} />
        )}
        {activeNav === 'explore' && <ExploreView />}
        {activeNav === 'reels' && <ReelsView />}
        {activeNav === 'messages' && <MessagesView />}
        {activeNav === 'notifications' && <NotificationsView />}
        {activeNav === 'profile' && <ProfileView />}
        {activeNav === 'admin' && (
          canSeeAdminEntry ? <AdminPanelView /> : <FeedStage onAddStory={() => openCreateWithMode('story')} />
        )}
      </main>

      {/* Modals & Real-time Call Overlay */}
      <CallOverlay />
      <StoryViewer />
      <PostDetailModal />
      <ShareSheetModal />
      <InviteRegisterModal />
      {isCreateOpen && <CreateModal key={createMode} initialMode={createMode} />}

      {/* Subtle Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-950 lg:bottom-6"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <SocialProvider>
      <LuminaShell />
    </SocialProvider>
  );
}
