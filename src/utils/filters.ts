import { FilterPresetId, StudioAdjustments } from '../types';

export interface FilterPreset {
  id: FilterPresetId;
  name: string;
  css: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'normal', name: 'Normal', css: '' },
  { id: 'clarendon', name: 'Clarendon', css: 'contrast(1.18) saturate(1.25) brightness(1.04)' },
  { id: 'gingham', name: 'Gingham', css: 'brightness(1.06) hue-rotate(-8deg) saturate(0.85) contrast(0.95)' },
  { id: 'moon', name: 'Moon', css: 'grayscale(1) contrast(1.15) brightness(1.05)' },
  { id: 'lark', name: 'Lark', css: 'contrast(0.95) brightness(1.08) saturate(1.15)' },
  { id: 'reyes', name: 'Reyes', css: 'sepia(0.22) brightness(1.08) contrast(0.88) saturate(0.82)' },
  { id: 'juno', name: 'Juno', css: 'saturate(1.35) contrast(1.12) brightness(1.02)' },
  { id: 'aden', name: 'Aden', css: 'hue-rotate(-14deg) contrast(0.92) saturate(0.88) brightness(1.1)' },
];

export const DEFAULT_ADJUSTMENTS: StudioAdjustments = {
  preset: 'normal',
  brightness: 100,
  contrast: 100,
  saturate: 100,
  warmth: 0,
};

export function buildFilterString(adj: StudioAdjustments): string {
  const preset = FILTER_PRESETS.find((p) => p.id === adj.preset);
  const parts: string[] = [];
  if (preset && preset.css) {
    parts.push(preset.css);
  }
  if (adj.brightness !== 100) {
    parts.push(`brightness(${(adj.brightness / 100).toFixed(2)})`);
  }
  if (adj.contrast !== 100) {
    parts.push(`contrast(${(adj.contrast / 100).toFixed(2)})`);
  }
  if (adj.saturate !== 100) {
    parts.push(`saturate(${(adj.saturate / 100).toFixed(2)})`);
  }
  if (adj.warmth > 0) {
    parts.push(`sepia(${(adj.warmth / 100).toFixed(2)})`);
  } else if (adj.warmth < 0) {
    parts.push(`hue-rotate(${adj.warmth}deg)`);
  }
  return parts.join(' ').trim();
}

export async function renderFilteredImage(
  sourceUrl: string,
  filterCss: string,
  aspectRatio: '1:1' | '4:5' | '16:9' | '9:16',
  maxDimension = 1080
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const targetRatio =
        aspectRatio === '1:1'
          ? 1
          : aspectRatio === '4:5'
          ? 4 / 5
          : aspectRatio === '16:9'
          ? 16 / 9
          : 9 / 16;

      const srcRatio = img.width / img.height;
      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;

      if (srcRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else if (srcRatio < targetRatio) {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      let outW = maxDimension;
      let outH = Math.round(maxDimension / targetRatio);
      if (outH > maxDimension) {
        outH = maxDimension;
        outW = Math.round(maxDimension * targetRatio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceUrl);
        return;
      }

      ctx.filter = filterCss || 'none';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      } catch {
        resolve(sourceUrl);
      }
    };
    img.onerror = () => reject(new Error('Falha ao processar imagem'));
    img.src = sourceUrl;
  });
}
