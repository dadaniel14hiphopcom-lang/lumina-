import type { CallSignalPayload } from '../types';

export type RealtimeServerEvent =
  | { type: 'call_signal'; signal: CallSignalPayload }
  | { type: 'chat_message'; threadId: string; senderId: string; recipientId: string }
  | { type: 'chat_typing'; fromUserId: string; toUserId: string; isTyping: boolean }
  | { type: 'chat_read'; threadId: string; readerIds: string[] }
  | { type: 'social_update'; scope: 'posts' | 'stories' | 'users' | 'all'; updatedAt?: number }
  | { type: 'site_meta_update'; updatedAt?: number }
  | {
      type: 'presence_update';
      userId: string;
      uid?: string;
      isOnline: boolean;
      lastActiveAtMs: number;
    };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

export function createCallPeerConnection(handlers: {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onRemoteTrack: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      handlers.onIceCandidate(event.candidate.toJSON());
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) {
      handlers.onRemoteTrack(stream);
    } else {
      const fallback = new MediaStream([event.track]);
      handlers.onRemoteTrack(fallback);
    }
  };

  pc.onconnectionstatechange = () => {
    handlers.onConnectionStateChange(pc.connectionState);
  };

  return pc;
}

// Gentle Web Audio API ringtone/ringback synthesizer (zero external audio asset dependencies)
let ringtoneTimer: number | null = null;
let ringAudioCtx: AudioContext | null = null;

export function stopCallRingtone(): void {
  if (ringtoneTimer !== null) {
    window.clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  if (ringAudioCtx) {
    try {
      void ringAudioCtx.close();
    } catch {
      // Ignore AudioContext close error
    }
    ringAudioCtx = null;
  }
}

export function startCallRingtone(mode: 'incoming' | 'outgoing'): void {
  stopCallRingtone();
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    ringAudioCtx = ctx;

    const playBurst = () => {
      if (!ringAudioCtx || ringAudioCtx.state === 'closed') return;
      if (ringAudioCtx.state === 'suspended') {
        void ringAudioCtx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const notes = mode === 'incoming' ? [659.25, 880] : [440, 480];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.16);
        gain.gain.setValueAtTime(0.001, now + idx * 0.16);
        gain.gain.exponentialRampToValueAtTime(
          mode === 'incoming' ? 0.08 : 0.035,
          now + idx * 0.16 + 0.03
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.16);
        osc.stop(now + idx * 0.16 + 0.38);
      });
    };

    playBurst();
    ringtoneTimer = window.setInterval(playBurst, mode === 'incoming' ? 2100 : 2800);
  } catch {
    // Browser autoplay policy may prevent ringing before user gesture; safe no-op
  }
}

export interface RealtimeSocketHandle {
  send: (payload: Record<string, unknown>) => boolean;
  isOpen: () => boolean;
  close: () => void;
}

export function connectRealtimeSocket(
  userIds: string[],
  onEvent: (event: RealtimeServerEvent) => void,
  onStatusChange?: (connected: boolean) => void
): RealtimeSocketHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let backoffMs = 1000;

  const cleanIds = Array.from(new Set(userIds.map((s) => s.trim()).filter(Boolean))).slice(0, 4);

  const openSocket = () => {
    if (closed || cleanIds.length === 0 || typeof window === 'undefined') return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = encodeURIComponent(cleanIds.join(','));
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/realtime?userIds=${qs}`);
      ws = socket;

      socket.onopen = () => {
        backoffMs = 1000;
        onStatusChange?.(true);
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data || '')) as RealtimeServerEvent;
          if (parsed && typeof parsed.type === 'string') {
            onEvent(parsed);
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      socket.onclose = () => {
        onStatusChange?.(false);
        ws = null;
        if (!closed) {
          reconnectTimer = window.setTimeout(() => {
            backoffMs = Math.min(8000, backoffMs * 1.5);
            openSocket();
          }, backoffMs);
        }
      };

      socket.onerror = () => {
        try {
          socket.close();
        } catch {
          // Ignore close error
        }
      };
    } catch {
      onStatusChange?.(false);
    }
  };

  openSocket();

  return {
    send: (payload) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    isOpen: () => Boolean(ws && ws.readyState === WebSocket.OPEN),
    close: () => {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // Ignore
        }
        ws = null;
      }
      onStatusChange?.(false);
    },
  };
}
