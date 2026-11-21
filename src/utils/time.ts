export function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return 'agora';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} sem`;
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

export function formatCompactCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }
  if (count >= 10_000) {
    return `${(count / 1_000).toFixed(1).replace('.0', '')} mil`;
  }
  return count.toLocaleString('pt-BR');
}
