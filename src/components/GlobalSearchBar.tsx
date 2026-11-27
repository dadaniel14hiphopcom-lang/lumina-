import {
  BadgeCheck,
  Clock,
  Compass,
  Film,
  Hash,
  MapPin,
  Music2,
  Search,
  Sparkles,
  TrendingUp,
  User as UserIcon,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isUserEffectivelyOnline, useSocial } from '../context/SocialContext';
import { Post, PostCategory, UserProfile } from '../types';
import { isVideoAsset, resolvePlayableMediaUrl } from '../utils/media';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

type SearchTab = 'all' | 'profiles' | 'hashtags' | 'topics';

interface HashtagEntry {
  tag: string;
  displayTag: string;
  count: number;
  engagement: number;
}

interface TopicEntry {
  label: string;
  kind: 'Categoria' | 'Local' | 'Áudio';
  count: number;
}

type SelectableAction =
  | { type: 'profile'; user: UserProfile }
  | { type: 'hashtag'; tag: string }
  | { type: 'topic'; label: string }
  | { type: 'post'; post: Post };

const POST_CATEGORIES: PostCategory[] = [
  'Fotografia',
  'Arquitetura',
  'Gastronomia',
  'Viagem',
  'Design',
  'Arte',
];

const HASHTAG_REGEX = /#([a-zA-ZÀ-ÿ0-9_]{2,40})/g;

interface GlobalSearchBarProps {
  mode: 'sidebar' | 'mobile';
}

