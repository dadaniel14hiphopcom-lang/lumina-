import { BadgeCheck, RefreshCw, UserCheck, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isUserEffectivelyOnline, useSocial } from '../context/SocialContext';
import { UserProfile } from '../types';
import { formatCompactCount } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { ProfileHoverCard } from './ProfileHoverCard';

interface SuggestedUsersProps {
  excludeIds?: Set<string>;
  limit?: number;
}

export function SuggestedUsers({ excludeIds, limit = 5 }: SuggestedUsersProps) {
  const {
    currentUser,
    users,
    posts,
    toggleFollow,
    openProfile,
    setActiveNav,
    isAuthenticated,
  } = useSocial();

  const [sessionInteractedIds, setSessionInteractedIds] = useState<string[]>([]);
  const [rotationOffset, setRotationOffset] = useState(0);

  const isUserFollowed = (user: UserProfile) =>
    currentUser.following.includes(user.id) ||
    Boolean(user.uid && currentUser.following.includes(user.uid));

  const rankedSuggestions = useMemo(() => {
    const postMetricsByAuthor = new Map<string, { posts: number; engagement: number }>();
    for (const post of posts) {
      const eng = post.likes.length + post.comments.length * 2;
      const cur = postMetricsByAuthor.get(post.authorId) || { posts: 0, engagement: 0 };
      postMetricsByAuthor.set(post.authorId, {
        posts: cur.posts + 1,
        engagement: cur.engagement + eng,
      });
      if (post.authorUid && post.authorUid !== post.authorId) {
        const curUid = postMetricsByAuthor.get(post.authorUid) || { posts: 0, engagement: 0 };
        postMetricsByAuthor.set(post.authorUid, {
          posts: curUid.posts + 1,
          engagement: curUid.engagement + eng,
        });
      }
    }

    const myFollowingSet = new Set(currentUser.following);
    const interactedSet = new Set(sessionInteractedIds);

    const eligible = users.filter((u) => {
      if (u.restricted) return false;
      if (u.id === currentUser.id || (currentUser.uid && u.uid === currentUser.uid)) {
        return false;
      }
      const followed = isUserFollowed(u);
      // Keep users just followed in this interaction batch so the user gets immediate feedback
      if (followed && !interactedSet.has(u.id)) return false;
      return true;
    });

    const nonExcluded =
      excludeIds && excludeIds.size > 0
        ? eligible.filter((u) => !excludeIds.has(u.id))
        : eligible;
    const pool = nonExcluded.length >= Math.min(2, limit) ? nonExcluded : eligible;

    const scored = pool.map((u) => {
      const m =
        postMetricsByAuthor.get(u.id) ||
        (u.uid ? postMetricsByAuthor.get(u.uid) : undefined) || {
          posts: 0,
          engagement: 0,
        };
      const mutualCount = u.followers.filter((fid) => myFollowingSet.has(fid)).length;
      const popularityScore =
        (!u.isDemoSeed ? 30 : 0) +
        u.followers.length * 4 +
        m.posts * 3 +
        m.engagement * 2 +
        mutualCount * 6 +
        (u.boosted ? 20 : 0) +
        (u.verified ? 10 : 0);

      let reason = u.displayName;
      if (mutualCount > 0) {
        reason =
          mutualCount === 1
            ? 'Seguido por 1 conexão'
            : `Seguido por ${mutualCount} conexões`;
      } else if (u.followers.length > 0) {
        const label = u.followers.length === 1 ? 'seguidor' : 'seguidores';
        reason = `${formatCompactCount(u.followers.length)} ${label}`;
      } else if (!u.isDemoSeed) {
        reason = 'Novo na Lumina';
      }

      return { user: u, score: popularityScore, reason, m };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored.length <= limit || rotationOffset === 0) {
      return { items: scored.slice(0, limit), totalAvailable: scored.length };
    }

    const start = rotationOffset % scored.length;
    const rotated = [...scored.slice(start), ...scored.slice(0, start)];
    return { items: rotated.slice(0, limit), totalAvailable: scored.length };
  }, [users, posts, currentUser, excludeIds, limit, sessionInteractedIds, rotationOffset]);

  const handleQuickFollow = (targetUser: UserProfile) => {
    if (isAuthenticated) {
      setSessionInteractedIds((prev) =>
        prev.includes(targetUser.id) ? prev : [...prev, targetUser.id]
      );
    }
    toggleFollow(targetUser.id);
  };

  const handleRefreshSuggestions = () => {
    setSessionInteractedIds([]);
    setRotationOffset((prev) => prev + limit);
  };

  return (
    <section aria-labelledby="suggested-users-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="suggested-users-heading"
          className="text-sm font-semibold text-zinc-800 dark:text-zinc-200"
        >
          Sugestões para você
        </h2>

        <div className="flex shrink-0 items-center gap-2.5">
          {rankedSuggestions.totalAvailable > limit && (
            <button
              type="button"
              onClick={handleRefreshSuggestions}
              aria-label="Atualizar sugestões"
              title="Ver outras sugestões"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveNav('explore')}
            className="whitespace-nowrap text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
          >
            Ver tudo
          </button>
        </div>
      </div>

      {rankedSuggestions.items.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-5 text-center dark:border-zinc-800/80 dark:bg-zinc-950">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Você já segue todos os perfis sugeridos.
          </p>
          <button
            type="button"
            onClick={() => setActiveNav('explore')}
            className="mt-2 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
          >
            Descobrir mais no Explorar
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rankedSuggestions.items.map(({ user, reason }) => {
            const following = isUserFollowed(user);
            return (
              <div
                key={user.id}
                className="flex items-center justify-between gap-2.5"
              >
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
                        {user.displayName !== reason
                          ? `${user.displayName} · ${reason}`
                          : reason}
                      </p>
                    </div>
                  </button>
                </ProfileHoverCard>

                <button
                  type="button"
                  onClick={() => handleQuickFollow(user)}
                  aria-pressed={following}
                  aria-label={
                    following ? `Deixar de seguir @${user.username}` : `Seguir @${user.username}`
                  }
                  className={`inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                    following
                      ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      : 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60'
                  }`}
                >
                  {following ? (
                    <>
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>Seguindo</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Seguir</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
