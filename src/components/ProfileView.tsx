import {
  BadgeCheck,
  Bookmark,
  Film,
  Grid3X3,
  Heart,
  Layers,
  Link as LinkIcon,
  MessageCircle,
  Moon,
  Settings,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

export function ProfileView() {
  const {
    currentUser,
    viewingProfileId,
    users,
    posts,
    stories,
    getUserById,
    toggleFollow,
    updateProfile,
    setSelectedPostId,
    setActiveStoryAuthorId,
    openProfile,
    setActiveNav,
    sendMessage,
    showToast,
    theme,
    toggleTheme,
  } = useSocial();

  const targetUser = getUserById(viewingProfileId || currentUser.id) || currentUser;
  const isOwnProfile = targetUser.id === currentUser.id;
  const isFollowing = currentUser.following.includes(targetUser.id);

  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [editOpen, setEditOpen] = useState(false);
  const [listModal, setListModal] = useState<'followers' | 'following' | null>(null);

  const [editName, setEditName] = useState(targetUser.displayName);
  const [editHandle, setEditHandle] = useState(targetUser.username);
  const [editBio, setEditBio] = useState(targetUser.bio);
  const [editWebsite, setEditWebsite] = useState(targetUser.website || '');
  const [editAvatar, setEditAvatar] = useState(targetUser.avatarUrl);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const userPosts = useMemo(
    () => posts.filter((p) => p.authorId === targetUser.id),
    [posts, targetUser.id]
  );

  const userReels = useMemo(
    () => userPosts.filter((p) => p.isReel || p.aspectRatio === '9:16'),
    [userPosts]
  );

  const savedPosts = useMemo(
    () => posts.filter((p) => p.savedBy.includes(currentUser.id)),
    [posts, currentUser.id]
  );

  const displayedPosts =
    activeTab === 'posts'
      ? userPosts
      : activeTab === 'reels'
      ? userReels
      : savedPosts;

  const userStories = stories.filter((s) => s.authorId === targetUser.id);
  const hasStory = userStories.length > 0;
  const hasUnseenStory = userStories.some((s) => !s.viewedBy.includes(currentUser.id));

  const openEditModal = () => {
    setEditName(targetUser.displayName);
    setEditHandle(targetUser.username);
    setEditBio(targetUser.bio);
    setEditWebsite(targetUser.website || '');
    setEditAvatar(targetUser.avatarUrl);
    setEditOpen(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({
      displayName: editName.trim() || targetUser.displayName,
      username: editHandle.toLowerCase().replace(/[^a-z0-9._]/g, '') || targetUser.username,
      bio: editBio.trim(),
      website: editWebsite.trim() || undefined,
      avatarUrl: editAvatar,
    });
    setEditOpen(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) setEditAvatar(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const listIds =
    listModal === 'followers' ? targetUser.followers : targetUser.following;
  const listUsers = users.filter((u) => listIds.includes(u.id));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Profile Header */}
      <header className="flex flex-col gap-6 border-b border-zinc-200 pb-8 dark:border-zinc-800 sm:flex-row sm:items-start sm:gap-10">
        <div className="flex items-center gap-6 sm:block">
          <AvatarRing
            src={targetUser.avatarUrl}
            alt={targetUser.username}
            size="xl"
            hasStory={hasStory}
            hasUnseenStory={hasUnseenStory}
            onClick={() => {
              if (hasStory) setActiveStoryAuthorId(targetUser.id);
            }}
          />

          {/* Mobile compact metrics next to avatar */}
          <div className="grid flex-1 grid-cols-3 gap-2 text-center sm:hidden">
            <div>
              <p className="text-base font-bold text-zinc-950 tabular-nums dark:text-white">
                {userPosts.length}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">publicações</p>
            </div>
            <button
              type="button"
              onClick={() => setListModal('followers')}
              className="text-center"
            >
              <p className="text-base font-bold text-zinc-950 tabular-nums dark:text-white">
                {formatCompactCount(targetUser.followers.length)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">seguidores</p>
            </button>
            <button
              type="button"
              onClick={() => setListModal('following')}
              className="text-center"
            >
              <p className="text-base font-bold text-zinc-950 tabular-nums dark:text-white">
                {formatCompactCount(targetUser.following.length)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">seguindo</p>
            </button>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-bold text-zinc-950 dark:text-white">
                {targetUser.username}
              </h1>
              {targetUser.verified && <BadgeCheck className="h-5 w-5 text-sky-500" />}
            </div>

            {isOwnProfile ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openEditModal}
                  className="h-9 rounded-lg bg-zinc-100 px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Editar perfil
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Alternar tema claro/escuro"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleFollow(targetUser.id)}
                  className={`h-9 rounded-lg px-5 text-xs font-semibold transition-colors ${
                    isFollowing
                      ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100'
                      : 'bg-sky-600 text-white hover:bg-sky-700'
                  }`}
                >
                  {isFollowing ? 'Seguindo' : 'Seguir'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sendMessage(targetUser.id, `Oi @${targetUser.username}!`);
                    setActiveNav('messages');
                  }}
                  className="h-9 rounded-lg bg-zinc-100 px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Mensagem
                </button>
              </div>
            )}
          </div>

          {(targetUser.boosted || targetUser.restricted) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {targetUser.boosted && (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  Perfil impulsionado
                </span>
              )}
              {targetUser.boosted && targetUser.restricted && (
                <span className="text-zinc-400" aria-hidden="true">·</span>
              )}
              {targetUser.restricted && (
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  Conta restrita pela moderação
                </span>
              )}
            </div>
          )}

          {/* Desktop stats */}
          <div className="hidden items-center gap-8 text-sm sm:flex">
            <p className="text-zinc-700 dark:text-zinc-300">
              <strong className="font-semibold text-zinc-950 tabular-nums dark:text-white">
                {userPosts.length}
              </strong>{' '}
              publicações
            </p>
            <button
              type="button"
              onClick={() => setListModal('followers')}
              className="text-zinc-700 hover:opacity-75 dark:text-zinc-300"
            >
              <strong className="font-semibold text-zinc-950 tabular-nums dark:text-white">
                {formatCompactCount(targetUser.followers.length)}
              </strong>{' '}
              seguidores
            </button>
            <button
              type="button"
              onClick={() => setListModal('following')}
              className="text-zinc-700 hover:opacity-75 dark:text-zinc-300"
            >
              <strong className="font-semibold text-zinc-950 tabular-nums dark:text-white">
                {formatCompactCount(targetUser.following.length)}
              </strong>{' '}
              seguindo
            </button>
          </div>

          {/* Bio */}
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-zinc-950 dark:text-zinc-100">
              {targetUser.displayName}
            </p>
            {targetUser.bio && (
              <p className="max-w-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
                {targetUser.bio}
              </p>
            )}
            {targetUser.website && (
              <button
                type="button"
                onClick={() => showToast(`Link: ${targetUser.website}`)}
                className="inline-flex items-center gap-1.5 font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                <span>{targetUser.website}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex justify-center gap-8 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('posts')}
          className={`flex items-center gap-2 border-t-2 py-3.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
            activeTab === 'posts'
              ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
          }`}
        >
          <Grid3X3 className="h-4 w-4" />
          <span>Publicações</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('reels')}
          className={`flex items-center gap-2 border-t-2 py-3.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
            activeTab === 'reels'
              ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
          }`}
        >
          <Film className="h-4 w-4" />
          <span>Reels</span>
        </button>

        {isOwnProfile && (
          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-2 border-t-2 py-3.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
              activeTab === 'saved'
                ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
            }`}
          >
            <Bookmark className="h-4 w-4" />
            <span>Salvos</span>
          </button>
        )}
      </div>

      {/* 3-Column Photo Grid */}
      {displayedPosts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {activeTab === 'saved'
              ? 'Nenhuma publicação salva ainda'
              : 'Nenhuma publicação encontrada'}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {activeTab === 'saved'
              ? 'Salve fotos que você gosta para revê-las aqui.'
              : 'As fotos e reels publicados aparecerão nesta grade.'}
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-1 sm:gap-2">
          {displayedPosts.map((post) => {
            const totalComments =
              post.comments.length +
              post.comments.reduce((acc, c) => acc + c.replies.length, 0);
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => setSelectedPostId(post.id)}
                className="group relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-900 sm:rounded-md"
              >
                <MediaImage
                  src={post.media[0]?.url}
                  alt={post.caption}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                {(post.isReel || post.media.length > 1) && (
                  <span className="absolute top-2 right-2 rounded-full bg-black/55 p-1 text-white">
                    {post.isReel ? (
                      <Film className="h-3.5 w-3.5" />
                    ) : (
                      <Layers className="h-3.5 w-3.5" />
                    )}
                  </span>
                )}
                <div className="absolute inset-0 flex items-center justify-center gap-4 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex items-center gap-1 text-sm font-semibold text-white tabular-nums">
                    <Heart className="h-4 w-4 fill-white" />
                    {formatCompactCount(post.likes.length)}
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-white tabular-nums">
                    <MessageCircle className="h-4 w-4 fill-white" />
                    {formatCompactCount(totalComments)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Edit Profile Modal */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Editar perfil"
          onClick={() => setEditOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-zinc-500" />
                <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                  Editar perfil
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                aria-label="Fechar"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 p-5">
              <div className="flex items-center gap-4">
                <AvatarRing src={editAvatar} alt={editHandle} size="lg" />
                <div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Alterar foto</span>
                  </button>
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Nome
                </span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Nome de usuário
                </span>
                <input
                  type="text"
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value)}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Biografia
                </span>
                <textarea
                  rows={3}
                  maxLength={160}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Site
                </span>
                <input
                  type="text"
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  placeholder="seusite.com.br"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>

              <button
                type="submit"
                className="h-11 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700"
              >
                Salvar alterações
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Followers / Following List Modal */}
      {listModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setListModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                {listModal === 'followers' ? 'Seguidores' : 'Seguindo'}
              </h3>
              <button
                type="button"
                onClick={() => setListModal(null)}
                aria-label="Fechar"
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-80 space-y-2 overflow-y-auto p-3">
              {listUsers.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Lista vazia por enquanto.
                </p>
              ) : (
                listUsers.map((u) => {
                  const following = currentUser.following.includes(u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setListModal(null);
                          openProfile(u.id);
                        }}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <AvatarRing src={u.avatarUrl} alt={u.username} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                            {u.username}
                          </p>
                          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {u.displayName}
                          </p>
                        </div>
                      </button>
                      {u.id !== currentUser.id && (
                        <button
                          type="button"
                          onClick={() => toggleFollow(u.id)}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            following
                              ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                              : 'bg-sky-600 text-white'
                          }`}
                        >
                          {following ? 'Seguindo' : 'Seguir'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
