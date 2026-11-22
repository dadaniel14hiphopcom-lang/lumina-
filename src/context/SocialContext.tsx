import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import {
  adminUpdateProfileFlagsInCloud,
  createInviteInCloud,
  createPostInCloud,
  createStoryInCloud,
  deletePostInCloud,
  ensureAdminDocIfMatched,
  subscribeToCloudState,
  syncSiteMetaToCloud,
  updatePostInteractionInCloud,
  updateProfileFollowersInCloud,
  updateStoryInteractionInCloud,
  upsertOwnProfileInCloud,
  upsertThreadInCloud,
} from '../lib/firestoreSync';
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
  isAuthenticated?: boolean;
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
        const mappedUsers = parsed.users.map((u) => {
          const seedMatch = SEED_USERS.find((s) => s.id === u.id);
          return {
            ...u,
            isOnline: u.isOnline !== undefined ? u.isOnline : seedMatch?.isOnline ?? true,
            coverUrl: u.coverUrl || seedMatch?.coverUrl,
            isDemoSeed: seedMatch
              ? seedMatch.isDemoSeed
              : u.isDemoSeed !== undefined
              ? u.isDemoSeed
              : false,
          };
        });
        const current = mappedUsers.find((u) => u.id === parsed.currentUserId);
        const canRestoreAuth =
          parsed.isAuthenticated === true && Boolean(current && !current.isDemoSeed);
        return {
          ...parsed,
          isAuthenticated: canRestoreAuth,
          users: mappedUsers,
        };
      }
    }
  } catch {
    // Fallback to seed
  }
  return {
    currentUserId: 'user_daniel',
    isAuthenticated: false,
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
  inviteModalMode: 'register' | 'login';
  openAuthModal: (mode: 'register' | 'login') => void;
  isAuthenticated: boolean;
  guestBrowsing: boolean;
  setGuestBrowsing: (guest: boolean) => void;
  firebaseUser: FirebaseUser | null;
  cloudConnected: boolean;
  loginWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  hasPasswordForCurrentUser: boolean;
  hasPasswordForUser: (userId: string) => boolean;
  changePassword: (payload: {
    currentPassword?: string;
    newPassword: string;
  }) => Promise<{ ok: boolean; error?: string }>;
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
  const [inviteModalMode, setInviteModalMode] = useState<'register' | 'login'>('register');
  const [guestBrowsing, setGuestBrowsing] = useState(false);
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [serverSyncAvailable, setServerSyncAvailable] = useState(false);

  const openAuthModal = (mode: 'register' | 'login') => {
    setInviteModalMode(mode);
    setIsInviteModalOpen(true);
  };

  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(`tab_${Math.random().toString(36).slice(2, 10)}`);
  const skipNextStateBroadcastRef = useRef(false);
  const skipNextInvitesBroadcastRef = useRef(false);
  const skipNextServerPushRef = useRef(false);
  const lastServerUpdatedAtRef = useRef(0);

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

  // Helper to merge remote records cleanly by ID without losing local seed fallback
  const mergeRecordsById = <T extends { id: string }>(localList: T[], remoteList: T[]): T[] => {
    const map = new Map<string, T>();
    for (const item of localList) map.set(item.id, item);
    for (const item of remoteList) map.set(item.id, item);
    return Array.from(map.values());
  };

  // Firebase Auth & Firestore real-time cross-device sync
  useEffect(() => {
    let unsubCloud: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      if (unsubCloud) {
        unsubCloud();
        unsubCloud = null;
      }
      if (!fbUser || !fbUser.emailVerified) return;

      void ensureAdminDocIfMatched(fbUser).catch(() => {});

      unsubCloud = subscribeToCloudState(fbUser, {
        onProfiles: (cloudProfiles) => {
          if (cloudProfiles.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => {
            const merged = mergeRecordsById(prev.users, cloudProfiles);
            return { ...prev, users: merged };
          });
        },
        onPosts: (cloudPosts) => {
          if (cloudPosts.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => ({
            ...prev,
            posts: mergeRecordsById(prev.posts, cloudPosts).sort((a, b) => b.createdAt - a.createdAt),
          }));
        },
        onStories: (cloudStories) => {
          if (cloudStories.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => ({
            ...prev,
            stories: mergeRecordsById(prev.stories, cloudStories).sort((a, b) => b.createdAt - a.createdAt),
          }));
        },
        onThreads: (cloudThreads) => {
          if (cloudThreads.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => ({
            ...prev,
            threads: mergeRecordsById(prev.threads, cloudThreads).sort((a, b) => b.updatedAt - a.updatedAt),
          }));
        },
        onNotifications: (cloudNotifs) => {
          if (cloudNotifs.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => ({
            ...prev,
            notifications: mergeRecordsById(prev.notifications, cloudNotifs).sort((a, b) => b.createdAt - a.createdAt),
          }));
        },
        onSiteMeta: (cloudMeta) => {
          setSiteMeta(cloudMeta);
        },
      });
    });

    return () => {
      unsubAuth();
      if (unsubCloud) unsubCloud();
    };
  }, []);

  // Node server cross-device fallback sync (/api/social/state)
  useEffect(() => {
    let active = true;
    const pullServerState = async () => {
      try {
        const res = await fetch('/api/social/state');
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) return;
        const data = (await res.json()) as {
          ok?: boolean;
          state?: {
            updatedAt?: number;
            users?: UserProfile[];
            posts?: Post[];
            stories?: StoryItem[];
            threads?: DirectThread[];
            notifications?: NotificationItem[];
          } | null;
        };
        if (!active || !data.ok) return;
        setServerSyncAvailable(true);
        const remote = data.state;
        if (!remote || !Array.isArray(remote.users) || !Array.isArray(remote.posts)) return;
        if (remote.updatedAt && remote.updatedAt <= lastServerUpdatedAtRef.current) return;
        lastServerUpdatedAtRef.current = remote.updatedAt || Date.now();
        skipNextServerPushRef.current = true;
        skipNextStateBroadcastRef.current = true;
        setState((prev) => ({
          ...prev,
          users: mergeRecordsById(prev.users, remote.users!),
          posts: mergeRecordsById(prev.posts, remote.posts!).sort((a, b) => b.createdAt - a.createdAt),
          stories: Array.isArray(remote.stories)
            ? mergeRecordsById(prev.stories, remote.stories).sort((a, b) => b.createdAt - a.createdAt)
            : prev.stories,
          threads: Array.isArray(remote.threads)
            ? mergeRecordsById(prev.threads, remote.threads).sort((a, b) => b.updatedAt - a.updatedAt)
            : prev.threads,
          notifications: Array.isArray(remote.notifications)
            ? mergeRecordsById(prev.notifications, remote.notifications).sort((a, b) => b.createdAt - a.createdAt)
            : prev.notifications,
        }));
      } catch {
        // Static hosting without Node /api/social/state
      }
    };
    void pullServerState();
    const timer = window.setInterval(() => {
      void pullServerState();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
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

    if (skipNextServerPushRef.current) {
      skipNextServerPushRef.current = false;
    } else if (serverSyncAvailable) {
      fetch('/api/social/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users: state.users,
          posts: state.posts,
          stories: state.stories,
          threads: state.threads,
          notifications: state.notifications,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = (await res.json()) as { updatedAt?: number };
            if (data.updatedAt) lastServerUpdatedAtRef.current = data.updatedAt;
          }
        })
        .catch(() => {});
    }
  }, [state, serverSyncAvailable]);

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

  const isAuthenticated = state.isAuthenticated !== false;

  const hasPasswordForUser = (userId: string) => {
    void credentialsVersion;
    const u = state.users.find((item) => item.id === userId);
    const creds = loadLocalCredentials();
    return creds.some(
      (c) =>
        c.userId === userId ||
        (u && c.username.toLowerCase() === u.username.toLowerCase())
    );
  };

  const hasPasswordForCurrentUser = useMemo(() => {
    void credentialsVersion;
    const creds = loadLocalCredentials();
    return creds.some(
      (c) =>
        c.userId === currentUser.id ||
        c.username.toLowerCase() === currentUser.username.toLowerCase()
    );
  }, [currentUser.id, currentUser.username, credentialsVersion]);

  const cloudConnected = Boolean(
    (firebaseUser && firebaseUser.emailVerified) || serverSyncAvailable
  );

  const requireAuthForAction = (): boolean => {
    if (isAuthenticated) return true;
    showToast('Entre com uma conta cadastrada para interagir');
    openAuthModal('login');
    return false;
  };

  const loginWithGoogle = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const fbUser = cred.user;
      if (!fbUser || !fbUser.emailVerified) {
        return { ok: false, error: 'Use uma conta Google com e-mail verificado.' };
      }

      await ensureAdminDocIfMatched(fbUser).catch(() => {});

      const cleanEmail = (fbUser.email || '').trim().toLowerCase();
      const existingMatch = state.users.find(
        (u) =>
          !u.isDemoSeed &&
          (u.uid === fbUser.uid ||
            u.id === fbUser.uid ||
            (cleanEmail && u.email?.toLowerCase() === cleanEmail))
      );

      let activeProfile: UserProfile;
      if (existingMatch) {
        activeProfile = {
          ...existingMatch,
          uid: fbUser.uid,
          email: existingMatch.email || cleanEmail || undefined,
          avatarUrl: existingMatch.avatarUrl || fbUser.photoURL || SEED_USERS[0].avatarUrl,
          isOnline: true,
          isDemoSeed: false,
        };
        setState((prev) => ({
          ...prev,
          users: prev.users.map((u) => (u.id === existingMatch.id ? activeProfile : u)),
          currentUserId: activeProfile.id,
          isAuthenticated: true,
        }));
      } else {
        const baseHandle = (
          fbUser.email?.split('@')[0] ||
          fbUser.displayName ||
          'usuario'
        )
          .toLowerCase()
          .replace(/[^a-z0-9._]/g, '')
          .slice(0, 24);
        const safeHandle =
          baseHandle.length >= 3
            ? state.users.some((u) => u.username.toLowerCase() === baseHandle)
              ? `${baseHandle}.${fbUser.uid.slice(0, 4).toLowerCase()}`
              : baseHandle
            : `user.${fbUser.uid.slice(0, 6).toLowerCase()}`;

        activeProfile = {
          id: fbUser.uid,
          uid: fbUser.uid,
          username: safeHandle,
          displayName: fbUser.displayName?.trim() || safeHandle,
          avatarUrl: fbUser.photoURL || SEED_USERS[0].avatarUrl,
          coverUrl: SEED_USERS[0].coverUrl,
          bio: 'Perfil conectado na nuvem Lumina.',
          email: cleanEmail || undefined,
          verified: false,
          isOnline: true,
          isDemoSeed: false,
          followers: [],
          following: [],
        };
        setState((prev) => ({
          ...prev,
          users: [activeProfile, ...prev.users.filter((u) => u.id !== activeProfile.id)],
          currentUserId: activeProfile.id,
          isAuthenticated: true,
        }));
      }

      setGuestBrowsing(false);
      setViewingProfileId(null);
      setIsInviteModalOpen(false);
      void upsertOwnProfileInCloud(activeProfile, fbUser).catch(() => {});
      showToast(`Conectado na nuvem como @${activeProfile.username}`);
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? 'Login com Google cancelado.'
          : 'Não foi possível conectar com o Google. Tente novamente.';
      return { ok: false, error: msg };
    }
  };

  const logout = () => {
    setSelectedPostId(null);
    setActiveStoryAuthorId(null);
    setIsCreateOpen(false);
    setSharePostId(null);
    setGuestBrowsing(false);
    setViewingProfileId(null);
    setActiveNav('feed');
    setState((prev) => ({ ...prev, isAuthenticated: false }));
    if (auth.currentUser) {
      void signOut(auth).catch(() => {});
    }
    showToast('Você saiu da sua conta');
  };

  const switchUser = (userId: string) => {
    const target = state.users.find((item) => item.id === userId);
    if (
      !target ||
      target.isDemoSeed ||
      (!hasPasswordForUser(target.id) && !target.uid)
    ) {
      showToast('Apenas contas cadastradas podem entrar');
      openAuthModal('login');
      return;
    }
    setState((prev) => ({ ...prev, currentUserId: userId, isAuthenticated: true }));
    setGuestBrowsing(false);
    setViewingProfileId(null);
    showToast(`Conectado como @${target.username}`);
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
      isAuthenticated: true,
    }));
    setGuestBrowsing(false);
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
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void createInviteInCloud(record, auth.currentUser).catch(() => {});
    }
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
    setCredentialsVersion((v) => v + 1);

    const newUser: UserProfile = {
      id: newId,
      uid: auth.currentUser?.uid,
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
      isAuthenticated: true,
    }));
    setGuestBrowsing(false);

    if (auth.currentUser && auth.currentUser.emailVerified) {
      void upsertOwnProfileInCloud(newUser, auth.currentUser).catch(() => {});
    }

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
          setState((prev) => ({ ...prev, currentUserId: targetUser.id, isAuthenticated: true }));
          setGuestBrowsing(false);
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
            setState((prev) => ({ ...prev, currentUserId: targetUser.id, isAuthenticated: true }));
            setGuestBrowsing(false);
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

  const changePassword = async (payload: {
    currentPassword?: string;
    newPassword: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const nextPass = payload.newPassword || '';
    if (nextPass.length < 6) {
      return { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
    }

    const creds = loadLocalCredentials();
    const existingCred = creds.find(
      (c) =>
        c.userId === currentUser.id ||
        c.username.toLowerCase() === currentUser.username.toLowerCase()
    );

    if (existingCred) {
      const currentAttempt = payload.currentPassword || '';
      if (!currentAttempt) {
        return { ok: false, error: 'Informe sua senha atual para alterá-la.' };
      }
      const candidateHash = await derivePasswordHash(currentAttempt, existingCred.salt);
      if (!constantTimeEqual(candidateHash, existingCred.hash)) {
        return { ok: false, error: 'A senha atual está incorreta.' };
      }
    }

    // Sync with Node backend if available
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          username: currentUser.username,
          email: currentUser.email,
          currentPassword: payload.currentPassword || '',
          newPassword: nextPass,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Não foi possível alterar a senha.' };
        }
      }
    } catch {
      // Static hosting without backend — local salted PBKDF2 store still updates
    }

    const newSalt = generateSaltHex();
    const newHash = await derivePasswordHash(nextPass, newSalt);
    const updatedCreds = creds.filter(
      (c) =>
        c.userId !== currentUser.id &&
        c.username.toLowerCase() !== currentUser.username.toLowerCase()
    );
    updatedCreds.unshift({
      userId: currentUser.id,
      username: currentUser.username.toLowerCase(),
      email: currentUser.email?.toLowerCase(),
      salt: newSalt,
      hash: newHash,
      createdAt: existingCred?.createdAt || Date.now(),
    });
    saveLocalCredentials(updatedCreds);
    setCredentialsVersion((v) => v + 1);
    showToast('Senha de acesso atualizada com sucesso');
    return { ok: true };
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
    if (!requireAuthForAction()) return;
    const updatedUser: UserProfile = { ...currentUser, ...updates };
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === prev.currentUserId ? updatedUser : u
      ),
    }));
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void upsertOwnProfileInCloud(updatedUser, auth.currentUser).catch(() => {});
    }
    showToast('Perfil atualizado');
  };

  const toggleFollow = (targetUserId: string) => {
    if (!requireAuthForAction()) return;
    if (targetUserId === currentUser.id) return;
    const isFollowing = currentUser.following.includes(targetUserId);
    const targetUser = state.users.find((u) => u.id === targetUserId);
    const nextMeFollowing = isFollowing
      ? currentUser.following.filter((id) => id !== targetUserId)
      : [...currentUser.following, targetUserId];
    const nextTargetFollowers = targetUser
      ? isFollowing
        ? targetUser.followers.filter((id) => id !== currentUser.id)
        : [...targetUser.followers, currentUser.id]
      : [];

    setState((prev) => {
      const me = prev.users.find((u) => u.id === prev.currentUserId);
      if (!me) return prev;

      const updatedUsers = prev.users.map((u) => {
        if (u.id === prev.currentUserId) {
          return { ...u, following: nextMeFollowing };
        }
        if (u.id === targetUserId) {
          return { ...u, followers: nextTargetFollowers };
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

    if (auth.currentUser && auth.currentUser.emailVerified) {
      void upsertOwnProfileInCloud({ ...currentUser, following: nextMeFollowing }, auth.currentUser).catch(() => {});
      if (targetUser) {
        void updateProfileFollowersInCloud(targetUser.id, nextTargetFollowers).catch(() => {});
      }
    }
  };

  const toggleLikePost = (postId: string) => {
    if (!requireAuthForAction()) return;
    const targetPost = state.posts.find((p) => p.id === postId);
    const alreadyLiked = targetPost?.likes.includes(currentUser.id);
    const nextLikes = targetPost
      ? alreadyLiked
        ? targetPost.likes.filter((id) => id !== currentUser.id)
        : [...targetPost.likes, currentUser.id]
      : [];

    setState((prev) => {
      const posts = prev.posts.map((p) =>
        p.id === postId ? { ...p, likes: nextLikes } : p
      );

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

    if (targetPost && auth.currentUser && auth.currentUser.emailVerified) {
      void updatePostInteractionInCloud({ ...targetPost, likes: nextLikes }).catch(() => {});
    }
  };

  const toggleSavePost = (postId: string) => {
    if (!requireAuthForAction()) return;
    const targetPost = state.posts.find((p) => p.id === postId);
    const saved = targetPost?.savedBy.includes(currentUser.id);
    const nextSavedBy = targetPost
      ? saved
        ? targetPost.savedBy.filter((id) => id !== currentUser.id)
        : [...targetPost.savedBy, currentUser.id]
      : [];

    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) =>
        p.id === postId ? { ...p, savedBy: nextSavedBy } : p
      ),
    }));

    if (targetPost && auth.currentUser && auth.currentUser.emailVerified) {
      void updatePostInteractionInCloud({ ...targetPost, savedBy: nextSavedBy }).catch(() => {});
    }
  };

  const addComment = (postId: string, text: string, parentCommentId?: string) => {
    if (!requireAuthForAction()) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const targetPost = state.posts.find((p) => p.id === postId);
    const nextComments = targetPost
      ? parentCommentId
        ? targetPost.comments.map((c) =>
            c.id === parentCommentId
              ? {
                  ...c,
                  replies: [
                    ...c.replies,
                    {
                      id: `rep_${Date.now()}`,
                      userId: currentUser.id,
                      text: trimmed,
                      createdAt: Date.now(),
                      likes: [],
                    },
                  ],
                }
              : c
          )
        : [
            ...targetPost.comments,
            {
              id: `com_${Date.now()}`,
              userId: currentUser.id,
              text: trimmed,
              createdAt: Date.now(),
              likes: [],
              replies: [],
            },
          ]
      : [];

    setState((prev) => {
      const posts = prev.posts.map((p) =>
        p.id === postId ? { ...p, comments: nextComments } : p
      );

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

    if (targetPost && auth.currentUser && auth.currentUser.emailVerified) {
      void updatePostInteractionInCloud({ ...targetPost, comments: nextComments }).catch(() => {});
    }
  };

  const toggleLikeComment = (postId: string, commentId: string) => {
    if (!requireAuthForAction()) return;
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
    if (!requireAuthForAction()) return;
    setState((prev) => ({
      ...prev,
      posts: prev.posts.filter((p) => p.id !== postId),
    }));
    if (selectedPostId === postId) setSelectedPostId(null);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void deletePostInCloud(postId).catch(() => {});
    }
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
    if (!requireAuthForAction()) return;
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
      authorUid: auth.currentUser?.uid,
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
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void createPostInCloud(newPost, currentUser, auth.currentUser).catch(() => {});
    }
    setActiveNav(payload.isReel ? 'reels' : 'feed');
    showToast(payload.isReel ? 'Reel publicado no feed' : 'Publicação compartilhada');
  };

  const publishStory = (payload: { mediaUrl: string; caption?: string; location?: string }) => {
    if (!requireAuthForAction()) return;
    const newStory: StoryItem = {
      id: `story_${Date.now()}`,
      authorId: currentUser.id,
      authorUid: auth.currentUser?.uid,
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
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void createStoryInCloud(newStory, currentUser, auth.currentUser).catch(() => {});
    }
    setActiveNav('feed');
    showToast('Story publicado por 24 horas');
  };

  const markStoryViewed = (storyId: string) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story || story.viewedBy.includes(currentUser.id)) return;
    const nextViewed = [...story.viewedBy, currentUser.id];
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId ? { ...s, viewedBy: nextViewed } : s
      ),
    }));
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void updateStoryInteractionInCloud({ ...story, viewedBy: nextViewed }).catch(() => {});
    }
  };

  const reactToStory = (storyId: string, emoji: string) => {
    if (!requireAuthForAction()) return;
    const story = state.stories.find((s) => s.id === storyId);
    const nextReactions = story
      ? [...story.reactions, { userId: currentUser.id, emoji }]
      : [];
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId ? { ...s, reactions: nextReactions } : s
      ),
    }));
    if (story && auth.currentUser && auth.currentUser.emailVerified) {
      void updateStoryInteractionInCloud({ ...story, reactions: nextReactions }).catch(() => {});
    }
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
    if (!requireAuthForAction()) return;
    const trimmed = text.trim();
    if (!trimmed && !options?.sharedPostId && !options?.audioUrl && !options?.videoUrl) {
      return;
    }

    const msgId = `dm_${Date.now()}`;
    const fallbackLabel = options?.audioUrl
      ? 'Mensagem de voz'
      : options?.videoUrl
      ? 'Vídeo'
      : options?.sharedPostId
      ? 'Compartilhou uma publicação'
      : '';

    const newMsg = {
      id: msgId,
      senderId: currentUser.id,
      text: trimmed || fallbackLabel,
      sharedPostId: options?.sharedPostId,
      storyReplyUrl: options?.storyReplyUrl,
      audioUrl: options?.audioUrl,
      audioDurationSec: options?.audioDurationSec,
      videoUrl: options?.videoUrl,
      videoName: options?.videoName,
      createdAt: Date.now(),
    };

    const existingThread = state.threads.find(
      (t) =>
        t.participantIds.includes(currentUser.id) &&
        t.participantIds.includes(recipientId)
    );

    const updatedThread: DirectThread = existingThread
      ? {
          ...existingThread,
          messages: [...existingThread.messages, newMsg],
          unreadBy: [recipientId],
          updatedAt: Date.now(),
        }
      : {
          id: `thread_${Date.now()}`,
          participantIds: [currentUser.id, recipientId],
          messages: [newMsg],
          unreadBy: [recipientId],
          updatedAt: Date.now(),
        };

    setState((prev) => {
      const newNotif: NotificationItem = {
        id: `notif_${Date.now()}`,
        recipientId,
        actorId: prev.currentUserId,
        type: 'mention',
        text: trimmed || fallbackLabel,
        createdAt: Date.now(),
        read: false,
      };

      const threadsList = existingThread
        ? prev.threads
            .map((t) => (t.id === existingThread.id ? updatedThread : t))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [updatedThread, ...prev.threads];

      return {
        ...prev,
        threads: threadsList,
        notifications:
          recipientId !== prev.currentUserId
            ? [newNotif, ...prev.notifications]
            : prev.notifications,
      };
    });

    if (auth.currentUser && auth.currentUser.emailVerified) {
      const recipientUser = state.users.find((u) => u.id === recipientId);
      const participantUids = [auth.currentUser.uid, recipientUser?.uid || ''].filter(Boolean);
      void upsertThreadInCloud(updatedThread, participantUids, auth.currentUser).catch(() => {});
    }
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
      isAuthenticated: true,
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
    const target = state.users.find((u) => u.id === userId);
    const nextVal = !target?.restricted;
    if (target) {
      showToast(
        nextVal
          ? `@${target.username} foi restringido`
          : `Restrição removida de @${target.username}`
      );
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void adminUpdateProfileFlagsInCloud({ ...target, restricted: nextVal }, auth.currentUser).catch(() => {});
      }
    }
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === userId ? { ...u, restricted: nextVal } : u
      ),
    }));
  };

  const toggleBoostUser = (userId: string) => {
    const target = state.users.find((u) => u.id === userId);
    const nextVal = !target?.boosted;
    if (target) {
      showToast(
        nextVal
          ? `Perfil @${target.username} impulsionado no feed`
          : `Impulsionamento desativado para @${target.username}`
      );
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void adminUpdateProfileFlagsInCloud({ ...target, boosted: nextVal }, auth.currentUser).catch(() => {});
      }
    }
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === userId ? { ...u, boosted: nextVal } : u
      ),
    }));
  };

  const toggleVerifyUser = (userId: string) => {
    const target = state.users.find((u) => u.id === userId);
    const nextVal = !target?.verified;
    if (target) {
      showToast(
        nextVal
          ? `Selo de verificação concedido a @${target.username}`
          : `Selo de verificação removido de @${target.username}`
      );
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void adminUpdateProfileFlagsInCloud({ ...target, verified: nextVal }, auth.currentUser).catch(() => {});
      }
    }
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === userId ? { ...u, verified: nextVal } : u
      ),
    }));
  };

  const handleSetSiteMeta = (nextMeta: SiteMeta) => {
    setSiteMeta(nextMeta);
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void syncSiteMetaToCloud(nextMeta, auth.currentUser).catch(() => {});
    }
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
        inviteModalMode,
        openAuthModal,
        isAuthenticated,
        guestBrowsing,
        setGuestBrowsing,
        firebaseUser,
        cloudConnected,
        loginWithGoogle,
        logout,
        hasPasswordForCurrentUser,
        hasPasswordForUser,
        changePassword,
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
