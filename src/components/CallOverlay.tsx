import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { AvatarRing } from './AvatarRing';

function formatCallDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function CallOverlay() {
  const {
    activeCall,
    localCallStream,
    remoteCallStream,
    isCallMicMuted,
    isCallCameraOff,
    callFacingMode,
    getUserById,
    acceptIncomingCall,
    rejectIncomingCall,
    endActiveCall,
    toggleCallMic,
    toggleCallCamera,
    switchCallCamera,
    toggleMinimizeCall,
  } = useSocial();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Live call duration timer
  useEffect(() => {
    if (!activeCall?.startedAt || activeCall.status !== 'connected') {
      setElapsedSec(0);
      return;
    }
    const update = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - activeCall.startedAt!) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall?.startedAt, activeCall?.status]);

  // Bind local MediaStream
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localCallStream || null;
    }
  }, [localCallStream, activeCall?.minimized, isCallCameraOff]);

  const remoteHasLiveVideo = Boolean(
    remoteCallStream &&
      remoteCallStream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled) &&
      !activeCall?.remoteCamOff
  );
  const localHasLiveVideo = Boolean(
    localCallStream &&
      localCallStream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled) &&
      !isCallCameraOff
  );

  // Bind remote MediaStream (both video element and fallback audio element)
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteCallStream || null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteCallStream || null;
      if (remoteCallStream) {
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [remoteCallStream, remoteHasLiveVideo, activeCall?.minimized, activeCall?.callType]);

  if (!activeCall) return null;

  const peer = getUserById(activeCall.peerId);
  const peerName = peer?.displayName || 'Usuário Lumina';
  const peerUsername = peer?.username || activeCall.peerId;
  const peerAvatar = peer?.avatarUrl || '/og-preview.jpg';

  // 1. Incoming Ringing Call Prompt
  if (activeCall.direction === 'incoming' && activeCall.status === 'ringing') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Chamada de ${activeCall.callType === 'video' ? 'vídeo' : 'áudio'} recebida`}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-md sm:items-center"
      >
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-white shadow-2xl">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-sky-300">
            {activeCall.callType === 'video' ? (
              <Video className="h-3.5 w-3.5" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
            <span>
              {activeCall.callType === 'video'
                ? 'Chamada de vídeo recebida'
                : 'Chamada de áudio recebida'}
            </span>
          </div>

          <div className="mt-5 flex justify-center">
            <div className="relative">
              <span className="absolute -inset-2 animate-ping rounded-full bg-emerald-500/25" />
              <AvatarRing src={peerAvatar} alt={peerUsername} size="xl" />
            </div>
          </div>

          <h2 className="mt-4 text-lg font-bold tracking-tight">{peerName}</h2>
          <p className="text-xs text-zinc-400">@{peerUsername}</p>
          <p className="mt-2 text-xs text-zinc-300">Chamando agora...</p>

          <div className="mt-7 flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={rejectIncomingCall}
              aria-label="Recusar chamada"
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-transform hover:bg-rose-700 active:scale-95">
                <PhoneOff className="h-6 w-6" />
              </span>
              <span className="text-xs font-medium text-zinc-300">Recusar</span>
            </button>

            <button
              type="button"
              onClick={() => void acceptIncomingCall()}
              aria-label="Atender chamada"
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-transform hover:bg-emerald-600 active:scale-95">
                {activeCall.callType === 'video' ? (
                  <Video className="h-6 w-6" />
                ) : (
                  <Phone className="h-6 w-6" />
                )}
              </span>
              <span className="text-xs font-medium text-zinc-300">Atender</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Minimized Floating Call Pill / Bar
  if (activeCall.minimized) {
    return (
      <>
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <div className="fixed top-14 right-3 left-3 z-50 mx-auto flex max-w-md items-center justify-between gap-2.5 rounded-2xl border border-zinc-700/80 bg-zinc-950/95 px-3 py-2 text-white shadow-xl backdrop-blur-md lg:top-4 lg:right-6 lg:left-auto lg:w-80">
          <button
            type="button"
            onClick={toggleMinimizeCall}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <AvatarRing src={peerAvatar} alt={peerUsername} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{peerName}</p>
              <p className="text-[11px] text-emerald-400 tabular-nums">
                {activeCall.status === 'connected'
                  ? formatCallDuration(elapsedSec)
                  : activeCall.status === 'connecting'
                  ? 'Conectando...'
                  : 'Chamando...'}
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleCallMic}
              aria-label={isCallMicMuted ? 'Ativar microfone' : 'Silenciar microfone'}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                isCallMicMuted ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-white hover:bg-zinc-700'
              }`}
            >
              {isCallMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={toggleMinimizeCall}
              aria-label="Expandir chamada"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-white hover:bg-zinc-700"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => endActiveCall('completed')}
              aria-label="Encerrar chamada"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-600 text-white hover:bg-rose-700"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>
      </>
    );
  }

  // 3. Full-Viewport Call Stage (Audio & Video)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Em chamada com ${peerName}`}
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col justify-between overflow-hidden bg-zinc-950 text-white"
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Remote Video Stream Background */}
      {activeCall.callType === 'video' && remoteHasLiveVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Subtle gradient overlay for readable controls */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/80" />

      {/* Top Bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarRing src={peerAvatar} alt={peerUsername} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{peerName}</p>
            <p className="text-xs text-zinc-300 tabular-nums">
              {activeCall.status === 'connected'
                ? `${activeCall.callType === 'video' ? 'Vídeo' : 'Áudio'} · ${formatCallDuration(elapsedSec)}`
                : activeCall.status === 'connecting'
                ? 'Conectando chamada...'
                : 'Chamando...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeCall.remoteMicMuted && (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur-sm">
              <MicOff className="h-3 w-3 text-rose-400" />
              <span className="hidden sm:inline">Microfone desligado</span>
            </span>
          )}
          <button
            type="button"
            onClick={toggleMinimizeCall}
            aria-label="Minimizar chamada"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            <Minimize2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Center Stage (Avatar when audio call or remote video not active yet) */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        {(!remoteHasLiveVideo || activeCall.callType === 'audio') && (
          <div className="flex flex-col items-center">
            <div className="relative">
              {activeCall.status !== 'connected' && (
                <span className="absolute -inset-3 animate-pulse rounded-full bg-sky-500/20" />
              )}
              <AvatarRing src={peerAvatar} alt={peerUsername} size="xl" />
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">{peerName}</h2>
            <p className="mt-1 text-sm text-zinc-300 tabular-nums">
              {activeCall.status === 'connected'
                ? formatCallDuration(elapsedSec)
                : activeCall.status === 'connecting'
                ? 'Estabelecendo conexão segura...'
                : 'Tocando...'}
            </p>
            {activeCall.remoteCamOff && activeCall.callType === 'video' && (
              <p className="mt-2 text-xs text-zinc-400">Câmera do contato desativada</p>
            )}
          </div>
        )}

        {/* Local Self-View Picture-in-Picture */}
        {localHasLiveVideo && (
          <div className="absolute right-4 bottom-4 h-36 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl sm:right-6 sm:bottom-6 sm:h-44 sm:w-32">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${
                callFacingMode === 'user' ? '-scale-x-100' : ''
              }`}
            />
          </div>
        )}
      </div>

      {/* Bottom Controls Dock */}
      <div className="relative z-10 flex items-center justify-center gap-3.5 px-4 pt-3 pb-7 sm:gap-5 sm:pb-9">
        <button
          type="button"
          onClick={toggleCallMic}
          aria-label={isCallMicMuted ? 'Ativar microfone' : 'Silenciar microfone'}
          className={`flex h-13 w-13 items-center justify-center rounded-full transition-transform active:scale-95 ${
            isCallMicMuted
              ? 'bg-white text-zinc-950'
              : 'bg-white/15 text-white backdrop-blur-md hover:bg-white/25'
          }`}
        >
          {isCallMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={() => void toggleCallCamera()}
          aria-label={isCallCameraOff ? 'Ligar câmera' : 'Desligar câmera'}
          className={`flex h-13 w-13 items-center justify-center rounded-full transition-transform active:scale-95 ${
            isCallCameraOff
              ? 'bg-white text-zinc-950'
              : 'bg-white/15 text-white backdrop-blur-md hover:bg-white/25'
          }`}
        >
          {isCallCameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </button>

        {!isCallCameraOff && (
          <button
            type="button"
            onClick={() => void switchCallCamera()}
            aria-label="Alternar câmera frontal/traseira"
            className="flex h-13 w-13 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-transform hover:bg-white/25 active:scale-95"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => endActiveCall('completed')}
          aria-label="Encerrar chamada"
          className="flex h-14 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-transform hover:bg-rose-700 active:scale-95"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
