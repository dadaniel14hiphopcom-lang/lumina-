import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  Download,
  FileAudio,
  FileText,
  Mic,
  Paperclip,
  Pause,
  Play,
  Reply,
  Search,
  Send,
  SmilePlus,
  Square,
  SwitchCamera,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import type { DirectMessage } from '../types';
import { formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';
import { MediaImage } from './MediaImage';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
const BLOCKED_ATTACHMENT_MIME_RE =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/x-msdownload|application\/javascript|text\/javascript)$/i;
const BLOCKED_ATTACHMENT_EXT_RE = /\.(html?|svg|xhtml|js|mjs|cjs|exe|bat|cmd|sh|msi|vbs|ps1)$/i;

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

async function compressImageFileToDataUrl(file: File): Promise<string> {
  const rawUrl = await readBlobAsDataUrl(file);
  if (rawUrl.length <= 220_000) return rawUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      let compressed = canvas.toDataURL('image/jpeg', 0.82);
      if (compressed.length > 280_000) {
        compressed = canvas.toDataURL('image/jpeg', 0.68);
      }
      resolve(compressed);
    };
    img.onerror = () => resolve(rawUrl);
    img.src = rawUrl;
  });
}

function summarizeMessageForQuote(msg: DirectMessage): string {
  if (msg.audioUrl) return 'Mensagem de voz';
  if (msg.videoUrl) return msg.videoName ? `Vídeo: ${msg.videoName}` : 'Vídeo enviado';
  if (msg.fileUrl) {
    if (msg.fileMime?.startsWith('image/')) return msg.text && msg.text !== `Arquivo: ${msg.fileName || 'anexo'}` ? msg.text : 'Foto enviada';
    return `Arquivo: ${msg.fileName || 'anexo'}`;
  }
  return msg.text || 'Mensagem';
}

interface PendingAttachment {
  fileUrl: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
}

