import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DirectThread,
  InviteRecord,
  NavSection,
  NotificationItem,
  Post,
  PostCategory,
  SiteMeta,
  StoryItem,
  UserProfile,
  VideoRulesConfig,
} from '../types';
import {
  SEED_NOTIFICATIONS,
  SEED_POSTS,
  SEED_STORIES,
  SEED_THREADS,
  SEED_USERS,
} from '../data/seed';

interface PersistedState {
  currentUserId: string;
  users: UserProfile[];
  posts: Post[];
  stories: StoryItem[];
  threads: DirectThread[];
  notifications: NotificationItem[];
  recentSearches: string[];
  theme: 'light' | 'dark';
}

export interface PendingInviteMeta {
  code: string;
  email?: string;
  invitedName?: string;
  grantVerified?: boolean;
  expiresAt?: number;
}

const STORAGE_KEY = 'lumina_social_v1';
const INVITES_KEY = 'lumina_invites_v1';
const CREDENTIALS_KEY = 'lumina_user_credentials_v1';
const REALTIME_CHANNEL = 'lumina_realtime_sync_v1';

interface LocalUserCredential {
  userId: string;
  username: string;
  email?: string;
  salt: string;
  hash: string;
  createdAt: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function generateSaltHex(): string {
  const buf = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(buf);
}

async function derivePasswordHash(password: string, saltHex: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: hexToBytes(saltHex) as BufferSource,
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    return `pbkdf2:${bytesToHex(new Uint8Array(bits))}`;
  }
  // Fallback only if subtle crypto is unavailable in a non-secure context
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const input = `${saltHex}:${password}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `fb:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function loadLocalCredentials(): LocalUserCredential[] {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return [];
}

function saveLocalCredentials(records: LocalUserCredential[]): void {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export const DEFAULT_VIDEO_RULES: VideoRulesConfig = {
  maxVideoSizeMB: 25,
  maxReelDurationSec: 60,
  allowVideoReels: true,
};

const DEFAULT_SITE_META: SiteMeta = {
  version: '2.4.0',
  announcementBanner: '',
  maintenanceMode: false,
  realUsersOnly: false,
  videoRules: DEFAULT_VIDEO_RULES,
};

function decodeInviteMeta(rawMeta: string | null): PendingInviteMeta | null {
  if (!rawMeta) return null;
  try {
    const base64 = rawMeta.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + pad);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as PendingInviteMeta;
    if (parsed && typeof parsed.code === 'string') {
      return parsed;
    }
  } catch {
    // Ignore malformed invite token metadata
  }
  return null;
}

export function encodeInviteMeta(meta: PendingInviteMeta): string {
  const json = JSON.stringify(meta);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadInitialInvites(): InviteRecord[] {
  try {
    const raw = localStorage.getItem(INVITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore storage error
  }
  return [];
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.posts)) {
        return {
          ...parsed,
          users: parsed.users.map((u) => {
            const seedMatch = SEED_USERS.find((s) => s.id === u.id);
            return {
              ...u,
              isOnline: u.isOnline !== undefined ? u.isOnline : seedMatch?.isOnline ?? true,
              coverUrl: u.coverUrl || seedMatch?.coverUrl,
              isDemoSeed:
                u.isDemoSeed !== undefined
                  ? u.isDemoSeed
                  : seedMatch
                  ? seedMatch.isDemoSeed
                  : false,
            };
          }),
        };
      }
    }
  } catch {
    // Fallback to seed
  }
  return {
    currentUserId: 'user_daniel',
    users: SEED_USERS,
    posts: SEED_POSTS,
    stories: SEED_STORIES,
    threads: SEED_THREADS,
    notifications: SEED_NOTIFICATIONS,
    recentSearches: ['arquitetura', 'clara.lentes', '35mm'],
    theme: 'light',
  };
}

interface SocialContextValue {
  currentUser: UserProfile;
  users: UserProfile[];
  allUsers: UserProfile[];
  posts: Post[];
  allPosts: Post[];
  stories: StoryItem[];
  threads: DirectThread[];
  notifications: NotificationItem[];
  recentSearches: string[];
  theme: 'light' | 'dark';
  activeNav: NavSection;
  viewingProfileId: string | null;
  exploreQuery: string;
  selectedPostId: string | null;
  activeStoryAuthorId: string | null;
  isCreateOpen: boolean;
  sharePostId: string | null;
  toastMessage: string | null;
  siteMeta: SiteMeta;
  setSiteMeta: (meta: SiteMeta) => void;
  refreshSiteMeta: () => Promise<void>;

