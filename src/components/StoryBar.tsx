import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';
import { ProfileHoverCard } from './ProfileHoverCard';

interface StoryBarProps {
  onAddStory: () => void;
}

export function StoryBar({ onAddStory }: StoryBarProps) {
  const { stories, users, currentUser, setActiveStoryAuthorId } = useSocial();

  const storyAuthors = useMemo(() => {
    const authorMap = new Map<
      string,
      { userId: string; hasUnseen: boolean; latestAt: number }
    >();

    for (const s of stories) {
      const existing = authorMap.get(s.authorId);
      const isUnseen = !s.viewedBy.includes(currentUser.id);
      if (!existing) {
        authorMap.set(s.authorId, {
          userId: s.authorId,
          hasUnseen: isUnseen,
          latestAt: s.createdAt,
        });
      } else {
        existing.hasUnseen = existing.hasUnseen || isUnseen;
        existing.latestAt = Math.max(existing.latestAt, s.createdAt);
      }
    }

    return Array.from(authorMap.values())
      .filter((item) => item.userId !== currentUser.id)
      .sort((a, b) => {
        if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
        return b.latestAt - a.latestAt;
      });
  }, [stories, currentUser.id]);

  const myStories = stories.filter((s) => s.authorId === currentUser.id);
  const myHasStory = myStories.length > 0;
  const myHasUnseen = myStories.some((s) => !s.viewedBy.includes(currentUser.id));

  return (
    <section
      aria-label="Stories recentes"
      className="border-b border-zinc-200/80 bg-white py-4 dark:border-zinc-800/80 dark:bg-[#050505] sm:rounded-xl sm:border sm:px-4"
    >
      <div className="no-scrollbar flex items-center gap-4 overflow-x-auto px-3 sm:px-0">
        {/* Current user story slot */}
        <div className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
          <div className="relative">
            <AvatarRing
              src={currentUser.avatarUrl}
              alt="Seu story"
              size="lg"
              hasStory={myHasStory}
              hasUnseenStory={myHasUnseen}
              onClick={() => {
                if (myHasStory) {
                  setActiveStoryAuthorId(currentUser.id);
                } else {
                  onAddStory();
                }
              }}
            />
            <button
              type="button"
              onClick={onAddStory}
              aria-label="Adicionar novo story"
              className="absolute right-0 bottom-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-600 text-white transition-transform hover:scale-105 dark:border-[#050505]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <span className="w-full truncate text-center text-xs text-zinc-700 dark:text-zinc-300">
            Seu story
          </span>
        </div>

        {/* Following & creator stories */}
        {storyAuthors.map((entry) => {
          const author = users.find((u) => u.id === entry.userId);
          if (!author) return null;
          return (
            <ProfileHoverCard key={author.id} userId={author.id} className="inline-flex shrink-0">
              <button
                type="button"
                onClick={() => setActiveStoryAuthorId(author.id)}
                className="group flex w-[72px] shrink-0 flex-col items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-rose-500"
              >
                <AvatarRing
                  src={author.avatarUrl}
                  alt={`Ver story de ${author.username}`}
                  size="lg"
                  hasStory
                  hasUnseenStory={entry.hasUnseen}
                  showOnlineIndicator={Boolean(author.isOnline)}
                />
                <span
                  className={`w-full truncate text-center text-xs ${
                    entry.hasUnseen
                      ? 'font-medium text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {author.username}
                </span>
              </button>
            </ProfileHoverCard>
          );
        })}
      </div>
    </section>
  );
}
