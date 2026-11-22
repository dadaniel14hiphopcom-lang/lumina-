import { MediaAsset } from '../types';

export function isVideoAsset(media?: Partial<MediaAsset> | null): boolean {
  if (!media?.url) return false;
  if (media.mediaType === 'video') return true;
  if (media.url.startsWith('data:video/')) return true;
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(media.url)) return true;
  return false;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
    img.src = src;
  });
}

/**
 * Resizes and compresses image files so avatars, covers, stories, and feed photos
 * sync reliably across devices via Firestore and fit cleanly within document limits.
 */
export async function compressImageFile(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    maxChars?: number;
  }
): Promise<string> {
  const maxWidth = options?.maxWidth ?? 1280;
  const maxHeight = options?.maxHeight ?? 1280;
  const initialQuality = options?.quality ?? 0.82;
  const maxChars = options?.maxChars ?? 360_000;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let targetWidth = img.naturalWidth || img.width || maxWidth;
    let targetHeight = img.naturalHeight || img.height || maxHeight;

    const widthRatio = maxWidth / targetWidth;
    const heightRatio = maxHeight / targetHeight;
    const scale = Math.min(1, widthRatio, heightRatio);

    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return await readAsDataUrl(file);
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    let quality = initialQuality;
    let output = canvas.toDataURL('image/jpeg', quality);
    while (output.length > maxChars && quality > 0.42) {
      quality = Math.max(0.4, quality - 0.12);
      output = canvas.toDataURL('image/jpeg', quality);
    }

    // If still larger than maxChars, shrink dimensions further
    if (output.length > maxChars) {
      const shrink = Math.sqrt(maxChars / output.length) * 0.9;
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = Math.max(120, Math.round(targetWidth * shrink));
      smallCanvas.height = Math.max(120, Math.round(targetHeight * shrink));
      const smallCtx = smallCanvas.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
        output = smallCanvas.toDataURL('image/jpeg', 0.72);
      }
    }

    return output;
  } catch {
    return await readAsDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
