import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface MediaImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackLabel?: string;
}

export function MediaImage({
  src,
  alt,
  className = '',
  style,
  fallbackLabel,
  ...rest
}: MediaImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-500 dark:from-zinc-900 dark:to-zinc-800 dark:text-zinc-400 ${className}`}
        style={style}
        role="img"
        aria-label={alt || fallbackLabel || 'Mídia indisponível'}
      >
        <ImageOff className="h-6 w-6 opacity-60" strokeWidth={1.6} />
        {fallbackLabel && (
          <span className="mt-1.5 max-w-[80%] truncate px-2 text-xs font-medium">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      style={style}
      {...rest}
    />
  );
}