export function MessagesView() {
  const {
    threads,
    users,
    allUsers,
    posts,
    currentUser,
    isAuthenticated,
    openAuthModal,
    refreshPublicUsersFromSupabase,
    getUserById,
    sendMessage,
    markThreadRead,
    reactToMessage,
    typingByUserId,
    setTypingStatus,
    setSelectedPostId,
    openProfile,
    showToast,
    siteMeta,
    pendingChatUserId,
    setPendingChatUserId,
  } = useSocial();

  const isCurrentUserRef = (id: string) =>
    id === currentUser.id || Boolean(currentUser.uid && id === currentUser.uid);

  const threadHasUser = (
    participantIds: string[],
    user?: { id: string; uid?: string } | null
  ) =>
    Boolean(
      user &&
        (participantIds.includes(user.id) ||
          (user.uid && participantIds.includes(user.uid)))
    );

  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    () => {
      if (pendingChatUserId && !isCurrentUserRef(pendingChatUserId)) {
        return getUserById(pendingChatUserId)?.id || pendingChatUserId;
      }
      const first = threads.find((t) => threadHasUser(t.participantIds, currentUser));
      if (!first) return null;
      const partnerId = first.participantIds.find((id) => !isCurrentUserRef(id));
      return partnerId ? getUserById(partnerId)?.id || partnerId : null;
    }
  );

  useEffect(() => {
    void refreshPublicUsersFromSupabase();
  }, []);

  useEffect(() => {
    if (pendingChatUserId && !isCurrentUserRef(pendingChatUserId)) {
      const resolved = getUserById(pendingChatUserId);
      setSelectedRecipientId(resolved?.id || pendingChatUserId);
      setPendingChatUserId(null);
    }
  }, [pendingChatUserId, currentUser.id, currentUser.uid, getUserById, setPendingChatUserId]);

  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [typingClock, setTypingClock] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioFallbackOpen, setAudioFallbackOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Unified Camera (Photo + Video) & Video picker modal state
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoRecSec, setVideoRecSec] = useState(0);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoLiveRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<number | null>(null);

  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentFileInputRef = useRef<HTMLInputElement | null>(null);

  // Tick every 1.2s while any typing timestamp exists so expired indicators vanish cleanly
  useEffect(() => {
    if (Object.keys(typingByUserId).length === 0) return;
    const timer = window.setInterval(() => {
      setTypingClock(Date.now());
    }, 1200);
    return () => window.clearInterval(timer);
  }, [typingByUserId]);

  const isUserActivelyTyping = (u?: { id: string; uid?: string } | null) => {
    if (!u) return false;
    const tsMain = typingByUserId[u.id] || 0;
    const tsUid = u.uid ? typingByUserId[u.uid] || 0 : 0;
    const newest = Math.max(tsMain, tsUid);
    return newest > 0 && typingClock - newest < 4500;
  };

  const contacts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase().replace(/^@/, '');
    const pool = users.length > 0 ? users : allUsers;
    const filtered = pool
      .filter((u) => !u.restricted && !isCurrentUserRef(u.id) && (!u.uid || !isCurrentUserRef(u.uid)))
      .filter(
        (u) =>
          !cleanSearch ||
          u.username.toLowerCase().includes(cleanSearch) ||
          u.displayName.toLowerCase().includes(cleanSearch) ||
          (u.bio && u.bio.toLowerCase().includes(cleanSearch))
      );

    return [...filtered].sort((a, b) => {
      const threadA = threads.find(
        (t) => threadHasUser(t.participantIds, currentUser) && threadHasUser(t.participantIds, a)
      );
      const threadB = threads.find(
        (t) => threadHasUser(t.participantIds, currentUser) && threadHasUser(t.participantIds, b)
      );
      const timeA = threadA?.updatedAt || 0;
      const timeB = threadB?.updatedAt || 0;
      if (timeA !== timeB) return timeB - timeA;
      const aReal = a.isDemoSeed ? 0 : 1;
      const bReal = b.isDemoSeed ? 0 : 1;
      return bReal - aReal;
    });
  }, [users, allUsers, threads, currentUser, search]);

  const recipient = useMemo(() => {
    if (!selectedRecipientId) return undefined;
    return (
      getUserById(selectedRecipientId) ||
      allUsers.find(
        (u) =>
          u.id === selectedRecipientId ||
          u.uid === selectedRecipientId ||
          u.username.toLowerCase() === selectedRecipientId.toLowerCase()
      )
    );
  }, [selectedRecipientId, getUserById, allUsers]);

  const activeThread = useMemo(() => {
    if (!selectedRecipientId) return undefined;
    return threads.find(
      (t) =>
        threadHasUser(t.participantIds, currentUser) &&
        (threadHasUser(t.participantIds, recipient) ||
          t.participantIds.includes(selectedRecipientId))
    );
  }, [threads, currentUser, recipient, selectedRecipientId]);

  const activeThreadHasUnread = useMemo(() => {
    if (!activeThread) return false;
    if (activeThread.unreadBy.some((uidOrId) => isCurrentUserRef(uidOrId))) {
      return true;
    }
    return activeThread.messages.some(
      (m) =>
        !isCurrentUserRef(m.senderId) &&
        !(m.readBy || []).some((rId) => isCurrentUserRef(rId))
    );
  }, [activeThread, currentUser.id, currentUser.uid]);

  useEffect(() => {
    if (activeThread && activeThreadHasUnread) {
      markThreadRead(activeThread.id);
    }
  }, [activeThread?.id, activeThread?.messages.length, activeThreadHasUnread, markThreadRead]);

  // Clear typing & reply box when switching recipients
  useEffect(() => {
    setReplyingTo(null);
    setReactionPickerMsgId(null);
    setPendingAttachment(null);
    return () => {
      if (selectedRecipientId) {
        setTypingStatus(selectedRecipientId, false);
      }
    };
  }, [selectedRecipientId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages.length]);

  useEffect(() => {
    if (
      cameraModalOpen &&
      !previewVideoUrl &&
      !previewPhotoUrl &&
      videoLiveRef.current &&
      videoStreamRef.current
    ) {
      videoLiveRef.current.srcObject = videoStreamRef.current;
    }
  }, [cameraModalOpen, previewVideoUrl, previewPhotoUrl]);

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

  const buildReplyOptions = () =>
    replyingTo
      ? {
          replyToId: replyingTo.id,
          replyToSenderId: replyingTo.senderId,
          replyToText: summarizeMessageForQuote(replyingTo).slice(0, 180),
        }
      : {};

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (selectedRecipientId) {
      setTypingStatus(selectedRecipientId, val.trim().length > 0, activeThread?.id);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipientId) return;
    if (!draft.trim() && !pendingAttachment) return;

    sendMessage(selectedRecipientId, draft, {
      ...(pendingAttachment || {}),
      ...buildReplyOptions(),
    });
    setDraft('');
    setReplyingTo(null);
    setPendingAttachment(null);
    setTypingStatus(selectedRecipientId, false, activeThread?.id);
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
    const replyOpts = buildReplyOptions();
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
          ...replyOpts,
        });
        setReplyingTo(null);
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
      ...buildReplyOptions(),
    });
    setReplyingTo(null);
    setAudioFallbackOpen(false);
    showToast('Áudio enviado no bate-papo');
  };

  // Attachment file upload (images, PDFs, docs, spreadsheets, archives)
  const handleAttachmentFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedRecipientId) return;

    const mime = (file.type || 'application/octet-stream').toLowerCase();
    if (BLOCKED_ATTACHMENT_MIME_RE.test(mime) || BLOCKED_ATTACHMENT_EXT_RE.test(file.name)) {
      showToast('Tipo de arquivo bloqueado por segurança.');
      return;
    }

    if (mime.startsWith('video/')) {
      const maxBytes = siteMeta.videoRules.maxVideoSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        showToast(
          `Vídeo excede o limite de ${siteMeta.videoRules.maxVideoSizeMB} MB configurado no painel admin.`
        );
        return;
      }
      const videoUrl =
        file.size <= 2_500_000 ? await readBlobAsDataUrl(file) : URL.createObjectURL(file);
      sendMessage(selectedRecipientId, draft.trim() || 'Vídeo enviado', {
        videoUrl,
        videoName: file.name,
        ...buildReplyOptions(),
      });
      setDraft('');
      setReplyingTo(null);
      showToast('Vídeo enviado no bate-papo');
      return;
    }

    if (mime.startsWith('image/')) {
      if (file.size > 12 * 1024 * 1024) {
        showToast('Imagem muito grande. Selecione uma imagem de até 12 MB.');
        return;
      }
      const dataUrl = await compressImageFileToDataUrl(file);
      setPendingAttachment({
        fileUrl: dataUrl,
        fileName: file.name,
        fileMime: 'image/jpeg',
        fileSize: file.size,
      });
      draftInputRef.current?.focus();
      return;
    }

    if (file.size > 380 * 1024) {
      showToast('Para envio rápido entre dispositivos, selecione documentos de até 380 KB.');
      return;
    }
    const dataUrl = await readBlobAsDataUrl(file);
    setPendingAttachment({
      fileUrl: dataUrl,
      fileName: file.name,
      fileMime: mime,
      fileSize: file.size,
    });
    draftInputRef.current?.focus();
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
      ...buildReplyOptions(),
    });
    setDraft('');
    setReplyingTo(null);
    showToast('Vídeo enviado no bate-papo');
  };

  // Live Camera Modal (Photo & Video)
  const startCameraStream = async (mode: 'photo' | 'video', nextFacing: 'user' | 'environment') => {
    cleanupVideoStream();
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Câmera indisponível');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: mode === 'video',
      });
      videoStreamRef.current = stream;
      if (videoLiveRef.current) {
        videoLiveRef.current.srcObject = stream;
      }
    } catch {
      setCameraError(
        'Não foi possível acessar a câmera neste navegador. Verifique as permissões ou envie um arquivo salvo no dispositivo.'
      );
    }
  };

  const openCameraModal = async (initialMode: 'photo' | 'video' = 'photo') => {
    setVideoMenuOpen(false);
    setCameraMode(initialMode);
    setCameraModalOpen(true);
    setPreviewVideoUrl(null);
    setPreviewPhotoUrl(null);
    setCameraError(null);
    setVideoRecSec(0);
    await startCameraStream(initialMode, facingMode);
  };

  const switchCameraMode = async (nextMode: 'photo' | 'video') => {
    if (isRecordingVideo) return;
    setCameraMode(nextMode);
    setPreviewVideoUrl(null);
    setPreviewPhotoUrl(null);
    await startCameraStream(nextMode, facingMode);
  };

  const toggleCameraFacing = async () => {
    if (isRecordingVideo) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    await startCameraStream(cameraMode, nextFacing);
  };

  const closeCameraModal = () => {
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.onstop = null;
      videoRecorderRef.current.stop();
    }
    cleanupVideoStream();
    setIsRecordingVideo(false);
    setCameraModalOpen(false);
    setPreviewVideoUrl(null);
    setPreviewPhotoUrl(null);
    setCameraError(null);
  };

  const captureCameraPhoto = () => {
    const videoEl = videoLiveRef.current;
    if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
      showToast('Aguarde a imagem da câmera carregar...');
      return;
    }
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight));
    const w = Math.max(1, Math.round(videoEl.videoWidth * scale));
    const h = Math.max(1, Math.round(videoEl.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (dataUrl.length > 260_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    }
    setPreviewPhotoUrl(dataUrl);
  };

  const sendCapturedPhoto = () => {
    if (!selectedRecipientId || !previewPhotoUrl) return;
    sendMessage(selectedRecipientId, draft.trim() || 'Foto da câmera', {
      fileUrl: previewPhotoUrl,
      fileName: `camera-${Date.now()}.jpg`,
      fileMime: 'image/jpeg',
      fileSize: Math.round((previewPhotoUrl.length * 3) / 4),
      ...buildReplyOptions(),
    });
    setDraft('');
    setReplyingTo(null);
    closeCameraModal();
    showToast('Foto enviada no bate-papo');
  };

  const startCameraVideoRecording = () => {
    if (!videoStreamRef.current || typeof MediaRecorder === 'undefined') {
      showToast('Gravação de vídeo indisponível neste navegador');
      return;
    }
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
      ...buildReplyOptions(),
    });
    setReplyingTo(null);
    closeCameraModal();
    showToast('Vídeo enviado no bate-papo');
  };

  const isRecipientRef = (idVal: string) =>
    Boolean(
      recipient &&
        (idVal === recipient.id || (recipient.uid && idVal === recipient.uid))
    );

  const isMessageSeenByRecipient = (msg: DirectMessage): boolean => {
    if (!recipient) return false;
    if ((msg.readBy || []).some((rId) => isRecipientRef(rId))) {
      return true;
    }
    const lastRead = activeThread?.lastReadBy;
    if (lastRead) {
      const readAt = Math.max(
        lastRead[recipient.id] || 0,
        recipient.uid ? lastRead[recipient.uid] || 0 : 0
      );
      if (readAt >= msg.createdAt) return true;
    }
    return false;
  };

  const lastOutgoingMsgId = useMemo(() => {
    if (!activeThread) return null;
    for (let i = activeThread.messages.length - 1; i >= 0; i--) {
      if (isCurrentUserRef(activeThread.messages[i].senderId)) {
        return activeThread.messages[i].id;
      }
    }
    return null;
  }, [activeThread?.messages, currentUser.id, currentUser.uid]);

  const recipientTyping = isUserActivelyTyping(recipient);

  const scrollToMessage = (msgId?: string) => {
    if (!msgId) return;
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
          {!isAuthenticated && (
            <div className="border-b border-zinc-200 bg-sky-50/70 p-3 dark:border-zinc-800 dark:bg-sky-950/30">
              <p className="text-xs font-medium text-sky-900 dark:text-sky-200">
                Entre com sua conta real para enviar e receber mensagens diretas.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="mt-2 h-8 w-full rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Entrar na conta
              </button>
            </div>
          )}

          {contacts.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Nenhum usuário encontrado para conversar.
            </p>
          ) : (
            contacts.map((contact) => {
              const thread = threads.find(
                (t) =>
                  threadHasUser(t.participantIds, currentUser) &&
                  threadHasUser(t.participantIds, contact)
              );
              const lastMsg = thread?.messages[thread.messages.length - 1];
              const isUnread = thread?.unreadBy.some((id) => isCurrentUserRef(id));
              const isTypingContact = isUserActivelyTyping(contact);
              const isSelected = Boolean(
                selectedRecipientId &&
                  (selectedRecipientId === contact.id ||
                    (contact.uid && selectedRecipientId === contact.uid))
              );

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
                    {isTypingContact ? (
                      <p className="truncate text-xs font-medium text-sky-600 dark:text-sky-400">
                        Digitando...
                      </p>
                    ) : (
                      <p
                        className={`truncate text-xs ${
                          isUnread
                            ? 'font-semibold text-zinc-950 dark:text-white'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {lastMsg
                          ? `${isCurrentUserRef(lastMsg.senderId) ? 'Você: ' : ''}${lastMsg.text}`
                          : `@${contact.username}`}
                      </p>
                    )}
                  </div>
                  {isUnread && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-600" />
                  )}
                </button>
              );
            })
          )}
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
                    {recipientTyping ? (
                      <p className="text-xs font-medium text-sky-600 dark:text-sky-400">
                        Digitando...
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {recipient.isOnline ? 'Ativo agora' : `@${recipient.username}`}
                      </p>
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Messages Scroll */}
            <div
              className="flex-1 space-y-3 overflow-y-auto p-4"
              onClick={() => {
                if (reactionPickerMsgId) setReactionPickerMsgId(null);
              }}
            >
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
                    Envie texto, arquivos, fotos da câmera, áudios de voz ou vídeos.
                  </p>
                </div>
              )}

              {activeThread?.messages.map((msg) => {
                const isMine = isCurrentUserRef(msg.senderId);
                const sharedPost = msg.sharedPostId
                  ? posts.find((p) => p.id === msg.sharedPostId)
                  : undefined;
                const isImageFile =
                  Boolean(msg.fileUrl) &&
                  (Boolean(msg.fileMime?.startsWith('image/')) ||
                    Boolean(msg.fileUrl?.startsWith('data:image/')));
                const isLatestOutgoing = isMine && msg.id === lastOutgoingMsgId;
                const seenByPartner = isMine ? isMessageSeenByRecipient(msg) : false;

                // Reaction grouping
                const reactionEntries = msg.reactions
                  ? Object.entries(msg.reactions)
                  : msg.reaction
                  ? [['legacy', msg.reaction]]
                  : [];
                const reactionCounts = reactionEntries.reduce<
                  Record<string, { count: number; mine: boolean }>
                >((acc, [uid, emoji]) => {
                  if (!emoji) return acc;
                  if (!acc[emoji]) acc[emoji] = { count: 0, mine: false };
                  acc[emoji].count += 1;
                  if (isCurrentUserRef(uid)) acc[emoji].mine = true;
                  return acc;
                }, {});

                const replyAuthor = msg.replyToSenderId
                  ? isCurrentUserRef(msg.replyToSenderId)
                    ? 'Você'
                    : getUserById(msg.replyToSenderId)?.displayName ||
                      `@${recipient.username}`
                  : undefined;

                return (
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div className="group relative max-w-[82%] sm:max-w-[75%]">
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

                      {/* Quoted Reply Preview */}
                      {msg.replyToText && (
                        <button
                          type="button"
                          onClick={() => scrollToMessage(msg.replyToId)}
                          className={`mb-1 flex w-full flex-col rounded-xl border-l-2 px-3 py-1.5 text-left text-xs transition-opacity hover:opacity-90 ${
                            isMine
                              ? 'border-sky-300 bg-sky-50 text-zinc-700 dark:border-sky-500 dark:bg-zinc-900 dark:text-zinc-300'
                              : 'border-zinc-400 bg-zinc-100/80 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-300'
                          }`}
                        >
                          {replyAuthor && (
                            <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                              {replyAuthor}
                            </span>
                          )}
                          <span className="line-clamp-2 opacity-85">{msg.replyToText}</span>
                        </button>
                      )}

                      <div
                        className={`flex items-end gap-1.5 ${
                          isMine ? 'flex-row-reverse' : 'flex-row'
                        }`}
                      >
                        <div className="min-w-0">
                          {/* Audio Voice Bubble */}
                          {msg.audioUrl ? (
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
                            >
                              <VoiceNoteBubble
                                audioUrl={msg.audioUrl}
                                durationSec={msg.audioDurationSec}
                                isMine={isMine}
                              />
                            </div>
                          ) : msg.videoUrl ? (
                            /* Video Message Bubble */
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
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
                              {msg.text &&
                                msg.text !== 'Vídeo enviado' &&
                                msg.text !== 'Mensagem de vídeo' && (
                                  <p className="px-3.5 py-2 text-sm">{msg.text}</p>
                                )}
                            </div>
                          ) : msg.fileUrl && isImageFile ? (
                            /* Image Attachment / Camera Photo Bubble */
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
                              className={`overflow-hidden rounded-2xl border ${
                                isMine
                                  ? 'border-sky-600/30 bg-sky-600 text-white'
                                  : 'border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setLightboxImageUrl(msg.fileUrl!)}
                                className="block w-full overflow-hidden bg-black/5 text-left"
                              >
                                <img
                                  src={msg.fileUrl}
                                  alt={msg.fileName || 'Foto enviada'}
                                  className="max-h-72 w-full max-w-[280px] object-cover"
                                />
                              </button>
                              {msg.text &&
                                msg.text !== 'Foto da câmera' &&
                                msg.text !== `Arquivo: ${msg.fileName || 'anexo'}` && (
                                  <p className="px-3.5 py-2 text-sm">{msg.text}</p>
                                )}
                            </div>
                          ) : msg.fileUrl ? (
                            /* Document / File Attachment Bubble */
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
                              className={`rounded-2xl px-3.5 py-2.5 ${
                                isMine
                                  ? 'bg-sky-600 text-white'
                                  : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
                              }`}
                            >
                              <a
                                href={msg.fileUrl}
                                download={msg.fileName || 'arquivo'}
                                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors ${
                                  isMine
                                    ? 'bg-white/15 hover:bg-white/25'
                                    : 'bg-white hover:bg-zinc-50 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                                }`}
                              >
                                <span
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                    isMine
                                      ? 'bg-white/20 text-white'
                                      : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                  }`}
                                >
                                  <FileText className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold">
                                    {msg.fileName || 'Documento anexo'}
                                  </span>
                                  <span
                                    className={`block text-[10px] ${
                                      isMine
                                        ? 'text-white/80'
                                        : 'text-zinc-500 dark:text-zinc-400'
                                    }`}
                                  >
                                    {formatBytes(msg.fileSize) || 'Baixar arquivo'}
                                  </span>
                                </span>
                                <Download className="h-4 w-4 shrink-0 opacity-80" />
                              </a>
                              {msg.text &&
                                msg.text !== `Arquivo: ${msg.fileName || 'anexo'}` && (
                                  <p className="mt-2 text-sm leading-relaxed">{msg.text}</p>
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
                        </div>

                        {/* Quick Actions (Reply & Emoji Reaction) */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReactionPickerMsgId((curr) =>
                                curr === msg.id ? null : msg.id
                              );
                            }}
                            aria-label="Reagir à mensagem"
                            title="Reagir"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                          >
                            <SmilePlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(msg);
                              draftInputRef.current?.focus();
                            }}
                            aria-label="Responder mensagem"
                            title="Responder"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Multi-emoji Reaction Picker Popover */}
                      {reactionPickerMsgId === msg.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className={`mt-1.5 inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 ${
                            isMine ? 'ml-auto' : ''
                          }`}
                        >
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                reactToMessage(activeThread.id, msg.id, emoji);
                                setReactionPickerMsgId(null);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Aggregated Reaction Chips */}
                      {Object.keys(reactionCounts).length > 0 && (
                        <div
                          className={`mt-1 flex flex-wrap gap-1 ${
                            isMine ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {Object.entries(reactionCounts).map(([emoji, info]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() =>
                                reactToMessage(activeThread.id, msg.id, emoji)
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-xs transition-colors ${
                                info.mine
                                  ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                                  : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                              }`}
                            >
                              <span>{emoji}</span>
                              {info.count > 1 && (
                                <span className="text-[10px] font-semibold tabular-nums">
                                  {info.count}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Outgoing Read Receipt ("Visualizada" / "Enviada") */}
                      {isLatestOutgoing && (
                        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-zinc-400">
                          {seenByPartner ? (
                            <>
                              <CheckCheck className="h-3.5 w-3.5 text-sky-500" />
                              <span className="font-medium text-sky-600 dark:text-sky-400">
                                Visualizada
                              </span>
                            </>
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Enviada</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Live Typing Bubble */}
              {recipientTyping && (
                <div className="flex items-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                    </span>
                    <span>Digitando...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Hidden file inputs for audio, video & attachments */}
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
            <input
              ref={attachmentFileInputRef}
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z"
              onChange={handleAttachmentFileSelect}
              className="hidden"
            />

            {/* Reply Banner above Composer */}
            {replyingTo && (
              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/80">
                <div className="min-w-0 flex-1 border-l-2 border-sky-600 pl-2.5">
                  <p className="font-semibold text-sky-700 dark:text-sky-400">
                    Respondendo a{' '}
                    {isCurrentUserRef(replyingTo.senderId)
                      ? 'você mesmo'
                      : recipient.displayName}
                  </p>
                  <p className="truncate text-zinc-600 dark:text-zinc-300">
                    {summarizeMessageForQuote(replyingTo)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  aria-label="Cancelar resposta"
                  className="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Pending File / Image Attachment Preview above Composer */}
            {pendingAttachment && (
              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-sky-50/60 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-sky-950/20">
                <div className="flex min-w-0 items-center gap-2.5">
                  {pendingAttachment.fileMime.startsWith('image/') ? (
                    <img
                      src={pendingAttachment.fileUrl}
                      alt={pendingAttachment.fileName}
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-600/15 text-sky-600 dark:text-sky-400">
                      <FileText className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                      {pendingAttachment.fileName}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {formatBytes(pendingAttachment.fileSize)} · Pronto para enviar
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  aria-label="Remover anexo"
                  className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

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
                    onClick={() => void openCameraModal('video')}
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
                <form onSubmit={handleSend} className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => void openCameraModal('photo')}
                    aria-label="Abrir câmera"
                    title="Abrir câmera (foto ou vídeo)"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Camera className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => attachmentFileInputRef.current?.click()}
                    aria-label="Enviar arquivo"
                    title="Enviar arquivo ou imagem"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>

                  <input
                    ref={draftInputRef}
                    type="text"
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onBlur={() => {
                      if (selectedRecipientId) {
                        setTypingStatus(selectedRecipientId, false, activeThread?.id);
                      }
                    }}
                    placeholder="Mensagem..."
                    className="h-11 min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  />

                  <button
                    type="button"
                    onClick={startAudioRecording}
                    aria-label="Gravar mensagem de voz"
                    title="Gravar mensagem de voz"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Mic className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setVideoMenuOpen((o) => !o)}
                    aria-label="Enviar mensagem de vídeo"
                    title="Enviar vídeo"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Video className="h-5 w-5" />
                  </button>

                  {(draft.trim() || pendingAttachment) && (
                    <button
                      type="submit"
                      aria-label="Enviar mensagem"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-700"
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
              Selecione um perfil à esquerda para enviar textos, arquivos, fotos, áudios ou vídeos.
            </p>
          </div>
        )}
      </div>

      {/* Unified Live Camera Modal (Photo & Video) */}
      {cameraModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Câmera do Messenger"
          onClick={closeCameraModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => void switchCameraMode('photo')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      cameraMode === 'photo'
                        ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400'
                    }`}
                  >
                    Foto
                  </button>
                  <button
                    type="button"
                    onClick={() => void switchCameraMode('video')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      cameraMode === 'video'
                        ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400'
                    }`}
                  >
                    Vídeo
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {!previewPhotoUrl && !previewVideoUrl && !cameraError && (
                  <button
                    type="button"
                    onClick={() => void toggleCameraFacing()}
                    aria-label="Alternar câmera"
                    title="Alternar câmera frontal/traseira"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <SwitchCamera className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeCameraModal}
                  aria-label="Fechar câmera"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-4">
              {cameraError ? (
                <div className="space-y-4 py-6 text-center">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      closeCameraModal();
                      if (cameraMode === 'video') {
                        videoFileInputRef.current?.click();
                      } else {
                        attachmentFileInputRef.current?.click();
                      }
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700"
                  >
                    <Upload className="h-4 w-4" />
                    <span>
                      {cameraMode === 'video'
                        ? 'Selecionar vídeo do dispositivo'
                        : 'Selecionar arquivo do dispositivo'}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
                    {previewPhotoUrl ? (
                      <img
                        src={previewPhotoUrl}
                        alt="Pré-visualização da foto"
                        className="h-full w-full object-cover"
                      />
                    ) : previewVideoUrl ? (
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
                        className={`h-full w-full object-cover ${
                          facingMode === 'user' ? '-scale-x-100' : ''
                        }`}
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
                    {cameraMode === 'photo' ? (
                      previewPhotoUrl ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setPreviewPhotoUrl(null)}
                            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          >
                            Tirar outra
                          </button>
                          <button
                            type="button"
                            onClick={sendCapturedPhoto}
                            className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700"
                          >
                            <Send className="h-4 w-4" />
                            <span>Enviar foto</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={captureCameraPhoto}
                          className="inline-flex h-11 items-center gap-2 rounded-full bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                          <Camera className="h-4 w-4" />
                          <span>Capturar foto</span>
                        </button>
                      )
                    ) : previewVideoUrl ? (
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

      {/* Image Lightbox Modal */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImageUrl(null)}
            aria-label="Fechar imagem"
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImageUrl}
            alt="Visualização ampliada"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
