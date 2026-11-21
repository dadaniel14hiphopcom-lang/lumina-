import { MediaAsset } from '../types';

export function isVideoAsset(media?: Partial<MediaAsset> | null): boolean {
  if (!media?.url) return false;
  if (media.mediaType === 'video') return true;
  if (media.url.startsWith('data:video/')) return true;
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(media.url)) return true;
  return false;
}
