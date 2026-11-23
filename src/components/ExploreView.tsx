import {
  BadgeCheck,
  Clock,
  Film,
  Heart,
  Layers,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { PostCategory } from '../types';
import { isVideoAsset, resolvePlayableMediaUrl } from '../utils/media';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { ProfileHoverCard } from './ProfileHoverCard';

const FILTER_TABS: ('Tudo' | PostCategory)[] = [
  'Tudo',
  'Fotografia',
  'Arquitetura',
  'Gastronomia',
  'Viagem',
  'Design',
  'Arte',
];

export function ExploreView() {
  const {
    posts,
    users,
    exploreQuery,
    setExploreQuery,
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
    setSelectedPostId,
    openProfile,
  } = useSocial();

  const [category, setCategory] = useState<'Tudo' | PostCategory>('Tudo');
  const [searchFocused, setSearchFocused] = useState(false);

  const normalized = exploreQuery.trim().toLowerCase();

  const matchedUsers = useMemo(() => {
    const activeUsers = users
      .filter((u) => !u.restricted)
      .sort((a, b) => {
        const aReal = a.isDemoSeed ? 0 : 1;
        const bReal = b.isDemoSeed ? 0 : 1;
        return bReal - aReal;
      });
    if (!normalized) return activeUsers.slice(0, 12);
    return activeUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(normalized) ||
        u.displayName.toLowerCase().includes(normalized)
    );
  }, [users, normalized]);

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const catOk = category === 'Tudo' || p.category === category;
      if (!catOk) return false;
      if (!normalized) return true;
      const author = users.find((u) => u.id === p.authorId);
      return (
        p.caption.toLowerCase().includes(normalized) ||
        (p.location && p.location.toLowerCase().includes(normalized)) ||
        p.category.toLowerCase().includes(normalized) ||
        (author && author.username.toLowerCase().includes(normalized))
      );
    });
  }, [posts, users, category, normalized]);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      {/* Search Bar */}
      <div className="relative mb-5">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 dark:border-zinc-800 dark:bg-zinc-900">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            type="text"
            value={exploreQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && exploreQuery.trim()) {
                addRecentSearch(exploreQuery.trim());
                setSearchFocused(false);
              }
            }}
            onChange={(e) => setExploreQuery(e.target.value)}
            placeholder="Pesquisar perfis, #hashtags ou lugares..."
            className="h-11 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
          />
          {exploreQuery && (
            <button
              type="button"
              onClick={() => setExploreQuery('')}
              aria-label="Limpar busca"
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Recent Searches Dropdown */}
        {searchFocused && !normalized && recentSearches.length > 0 && (
          <div className="absolute top-13 right-0 left-0 z-20 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Buscas recentes
              </span>
              <button
                type="button"
                onClick={clearRecentSearches}
                className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
              >
                Limpar tudo
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  type="button"
                  onMouseDown={() => setExploreQuery(term)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Clock className="h-3 w-3 text-zinc-400" />
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Category Filter Tabs */}
      <div className="no-scrollbar mb-6 flex items-center gap-1.5 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => {
          const active = category === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setCategory(tab)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Matched or Active Community Profiles */}
      {matchedUsers.length > 0 && (
        <div className="mb-6">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {normalized ? 'Perfis encontrados' : 'Membros na Lumina'}
            </h2>
            {!normalized && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {matchedUsers.length} perfis públicos
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matchedUsers.map((u) => (
              <ProfileHoverCard key={u.id} userId={u.id} className="block w-full">
                <button
                  type="button"
                  onClick={() => {
                    if (normalized) addRecentSearch(u.username);
                    openProfile(u.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <AvatarRing
                    src={u.avatarUrl}
                    alt={u.username}
                    size="sm"
                    showOnlineIndicator={Boolean(u.isOnline)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                        @{u.username}
                      </p>
                      {u.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
                    </div>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {u.displayName}
                    </p>
                  </div>
                </button>
              </ProfileHoverCard>
            ))}
          </div>
        </div>
      )}

      {/* Bento / Masonry Grid */}
      {filteredPosts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 py-16 text-center dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nenhuma publicação encontrada
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Tente outro termo ou limpe os filtros acima.
          </p>
        </div>
      ) : (
        <div className="grid auto-rows-[160px] grid-cols-3 gap-1.5 sm:auto-rows-[220px] sm:gap-2">
          {filteredPosts.map((post, idx) => {
            const isFeatured = idx % 5 === 2;
            const totalComments =
              post.comments.length +
              post.comments.reduce((acc, c) => acc + c.replies.length, 0);

            return (
              <button
                key={post.id}
                type="button"
                onClick={() => setSelectedPostId(post.id)}
                className={`group relative overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900 ${
                  isFeatured ? 'row-span-2' : ''
                }`}
              >
                {isVideoAsset(post.media[0]) ? (
                  <video
                    src={resolvePlayableMediaUrl(post.media[0]?.url)}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <MediaImage
                    src={post.media[0]?.url}
                    alt={post.media[0]?.alt || post.caption}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                )}

                {/* Type indicator */}
                {(post.isReel || post.media.length > 1) && (
                  <span className="absolute top-2.5 right-2.5 rounded-full bg-black/55 p-1.5 text-white backdrop-blur-xs">
                    {post.isReel ? (
                      <Film className="h-3.5 w-3.5" />
                    ) : (
                      <Layers className="h-3.5 w-3.5" />
                    )}
                  </span>
                )}

                {/* Hover stats overlay */}
                <div className="absolute inset-0 flex items-center justify-center gap-5 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-white tabular-nums">
                    <Heart className="h-4 w-4 fill-white" />
                    {formatCompactCount(post.likes.length)}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-white tabular-nums">
                    <MessageCircle className="h-4 w-4 fill-white" />
                    {formatCompactCount(totalComments)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