  invites: InviteRecord[];
  setInvites: React.Dispatch<React.SetStateAction<InviteRecord[]>>;
  pendingInviteCode: string | null;
  setPendingInviteCode: (code: string | null) => void;
  pendingInviteMeta: PendingInviteMeta | null;
  isInviteModalOpen: boolean;
  setIsInviteModalOpen: (open: boolean) => void;
  createInvite: (payload: {
    email: string;
    invitedName?: string;
    grantVerified?: boolean;
    expiresInDays?: number;
  }) => InviteRecord;
  revokeInvite: (inviteId: string) => void;
  registerWithInvite: (payload: {
    code: string;
    username: string;
    displayName: string;
    email: string;
    password: string;
    bio: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  loginWithCredentials: (
    identifier: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  purgeDemoUsers: () => void;

  pendingChatUserId: string | null;
  setPendingChatUserId: (userId: string | null) => void;
  openChatWithUser: (userId: string) => void;

  setActiveNav: (nav: NavSection) => void;
  openProfile: (userId: string) => void;
  openHashtagInExplore: (tag: string) => void;
  setExploreQuery: (q: string) => void;
  setSelectedPostId: (id: string | null) => void;
  setActiveStoryAuthorId: (id: string | null) => void;
  setIsCreateOpen: (open: boolean) => void;
  setSharePostId: (postId: string | null) => void;
  toggleTheme: () => void;
  showToast: (msg: string) => void;

  switchUser: (userId: string) => void;
  createAccount: (data: {
    username: string;
    displayName: string;
    bio: string;
    email?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => void;
  updateProfile: (
    updates: Partial<
      Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl' | 'coverUrl' | 'email'>
    >
  ) => void;

  toggleFollow: (targetUserId: string) => void;
  toggleLikePost: (postId: string) => void;
  toggleSavePost: (postId: string) => void;
  addComment: (postId: string, text: string, parentCommentId?: string) => void;
  toggleLikeComment: (postId: string, commentId: string) => void;
  deletePost: (postId: string) => void;

  publishPost: (payload: {
    mediaUrls: string[];
    mediaAssets?: {
      url: string;
      mediaType?: 'image' | 'video';
      durationSec?: number;
      filterCss?: string;
    }[];
    caption: string;
    location?: string;
    category: PostCategory;
    aspectRatio: '1:1' | '4:5' | '16:9' | '9:16';
    isReel?: boolean;
    audioTrack?: string;
  }) => void;

  publishStory: (payload: { mediaUrl: string; caption?: string; location?: string }) => void;
  markStoryViewed: (storyId: string) => void;
  reactToStory: (storyId: string, emoji: string) => void;

  sendMessage: (
    recipientId: string,
    text: string,
    options?: {
      sharedPostId?: string;
      storyReplyUrl?: string;
      audioUrl?: string;
      audioDurationSec?: number;
      videoUrl?: string;
      videoName?: string;
    }
  ) => void;
  markThreadRead: (threadId: string) => void;
  reactToMessage: (threadId: string, messageId: string, emoji: string) => void;

  markNotificationsRead: () => void;
  addRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;
  resetDemoData: () => void;

  toggleRestrictUser: (userId: string) => void;
  toggleBoostUser: (userId: string) => void;
  toggleVerifyUser: (userId: string) => void;

  getUserById: (id: string) => UserProfile | undefined;
}

const SocialContext = createContext<SocialContextValue | null>(null);

function normalizeVideoRules(raw?: Partial<VideoRulesConfig>): VideoRulesConfig {
  return {
    maxVideoSizeMB:
      typeof raw?.maxVideoSizeMB === 'number' && raw.maxVideoSizeMB > 0
        ? Math.min(250, Math.max(1, raw.maxVideoSizeMB))
        : DEFAULT_VIDEO_RULES.maxVideoSizeMB,
    maxReelDurationSec:
      typeof raw?.maxReelDurationSec === 'number' && raw.maxReelDurationSec > 0
        ? Math.min(300, Math.max(5, raw.maxReelDurationSec))
        : DEFAULT_VIDEO_RULES.maxReelDurationSec,
    allowVideoReels:
      typeof raw?.allowVideoReels === 'boolean'
        ? raw.allowVideoReels
        : DEFAULT_VIDEO_RULES.allowVideoReels,
  };
}

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadInitialState);
  const [invites, setInvites] = useState<InviteRecord[]>(loadInitialInvites);
  const [activeNav, setActiveNav] = useState<NavSection>('feed');
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [activeStoryAuthorId, setActiveStoryAuthorId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [pendingChatUserId, setPendingChatUserId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [siteMeta, setSiteMeta] = useState<SiteMeta>(DEFAULT_SITE_META);

  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('invite')?.trim().toUpperCase() || null;
  });
  const [pendingInviteMeta, setPendingInviteMeta] = useState<PendingInviteMeta | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return decodeInviteMeta(params.get('meta'));
  });
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(new URLSearchParams(window.location.search).get('invite')?.trim());
  });

  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(`tab_${Math.random().toString(36).slice(2, 10)}`);
  const skipNextStateBroadcastRef = useRef(false);
  const skipNextInvitesBroadcastRef = useRef(false);

  const refreshSiteMeta = async () => {
    try {
      const res = await fetch('/api/site/meta');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as Partial<SiteMeta>;
        if (data && typeof data.version === 'string') {
          setSiteMeta({
            version: data.version,
            announcementBanner: data.announcementBanner || '',
            maintenanceMode: Boolean(data.maintenanceMode),
            realUsersOnly: Boolean(data.realUsersOnly),
            videoRules: normalizeVideoRules(data.videoRules),
          });
          return;
        }
      }
    } catch {
      // Fallback to local admin state on static hosting
    }
    try {
      const raw = localStorage.getItem('lumina_admin_local_state_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as { site?: Partial<SiteMeta> };
        if (parsed?.site) {
          setSiteMeta((prev) => ({
            version: typeof parsed.site?.version === 'string' ? parsed.site.version : prev.version,
            announcementBanner:
              typeof parsed.site?.announcementBanner === 'string'
                ? parsed.site.announcementBanner
                : prev.announcementBanner,
            maintenanceMode:
              typeof parsed.site?.maintenanceMode === 'boolean'
                ? parsed.site.maintenanceMode
                : prev.maintenanceMode,
            realUsersOnly:
              typeof parsed.site?.realUsersOnly === 'boolean'
                ? parsed.site.realUsersOnly
                : prev.realUsersOnly,
            videoRules: normalizeVideoRules(parsed.site?.videoRules || prev.videoRules),
          }));
        }
      }
    } catch {
      // Ignore storage error
    }
  };

  useEffect(() => {
    refreshSiteMeta();
  }, []);

  // Cross-tab real-time synchronization for real user messages, posts, and profiles
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(REALTIME_CHANNEL);
      channelRef.current = ch;
      ch.onmessage = (event: MessageEvent) => {
        const payload = event.data as {
          senderTabId?: string;
          type?: string;
          users?: UserProfile[];
          posts?: Post[];
          stories?: StoryItem[];
          threads?: DirectThread[];
          notifications?: NotificationItem[];
          invites?: InviteRecord[];
          siteMeta?: SiteMeta;
        };
        if (!payload || payload.senderTabId === tabIdRef.current) return;
        if (payload.type === 'state_sync') {
          skipNextStateBroadcastRef.current = true;
          setState((prev) => ({
            ...prev,
            users: Array.isArray(payload.users) ? payload.users : prev.users,
            posts: Array.isArray(payload.posts) ? payload.posts : prev.posts,
            stories: Array.isArray(payload.stories) ? payload.stories : prev.stories,
            threads: Array.isArray(payload.threads) ? payload.threads : prev.threads,
            notifications: Array.isArray(payload.notifications)
              ? payload.notifications
              : prev.notifications,
          }));
        } else if (payload.type === 'invites_sync' && Array.isArray(payload.invites)) {
          skipNextInvitesBroadcastRef.current = true;
          setInvites(payload.invites);
        } else if (payload.type === 'sitemeta_sync' && payload.siteMeta) {
          setSiteMeta(payload.siteMeta);
        }
      };
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as PersistedState;
          if (parsed && Array.isArray(parsed.users)) {
            skipNextStateBroadcastRef.current = true;
            setState((prev) => ({
              ...prev,
              users: parsed.users,
              posts: parsed.posts,
              stories: parsed.stories,
              threads: parsed.threads,
              notifications: parsed.notifications,
            }));
          }
        } catch {
          // Ignore malformed storage event
        }
      } else if (e.key === INVITES_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            skipNextInvitesBroadcastRef.current = true;
            setInvites(parsed);
          }
        } catch {
          // Ignore
        }
      } else if (e.key === 'lumina_admin_local_state_v1') {
        refreshSiteMeta();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state.theme]);

  useEffect(() => {
    if (skipNextStateBroadcastRef.current) {
      skipNextStateBroadcastRef.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      try {
        const compactState: PersistedState = {
          ...state,
          posts: state.posts.map((p) => ({
            ...p,
            media: p.media.map((m) => ({
              ...m,
              url:
                m.url.startsWith('data:video/') && m.url.length > 750_000
                  ? SEED_POSTS[0].media[0].url
                  : m.url,
            })),
          })),
          threads: state.threads.map((t) => ({
            ...t,
            messages: t.messages.map((m) => ({
              ...m,
              videoUrl: m.videoUrl && m.videoUrl.length > 500_000 ? undefined : m.videoUrl,
              audioUrl: m.audioUrl && m.audioUrl.length > 500_000 ? undefined : m.audioUrl,
            })),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
      } catch {
        // Keep running smoothly in memory
      }
    }

    channelRef.current?.postMessage({
      senderTabId: tabIdRef.current,
      type: 'state_sync',
      users: state.users,
      posts: state.posts,
      stories: state.stories,
      threads: state.threads,
      notifications: state.notifications,
    });
  }, [state]);

  useEffect(() => {
    if (skipNextInvitesBroadcastRef.current) {
      skipNextInvitesBroadcastRef.current = false;
      return;
    }
    try {
      localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
    } catch {
      // Ignore quota errors
    }
    channelRef.current?.postMessage({
      senderTabId: tabIdRef.current,
      type: 'invites_sync',
      invites,
    });
  }, [invites]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2800);
  };

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === state.currentUserId) || state.users[0],
    [state.users, state.currentUserId]
  );

  const visibleUsers = useMemo(() => {
    if (!siteMeta.realUsersOnly) return state.users;
    return state.users.filter((u) => !u.isDemoSeed || u.id === state.currentUserId);
  }, [state.users, state.currentUserId, siteMeta.realUsersOnly]);

  const visibleUserIds = useMemo(
    () => new Set(visibleUsers.map((u) => u.id)),
    [visibleUsers]
  );

  const visiblePosts = useMemo(() => {
    if (!siteMeta.realUsersOnly) return state.posts;
    return state.posts.filter((p) => visibleUserIds.has(p.authorId));
  }, [state.posts, visibleUserIds, siteMeta.realUsersOnly]);

  const visibleStories = useMemo(() => {
    if (!siteMeta.realUsersOnly) return state.stories;
    return state.stories.filter((s) => visibleUserIds.has(s.authorId));
  }, [state.stories, visibleUserIds, siteMeta.realUsersOnly]);

  const getUserById = (id: string) => state.users.find((u) => u.id === id);

  const openProfile = (userId: string) => {
    setViewingProfileId(userId);
    setActiveNav('profile');
  };

  const openChatWithUser = (userId: string) => {
    setPendingChatUserId(userId);
    setActiveNav('messages');
  };

  const openHashtagInExplore = (tag: string) => {
    setExploreQuery(tag);
    setSelectedPostId(null);
    setActiveNav('explore');
  };

  const toggleTheme = () => {
    setState((prev) => {
      const nextTheme = prev.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', nextTheme === 'dark');
      return {
        ...prev,
        theme: nextTheme,
      };
    });
  };

  const switchUser = (userId: string) => {
    setState((prev) => ({ ...prev, currentUserId: userId }));
    setViewingProfileId(null);
    const u = state.users.find((item) => item.id === userId);
    if (u) showToast(`Conectado como @${u.username}`);
  };

  const createAccount = (data: {
    username: string;
    displayName: string;
    bio: string;
    email?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => {
    const cleanHandle =
      data.username.toLowerCase().replace(/[^a-z0-9._]/g, '') || `usuario.${Date.now()}`;
    const newId = `user_${Date.now()}`;
    const newUser: UserProfile = {
      id: newId,
      username: cleanHandle,
      displayName: data.displayName.trim() || cleanHandle,
      avatarUrl: data.avatarUrl || SEED_USERS[0].avatarUrl,
      coverUrl: data.coverUrl || SEED_USERS[0].coverUrl,
      bio: data.bio.trim() || 'Novo perfil real na Lumina.',
      email: data.email?.trim() || undefined,
      verified: false,
      isOnline: true,
      isDemoSeed: false,
      followers: [],
      following: [],
    };
    setState((prev) => ({
      ...prev,
      users: [newUser, ...prev.users],
      currentUserId: newId,
    }));
    setViewingProfileId(null);
    showToast(`Conta @${cleanHandle} criada com sucesso`);
  };

  const createInvite = (payload: {
    email: string;
    invitedName?: string;
    grantVerified?: boolean;
    expiresInDays?: number;
  }): InviteRecord => {
    const cleanCode = `LUM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const days = Math.min(90, Math.max(1, payload.expiresInDays || 7));
    const record: InviteRecord = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      code: cleanCode,
      email: payload.email.trim().toLowerCase(),
      invitedName: payload.invitedName?.trim() || undefined,
      grantVerified: Boolean(payload.grantVerified),
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
    };
    setInvites((prev) => [record, ...prev]);
    return record;
  };

  const revokeInvite = (inviteId: string) => {
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId ? { ...inv, status: 'revoked' } : inv
      )
    );
    showToast('Convite revogado');
  };

  const registerWithInvite = async (payload: {
    code: string;
    username: string;
    displayName: string;
    email: string;
    password: string;
    bio: string;
    avatarUrl?: string;
    coverUrl?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const cleanCode = payload.code.trim().toUpperCase();
    if (!cleanCode) {
      return { ok: false, error: 'Informe o código de convite recebido.' };
    }
    const cleanHandle = payload.username
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/[^a-z0-9._]/g, '');

    if (cleanHandle.length < 3) {
      return { ok: false, error: 'Escolha um @usuario com pelo menos 3 caracteres.' };
    }

    const password = payload.password || '';
    if (password.length < 6) {
      return { ok: false, error: 'Crie uma senha de acesso com pelo menos 6 caracteres.' };
    }

    if (state.users.some((u) => u.username.toLowerCase() === cleanHandle)) {
      return { ok: false, error: `O nome @${cleanHandle} já está em uso.` };
    }

    const newId = `user_${Date.now()}`;
    const cleanEmail = payload.email.trim().toLowerCase();
    let grantVerified = false;
    const localMatch = invites.find((i) => i.code.toUpperCase() === cleanCode);

    if (localMatch) {
      if (localMatch.status === 'revoked') {
        return { ok: false, error: 'Este convite foi revogado pelo administrador.' };
      }
      if (localMatch.status === 'accepted') {
        return { ok: false, error: 'Este convite já foi utilizado.' };
      }
      if (Date.now() > localMatch.expiresAt) {
        return { ok: false, error: 'Este convite expirou. Solicite um novo link ao admin.' };
      }
      grantVerified = localMatch.grantVerified;
    } else if (pendingInviteMeta && pendingInviteMeta.code.toUpperCase() === cleanCode) {
      if (pendingInviteMeta.expiresAt && Date.now() > pendingInviteMeta.expiresAt) {
        return { ok: false, error: 'Este link de convite expirou.' };
      }
      grantVerified = Boolean(pendingInviteMeta.grantVerified);
    } else {
      // Check backend if available
      try {
        const res = await fetch('/api/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: cleanCode,
            userId: newId,
            username: cleanHandle,
            email: cleanEmail || undefined,
            password,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return { ok: false, error: 'Código de convite não encontrado ou inválido.' };
        }
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          grantVerified?: boolean;
          invite?: { grantVerified?: boolean };
        };
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Código de convite inválido.' };
        }
        grantVerified = Boolean(data.grantVerified ?? data.invite?.grantVerified);
      } catch {
        return { ok: false, error: 'Código de convite não encontrado ou inválido.' };
      }
    }

    // Notify server too if localMatch existed and server is reachable
    if (localMatch || pendingInviteMeta) {
      fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          userId: newId,
          username: cleanHandle,
          email: cleanEmail || localMatch?.email || pendingInviteMeta?.email,
          password,
        }),
      }).catch(() => {});
    }

    // Persist salted PBKDF2 password hash locally in isolated store (never on UserProfile)
    const salt = generateSaltHex();
    const hash = await derivePasswordHash(password, salt);
    const resolvedEmail = cleanEmail || localMatch?.email || pendingInviteMeta?.email;
    const existingCreds = loadLocalCredentials().filter(
      (c) => c.userId !== newId && c.username.toLowerCase() !== cleanHandle
    );
    existingCreds.unshift({
      userId: newId,
      username: cleanHandle,
      email: resolvedEmail?.toLowerCase(),
      salt,
      hash,
      createdAt: Date.now(),
    });
    saveLocalCredentials(existingCreds);

    const newUser: UserProfile = {
      id: newId,
      username: cleanHandle,
      displayName: payload.displayName.trim() || cleanHandle,
      avatarUrl: payload.avatarUrl || SEED_USERS[0].avatarUrl,
      coverUrl: payload.coverUrl || SEED_USERS[0].coverUrl,
      bio: payload.bio.trim() || 'Novo membro convidado na Lumina.',
      email: resolvedEmail,
      verified: grantVerified,
      isOnline: true,
      isDemoSeed: false,
      followers: [],
      following: [],
    };

    setState((prev) => ({
      ...prev,
      users: [newUser, ...prev.users],
      currentUserId: newId,
    }));

    if (localMatch) {
      setInvites((prev) =>
        prev.map((i) =>
          i.id === localMatch.id
            ? { ...i, status: 'accepted', acceptedByUserId: newId }
            : i
        )
      );
    }

    setPendingInviteCode(null);
    setPendingInviteMeta(null);
    setIsInviteModalOpen(false);
    setViewingProfileId(null);
    setActiveNav('feed');

    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      url.searchParams.delete('meta');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }

    showToast(`Bem-vindo(a), @${cleanHandle}! Cadastro por convite concluído.`);
    return { ok: true };
  };

  const loginWithCredentials = async (
    identifier: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const rawId = identifier.trim().toLowerCase();
    const cleanHandle = rawId.replace(/^@/, '');
    if (!cleanHandle || !password) {
      return { ok: false, error: 'Informe seu @usuário (ou e-mail) e senha de acesso.' };
    }

    const creds = loadLocalCredentials();
    const localCred = creds.find(
      (c) =>
        c.username.toLowerCase() === cleanHandle ||
        (c.email && c.email.toLowerCase() === rawId)
    );

    if (localCred) {
      const candidateHash = await derivePasswordHash(password, localCred.salt);
      if (constantTimeEqual(candidateHash, localCred.hash)) {
        const targetUser =
          state.users.find((u) => u.id === localCred.userId) ||
          state.users.find((u) => u.username.toLowerCase() === localCred.username.toLowerCase());
        if (targetUser) {
          setState((prev) => ({ ...prev, currentUserId: targetUser.id }));
          setViewingProfileId(null);
          setIsInviteModalOpen(false);
          showToast(`Conectado como @${targetUser.username}`);
          return { ok: true };
        }
      }
      return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' };
    }

    // Fallback to backend verification when available
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: rawId, password }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as {
          ok?: boolean;
          userId?: string;
          username?: string;
          error?: string;
        };
        if (res.ok && data.ok) {
          const targetUser =
            state.users.find((u) => u.id === data.userId) ||
            state.users.find(
              (u) => data.username && u.username.toLowerCase() === data.username.toLowerCase()
            );
          if (targetUser) {
            setState((prev) => ({ ...prev, currentUserId: targetUser.id }));
            setViewingProfileId(null);
            setIsInviteModalOpen(false);
            showToast(`Conectado como @${targetUser.username}`);
            return { ok: true };
          }
        }
        return { ok: false, error: data.error || 'Usuário/e-mail ou senha incorretos.' };
      }
    } catch {
      // Static hosting without backend auth endpoint
    }

    return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' };
  };

  const purgeDemoUsers = () => {
    setState((prev) => {
      const realUsers = prev.users.filter((u) => !u.isDemoSeed);
      const keptUsers =
        realUsers.length > 0
          ? realUsers
          : prev.users.filter((u) => u.id === prev.currentUserId);
      const keptIds = new Set(keptUsers.map((u) => u.id));
      const nextCurrentId = keptIds.has(prev.currentUserId)
        ? prev.currentUserId
        : keptUsers[0]?.id || prev.currentUserId;

      return {
        ...prev,
        currentUserId: nextCurrentId,
        users: keptUsers.map((u) => ({
          ...u,
          followers: u.followers.filter((id) => keptIds.has(id)),
          following: u.following.filter((id) => keptIds.has(id)),
        })),
        posts: prev.posts.filter((p) => keptIds.has(p.authorId)),
        stories: prev.stories.filter((s) => keptIds.has(s.authorId)),
        threads: prev.threads.filter((t) => t.participantIds.every((id) => keptIds.has(id))),
        notifications: prev.notifications.filter(
          (n) => keptIds.has(n.recipientId) && keptIds.has(n.actorId)
        ),
      };
    });
    showToast('Contas fictícias removidas. Rede apontada para usuários reais.');
  };

  const updateProfile = (
    updates: Partial<
      Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl' | 'coverUrl' | 'email'>
    >
  ) => {
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === prev.currentUserId ? { ...u, ...updates } : u
      ),
    }));
    showToast('Perfil atualizado');
  };

  const toggleFollow = (targetUserId: string) => {
    if (targetUserId === currentUser.id) return;
    setState((prev) => {
      const me = prev.users.find((u) => u.id === prev.currentUserId);
      if (!me) return prev;
      const isFollowing = me.following.includes(targetUserId);

      const updatedUsers = prev.users.map((u) => {
        if (u.id === prev.currentUserId) {
          return {
            ...u,
            following: isFollowing
              ? u.following.filter((id) => id !== targetUserId)
              : [...u.following, targetUserId],
          };
        }
        if (u.id === targetUserId) {
          return {
            ...u,
            followers: isFollowing
              ? u.followers.filter((id) => id !== prev.currentUserId)
              : [...u.followers, prev.currentUserId],
          };
        }
        return u;
      });

      const newNotifs = !isFollowing
        ? [
            {
              id: `notif_${Date.now()}`,
              recipientId: targetUserId,
              actorId: prev.currentUserId,
              type: 'follow' as const,
              createdAt: Date.now(),
              read: false,
            },
            ...prev.notifications,
          ]
        : prev.notifications;

      return { ...prev, users: updatedUsers, notifications: newNotifs };
    });
  };

  const toggleLikePost = (postId: string) => {
    setState((prev) => {
      const targetPost = prev.posts.find((p) => p.id === postId);
      const alreadyLiked = targetPost?.likes.includes(prev.currentUserId);

      const posts = prev.posts.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          likes: alreadyLiked
            ? p.likes.filter((id) => id !== prev.currentUserId)
            : [...p.likes, prev.currentUserId],
        };
      });

      const notifications =
        !alreadyLiked && targetPost && targetPost.authorId !== prev.currentUserId
          ? [
              {
                id: `notif_${Date.now()}`,
                recipientId: targetPost.authorId,
                actorId: prev.currentUserId,
                type: 'like' as const,
                postId,
                createdAt: Date.now(),
                read: false,
              },
              ...prev.notifications,
            ]
          : prev.notifications;

      return { ...prev, posts, notifications };
    });
  };

  const toggleSavePost = (postId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => {
        if (p.id !== postId) return p;
        const saved = p.savedBy.includes(prev.currentUserId);
        return {
          ...p,
          savedBy: saved
            ? p.savedBy.filter((id) => id !== prev.currentUserId)
            : [...p.savedBy, prev.currentUserId],
        };
      }),
    }));
  };

  const addComment = (postId: string, text: string, parentCommentId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((prev) => {
      const targetPost = prev.posts.find((p) => p.id === postId);
      const posts = prev.posts.map((p) => {
        if (p.id !== postId) return p;
        if (parentCommentId) {
          return {
            ...p,
            comments: p.comments.map((c) =>
              c.id === parentCommentId
                ? {
                    ...c,
                    replies: [
                      ...c.replies,
                      {
                        id: `rep_${Date.now()}`,
                        userId: prev.currentUserId,
                        text: trimmed,
                        createdAt: Date.now(),
                        likes: [],
                      },
                    ],
                  }
                : c
            ),
          };
        }
        return {
          ...p,
          comments: [
            ...p.comments,
            {
              id: `com_${Date.now()}`,
              userId: prev.currentUserId,
              text: trimmed,
              createdAt: Date.now(),
              likes: [],
              replies: [],
            },
          ],
        };
      });

      const notifications =
        targetPost && targetPost.authorId !== prev.currentUserId
          ? [
              {
                id: `notif_${Date.now()}`,
                recipientId: targetPost.authorId,
                actorId: prev.currentUserId,
                type: 'comment' as const,
                postId,
                text: trimmed,
                createdAt: Date.now(),
                read: false,
              },
              ...prev.notifications,
            ]
          : prev.notifications;

      return { ...prev, posts, notifications };
    });
  };

  const toggleLikeComment = (postId: string, commentId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: p.comments.map((c) => {
            if (c.id !== commentId) return c;
            const liked = c.likes.includes(prev.currentUserId);
            return {
              ...c,
              likes: liked
                ? c.likes.filter((id) => id !== prev.currentUserId)
                : [...c.likes, prev.currentUserId],
            };
          }),
        };
      }),
    }));
  };

  const deletePost = (postId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.filter((p) => p.id !== postId),
    }));
    if (selectedPostId === postId) setSelectedPostId(null);
    showToast('Publicação removida');
  };

  const publishPost = (payload: {
    mediaUrls: string[];
    mediaAssets?: {
      url: string;
      mediaType?: 'image' | 'video';
      durationSec?: number;
      filterCss?: string;
    }[];
    caption: string;
    location?: string;
    category: PostCategory;
    aspectRatio: '1:1' | '4:5' | '16:9' | '9:16';
    isReel?: boolean;
    audioTrack?: string;
  }) => {
    if (currentUser.restricted) {
      showToast('Conta restrita pela administração — publicação bloqueada');
      return;
    }
    const assets: {
      url: string;
      mediaType?: 'image' | 'video';
      durationSec?: number;
      filterCss?: string;
    }[] =
      payload.mediaAssets && payload.mediaAssets.length > 0
        ? payload.mediaAssets
        : payload.mediaUrls.map((url) => ({ url, mediaType: 'image' as const }));

    const newPost: Post = {
      id: `post_${Date.now()}`,
      authorId: currentUser.id,
      media: assets.map((asset, idx) => ({
        id: `m_${Date.now()}_${idx}`,
        url: asset.url,
        alt: payload.caption.slice(0, 80) || 'Publicação na Lumina',
        mediaType: asset.mediaType || 'image',
        durationSec: asset.durationSec,
        filterCss: asset.filterCss,
      })),
      caption: payload.caption.trim(),
      location: payload.location?.trim() || undefined,
      category: payload.category,
      aspectRatio: payload.aspectRatio,
      isReel: payload.isReel,
      audioTrack: payload.audioTrack,
      likes: [],
      savedBy: [],
      comments: [],
      createdAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      posts: [newPost, ...prev.posts],
    }));
    setActiveNav(payload.isReel ? 'reels' : 'feed');
    showToast(payload.isReel ? 'Reel publicado no feed' : 'Publicação compartilhada');
  };

  const publishStory = (payload: { mediaUrl: string; caption?: string; location?: string }) => {
    const newStory: StoryItem = {
      id: `story_${Date.now()}`,
      authorId: currentUser.id,
      mediaUrl: payload.mediaUrl,
      caption: payload.caption?.trim() || undefined,
      location: payload.location?.trim() || undefined,
      createdAt: Date.now(),
      viewedBy: [],
      reactions: [],
    };
    setState((prev) => ({
      ...prev,
      stories: [newStory, ...prev.stories],
    }));
    setActiveNav('feed');
    showToast('Story publicado por 24 horas');
  };

  const markStoryViewed = (storyId: string) => {
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId && !s.viewedBy.includes(prev.currentUserId)
          ? { ...s, viewedBy: [...s.viewedBy, prev.currentUserId] }
          : s
      ),
    }));
  };

  const reactToStory = (storyId: string, emoji: string) => {
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId
          ? {
              ...s,
              reactions: [...s.reactions, { userId: prev.currentUserId, emoji }],
            }
          : s
      ),
    }));
    showToast(`Reação ${emoji} enviada`);
  };

  // Direct messages for real users only (no automated/bot replies)
  const sendMessage = (
    recipientId: string,
    text: string,
    options?: {
      sharedPostId?: string;
      storyReplyUrl?: string;
      audioUrl?: string;
      audioDurationSec?: number;
      videoUrl?: string;
      videoName?: string;
    }
  ) => {
    const trimmed = text.trim();
    if (!trimmed && !options?.sharedPostId && !options?.audioUrl && !options?.videoUrl) {
      return;
    }

    const msgId = `dm_${Date.now()}`;
    setState((prev) => {
      const existing = prev.threads.find(
        (t) =>
          t.participantIds.includes(prev.currentUserId) &&
          t.participantIds.includes(recipientId)
      );

      const fallbackLabel = options?.audioUrl
        ? 'Mensagem de voz'
        : options?.videoUrl
        ? 'Vídeo'
        : options?.sharedPostId
        ? 'Compartilhou uma publicação'
        : '';

      const newMsg = {
        id: msgId,
        senderId: prev.currentUserId,
        text: trimmed || fallbackLabel,
        sharedPostId: options?.sharedPostId,
        storyReplyUrl: options?.storyReplyUrl,
        audioUrl: options?.audioUrl,
        audioDurationSec: options?.audioDurationSec,
        videoUrl: options?.videoUrl,
        videoName: options?.videoName,
        createdAt: Date.now(),
      };

      const newNotif: NotificationItem = {
        id: `notif_${Date.now()}`,
        recipientId,
        actorId: prev.currentUserId,
        type: 'mention',
        text: trimmed || fallbackLabel,
        createdAt: Date.now(),
        read: false,
      };

      if (existing) {
        return {
          ...prev,
          threads: prev.threads
            .map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    messages: [...t.messages, newMsg],
                    unreadBy: [recipientId],
                    updatedAt: Date.now(),
                  }
                : t
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
          notifications:
            recipientId !== prev.currentUserId
              ? [newNotif, ...prev.notifications]
              : prev.notifications,
        };
      }

      const newThread: DirectThread = {
        id: `thread_${Date.now()}`,
        participantIds: [prev.currentUserId, recipientId],
        messages: [newMsg],
        unreadBy: [recipientId],
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        threads: [newThread, ...prev.threads],
        notifications:
          recipientId !== prev.currentUserId
            ? [newNotif, ...prev.notifications]
            : prev.notifications,
      };
    });
  };

  const markThreadRead = (threadId: string) => {
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === threadId
          ? { ...t, unreadBy: t.unreadBy.filter((id) => id !== prev.currentUserId) }
          : t
      ),
    }));
  };

  const reactToMessage = (threadId: string, messageId: string, emoji: string) => {
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId
                  ? { ...m, reaction: m.reaction === emoji ? undefined : emoji }
                  : m
              ),
            }
          : t
      ),
    }));
  };

  const markNotificationsRead = () => {
    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.recipientId === prev.currentUserId ? { ...n, read: true } : n
      ),
    }));
  };

  const addRecentSearch = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setState((prev) => ({
      ...prev,
      recentSearches: [
        clean,
        ...prev.recentSearches.filter((t) => t.toLowerCase() !== clean.toLowerCase()),
      ].slice(0, 6),
    }));
  };

  const clearRecentSearches = () => {
    setState((prev) => ({ ...prev, recentSearches: [] }));
  };

  const resetDemoData = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      currentUserId: 'user_daniel',
      users: SEED_USERS,
      posts: SEED_POSTS,
      stories: SEED_STORIES,
      threads: SEED_THREADS,
      notifications: SEED_NOTIFICATIONS,
      recentSearches: ['arquitetura', 'clara.lentes', '35mm'],
      theme: state.theme,
    });
    showToast('Feed restaurado para os dados originais');
  };

  const toggleRestrictUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.restricted;
      showToast(
        nextVal
          ? `@${target?.username || 'usuário'} foi restringido`
          : `Restrição removida de @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, restricted: nextVal } : u
        ),
      };
    });
  };

  const toggleBoostUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.boosted;
      showToast(
        nextVal
          ? `Perfil @${target?.username || 'usuário'} impulsionado no feed`
          : `Impulsionamento desativado para @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, boosted: nextVal } : u
        ),
      };
    });
  };

  const toggleVerifyUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.verified;
      showToast(
        nextVal
          ? `Selo de verificação concedido a @${target?.username || 'usuário'}`
          : `Selo de verificação removido de @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, verified: nextVal } : u
        ),
      };
    });
  };

  const handleSetSiteMeta = (nextMeta: SiteMeta) => {
    setSiteMeta(nextMeta);
    channelRef.current?.postMessage({
      senderTabId: tabIdRef.current,
      type: 'sitemeta_sync',
      siteMeta: nextMeta,
    });
  };

  return (
    <SocialContext.Provider
      value={{
        currentUser,
        users: visibleUsers,
        allUsers: state.users,
        posts: visiblePosts,
        allPosts: state.posts,
        stories: visibleStories,
        threads: state.threads,
        notifications: state.notifications,
        recentSearches: state.recentSearches,
        theme: state.theme,
        activeNav,
        viewingProfileId,
        exploreQuery,
        selectedPostId,
        activeStoryAuthorId,
        isCreateOpen,
        sharePostId,
        toastMessage,
        siteMeta,
        setSiteMeta: handleSetSiteMeta,
        refreshSiteMeta,
        invites,
        setInvites,
        pendingInviteCode,
        setPendingInviteCode,
        pendingInviteMeta,
        isInviteModalOpen,
        setIsInviteModalOpen,
        createInvite,
        revokeInvite,
        registerWithInvite,
        loginWithCredentials,
        purgeDemoUsers,
        pendingChatUserId,
        setPendingChatUserId,
        openChatWithUser,
        setActiveNav: (nav) => {
          if (nav === 'profile') setViewingProfileId(currentUser.id);
          setActiveNav(nav);
        },
        openProfile,
        openHashtagInExplore,
        setExploreQuery,
        setSelectedPostId,
        setActiveStoryAuthorId,
        setIsCreateOpen,
        setSharePostId,
        toggleTheme,
        showToast,
        switchUser,
        createAccount,
        updateProfile,
        toggleFollow,
        toggleLikePost,
        toggleSavePost,
        addComment,
        toggleLikeComment,
        deletePost,
        publishPost,
        publishStory,
        markStoryViewed,
        reactToStory,
        sendMessage,
        markThreadRead,
        reactToMessage,
        markNotificationsRead,
        addRecentSearch,
        clearRecentSearches,
        resetDemoData,
        toggleRestrictUser,
        toggleBoostUser,
        toggleVerifyUser,
        getUserById,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used within SocialProvider');
  return ctx;
}
