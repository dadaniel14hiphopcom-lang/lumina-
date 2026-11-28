import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-amber-300/70 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>Sem conexão — exibindo versão em cache do feed.</span>
      </div>
    </div>
  );
}
