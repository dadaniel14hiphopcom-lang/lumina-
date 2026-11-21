import {
  ArrowLeft,
  Camera,
  FileAudio,
  Heart,
  Mic,
  Pause,
  Play,
  Search,
  Send,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const WAVEFORM_BARS = [
  38, 65, 90, 50, 75, 100, 62, 44, 85, 95, 54, 70, 88, 42, 68, 92, 58, 76, 48, 60,
];

function VoiceNoteBubble({
  audioUrl,
  durationSec,
  isMine,
}: {
  audioUrl: string;
  durationSec?: number;
  isMine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec || 0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
  };

  return (
    <div
      className={`flex min-w-[220px] items-center gap-3 rounded-2xl px-3.5 py-2.5 sm:min-w-[250px] ${
        isMine
          ? 'bg-sky-600 text-white'
          : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
      }`}
    >
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotalDuration(Math.round(d));
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurrentTime(el.currentTime);
          if (el.duration > 0) {
            setProgress((el.currentTime / el.duration) * 100);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
        }}
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 ${
          isMine
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950'
        }`}
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex h-6 items-center gap-[3px]">
          {WAVEFORM_BARS.map((height, idx) => {
            const barPercent = ((idx + 1) / WAVEFORM_BARS.length) * 100;
            const active = barPercent <= progress;
            return (
              <span
                key={idx}
                className={`w-[3px] rounded-full transition-colors ${
                  active
                    ? isMine
                      ? 'bg-white'
                      : 'bg-sky-600 dark:bg-sky-400'
                    : isMine
                    ? 'bg-white/40'
                    : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
                style={{ height: `${Math.max(22, height)}%` }}
              />
            );
          })}
        </div>
        <div
          className={`flex items-center justify-between text-[11px] tabular-nums ${
            isMine ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <span>Áudio de voz</span>
          <span>{playing ? formatTimer(currentTime) : formatTimer(totalDuration)}</span>
        </div>
      </div>
    </div>
  );
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(blob);
  });
}

export function MessagesView() {
  const {
    threads,
    users,
    posts,
    currentUser,
    getUserById,
    sendMessage,
    markThreadRead,
    reactToMessage,
    setSelectedPostId,
    openProfile,
    showToast,
    siteMeta,
  } = useSocial();

  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    () => {
      const first = threads.find((t) =>
        t.participantIds.includes(currentUser.id)
      );
      if (!first) return null;
      return first.participantIds.find((id) => id !== currentUser.id) || null;
    }
  );
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioFallbackOpen, setAudioFallbackOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Video picker & recorder modal state
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);
  const [videoRecorderOpen, setVideoRecorderOpen] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoRecSec, setVideoRecSec] = useState(0);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoLiveRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<number | null>(null);

  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);

  const contacts = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUser.id)
      .filter(
        (u) =>
          !search.trim() ||
          u.username.toLowerCase().includes(search.toLowerCase()) ||
          u.displayName.toLowerCase().includes(search.toLowerCase())
      );
  }, [users, currentUser.id, search]);

  const activeThread = useMemo(() => {
    if (!selectedRecipientId) return undefined;
    return threads.find(
      (t) =>
        t.participantIds.includes(currentUser.id) &&
        t.participantIds.includes(selectedRecipientId)
    );
  }, [threads, currentUser.id, selectedRecipientId]);

  const recipient = selectedRecipientId
    ? getUserById(selectedRecipientId)
    : undefined;

  useEffect(() => {
    if (activeThread && activeThread.unreadBy.includes(currentUser.id)) {
      markThreadRead(activeThread.id);
    }
  }, [activeThread?.id, activeThread?.messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages.length]);

  useEffect(() => {
    if (videoRecorderOpen && !previewVideoUrl && videoLiveRef.current && videoStreamRef.current) {
      videoLiveRef.current.srcObject = videoStreamRef.current;
    }
  }, [videoRecorderOpen, previewVideoUrl]);

  useEffect(() => {
    return () => {
      cleanupAudioRecorder();
      cleanupVideoStream();
    };
  }, []);

  const cleanupAudioRecorder = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  const cleanupVideoStream = () => {
    if (videoTimerRef.current) {
      window.clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    videoRecorderRef.current = null;
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipientId || !draft.trim()) return;
    sendMessage(selectedRecipientId, draft);
    setDraft('');
  };

  // Start Voice Recording
  const startAudioRecording = async () => {
    if (!selectedRecipientId) return;
    setAudioFallbackOpen(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Gravação indisponível');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start();
      recordingStartRef.current = Date.now();
      setRecordingSec(0);
      setIsRecordingAudio(true);

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSec(Math.floor((Date.now() - recordingStartRef.current) / 1000));
      }, 250);
    } catch {
      setAudioFallbackOpen(true);
      showToast('Microfone indisponível — selecione um arquivo de áudio');
    }
  };

  const cancelAudioRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    cleanupAudioRecorder();
    setIsRecordingAudio(false);
    setRecordingSec(0);
  };

  const finishAndSendAudio = () => {
    const rec = mediaRecorderRef.current;
    const recipientId = selectedRecipientId;
    if (!rec || !recipientId) return;

    const duration = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
    rec.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' });
      cleanupAudioRecorder();
      setIsRecordingAudio(false);
      setRecordingSec(0);

      if (blob.size > 0) {
        const dataUrl = await readBlobAsDataUrl(blob);
        sendMessage(recipientId, 'Mensagem de voz', {
          audioUrl: dataUrl,
          audioDurationSec: duration,
        });
      }
    };
    rec.stop();
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedRecipientId) return;
    const url = file.size <= 2_500_000 ? await readBlobAsDataUrl(file) : URL.createObjectURL(file);
    sendMessage(selectedRecipientId, file.name, {
      audioUrl: url,
    });
    setAudioFallbackOpen(false);
    showToast('Áudio enviado no bate-papo');
  };

  // Video file upload
  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setVideoMenuOpen(false);
    if (!file || !selectedRecipientId) return;

    const maxBytes = siteMeta.videoRules.maxVideoSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      showToast(
        `Vídeo (${sizeMb} MB) excede o limite de ${siteMeta.videoRules.maxVideoSizeMB} MB configurado no painel admin.`
      );
      return;
    }

    const videoUrl =
      file.size <= 2_500_000 ? await readBlobAsDataUrl(file) : URL.createObjectURL(file);
    sendMessage(selectedRecipientId, draft.trim() || 'Vídeo enviado', {
      videoUrl,
      videoName: file.name,
    });
    setDraft('');
    showToast('Vídeo enviado no bate-papo');
  };

  // Live Camera Video Note Modal
  const openCameraVideoModal = async () => {
    setVideoMenuOpen(false);
    setVideoRecorderOpen(true);
    setPreviewVideoUrl(null);
    setCameraError(null);
    setVideoRecSec(0);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Câmera indisponível');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      videoStreamRef.current = stream;
      if (videoLiveRef.current) {
        videoLiveRef.current.srcObject = stream;
      }
    } catch {
      setCameraError(
        'Não foi possível acessar a câmera neste navegador. Você pode enviar um vídeo salvo no dispositivo.'
      );
    }
  };

  const closeCameraVideoModal = () => {
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.onstop = null;
      videoRecorderRef.current.stop();
    }
    cleanupVideoStream();
    setIsRecordingVideo(false);
    setVideoRecorderOpen(false);
    setPreviewVideoUrl(null);
    setCameraError(null);
  };

  const startCameraVideoRecording = () => {
    if (!videoStreamRef.current) return;
    videoChunksRef.current = [];
    const recorder = new MediaRecorder(videoStreamRef.current);
    videoRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) videoChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(videoChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      if (blob.size > 0) {
        const url =
          blob.size <= 2_500_000 ? await readBlobAsDataUrl(blob) : URL.createObjectURL(blob);
        setPreviewVideoUrl(url);
      }
      setIsRecordingVideo(false);
      if (videoTimerRef.current) {
        window.clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    };

    recorder.start();
    setVideoRecSec(0);
    setIsRecordingVideo(true);
    const startMs = Date.now();
    videoTimerRef.current = window.setInterval(() => {
      setVideoRecSec(Math.floor((Date.now() - startMs) / 1000));
    }, 250);
  };

  const stopCameraVideoRecording = () => {
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.stop();
    }
  };

  const sendRecordedVideo = () => {
    if (!selectedRecipientId || !previewVideoUrl) return;
    sendMessage(selectedRecipientId, 'Mensagem de vídeo', {
      videoUrl: previewVideoUrl,
    });
    closeCameraVideoModal();
    showToast('Vídeo enviado no bate-papo');
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-5xl overflow-hidden bg-white dark:bg-[#050505] lg:my-6 lg:h-[calc(100vh-3rem)] lg:rounded-2xl lg:border lg:border-zinc-200 dark:lg:border-zinc-800">
      {/* Left: Thread / Contacts List */}
      <div
        className={`flex w-full flex-col border-r border-zinc-200 dark:border-zinc-800 md:w-80 ${
          selectedRecipientId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h1 className="text-lg font-bold text-zinc-950 dark:text-zinc-100">
            Mensagens
          </h1>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-900">
            <Search className="h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa..."
              className="h-9 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.map((contact) => {
            const thread = threads.find(
              (t) =>
                t.participantIds.includes(currentUser.id) &&
                t.participantIds.includes(contact.id)
            );
            const lastMsg = thread?.messages[thread.messages.length - 1];
            const isUnread = thread?.unreadBy.includes(currentUser.id);
            const isSelected = selectedRecipientId === contact.id;

            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => setSelectedRecipientId(contact.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? 'bg-zinc-100 dark:bg-zinc-900'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <AvatarRing
                  src={contact.avatarUrl}
                  alt={contact.username}
                  size="md"
                  showOnlineIndicator={Boolean(contact.isOnline)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                      {contact.displayName}
                    </span>
                    {lastMsg && (
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {formatRelativeTime(lastMsg.createdAt)}
                      </span>
                    )}
                  </div>
                  <p
                    className={`truncate text-xs ${
                      isUnread
                        ? 'font-semibold text-zinc-950 dark:text-white'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {lastMsg
                      ? `${lastMsg.senderId === currentUser.id ? 'Você: ' : ''}${lastMsg.text}`
                      : `@${contact.username}`}
                  </p>
                </div>
                {isUnread && (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-600" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Active Conversation */}
      <div
        className={`flex flex-1 flex-col ${
          selectedRecipientId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {recipient ? (
          <>
            {/* Thread Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRecipientId(null)}
                  aria-label="Voltar às conversas"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900 md:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => openProfile(recipient.id)}
                  className="flex items-center gap-3 text-left"
                >
                  <AvatarRing
                    src={recipient.avatarUrl}
                    alt={recipient.username}
                    size="sm"
                    showOnlineIndicator={Boolean(recipient.isOnline)}
                  />
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                      {recipient.displayName}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {recipient.isOnline ? 'Ativo agora' : `@${recipient.username}`}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Messages Scroll */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {(!activeThread || activeThread.messages.length === 0) && (
                <div className="py-12 text-center">
                  <AvatarRing
                    src={recipient.avatarUrl}
                    alt={recipient.username}
                    size="lg"
                  />
                  <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {recipient.displayName}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Envie texto, áudio de voz ou vídeo para iniciar a conversa.
                  </p>
                </div>
              )}

              {activeThread?.messages.map((msg) => {
                const isMine = msg.senderId === currentUser.id;
                const sharedPost = msg.sharedPostId
                  ? posts.find((p) => p.id === msg.sharedPostId)
                  : undefined;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isMine ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="group relative max-w-[80%]">
                      {msg.storyReplyUrl && (
                        <div className="mb-1.5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                          <MediaImage
                            src={msg.storyReplyUrl}
                            alt="Story respondido"
                            className="h-28 w-20 object-cover"
                          />
                        </div>
                      )}

                      {sharedPost && (
                        <button
                          type="button"
                          onClick={() => setSelectedPostId(sharedPost.id)}
                          className="mb-1.5 block w-52 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <MediaImage
                            src={sharedPost.media[0]?.url}
                            alt={sharedPost.caption}
                            className="aspect-square w-full object-cover"
                          />
                          <div className="p-2 text-xs">
                            <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                              @{getUserById(sharedPost.authorId)?.username}
                            </p>
                            <p className="truncate text-zinc-500 dark:text-zinc-400">
                              {sharedPost.caption}
                            </p>
                          </div>
                        </button>
                      )}

                      {/* Audio Voice Bubble */}
                      {msg.audioUrl ? (
                        <div onDoubleClick={() => reactToMessage(activeThread.id, msg.id, '❤️')}>
                          <VoiceNoteBubble
                            audioUrl={msg.audioUrl}
                            durationSec={msg.audioDurationSec}
                            isMine={isMine}
                          />
                        </div>
                      ) : msg.videoUrl ? (
                        /* Video Message Bubble */
                        <div
                          onDoubleClick={() => reactToMessage(activeThread.id, msg.id, '❤️')}
                          className={`overflow-hidden rounded-2xl border ${
                            isMine
                              ? 'border-sky-600/30 bg-sky-600 text-white'
                              : 'border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          <video
                            src={msg.videoUrl}
                            controls
                            playsInline
                            className="max-h-72 w-full max-w-[280px] bg-black object-contain"
                          />
                          {msg.text && msg.text !== 'Vídeo enviado' && msg.text !== 'Mensagem de vídeo' && (
                            <p className="px-3.5 py-2 text-sm">{msg.text}</p>
                          )}
                        </div>
                      ) : (
                        /* Standard Text Bubble */
                        <div
                          onDoubleClick={() =>
                            reactToMessage(activeThread.id, msg.id, '❤️')
                          }
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                            isMine
                              ? 'bg-sky-600 text-white'
                              : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {msg.text}
                        </div>
                      )}

                      {msg.reaction ? (
                        <button
                          type="button"
                          onClick={() =>
                            reactToMessage(activeThread.id, msg.id, msg.reaction!)
                          }
                          className="mt-1 inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          {msg.reaction}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            reactToMessage(activeThread.id, msg.id, '❤️')
                          }
                          aria-label="Reagir com coração"
                          className="mt-1 hidden text-xs text-zinc-400 group-hover:inline-flex hover:text-rose-500"
                        >
                          <Heart className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Hidden file inputs for audio/video */}
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioFileUpload}
              className="hidden"
            />
            <input
              ref={videoFileInputRef}
              type="file"
              accept="video/*"
              onChange={handleVideoFileUpload}
              className="hidden"
            />

            {/* Fallback inline audio picker if microphone is unavailable */}
            {audioFallbackOpen && (
              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-zinc-600 dark:text-zinc-300">
                  Microfone bloqueado ou ausente. Envie um arquivo de áudio:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => audioFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 font-semibold text-white dark:bg-white dark:text-zinc-950"
                  >
                    <FileAudio className="h-3.5 w-3.5" />
                    <span>Escolher áudio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioFallbackOpen(false)}
                    aria-label="Fechar aviso"
                    className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Composer */}
            <div className="relative border-t border-zinc-200 p-3 dark:border-zinc-800">
              {videoMenuOpen && (
                <div className="absolute right-14 bottom-16 z-20 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    type="button"
                    onClick={openCameraVideoModal}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Camera className="h-4 w-4 text-sky-600" />
                    <span>Gravar vídeo agora</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => videoFileInputRef.current?.click()}
                    className="flex w-full items-center gap-2.5 border-t border-zinc-100 px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Upload className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                    <span>Enviar vídeo do dispositivo</span>
                  </button>
                </div>
              )}

              {isRecordingAudio ? (
                <div className="flex h-11 items-center justify-between gap-3 rounded-full border border-rose-500/40 bg-rose-50 px-3 dark:bg-rose-950/30">
                  <button
                    type="button"
                    onClick={cancelAudioRecording}
                    aria-label="Cancelar áudio"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <div className="flex flex-1 items-center justify-center gap-2.5">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                    <span className="font-mono text-sm font-semibold text-rose-600 tabular-nums dark:text-rose-400">
                      {formatTimer(recordingSec)}
                    </span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">
                      Gravando áudio...
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={finishAndSendAudio}
                    aria-label="Enviar mensagem de voz"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-700"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Mensagem..."
                    className="h-11 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  />

                  <button
                    type="button"
                    onClick={startAudioRecording}
                    aria-label="Gravar mensagem de voz"
                    title="Gravar mensagem de voz"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Mic className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setVideoMenuOpen((o) => !o)}
                    aria-label="Enviar mensagem de vídeo"
                    title="Enviar vídeo"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Video className="h-5 w-5" />
                  </button>

                  {draft.trim() && (
                    <button
                      type="submit"
                      aria-label="Enviar mensagem"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-700"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Suas mensagens diretas
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Selecione um perfil à esquerda para enviar textos, áudios de voz ou vídeos.
            </p>
          </div>
        )}
      </div>

      {/* Live Video Recorder Modal */}
      {videoRecorderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Gravar mensagem de vídeo"
          onClick={closeCameraVideoModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
                Mensagem de vídeo
              </h3>
              <button
                type="button"
                onClick={closeCameraVideoModal}
                aria-label="Fechar câmera"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              {cameraError ? (
                <div className="space-y-4 py-6 text-center">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      closeCameraVideoModal();
                      videoFileInputRef.current?.click();
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Selecionar vídeo do dispositivo</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
                    {previewVideoUrl ? (
                      <video
                        src={previewVideoUrl}
                        controls
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <video
                        ref={videoLiveRef}
                        autoPlay
                        muted
                        playsInline
                        className="h-full w-full -scale-x-100 object-cover"
                      />
                    )}

                    {isRecordingVideo && (
                      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white tabular-nums">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                        <span>{formatTimer(videoRecSec)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-3">
                    {previewVideoUrl ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewVideoUrl(null)}
                          className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                          Regravar
                        </button>
                        <button
                          type="button"
                          onClick={sendRecordedVideo}
                          className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                          <Send className="h-4 w-4" />
                          <span>Enviar vídeo</span>
                        </button>
                      </>
                    ) : isRecordingVideo ? (
                      <button
                        type="button"
                        onClick={stopCameraVideoRecording}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white hover:bg-rose-700"
                      >
                        <Square className="h-4 w-4 fill-white" />
                        <span>Parar gravação</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startCameraVideoRecording}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white hover:bg-rose-700"
                      >
                        <Camera className="h-4 w-4" />
                        <span>Iniciar gravação</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
