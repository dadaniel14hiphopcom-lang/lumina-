import {
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  FolderOpen,
  Mic,
  MoreVertical,
  Paperclip,
  Pause,
  Phone,
  PhoneCall,
  PhoneMissed,
  Pin,
  PinOff,
  Play,
  Plus,
  Reply,
  Search,
  Send,
  SmilePlus,
  Square,
  SwitchCamera,
  Trash2,
  Upload,
  UserCheck,
  UserX,
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

function formatCallLogDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const WAVEFORM_BARS = [
  38, 65, 90, 50, 75, 100, 62, 44, 85, 95, 54, 70, 88, 42, 68, 92, 58, 76,
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
      className={`flex w-[196px] max-w-full items-center gap-2.5 rounded-2xl px-3 py-2 sm:w-[248px] sm:gap-3 sm:px-3.5 sm:py-2.5 ${
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

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-6 items-center gap-[2.5px] sm:gap-[3px]">
          {WAVEFORM_BARS.map((height, idx) => {
            const barPercent = ((idx + 1) / WAVEFORM_BARS.length) * 100;
            const active = barPercent <= progress;
            return (
              <span
                key={idx}
                className={`w-[2.5px] rounded-full transition-colors sm:w-[3px] ${
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
          <span className="truncate">Áudio de voz</span>
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
  if (msg.isCallLog) {
    return msg.callType === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio';
  }
  if (msg.audioUrl) return 'Mensagem de voz';
  if (msg.videoUrl) return msg.videoName ? `Vídeo: ${msg.videoName}` : 'Vídeo enviado';
  if (msg.fileUrl) {
    if (msg.fileMime?.startsWith('image/')) {
      return msg.text && msg.text !== `Arquivo: ${msg.fileName || 'anexo'}`
        ? msg.text
        : 'Foto enviada';
    }
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
    blockedUserIds,
    mutedThreadIds,
    pinnedThreadIds,
    isUserBlocked,
    blockUser,
    unblockUser,
    toggleMuteThread,
    togglePinThread,
    clearThreadMessages,
    deleteThread,
    startCall,
    activeCall,
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
  const [contactTab, setContactTab] = useState<'all' | 'unread' | 'blocked'>('all');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [typingClock, setTypingClock] = useState(() => Date.now());
  const [mobileTrayOpen, setMobileTrayOpen] = useState(false);

  // Advanced Chat Options & In-Thread Search
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsSubView, setOptionsSubView] = useState<'main' | 'media' | 'blocked'>('main');
  const [confirmAction, setConfirmAction] = useState<'clear' | 'delete' | 'block' | null>(null);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchIdx, setThreadSearchIdx] = useState(0);

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
    if (!u || isUserBlocked(u.id) || (u.uid && isUserBlocked(u.uid))) return false;
    const tsMain = typingByUserId[u.id] || 0;
    const tsUid = u.uid ? typingByUserId[u.uid] || 0 : 0;
    const newest = Math.max(tsMain, tsUid);
    return newest > 0 && typingClock - newest < 4500;
  };

  const contacts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase().replace(/^@/, '');
    const pool = users.length > 0 ? users : allUsers;
    const base = pool.filter(
      (u) => !u.restricted && !isCurrentUserRef(u.id) && (!u.uid || !isCurrentUserRef(u.uid))
    );

    const byTab = base.filter((u) => {
      const blocked = isUserBlocked(u.id) || Boolean(u.uid && isUserBlocked(u.uid));
      if (contactTab === 'blocked') return blocked;
      if (contactTab === 'unread') {
        if (blocked) return false;
        const thread = threads.find(
          (t) =>
            threadHasUser(t.participantIds, currentUser) &&
            threadHasUser(t.participantIds, u)
        );
        return Boolean(thread?.unreadBy.some((id) => isCurrentUserRef(id)));
      }
      return !blocked;
    });

    const filtered = byTab.filter(
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
      const pinA = threadA && pinnedThreadIds.includes(threadA.id) ? 1 : 0;
      const pinB = threadB && pinnedThreadIds.includes(threadB.id) ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;

      const timeA = threadA?.updatedAt || 0;
      const timeB = threadB?.updatedAt || 0;
      if (timeA !== timeB) return timeB - timeA;
      const aReal = a.isDemoSeed ? 0 : 1;
      const bReal = b.isDemoSeed ? 0 : 1;
      return bReal - aReal;
    });
  }, [
    users,
    allUsers,
    threads,
    currentUser,
    search,
    contactTab,
    blockedUserIds,
    pinnedThreadIds,
  ]);

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

  const recipientBlocked = Boolean(
    recipient && (isUserBlocked(recipient.id) || (recipient.uid && isUserBlocked(recipient.uid)))
  );

  const activeThread = useMemo(() => {
    if (!selectedRecipientId) return undefined;
    return threads.find(
      (t) =>
        threadHasUser(t.participantIds, currentUser) &&
        (threadHasUser(t.participantIds, recipient) ||
          t.participantIds.includes(selectedRecipientId))
    );
  }, [threads, currentUser, recipient, selectedRecipientId]);

  const activeThreadMuted = Boolean(activeThread && mutedThreadIds.includes(activeThread.id));
  const activeThreadPinned = Boolean(activeThread && pinnedThreadIds.includes(activeThread.id));

  const sharedMediaStats = useMemo(() => {
    const msgs = activeThread?.messages || [];
    const photos: DirectMessage[] = [];
    const videos: DirectMessage[] = [];
    const files: DirectMessage[] = [];
    let audioCount = 0;

    for (const m of msgs) {
      if (m.audioUrl) audioCount += 1;
      if (m.videoUrl) videos.push(m);
      if (m.fileUrl) {
        const isImg =
          Boolean(m.fileMime?.startsWith('image/')) ||
          Boolean(m.fileUrl.startsWith('data:image/'));
        if (isImg) photos.push(m);
        else files.push(m);
      }
    }
    return { photos: photos.reverse(), videos: videos.reverse(), files: files.reverse(), audioCount };
  }, [activeThread?.messages]);

  const searchMatches = useMemo(() => {
    const q = threadSearchQuery.trim().toLowerCase();
    if (!q || !activeThread) return [] as string[];
    return activeThread.messages
      .filter((m) => {
        const text = m.text?.toLowerCase() || '';
        const fname = m.fileName?.toLowerCase() || '';
        return text.includes(q) || fname.includes(q);
      })
      .map((m) => m.id);
  }, [threadSearchQuery, activeThread]);

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

  // Reset contextual popovers & search when switching recipients
  useEffect(() => {
    setReplyingTo(null);
    setReactionPickerMsgId(null);
    setPendingAttachment(null);
    setMobileTrayOpen(false);
    setVideoMenuOpen(false);
    setOptionsOpen(false);
    setOptionsSubView('main');
    setConfirmAction(null);
    setThreadSearchOpen(false);
    setThreadSearchQuery('');
    setThreadSearchIdx(0);
    return () => {
      if (selectedRecipientId) {
        setTypingStatus(selectedRecipientId, false);
      }
    };
  }, [selectedRecipientId]);

  useEffect(() => {
    if (!threadSearchOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeThread?.messages.length, threadSearchOpen]);

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
    if (selectedRecipientId && !recipientBlocked) {
      setTypingStatus(selectedRecipientId, val.trim().length > 0, activeThread?.id);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipientId || recipientBlocked) return;
    if (!draft.trim() && !pendingAttachment) return;

    sendMessage(selectedRecipientId, draft, {
      ...(pendingAttachment || {}),
      ...buildReplyOptions(),
    });
    setDraft('');
    setReplyingTo(null);
    setPendingAttachment(null);
    setMobileTrayOpen(false);
    setTypingStatus(selectedRecipientId, false, activeThread?.id);
  };

  // Start Voice Recording
  const startAudioRecording = async () => {
    if (!selectedRecipientId || recipientBlocked) return;
    setMobileTrayOpen(false);
    setVideoMenuOpen(false);
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
    if (!file || !selectedRecipientId || recipientBlocked) return;
    const url = file.size <= 2_500_000 ? await readBlobAsDataUrl(file) : URL.createObjectURL(file);
    sendMessage(selectedRecipientId, file.name, {
      audioUrl: url,
      ...buildReplyOptions(),
    });
    setReplyingTo(null);
    setAudioFallbackOpen(false);
    setMobileTrayOpen(false);
    showToast('Áudio enviado no bate-papo');
  };

  // Attachment file upload (images, PDFs, docs, spreadsheets, archives)
  const handleAttachmentFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setMobileTrayOpen(false);
    if (!file || !selectedRecipientId || recipientBlocked) return;

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
    setMobileTrayOpen(false);
    if (!file || !selectedRecipientId || recipientBlocked) return;

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
    if (recipientBlocked) return;
    setVideoMenuOpen(false);
    setMobileTrayOpen(false);
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

  const jumpSearchMatch = (delta: number) => {
    if (searchMatches.length === 0) return;
    const nextIdx =
      (threadSearchIdx + delta + searchMatches.length) % searchMatches.length;
    setThreadSearchIdx(nextIdx);
    scrollToMessage(searchMatches[nextIdx]);
  };

  const openOptionsSheet = (tab: 'main' | 'media' | 'blocked' = 'main') => {
    setConfirmAction(null);
    setOptionsSubView(tab);
    setOptionsOpen(true);
  };

  const resolvedBlockedUsers = useMemo(() => {
    return blockedUserIds
      .map((id) => getUserById(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));
  }, [blockedUserIds, getUserById]);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl min-w-0 overflow-hidden bg-white dark:bg-[#050505] lg:my-6 lg:h-[calc(100dvh-3rem)] lg:rounded-2xl lg:border lg:border-zinc-200 dark:lg:border-zinc-800">
      {/* Left: Thread / Contacts List */}
      <div
        className={`flex min-w-0 w-full flex-col border-r border-zinc-200 dark:border-zinc-800 md:w-76 lg:w-80 ${
          selectedRecipientId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="border-b border-zinc-200 p-3.5 sm:p-4 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-bold text-zinc-950 sm:text-lg dark:text-zinc-100">
              Mensagens
            </h1>
            {blockedUserIds.length > 0 && (
              <button
                type="button"
                onClick={() => openOptionsSheet('blocked')}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-100 px-2.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Ban className="h-3 w-3 text-rose-500" />
                <span className="tabular-nums">{blockedUserIds.length}</span>
              </button>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-900">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa..."
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Segmented Tabs: Todas / Não lidas / Bloqueados */}
          <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setContactTab('all')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                contactTab === 'all'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setContactTab('unread')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                contactTab === 'unread'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Não lidas
            </button>
            <button
              type="button"
              onClick={() => setContactTab('blocked')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                contactTab === 'blocked'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Bloqueados
            </button>
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
                className="mt-2 h-9 w-full rounded-lg bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Entrar na conta
              </button>
            </div>
          )}

          {contacts.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {contactTab === 'blocked'
                ? 'Nenhuma pessoa bloqueada no momento.'
                : contactTab === 'unread'
                ? 'Nenhuma conversa não lida.'
                : 'Nenhum usuário encontrado para conversar.'}
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
              const isMuted = Boolean(thread && mutedThreadIds.includes(thread.id));
              const isPinned = Boolean(thread && pinnedThreadIds.includes(thread.id));
              const contactBlocked =
                isUserBlocked(contact.id) || Boolean(contact.uid && isUserBlocked(contact.uid));
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
                  className={`flex min-h-[64px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors sm:px-4 sm:py-3 ${
                    isSelected
                      ? 'bg-zinc-100 dark:bg-zinc-900'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                  }`}
                >
                  <AvatarRing
                    src={contact.avatarUrl}
                    alt={contact.username}
                    size="md"
                    showOnlineIndicator={Boolean(contact.isOnline && !contactBlocked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                          {contact.displayName}
                        </span>
                        {isPinned && (
                          <Pin className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400" />
                        )}
                        {isMuted && (
                          <BellOff className="h-3 w-3 shrink-0 text-zinc-400" />
                        )}
                      </div>
                      {lastMsg && (
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {formatRelativeTime(lastMsg.createdAt)}
                        </span>
                      )}
                    </div>

                    {contactBlocked ? (
                      <p className="truncate text-xs font-medium text-rose-600 dark:text-rose-400">
                        Bloqueado · toque para gerenciar
                      </p>
                    ) : isTypingContact ? (
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
                  {isUnread && !contactBlocked && (
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
        className={`flex min-w-0 flex-1 flex-col ${
          selectedRecipientId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {recipient ? (
          <>
            {/* Thread Header (Compact Mobile + Audio/Video Call + Options) */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-2.5 py-2 sm:px-4 sm:py-3 dark:border-zinc-800">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRecipientId(null)}
                  aria-label="Voltar às conversas"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900 md:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => openProfile(recipient.id)}
                  className="flex min-w-0 items-center gap-2.5 text-left"
                >
                  <AvatarRing
                    src={recipient.avatarUrl}
                    alt={recipient.username}
                    size="sm"
                    showOnlineIndicator={Boolean(recipient.isOnline && !recipientBlocked)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                        {recipient.displayName}
                      </p>
                      {activeThreadMuted && (
                        <BellOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      )}
                    </div>
                    {recipientBlocked ? (
                      <p className="truncate text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        Usuário bloqueado
                      </p>
                    ) : recipientTyping ? (
                      <p className="truncate text-[11px] font-medium text-sky-600 dark:text-sky-400">
                        Digitando...
                      </p>
                    ) : (
                      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {recipient.isOnline ? 'Ativo agora' : `@${recipient.username}`}
                      </p>
                    )}
                  </div>
                </button>
              </div>

              {/* Call & Chat Options Actions */}
              <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                <button
                  type="button"
                  disabled={recipientBlocked || Boolean(activeCall)}
                  onClick={() => void startCall(recipient.id, 'audio')}
                  aria-label="Ligação de áudio"
                  title={recipientBlocked ? 'Desbloqueie para ligar' : 'Chamada de áudio'}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <Phone className="h-[19px] w-[19px]" />
                </button>
                <button
                  type="button"
                  disabled={recipientBlocked || Boolean(activeCall)}
                  onClick={() => void startCall(recipient.id, 'video')}
                  aria-label="Chamada de vídeo"
                  title={recipientBlocked ? 'Desbloqueie para ligar' : 'Chamada de vídeo'}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <Video className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => openOptionsSheet('main')}
                  aria-label="Opções da conversa"
                  title="Opções da conversa"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Inline In-Conversation Search Bar */}
            {threadSearchOpen && (
              <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  type="text"
                  autoFocus
                  value={threadSearchQuery}
                  onChange={(e) => {
                    setThreadSearchQuery(e.target.value);
                    setThreadSearchIdx(0);
                  }}
                  placeholder="Buscar nesta conversa..."
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
                />
                {threadSearchQuery.trim() && (
                  <span className="shrink-0 text-[11px] font-medium text-zinc-500 tabular-nums">
                    {searchMatches.length > 0
                      ? `${Math.min(threadSearchIdx + 1, searchMatches.length)}/${searchMatches.length}`
                      : '0/0'}
                  </span>
                )}
                <button
                  type="button"
                  disabled={searchMatches.length === 0}
                  onClick={() => jumpSearchMatch(-1)}
                  aria-label="Resultado anterior"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200 disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={searchMatches.length === 0}
                  onClick={() => jumpSearchMatch(1)}
                  aria-label="Próximo resultado"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200 disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThreadSearchOpen(false);
                    setThreadSearchQuery('');
                  }}
                  aria-label="Fechar busca"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Messages Scroll */}
            <div
              className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3 sm:space-y-3 sm:p-4"
              onClick={() => {
                if (reactionPickerMsgId) setReactionPickerMsgId(null);
                if (mobileTrayOpen) setMobileTrayOpen(false);
              }}
            >
              {(!activeThread || activeThread.messages.length === 0) && (
                <div className="py-10 text-center sm:py-12">
                  <AvatarRing
                    src={recipient.avatarUrl}
                    alt={recipient.username}
                    size="lg"
                  />
                  <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {recipient.displayName}
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                    Envie texto, arquivos, fotos da câmera, áudios de voz ou inicie chamadas de vídeo e áudio.
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
                const isSearchHighlighted =
                  threadSearchOpen &&
                  searchMatches.length > 0 &&
                  searchMatches[threadSearchIdx] === msg.id;

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

                // Dedicated Call Log Card
                if (msg.isCallLog) {
                  const isMissedOrRejected =
                    msg.callStatus === 'missed' || msg.callStatus === 'rejected';
                  const durLabel = formatCallLogDuration(msg.callDurationSec);
                  return (
                    <div
                      key={msg.id}
                      id={`msg-${msg.id}`}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`flex max-w-[85%] items-center gap-3 rounded-2xl border px-3.5 py-2.5 sm:max-w-[74%] ${
                          isSearchHighlighted
                            ? 'ring-2 ring-amber-400'
                            : ''
                        } ${
                          isMine
                            ? 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                            : 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            isMissedOrRejected
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {isMissedOrRejected ? (
                            <PhoneMissed className="h-4 w-4" />
                          ) : msg.callType === 'video' ? (
                            <Video className="h-4 w-4" />
                          ) : (
                            <PhoneCall className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">
                            {msg.callType === 'video'
                              ? 'Chamada de vídeo'
                              : 'Chamada de áudio'}
                          </p>
                          <p className="text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                            {msg.callStatus === 'completed'
                              ? durLabel
                                ? `Duração ${durLabel}`
                                : 'Concluída'
                              : msg.callStatus === 'rejected'
                              ? 'Recusada'
                              : 'Não atendida'}
                            {' · '}
                            {formatRelativeTime(msg.createdAt)}
                          </p>
                        </div>
                        {!recipientBlocked && (
                          <button
                            type="button"
                            onClick={() =>
                              void startCall(recipient.id, msg.callType || 'audio')
                            }
                            className="shrink-0 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                          >
                            Ligar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`group relative max-w-[85%] sm:max-w-[74%] ${
                        isSearchHighlighted
                          ? 'rounded-2xl ring-2 ring-amber-400 ring-offset-2 dark:ring-offset-zinc-950'
                          : ''
                      }`}
                    >
                      {msg.storyReplyUrl && (
                        <div className="mb-1.5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                          <MediaImage
                            src={msg.storyReplyUrl}
                            alt="Story respondido"
                            className="h-24 w-16 object-cover sm:h-28 sm:w-20"
                          />
                        </div>
                      )}

                      {sharedPost && (
                        <button
                          type="button"
                          onClick={() => setSelectedPostId(sharedPost.id)}
                          className="mb-1.5 block w-44 max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-left sm:w-52 dark:border-zinc-800 dark:bg-zinc-900"
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
                          className={`mb-1 flex w-full flex-col rounded-xl border-l-2 px-2.5 py-1.5 text-left text-xs transition-opacity hover:opacity-90 sm:px-3 ${
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
                          <span className="line-clamp-2 break-words opacity-85">
                            {msg.replyToText}
                          </span>
                        </button>
                      )}

                      <div
                        className={`flex items-end gap-1 ${
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
                                className="max-h-60 w-full max-w-[220px] bg-black object-contain sm:max-h-72 sm:max-w-[280px]"
                              />
                              {msg.text &&
                                msg.text !== 'Vídeo enviado' &&
                                msg.text !== 'Mensagem de vídeo' && (
                                  <p className="break-words px-3 py-1.5 text-[13px] sm:px-3.5 sm:py-2 sm:text-sm">
                                    {msg.text}
                                  </p>
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
                                  className="max-h-60 w-full max-w-[220px] object-cover sm:max-h-72 sm:max-w-[280px]"
                                />
                              </button>
                              {msg.text &&
                                msg.text !== 'Foto da câmera' &&
                                msg.text !== `Arquivo: ${msg.fileName || 'anexo'}` && (
                                  <p className="break-words px-3 py-1.5 text-[13px] sm:px-3.5 sm:py-2 sm:text-sm">
                                    {msg.text}
                                  </p>
                                )}
                            </div>
                          ) : msg.fileUrl ? (
                            /* Document / File Attachment Bubble */
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
                              className={`max-w-full rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2.5 ${
                                isMine
                                  ? 'bg-sky-600 text-white'
                                  : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
                              }`}
                            >
                              <a
                                href={msg.fileUrl}
                                download={msg.fileName || 'arquivo'}
                                className={`flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${
                                  isMine
                                    ? 'bg-white/15 hover:bg-white/25'
                                    : 'bg-white hover:bg-zinc-50 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                                }`}
                              >
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${
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
                                  <p className="mt-2 break-words text-[13px] leading-relaxed sm:text-sm">
                                    {msg.text}
                                  </p>
                                )}
                            </div>
                          ) : (
                            /* Standard Text Bubble */
                            <div
                              onDoubleClick={() =>
                                reactToMessage(activeThread.id, msg.id, '❤️')
                              }
                              className={`break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed sm:px-4 sm:py-2.5 sm:text-sm ${
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

            {/* Blocked Contact Banner OR Active Composer */}
            {recipientBlocked ? (
              <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
                      <Ban className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        Você bloqueou @{recipient.username}
                      </p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Mensagens e chamadas estão desativadas para este contato.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => unblockUser(recipient.id)}
                    className="h-9 shrink-0 rounded-xl bg-zinc-900 px-3.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    Desbloquear
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Reply Banner above Composer */}
                {replyingTo && (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/80">
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
                      className="flex h-8 w-8 items-center justify-center text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Pending File / Image Attachment Preview above Composer */}
                {pendingAttachment && (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-sky-50/60 px-3 py-2 text-xs sm:px-4 dark:border-zinc-800 dark:bg-sky-950/20">
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
                      className="flex h-8 w-8 items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Fallback inline audio picker if microphone is unavailable */}
                {audioFallbackOpen && (
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs sm:px-4 sm:py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      Microfone ausente. Envie um arquivo de áudio:
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

                {/* Mobile Quick Media Tray (Keeps composer input wide on narrow screens) */}
                {mobileTrayOpen && !isRecordingAudio && (
                  <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2.5 sm:hidden dark:border-zinc-800 dark:bg-zinc-900/90">
                    <button
                      type="button"
                      onClick={() => void openCameraModal('photo')}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2 text-[11px] font-medium text-zinc-700 shadow-xs dark:bg-zinc-950 dark:text-zinc-200"
                    >
                      <Camera className="h-4 w-4 text-sky-600" />
                      <span>Câmera</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => attachmentFileInputRef.current?.click()}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2 text-[11px] font-medium text-zinc-700 shadow-xs dark:bg-zinc-950 dark:text-zinc-200"
                    >
                      <Paperclip className="h-4 w-4 text-emerald-600" />
                      <span>Arquivo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCameraModal('video')}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2 text-[11px] font-medium text-zinc-700 shadow-xs dark:bg-zinc-950 dark:text-zinc-200"
                    >
                      <Video className="h-4 w-4 text-violet-600" />
                      <span>Gravar vídeo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => videoFileInputRef.current?.click()}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2 text-[11px] font-medium text-zinc-700 shadow-xs dark:bg-zinc-950 dark:text-zinc-200"
                    >
                      <Upload className="h-4 w-4 text-amber-600" />
                      <span>Enviar vídeo</span>
                    </button>
                  </div>
                )}

                {/* Composer */}
                <div className="relative shrink-0 border-t border-zinc-200 p-2 sm:p-3 dark:border-zinc-800">
                  {videoMenuOpen && (
                    <div className="absolute right-14 bottom-16 z-20 hidden w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg sm:block dark:border-zinc-800 dark:bg-zinc-950">
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
                        className="flex h-9 w-9 items-center justify-center rounded-full text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <div className="flex flex-1 items-center justify-center gap-2">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                        <span className="font-mono text-sm font-semibold text-rose-600 tabular-nums dark:text-rose-400">
                          {formatTimer(recordingSec)}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">
                          Gravando...
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={finishAndSendAudio}
                        aria-label="Enviar mensagem de voz"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-700"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSend} className="flex items-center gap-1 sm:gap-2">
                      {/* Mobile '+' tray trigger */}
                      <button
                        type="button"
                        onClick={() => setMobileTrayOpen((v) => !v)}
                        aria-label="Mais opções de envio"
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform sm:hidden ${
                          mobileTrayOpen
                            ? 'rotate-45 bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                            : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200'
                        }`}
                      >
                        <Plus className="h-5 w-5" />
                      </button>

                      {/* Desktop/Tablet direct media triggers */}
                      <button
                        type="button"
                        onClick={() => void openCameraModal('photo')}
                        aria-label="Abrir câmera"
                        title="Abrir câmera (foto ou vídeo)"
                        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 sm:flex dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        <Camera className="h-5 w-5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => attachmentFileInputRef.current?.click()}
                        aria-label="Enviar arquivo"
                        title="Enviar arquivo ou imagem"
                        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 sm:flex dark:text-zinc-200 dark:hover:bg-zinc-900"
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
                        className="h-10 min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none sm:h-11 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
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
                        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100 sm:flex dark:text-zinc-200 dark:hover:bg-zinc-900"
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
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Suas mensagens diretas
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Selecione um perfil à esquerda para enviar textos, arquivos, fotos, áudios ou iniciar chamadas.
            </p>
          </div>
        )}
      </div>

      {/* Advanced Chat Options Bottom Sheet (Mobile) / Modal (Desktop) */}
      {optionsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Opções do bate-papo"
          onClick={() => setOptionsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-200 bg-white shadow-2xl sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            {/* Mobile drag handle */}
            <div className="flex justify-center pt-2.5 sm:hidden">
              <span className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            </div>

            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                {optionsSubView !== 'main' && recipient && (
                  <button
                    type="button"
                    onClick={() => setOptionsSubView('main')}
                    aria-label="Voltar"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <h2 className="text-sm font-bold text-zinc-950 dark:text-zinc-100">
                  {optionsSubView === 'media'
                    ? 'Mídias e arquivos'
                    : optionsSubView === 'blocked'
                    ? 'Pessoas bloqueadas'
                    : 'Opções da conversa'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOptionsOpen(false)}
                aria-label="Fechar opções"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {optionsSubView === 'blocked' ? (
                resolvedBlockedUsers.length === 0 ? (
                  <div className="py-10 text-center">
                    <UserCheck className="mx-auto h-8 w-8 text-zinc-400" />
                    <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Nenhum usuário bloqueado
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Contatos bloqueados aparecerão aqui para você gerenciar quando quiser.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {resolvedBlockedUsers.map((bu) => (
                      <div
                        key={bu.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <AvatarRing src={bu.avatarUrl} alt={bu.username} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {bu.displayName}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              @{bu.username}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => unblockUser(bu.id)}
                          className="h-9 shrink-0 rounded-xl bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                        >
                          Desbloquear
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : optionsSubView === 'media' && recipient ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-900">
                      <p className="text-base font-bold text-zinc-900 tabular-nums dark:text-white">
                        {sharedMediaStats.photos.length}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400">Fotos</p>
                    </div>
                    <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-900">
                      <p className="text-base font-bold text-zinc-900 tabular-nums dark:text-white">
                        {sharedMediaStats.videos.length}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400">Vídeos</p>
                    </div>
                    <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-900">
                      <p className="text-base font-bold text-zinc-900 tabular-nums dark:text-white">
                        {sharedMediaStats.files.length + sharedMediaStats.audioCount}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400">Arq./Áudios</p>
                    </div>
                  </div>

                  {sharedMediaStats.photos.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-zinc-500 uppercase">
                        Fotos compartilhadas
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {sharedMediaStats.photos.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setOptionsOpen(false);
                              setLightboxImageUrl(p.fileUrl!);
                            }}
                            className="aspect-square overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900"
                          >
                            <img
                              src={p.fileUrl}
                              alt={p.fileName || 'Foto'}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {sharedMediaStats.files.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-zinc-500 uppercase">
                        Documentos
                      </p>
                      <div className="space-y-1.5">
                        {sharedMediaStats.files.map((f) => (
                          <a
                            key={f.id}
                            href={f.fileUrl}
                            download={f.fileName || 'arquivo'}
                            className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-sky-600" />
                            <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                              {f.fileName || 'Documento'}
                            </span>
                            <Download className="h-4 w-4 shrink-0 text-zinc-400" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {sharedMediaStats.photos.length === 0 &&
                    sharedMediaStats.videos.length === 0 &&
                    sharedMediaStats.files.length === 0 && (
                      <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                        Nenhuma mídia ou arquivo enviado nesta conversa ainda.
                      </p>
                    )}
                </div>
              ) : recipient ? (
                <>
                  {/* Recipient Identity Card */}
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarRing
                        src={recipient.avatarUrl}
                        alt={recipient.username}
                        size="md"
                        showOnlineIndicator={Boolean(recipient.isOnline && !recipientBlocked)}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-100">
                          {recipient.displayName}
                        </p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          @{recipient.username}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOptionsOpen(false);
                        openProfile(recipient.id);
                      }}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-zinc-100 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <span>Perfil</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Quick Grid Actions */}
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      disabled={recipientBlocked || Boolean(activeCall)}
                      onClick={() => {
                        setOptionsOpen(false);
                        void startCall(recipient.id, 'audio');
                      }}
                      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-100 p-2 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <Phone className="h-4 w-4 text-emerald-600" />
                      <span>Áudio</span>
                    </button>
                    <button
                      type="button"
                      disabled={recipientBlocked || Boolean(activeCall)}
                      onClick={() => {
                        setOptionsOpen(false);
                        void startCall(recipient.id, 'video');
                      }}
                      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-100 p-2 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <Video className="h-4 w-4 text-sky-600" />
                      <span>Vídeo</span>
                    </button>
                    <button
                      type="button"
                      disabled={!activeThread}
                      onClick={() => {
                        if (activeThread) toggleMuteThread(activeThread.id);
                      }}
                      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-100 p-2 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {activeThreadMuted ? (
                        <Bell className="h-4 w-4 text-amber-600" />
                      ) : (
                        <BellOff className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                      )}
                      <span>{activeThreadMuted ? 'Reativar' : 'Silenciar'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!activeThread}
                      onClick={() => {
                        if (activeThread) togglePinThread(activeThread.id);
                      }}
                      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-100 p-2 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {activeThreadPinned ? (
                        <PinOff className="h-4 w-4 text-sky-600" />
                      ) : (
                        <Pin className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                      )}
                      <span>{activeThreadPinned ? 'Desafixar' : 'Fixar'}</span>
                    </button>
                  </div>

                  {/* Conversation Tools List */}
                  <div className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setOptionsOpen(false);
                        setThreadSearchOpen(true);
                      }}
                      className="flex min-h-[48px] w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <span className="flex items-center gap-3">
                        <Search className="h-4 w-4 text-zinc-500" />
                        <span>Buscar nesta conversa</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOptionsSubView('media')}
                      className="flex min-h-[48px] w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <span className="flex items-center gap-3">
                        <FolderOpen className="h-4 w-4 text-sky-600" />
                        <span>Mídias e arquivos compartilhados</span>
                      </span>
                      <span className="text-xs text-zinc-400 tabular-nums">
                        {sharedMediaStats.photos.length +
                          sharedMediaStats.videos.length +
                          sharedMediaStats.files.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOptionsSubView('blocked')}
                      className="flex min-h-[48px] w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <span className="flex items-center gap-3">
                        <UserX className="h-4 w-4 text-zinc-500" />
                        <span>Gerenciar pessoas bloqueadas</span>
                      </span>
                      <span className="text-xs text-zinc-400 tabular-nums">
                        {blockedUserIds.length}
                      </span>
                    </button>
                  </div>

                  {/* Privacy & Safety / Destructive Actions */}
                  <div className="space-y-2">
                    {activeThread && (
                      <>
                        {confirmAction === 'clear' ? (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
                            <span className="font-medium text-amber-900 dark:text-amber-200">
                              Limpar histórico deste chat?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setConfirmAction(null)}
                                className="rounded-lg px-2.5 py-1 font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-300"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  clearThreadMessages(activeThread.id);
                                  setConfirmAction(null);
                                  setOptionsOpen(false);
                                }}
                                className="rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmAction('clear')}
                            className="flex min-h-[46px] w-full items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2.5 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          >
                            <Trash2 className="h-4 w-4 text-zinc-500" />
                            <span>Limpar histórico da conversa</span>
                          </button>
                        )}

                        {confirmAction === 'delete' ? (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs dark:border-rose-900/50 dark:bg-rose-950/30">
                            <span className="font-medium text-rose-900 dark:text-rose-200">
                              Remover conversa da lista?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setConfirmAction(null)}
                                className="rounded-lg px-2.5 py-1 font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-300"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteThread(activeThread.id);
                                  setConfirmAction(null);
                                  setOptionsOpen(false);
                                  setSelectedRecipientId(null);
                                }}
                                className="rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700"
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmAction('delete')}
                            className="flex min-h-[46px] w-full items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2.5 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          >
                            <X className="h-4 w-4 text-zinc-500" />
                            <span>Excluir conversa da lista</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* Block / Unblock User */}
                    {recipientBlocked ? (
                      <button
                        type="button"
                        onClick={() => {
                          unblockUser(recipient.id);
                          setOptionsOpen(false);
                        }}
                        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        <UserCheck className="h-4 w-4" />
                        <span>Desbloquear @{recipient.username}</span>
                      </button>
                    ) : confirmAction === 'block' ? (
                      <div className="space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs dark:border-rose-900/60 dark:bg-rose-950/30">
                        <p className="font-semibold text-rose-900 dark:text-rose-200">
                          Bloquear @{recipient.username}?
                        </p>
                        <p className="text-rose-800/80 dark:text-rose-300/80">
                          Vocês não poderão enviar mensagens nem iniciar chamadas de áudio ou vídeo.
                        </p>
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setConfirmAction(null)}
                            className="h-8 rounded-lg px-3 font-semibold text-zinc-700 hover:bg-black/5 dark:text-zinc-300"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              blockUser(recipient.id);
                              setConfirmAction(null);
                              setOptionsOpen(false);
                            }}
                            className="h-8 rounded-lg bg-rose-600 px-3 font-semibold text-white hover:bg-rose-700"
                          >
                            Confirmar bloqueio
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmAction('block')}
                        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-600 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
                      >
                        <Ban className="h-4 w-4" />
                        <span>Bloquear @{recipient.username}</span>
                      </button>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Unified Live Camera Modal (Photo & Video) */}
      {cameraModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Câmera do Messenger"
          onClick={closeCameraModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
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
            className="max-h-[88dvh] max-w-[92vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
