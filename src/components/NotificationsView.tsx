import { useEffect } from 'react';
import { isUserEffectivelyOnline, useSocial } from '../context/SocialContext';
import { formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';
import { ProfileHoverCard } from './ProfileHoverCard';

export function NotificationsView() {
  const {
    notifications,
    currentUser,
    posts,
    getUserById,
    toggleFollow,
    setSelectedPostId,
    openProfile,
    markNotificationsRead,
  } = useSocial();

  const myIds = new Set([currentUser.id, currentUser.uid || ''].filter(Boolean));

  const myNotifs = notifications.filter((n) => myIds.has(n.recipientId));
  const hasUnread = myNotifs.some((n) => !n.read);

  useEffect(() => {
    if (hasUnread) {
      markNotificationsRead();
    }
  }, [hasUnread]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:py-8">
      <h1 className="mb-6 text-xl font-bold text-zinc-950 dark:text-zinc-100">
        Notificações
      </h1>

      {myNotifs.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 py-14 text-center dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nenhuma atividade recente
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Curtidas, comentários, menções e novos seguidores aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {myNotifs.map((item) => {
            const actor = getUserById(item.actorId);
            if (!actor) return null;
            const post = item.postId
              ? posts.find((p) => p.id === item.postId)
              : undefined;
            const isFollowing = currentUser.following.includes(actor.id);

            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileHoverCard userId={actor.id}>
                    <AvatarRing
                      src={actor.avatarUrl}
                      alt={actor.username}
                      size="md"
                      showOnlineIndicator={isUserEffectivelyOnline(actor, currentUser.id)}
                      onClick={() => openProfile(actor.id)}
                    />
                  </ProfileHoverCard>
                  <div className="min-w-0 text-sm leading-snug text-zinc-900 dark:text-zinc-100">
                    <ProfileHoverCard userId={actor.id}>
                      <button
                        type="button"
                        onClick={() => openProfile(actor.id)}
                        className="mr-1.5 font-semibold hover:underline"
                      >
                        {actor.username}
                      </button>
                    </ProfileHoverCard>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {item.type === 'like' && 'curtiu sua publicação.'}
                      {item.type === 'comment' &&
                        `comentou: "${item.text || ''}"`}
                      {item.type === 'follow' && 'começou a seguir você.'}
                      {item.type === 'mention' &&
                        (item.postId
                          ? item.text
                            ? `mencionou você: "${item.text}"`
                            : 'mencionou você em uma publicação.'
                          : item.text
                          ? `enviou mensagem: "${item.text}"`
                          : 'mencionou você.')}
                    </span>{' '}
                    <span className="text-xs text-zinc-400">
                      · {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                </div>

                {item.type === 'follow' ? (
                  <button
                    type="button"
                    onClick={() => toggleFollow(actor.id)}
                    className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      isFollowing
                        ? 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    {isFollowing ? 'Seguindo' : 'Seguir de volta'}
                  </button>
                ) : (
                  post && (
                    <button
                      type="button"
                      onClick={() => setSelectedPostId(post.id)}
                      className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900"
                    >
                      <MediaImage
                        src={post.media[0]?.url}
                        alt={post.caption}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