export function GlobalSearchBar({ mode }: GlobalSearchBarProps) {
  const {
    users,
    allUsers,
    posts,
    currentUser,
    getUserById,
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
    refreshPublicUsersFromSupabase,
    openProfile,
    openHashtagInExplore,
    setSelectedPostId,
  } = useSocial();

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const railInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const lastRefreshRef = useRef<number>(0);

  const triggerBackgroundRefresh = () => {
    const now = Date.now();
    if (now - lastRefreshRef.current > 15000) {
      lastRefreshRef.current = now;
      void refreshPublicUsersFromSupabase();
    }
  };

  // Close desktop popover on outside click
  useEffect(() => {
    if (mode !== 'sidebar' || !isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mode, isOpen]);

  // Global keyboard shortcut: Cmd/Ctrl + K focuses search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
        if (mode === 'sidebar' && isDesktop) {
          e.preventDefault();
          setIsOpen(true);
          triggerBackgroundRefresh();
          window.setTimeout(() => {
            if (window.matchMedia('(min-width: 1280px)').matches) {
              desktopInputRef.current?.focus();
            } else {
              railInputRef.current?.focus();
            }
          }, 20);
        } else if (mode === 'mobile' && !isDesktop) {
          e.preventDefault();
          setIsOpen(true);
          triggerBackgroundRefresh();
          window.setTimeout(() => mobileInputRef.current?.focus(), 20);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode]);

  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const cleanQuery = normalized.replace(/^[@#]/, '');
  const isHandleOnly = normalized.startsWith('@');
  const isHashtagOnly = normalized.startsWith('#');

  const userPool = useMemo(() => {
    const pool = users.length > 0 ? users : allUsers;
    return pool.filter((u) => !u.restricted);
  }, [users, allUsers]);

  const matchedUsers = useMemo(() => {
    if (!cleanQuery) {
      return [...userPool]
        .sort((a, b) => {
          const aReal = a.isDemoSeed ? 0 : 1;
          const bReal = b.isDemoSeed ? 0 : 1;
          if (aReal !== bReal) return bReal - aReal;
          return b.followers.length - a.followers.length;
        })
        .slice(0, 4);
    }

    if (isHashtagOnly && activeTab === 'all') return [];

    return userPool
      .map((u) => {
        const uname = u.username.toLowerCase();
        const dname = u.displayName.toLowerCase();
        const bio = (u.bio || '').toLowerCase();

        let score = 0;
        if (uname === cleanQuery) score = 100;
        else if (uname.startsWith(cleanQuery)) score = 70;
        else if (dname.startsWith(cleanQuery)) score = 55;
        else if (uname.includes(cleanQuery)) score = 38;
        else if (dname.includes(cleanQuery)) score = 26;
        else if (bio.includes(cleanQuery)) score = 12;

        if (score === 0) return null;
        if (!u.isDemoSeed) score += 6;
        if (u.verified) score += 2;
        if (u.boosted) score += 2;

        return { user: u, score };
      })
      .filter((entry): entry is { user: UserProfile; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, activeTab === 'profiles' ? 16 : 5)
      .map((entry) => entry.user);
  }, [userPool, cleanQuery, isHashtagOnly, activeTab]);

  const allHashtags = useMemo<HashtagEntry[]>(() => {
    const map = new Map<
      string,
      { countsByCase: Map<string, number>; count: number; engagement: number }
    >();

    for (const post of posts) {
      if (!post.caption) continue;
      const matches = post.caption.match(HASHTAG_REGEX);
      if (!matches) continue;
      const seenInPost = new Set<string>();
      const engagement = post.likes.length + post.comments.length * 2;

      for (const rawTag of matches) {
        const body = rawTag.slice(1);
        const key = body.toLowerCase();
        if (seenInPost.has(key)) continue;
        seenInPost.add(key);

        const existing = map.get(key) || {
          countsByCase: new Map<string, number>(),
          count: 0,
          engagement: 0,
        };
        existing.count += 1;
        existing.engagement += engagement;
        existing.countsByCase.set(body, (existing.countsByCase.get(body) || 0) + 1);
        map.set(key, existing);
      }
    }

    return Array.from(map.entries())
      .map(([tag, info]) => {
        let bestCase = tag;
        let maxCaseCount = -1;
        for (const [variant, c] of info.countsByCase.entries()) {
          if (c > maxCaseCount) {
            maxCaseCount = c;
            bestCase = variant;
          }
        }
        return {
          tag,
          displayTag: bestCase,
          count: info.count,
          engagement: info.engagement,
        };
      })
      .sort((a, b) => b.count - a.count || b.engagement - a.engagement);
  }, [posts]);

  const matchedHashtags = useMemo(() => {
    if (!cleanQuery) return allHashtags.slice(0, 6);
    if (isHandleOnly && activeTab === 'all') return [];

    return allHashtags
      .filter((h) => h.tag.includes(cleanQuery))
      .sort((a, b) => {
        const aPrefix = a.tag.startsWith(cleanQuery) ? 1 : 0;
        const bPrefix = b.tag.startsWith(cleanQuery) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        return b.count - a.count;
      })
      .slice(0, activeTab === 'hashtags' ? 16 : 5);
  }, [allHashtags, cleanQuery, isHandleOnly, activeTab]);

  const allTopics = useMemo<TopicEntry[]>(() => {
    const categoryCounts = new Map<PostCategory, number>();
    const locationCounts = new Map<string, { label: string; count: number }>();
    const audioCounts = new Map<string, { label: string; count: number }>();

    for (const post of posts) {
      categoryCounts.set(post.category, (categoryCounts.get(post.category) || 0) + 1);
      if (post.location && post.location.trim()) {
        const cleanLoc = post.location.trim();
        const key = cleanLoc.toLowerCase();
        const prev = locationCounts.get(key);
        locationCounts.set(key, {
          label: prev?.label || cleanLoc,
          count: (prev?.count || 0) + 1,
        });
      }
      if (post.audioTrack && post.audioTrack.trim()) {
        const cleanAudio = post.audioTrack.trim();
        const key = cleanAudio.toLowerCase();
        const prev = audioCounts.get(key);
        audioCounts.set(key, {
          label: prev?.label || cleanAudio,
          count: (prev?.count || 0) + 1,
        });
      }
    }

    const categories: TopicEntry[] = POST_CATEGORIES.map((cat) => ({
      label: cat,
      kind: 'Categoria',
      count: categoryCounts.get(cat) || 0,
    }));

    const locations: TopicEntry[] = Array.from(locationCounts.values()).map((loc) => ({
      label: loc.label,
      kind: 'Local',
      count: loc.count,
    }));

    const audios: TopicEntry[] = Array.from(audioCounts.values()).map((a) => ({
      label: a.label,
      kind: 'Áudio',
      count: a.count,
    }));

    return [...categories, ...locations, ...audios].sort((a, b) => b.count - a.count);
  }, [posts]);

  const matchedTopics = useMemo(() => {
    if (!cleanQuery) {
      return allTopics.filter((t) => t.kind === 'Categoria' || t.count > 0).slice(0, 6);
    }
    if ((isHandleOnly || isHashtagOnly) && activeTab === 'all') return [];

    return allTopics
      .filter((t) => t.label.toLowerCase().includes(cleanQuery))
      .sort((a, b) => {
        const aPrefix = a.label.toLowerCase().startsWith(cleanQuery) ? 1 : 0;
        const bPrefix = b.label.toLowerCase().startsWith(cleanQuery) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        return b.count - a.count;
      })
      .slice(0, activeTab === 'topics' ? 12 : 4);
  }, [allTopics, cleanQuery, isHandleOnly, isHashtagOnly, activeTab]);

  const matchedPosts = useMemo(() => {
    if (!cleanQuery) return [];
    if (isHandleOnly && activeTab === 'all') return [];

    return posts
      .filter((p) => {
        const caption = p.caption.toLowerCase();
        const loc = (p.location || '').toLowerCase();
        const cat = p.category.toLowerCase();
        const audio = (p.audioTrack || '').toLowerCase();
        const author =
          getUserById(p.authorId) || (p.authorUid ? getUserById(p.authorUid) : undefined);

        if (isHashtagOnly) {
          return caption.includes(`#${cleanQuery}`);
        }
        return (
          caption.includes(normalized) ||
          loc.includes(cleanQuery) ||
          cat.includes(cleanQuery) ||
          audio.includes(cleanQuery) ||
          Boolean(
            author &&
              (author.username.toLowerCase().includes(cleanQuery) ||
                author.displayName.toLowerCase().includes(cleanQuery))
          )
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, activeTab === 'topics' ? 8 : 3);
  }, [posts, cleanQuery, normalized, isHandleOnly, isHashtagOnly, activeTab, getUserById]);

  const showProfiles = activeTab === 'all' || activeTab === 'profiles';
  const showHashtags = activeTab === 'all' || activeTab === 'hashtags';
  const showTopics = activeTab === 'all' || activeTab === 'topics';

  const selectableItems = useMemo<SelectableAction[]>(() => {
    const items: SelectableAction[] = [];
    if (showProfiles) {
      for (const user of matchedUsers) items.push({ type: 'profile', user });
    }
    if (showHashtags) {
      for (const h of matchedHashtags) items.push({ type: 'hashtag', tag: `#${h.displayTag}` });
    }
    if (showTopics) {
      for (const t of matchedTopics) items.push({ type: 'topic', label: t.label });
      if (cleanQuery) {
        for (const p of matchedPosts) items.push({ type: 'post', post: p });
      }
    }
    return items;
  }, [
    showProfiles,
    showHashtags,
    showTopics,
    matchedUsers,
    matchedHashtags,
    matchedTopics,
    matchedPosts,
    cleanQuery,
  ]);

  useEffect(() => {
    setHighlightedIdx(-1);
  }, [query, activeTab, isOpen]);

  const closeSearch = () => {
    setIsOpen(false);
    setHighlightedIdx(-1);
  };

  const executeAction = (action: SelectableAction) => {
    if (action.type === 'profile') {
      addRecentSearch(`@${action.user.username}`);
      closeSearch();
      openProfile(action.user.id);
      return;
    }
    if (action.type === 'hashtag') {
      addRecentSearch(action.tag);
      closeSearch();
      openHashtagInExplore(action.tag);
      return;
    }
    if (action.type === 'topic') {
      addRecentSearch(action.label);
      closeSearch();
      openHashtagInExplore(action.label);
      return;
    }
    if (action.type === 'post') {
      if (trimmed) addRecentSearch(trimmed);
      closeSearch();
      setSelectedPostId(action.post.id);
    }
  };

  const handleOpenAllInExplore = () => {
    if (!trimmed) {
      closeSearch();
      openHashtagInExplore('');
      return;
    }
    addRecentSearch(trimmed);
    closeSearch();
    openHashtagInExplore(trimmed);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectableItems.length > 0) {
        setHighlightedIdx((prev) => (prev + 1) % selectableItems.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectableItems.length > 0) {
        setHighlightedIdx((prev) =>
          prev <= 0 ? selectableItems.length - 1 : prev - 1
        );
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIdx >= 0 && selectableItems[highlightedIdx]) {
        executeAction(selectableItems[highlightedIdx]);
      } else if (trimmed) {
        handleOpenAllInExplore();
      }
    }
  };

  const hasAnyResults =
    (showProfiles && matchedUsers.length > 0) ||
    (showHashtags && matchedHashtags.length > 0) ||
    (showTopics && (matchedTopics.length > 0 || (Boolean(cleanQuery) && matchedPosts.length > 0)));

  const renderResultsBody = () => {
    let runningIdx = 0;

    return (
      <div className="flex flex-col">
        {/* Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filtrar busca por categoria"
          className="grid grid-cols-4 gap-1 border-b border-zinc-200/80 bg-zinc-50/70 p-1.5 dark:border-zinc-800 dark:bg-zinc-900/50"
        >
          {(
            [
              { id: 'all', label: 'Tudo' },
              { id: 'profiles', label: 'Perfis' },
              { id: 'hashtags', label: 'Hashtags' },
              { id: 'topics', label: 'Tópicos' },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-2.5 lg:max-h-[420px]">
          {/* Recent Searches (only when query is empty) */}
          {!cleanQuery && recentSearches.length > 0 && (
            <div className="mb-3 border-b border-zinc-100 pb-3 dark:border-zinc-800/80">
              <div className="mb-1.5 flex items-center justify-between px-1.5">
                <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                  Buscas recentes
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearRecentSearches}
                  className="text-[11px] font-semibold text-sky-600 hover:underline dark:text-sky-400"
                >
                  Limpar
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {recentSearches.slice(0, 6).map((term) => (
                  <button
                    key={term}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (term.startsWith('@')) {
                        const target = getUserById(term.slice(1));
                        if (target) {
                          executeAction({ type: 'profile', user: target });
                          return;
                        }
                      }
                      setQuery(term);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Clock className="h-3 w-3 text-zinc-400" />
                    <span className="max-w-[140px] truncate">{term}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!hasAnyResults ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Nenhum resultado para &ldquo;{trimmed}&rdquo;
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Busque por @usuário, #hashtag ou tópicos como Fotografia e Arquitetura.
              </p>
              {trimmed && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleOpenAllInExplore}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>Buscar no Explorar</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Profiles Section */}
              {showProfiles && matchedUsers.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between px-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      <UserIcon className="h-3 w-3" />
                      <span>{cleanQuery ? 'Perfis' : 'Perfis em destaque'}</span>
                    </span>
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {matchedUsers.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {matchedUsers.map((user) => {
                      const itemIdx = runningIdx++;
                      const active = highlightedIdx === itemIdx;
                      const online = isUserEffectivelyOnline(user, currentUser.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlightedIdx(itemIdx)}
                          onClick={() => executeAction({ type: 'profile', user })}
                          className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                            active
                              ? 'bg-zinc-100 dark:bg-zinc-900'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/70'
                          }`}
                        >
                          <AvatarRing
                            src={user.avatarUrl}
                            alt={user.username}
                            size="sm"
                            showOnlineIndicator={online}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                                @{user.username}
                              </span>
                              {user.verified && (
                                <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                              )}
                            </div>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              <span>{user.displayName}</span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {formatCompactCount(user.followers.length)} seg.
                              </span>
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hashtags Section */}
              {showHashtags && matchedHashtags.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between px-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      <Hash className="h-3 w-3" />
                      <span>{cleanQuery ? 'Hashtags' : 'Hashtags em alta'}</span>
                    </span>
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {matchedHashtags.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {matchedHashtags.map((h) => {
                      const itemIdx = runningIdx++;
                      const active = highlightedIdx === itemIdx;
                      return (
                        <button
                          key={h.tag}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlightedIdx(itemIdx)}
                          onClick={() =>
                            executeAction({ type: 'hashtag', tag: `#${h.displayTag}` })
                          }
                          className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                            active
                              ? 'bg-zinc-100 dark:bg-zinc-900'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/70'
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                            <Hash className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                              #{h.displayTag}
                            </p>
                            <p className="truncate text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                              {h.count} {h.count === 1 ? 'publicação' : 'publicações'}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Direct hashtag search fallback when typing #newtag */}
              {showHashtags &&
                isHashtagOnly &&
                cleanQuery.length >= 2 &&
                !matchedHashtags.some((h) => h.tag === cleanQuery) && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      executeAction({ type: 'hashtag', tag: `#${cleanQuery}` })
                    }
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/70"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                      <Search className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                        Explorar #{cleanQuery}
                      </p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        Filtrar publicações com esta hashtag
                      </p>
                    </div>
                  </button>
                )}

              {/* Topics / Categories / Locations Section */}
              {showTopics && matchedTopics.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between px-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      <TrendingUp className="h-3 w-3" />
                      <span>{cleanQuery ? 'Tópicos e locais' : 'Tópicos populares'}</span>
                    </span>
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {matchedTopics.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {matchedTopics.map((topic) => {
                      const itemIdx = runningIdx++;
                      const active = highlightedIdx === itemIdx;
                      return (
                        <button
                          key={`${topic.kind}:${topic.label}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlightedIdx(itemIdx)}
                          onClick={() => executeAction({ type: 'topic', label: topic.label })}
                          className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                            active
                              ? 'bg-zinc-100 dark:bg-zinc-900'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/70'
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                            {topic.kind === 'Local' ? (
                              <MapPin className="h-4 w-4" />
                            ) : topic.kind === 'Áudio' ? (
                              <Music2 className="h-4 w-4" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                              {topic.label}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              <span>{topic.kind}</span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {topic.count} {topic.count === 1 ? 'publicação' : 'publicações'}
                              </span>
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Matching Publications (when searching) */}
              {showTopics && cleanQuery && matchedPosts.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between px-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      <Compass className="h-3 w-3" />
                      <span>Publicações relacionadas</span>
                    </span>
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {matchedPosts.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {matchedPosts.map((post) => {
                      const itemIdx = runningIdx++;
                      const active = highlightedIdx === itemIdx;
                      const author =
                        getUserById(post.authorId) ||
                        (post.authorUid ? getUserById(post.authorUid) : undefined);

                      return (
                        <button
                          key={post.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlightedIdx(itemIdx)}
                          onClick={() => executeAction({ type: 'post', post })}
                          className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                            active
                              ? 'bg-zinc-100 dark:bg-zinc-900'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/70'
                          }`}
                        >
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                            {isVideoAsset(post.media[0]) ? (
                              <video
                                src={resolvePlayableMediaUrl(post.media[0]?.url)}
                                muted
                                playsInline
                                preload="metadata"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <MediaImage
                                src={post.media[0]?.url}
                                alt={post.media[0]?.alt || post.caption}
                                className="h-full w-full object-cover"
                              />
                            )}
                            {post.isReel && (
                              <span className="absolute right-0.5 bottom-0.5 rounded bg-black/65 p-0.5 text-white">
                                <Film className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                              {post.caption || 'Publicação sem legenda'}
                            </p>
                            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                              <span>{author ? `@${author.username}` : 'Lumina'}</span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span>{post.category}</span>
                              {post.location ? (
                                <>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span>{post.location}</span>
                                </>
                              ) : null}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer quick explore action */}
        {trimmed && (
          <div className="border-t border-zinc-200/80 p-2 dark:border-zinc-800">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleOpenAllInExplore}
              className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-sky-600 transition-colors hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/30"
            >
              <span className="truncate">
                Ver todos os resultados para &ldquo;{trimmed}&rdquo;
              </span>
              <Compass className="h-4 w-4 shrink-0" />
            </button>
          </div>
        )}
      </div>
    );
  };

  if (mode === 'mobile') {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            triggerBackgroundRefresh();
            window.setTimeout(() => mobileInputRef.current?.focus(), 30);
          }}
          aria-label="Pesquisar perfis, hashtags ou tópicos"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <Search className="h-5 w-5" />
        </button>

        {isOpen && (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-[#050505]"
            role="dialog"
            aria-modal="true"
            aria-label="Pesquisa global"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  ref={mobileInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Perfis, #hashtags ou tópicos..."
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Limpar busca"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeSearch}
                className="flex h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Fechar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {renderResultsBody()}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Expanded Desktop Sidebar Search Input (xl+) */}
      <div className="hidden xl:block">
        <div
          className={`flex h-10 items-center gap-2 rounded-xl border px-3 transition-colors ${
            isOpen
              ? 'border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-900'
              : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-zinc-700'
          }`}
        >
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={desktopInputRef}
            type="text"
            value={query}
            onFocus={() => {
              setIsOpen(true);
              triggerBackgroundRefresh();
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Buscar @perfil, #tag..."
            aria-label="Pesquisar perfis, hashtags ou tópicos"
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
          />
          {query ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery('');
                desktopInputRef.current?.focus();
              }}
              aria-label="Limpar pesquisa"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 xl:inline">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {/* Collapsed Rail Search Button (lg to xl) */}
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next) {
            triggerBackgroundRefresh();
            window.setTimeout(() => railInputRef.current?.focus(), 30);
          }
        }}
        aria-label="Pesquisar perfis, hashtags ou tópicos"
        aria-expanded={isOpen}
        className={`flex h-12 w-full items-center justify-center rounded-xl transition-colors xl:hidden ${
          isOpen
            ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-white'
            : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60'
        }`}
      >
        <Search className="h-6 w-6 shrink-0" strokeWidth={isOpen ? 2.3 : 1.8} />
      </button>

      {/* Real-time Floating Search Results Panel */}
      {isOpen && (
        <div
          role="region"
          aria-label="Resultados da pesquisa em tempo real"
          className="absolute top-0 left-full z-50 ml-3 w-[350px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 xl:top-full xl:left-0 xl:mt-2 xl:ml-0 xl:w-[370px]"
        >
          {/* Compact header input inside panel when opened from collapsed lg rail */}
          <div className="border-b border-zinc-200 p-2.5 dark:border-zinc-800 xl:hidden">
            <div className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
              <Search className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                ref={railInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Perfis, #hashtags ou tópicos..."
                className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
              />
              {query && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setQuery('')}
                  aria-label="Limpar pesquisa"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {renderResultsBody()}
        </div>
      )}
    </div>
  );
}
