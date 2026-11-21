import { MediaImage } from './MediaImage';

interface AvatarRingProps {
  src: string;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  hasStory?: boolean;
  hasUnseenStory?: boolean;
  showOnlineIndicator?: boolean;
  onClick?: () => void;
}

const SIZE_CLASSES: Record<NonNullable<AvatarRingProps['size']>, string> = {
  xs: 'h-7 w-7',
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24 md:h-32 md:w-32',
};

const DOT_SIZE_CLASSES: Record<NonNullable<AvatarRingProps['size']>, string> = {
  xs: 'h-2 w-2 right-0 bottom-0',
  sm: 'h-2.5 w-2.5 right-0 bottom-0',
  md: 'h-3 w-3 right-0 bottom-0',
  lg: 'h-3.5 w-3.5 right-0.5 bottom-0.5',
  xl: 'h-4 w-4 right-1.5 bottom-1.5',
};

export function AvatarRing({
  src,
  alt,
  size = 'md',
  hasStory = false,
  hasUnseenStory = false,
  showOnlineIndicator = false,
  onClick,
}: AvatarRingProps) {
  const dim = SIZE_CLASSES[size];
  const dotDim = DOT_SIZE_CLASSES[size];

  const ringClass = hasStory
    ? hasUnseenStory
      ? 'bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 p-[2px]'
      : 'bg-zinc-300 dark:bg-zinc-700 p-[1.5px]'
    : '';

  const innerPadding = hasStory ? 'bg-white dark:bg-[#050505] p-[2px] rounded-full' : '';

  const content = (
    <span className="relative inline-flex shrink-0">
      <span className={`inline-flex shrink-0 rounded-full ${ringClass}`}>
        <span className={`inline-flex rounded-full ${innerPadding}`}>
          <MediaImage
            src={src}
            alt={alt}
            className={`${dim} rounded-full object-cover select-none`}
          />
        </span>
      </span>
      {showOnlineIndicator && (
        <span
          title="Ativo agora"
          aria-label="Ativo agora"
          className={`absolute rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#050505] ${dotDim}`}
        />
      )}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
        aria-label={alt}
      >
        {content}
      </button>
    );
  }

  return content;
}
