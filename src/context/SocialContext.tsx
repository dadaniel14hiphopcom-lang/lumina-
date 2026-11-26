import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  ADMIN_EMAIL,
  auth,
  FIREBASE_PROJECT_ID,
  googleProvider,
  isExclusiveAdminUser,
} from '../lib/firebase';
import { verifyStaticAdminPasscode } from '../utils/staticAdminAuth';
import {
  type BrowserSupabaseConfig,
  canonicalThreadIdForPair,
  clearBrowserSupabaseSession,
  deletePostFromSupabaseBrowser,
  fetchDirectThreadsForUserFromSupabaseBrowser,
  fetchPublicPostsFromSupabaseBrowser,
  fetchPublicStoriesFromSupabaseBrowser,
  fetchPublicUserByUsernameFromSupabaseBrowser,
  fetchPublicUsersFromSupabaseBrowser,
  getBrowserSupabaseConfig,
  loginSupabaseFromBrowser,
  markThreadMessagesReadInSupabaseBrowser,
  reactToDirectMessageInSupabaseBrowser,
  setRuntimePublicSupabaseConfig,
  signupRealUserInSupabaseFromBrowser,
  syncUsersToSupabaseFromBrowser,
  updateUserFlagsInSupabaseBrowser,
  updateUserProfileInSupabaseBrowser,
  upsertDirectMessageToSupabaseBrowser,
  upsertPostToSupabaseBrowser,
  upsertStoryToSupabaseBrowser,
} from '../lib/supabaseClient';
import {
  adminUpdateProfileFlagsInCloud,
  createInviteInCloud,
  createNotificationInCloud,
  createPostInCloud,
  createStoryInCloud,
  deletePostInCloud,
  ensureAdminDocIfMatched,
  fetchAllProfilesFromCloud,
  fetchProfileByUsernameFromCloud,
  fetchUserProfileAndMediaFromCloud,
  markNotificationsReadInCloud,
  migrateDemoDataToCloud,
  sendCallSignalInCloud,
  subscribeToCallSignalsInCloud,
  subscribeToCloudState,
  syncSiteMetaToCloud,
  updatePostInteractionInCloud,
  updateProfileFollowersInCloud,
  updateStoryInteractionInCloud,
  updateUserPresenceInCloud,
  upsertOwnProfileInCloud,
  upsertThreadInCloud,
} from '../lib/firestoreSync';
import {
  lookupCachedProfileInstant,
  readAllCachedProfilesIDB,
  readCachedProfilesSync,
  upsertCachedProfiles,
} from '../lib/userProfileCache';
import {
  connectRealtimeSocket,
  createCallPeerConnection,
  type RealtimeSocketHandle,
  startCallRingtone,
  stopCallRingtone,
} from '../lib/realtimeCalls';
import {
  ActiveCallSession,
  CallSignalPayload,
  CallType,
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
const ADMIN_USER_FLAGS_KEY = 'lumina_admin_user_flags_v1';
const THREAD_READ_WATERMARK_KEY = 'lumina_thread_read_v1';
const NOTIF_READ_IDS_KEY = 'lumina_notif_read_ids_v1';
const CHAT_PREFS_KEY = 'lumina_chat_prefs_v1';
const REALTIME_CHANNEL = 'lumina_realtime_sync_v1';
const PRESENCE_STALE_MS = 120_000;

export function isUserEffectivelyOnline(
  user?: Partial<UserProfile> | null,
  currentUserId?: string
): boolean {
  if (!user || user.restricted) return false;
  if (currentUserId && user.id === currentUserId) return true;
  if (user.isOnline !== true) return false;
  if (typeof user.lastActiveAtMs === 'number' && user.lastActiveAtMs > 0) {
    return Date.now() - user.lastActiveAtMs <= PRESENCE_STALE_MS;
  }
  return true;
}

interface ChatPrefsStore {
  blockedByUser: Record<string, string[]>;
  mutedByUser: Record<string, string[]>;
  pinnedByUser: Record<string, string[]>;
}

function loadChatPrefs(): ChatPrefsStore {
  try {
    const raw = localStorage.getItem(CHAT_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChatPrefsStore>;
      if (parsed && typeof parsed === 'object') {
        return {
          blockedByUser:
            parsed.blockedByUser && typeof parsed.blockedByUser === 'object'
              ? parsed.blockedByUser
              : {},
          mutedByUser:
            parsed.mutedByUser && typeof parsed.mutedByUser === 'object'
              ? parsed.mutedByUser
              : {},
          pinnedByUser:
            parsed.pinnedByUser && typeof parsed.pinnedByUser === 'object'
              ? parsed.pinnedByUser
              : {},
        };
      }
    }
  } catch {
    // Ignore storage read error
  }
  return { blockedByUser: {}, mutedByUser: {}, pinnedByUser: {} };
}

function saveChatPrefs(prefs: ChatPrefsStore): void {
  try {
    localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota error
  }
}

function loadThreadReadWatermarks(): Record<string, number> {
  try {
    const raw = localStorage.getItem(THREAD_READ_WATERMARK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, number>;
      }
    }
  } catch {
    // Ignore storage read error
  }
  return {};
}

function saveThreadReadWatermarks(map: Record<string, number>): void {
  try {
    localStorage.setItem(THREAD_READ_WATERMARK_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota error
  }
}

function loadReadNotifIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIF_READ_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v): v is string => typeof v === 'string').slice(-400));
      }
    }
  } catch {
    // Ignore storage read error
  }
  return new Set();
}

function saveReadNotifIds(ids: Set<string>): void {
  try {
    localStorage.setItem(NOTIF_READ_IDS_KEY, JSON.stringify(Array.from(ids).slice(-400)));
  } catch {
    // Ignore storage quota error
  }
}

function mergeNotificationsSmart(
  localList: NotificationItem[],
  remoteList: NotificationItem[],
  readIds: Set<string>
): NotificationItem[] {
  const map = new Map<string, NotificationItem>();
  for (const item of localList) {
    if (!item?.id) continue;
    map.set(item.id, readIds.has(item.id) && !item.read ? { ...item, read: true } : item);
  }
  for (const item of remoteList) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    const isRead = Boolean(prev?.read || item.read || readIds.has(item.id));
    map.set(item.id, prev ? { ...prev, ...item, read: isRead } : { ...item, read: isRead });
  }
  return Array.from(map.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 250);
}

function extractMentionedUsers(
  text: string,
  users: UserProfile[],
  excludeIds: string[]
): UserProfile[] {
  if (!text) return [];
  const matches = text.match(/(?:^|[\s(])@([a-z0-9._]{2,32})/gi);
  if (!matches) return [];
  const excluded = new Set(excludeIds.filter(Boolean));
  const seenIds = new Set<string>();
  const mentioned: UserProfile[] = [];
  for (const raw of matches) {
    const handle = raw.replace(/^[\s(]*@/, '').trim().toLowerCase();
    if (!handle) continue;
    const candidates = users.filter((u) => u.username.trim().toLowerCase() === handle);
    const target = candidates.find((u) => !u.isDemoSeed) || candidates[0];
    if (!target) continue;
    if (excluded.has(target.id) || (target.uid && excluded.has(target.uid))) continue;
    if (seenIds.has(target.id)) continue;
    seenIds.add(target.id);
    mentioned.push(target);
  }
  return mentioned;
}

interface AdminUserFlagOverride {
  id?: string;
  username?: string;
  verified?: boolean;
  boosted?: boolean;
  restricted?: boolean;
  updatedAt: number;
  expiresAt?: number;
}

type AdminUserFlagOverrideMap = Record<string, AdminUserFlagOverride>;

function loadLocalAdminUserFlags(): AdminUserFlagOverrideMap {
  try {
    const raw = localStorage.getItem(ADMIN_USER_FLAGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as AdminUserFlagOverrideMap;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return {};
}

function saveLocalAdminUserFlags(flags: AdminUserFlagOverrideMap): void {
  try {
    localStorage.setItem(ADMIN_USER_FLAGS_KEY, JSON.stringify(flags));
  } catch {
    // Ignore storage write errors
  }
}

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
  const cachedRealUsers = readCachedProfilesSync();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.posts)) {
        const mappedUsers = parsed.users.map((u) => {
          const seedMatch = SEED_USERS.find((s) => s.id === u.id);
          return {
            ...u,
            isOnline: u.isOnline !== undefined ? u.isOnline : seedMatch?.isOnline ?? false,
            coverUrl: u.coverUrl || seedMatch?.coverUrl,
            isDemoSeed: seedMatch
              ? seedMatch.isDemoSeed
              : u.isDemoSeed !== undefined
              ? u.isDemoSeed
              : false,
          };
        });
        const mergedUsers =
          cachedRealUsers.length > 0
            ? mergeUsersSmart(mappedUsers, cachedRealUsers)
            : mappedUsers;
        const current = mergedUsers.find((u) => u.id === parsed.currentUserId);
        const canRestoreAuth =
          parsed.isAuthenticated === true && Boolean(current && !current.isDemoSeed);
        return {
          ...parsed,
          isAuthenticated: canRestoreAuth,
          users: mergedUsers,
        };
      }
    }
  } catch {
    // Fallback to seed + persistent real user cache
  }
  return {
    currentUserId: 'user_daniel',
    isAuthenticated: false,
    users:
      cachedRealUsers.length > 0
        ? mergeUsersSmart(SEED_USERS, cachedRealUsers)
        : SEED_USERS,
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
  pendingProfileSlug: string | null;
  setPendingProfileSlug: (slug: string | null) => void;
  profileLookupLoading: boolean;
  profileMediaLoading: boolean;
  exploreQuery: string;
  selectedPostId: string | null;
  activeStoryAuthorId: string | null;
  isCreateOpen: boolean;
  sharePostId: string | null;
  toastMessage: string | null;
  siteMeta: SiteMeta;
  setSiteMeta: (meta: SiteMeta) => void;
  refreshSiteMeta: () => Promise<void>;
  refreshPublicUsersFromSupabase: () => Promise<UserProfile[]>;
  mergeExternalUsers: (incoming: UserProfile[]) => void;
  demoMigrationStatus: {
    running: boolean;
    lastResult: {
      profilesMigrated: number;
      postsMigrated: number;
      storiesMigrated: number;
      skipped: number;
    } | null;
    error: string | null;
  };
  migrateDemoToFirestore: () => Promise<{
    profilesMigrated: number;
    postsMigrated: number;
    storiesMigrated: number;
    skipped: number;
  }>;

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
  adminMemoryToken: string | null;
  setAdminMemoryToken: React.Dispatch<React.SetStateAction<string | null>>;
  activateAdminProfileSession: (token: string) => void;
  loginWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogleRedirect: (target?: 'feed' | 'admin') => Promise<{ ok: boolean; error?: string }>;
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
  registerRealUser: (payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    bio: string;
    inviteCode?: string;
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
      fileUrl?: string;
      fileName?: string;
      fileMime?: string;
      fileSize?: number;
      replyToId?: string;
      replyToSenderId?: string;
      replyToText?: string;
      isCallLog?: boolean;
      callType?: CallType;
      callStatus?: 'completed' | 'missed' | 'rejected';
      callDurationSec?: number;
    }
  ) => void;
  markThreadRead: (threadId: string) => void;
  reactToMessage: (threadId: string, messageId: string, emoji: string) => void;
  typingByUserId: Record<string, number>;
  setTypingStatus: (recipientId: string, isTyping: boolean, threadId?: string) => void;

  // Chat advanced options & blocking
  blockedUserIds: string[];
  mutedThreadIds: string[];
  pinnedThreadIds: string[];
  isUserBlocked: (userId: string) => boolean;
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  toggleMuteThread: (threadId: string) => void;
  togglePinThread: (threadId: string) => void;
  clearThreadMessages: (threadId: string) => void;
  deleteThread: (threadId: string) => void;

  // Real-time WebRTC audio & video calls
  activeCall: ActiveCallSession | null;
  localCallStream: MediaStream | null;
  remoteCallStream: MediaStream | null;
  isCallMicMuted: boolean;
  isCallCameraOff: boolean;
  callFacingMode: 'user' | 'environment';
  startCall: (peerId: string, callType: CallType) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  endActiveCall: (reasonStatus?: 'completed' | 'missed' | 'rejected') => void;
  toggleCallMic: () => void;
  toggleCallCamera: () => Promise<void>;
  switchCallCamera: () => Promise<void>;
  toggleMinimizeCall: () => void;

  markNotificationsRead: () => void;
  addRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;
  resetDemoData: () => void;

  toggleRestrictUser: (userId: string, tokenOverride?: string | null) => void;
  toggleBoostUser: (userId: string, tokenOverride?: string | null) => void;
  toggleVerifyUser: (userId: string, tokenOverride?: string | null) => void;

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

function extractInitialProfileParam(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const rawQuery =
    params.get('perfil') ||
    params.get('profile') ||
    params.get('u') ||
    params.get('user') ||
    '';
  const cleanQuery = rawQuery.trim().replace(/^@/, '').toLowerCase();
  if (cleanQuery.length >= 2) return cleanQuery.slice(0, 64);

  const pathMatch = window.location.pathname.match(/^\/(?:@|perfil\/)([a-zA-Z0-9._]{2,40})\/?$/i);
  return pathMatch ? pathMatch[1].toLowerCase() : null;
}

function resolveFlagOverrideForUser(
  user: { id?: string; uid?: string; username?: string },
  flagOverrides?: AdminUserFlagOverrideMap
): AdminUserFlagOverride | undefined {
  if (!flagOverrides) return undefined;
  const id = typeof user.id === 'string' ? user.id : '';
  const uid = typeof user.uid === 'string' ? user.uid : '';
  const handle =
    typeof user.username === 'string' ? user.username.trim().toLowerCase().replace(/^@/, '') : '';
  const candidate =
    (id && flagOverrides[id]) ||
    (uid && flagOverrides[uid]) ||
    (handle && flagOverrides[`handle:${handle}`]) ||
    undefined;
  if (!candidate) return undefined;
  if (typeof candidate.expiresAt === 'number' && candidate.expiresAt < Date.now()) {
    return undefined;
  }
  return candidate;
}

function mergeUsersSmart(
  localList: UserProfile[],
  remoteList: UserProfile[],
  flagOverrides?: AdminUserFlagOverrideMap
): UserProfile[] {
  const result: UserProfile[] = localList.map((u) => {
    const ov = resolveFlagOverrideForUser(u, flagOverrides);
    return {
      ...u,
      avatarUrl: u.avatarUrl || '/og-preview.jpg',
      followers: Array.isArray(u.followers) ? u.followers : [],
      following: Array.isArray(u.following) ? u.following : [],
      ...(ov && typeof ov.verified === 'boolean' ? { verified: ov.verified } : {}),
      ...(ov && typeof ov.boosted === 'boolean' ? { boosted: ov.boosted } : {}),
      ...(ov && typeof ov.restricted === 'boolean' ? { restricted: ov.restricted } : {}),
    };
  });

  for (const rawRemote of remoteList) {
    if (!rawRemote || !rawRemote.id || !rawRemote.username) continue;
    const remote: UserProfile = {
      ...rawRemote,
      avatarUrl: rawRemote.avatarUrl || '/og-preview.jpg',
      followers: Array.isArray(rawRemote.followers) ? rawRemote.followers : [],
      following: Array.isArray(rawRemote.following) ? rawRemote.following : [],
    };
    const rUsername = remote.username.trim().toLowerCase();
    const matchIdx = result.findIndex(
      (u) =>
        u.id === remote.id ||
        (remote.uid && (u.uid === remote.uid || u.id === remote.uid)) ||
        (!remote.isDemoSeed &&
          !u.isDemoSeed &&
          u.username.trim().toLowerCase() === rUsername)
    );
    if (matchIdx === -1) {
      const ov = resolveFlagOverrideForUser(remote, flagOverrides);
      result.push(
        ov
          ? {
              ...remote,
              ...(typeof ov.verified === 'boolean' ? { verified: ov.verified } : {}),
              ...(typeof ov.boosted === 'boolean' ? { boosted: ov.boosted } : {}),
              ...(typeof ov.restricted === 'boolean' ? { restricted: ov.restricted } : {}),
            }
          : remote
      );
    } else {
      const existing = result[matchIdx];
      const ov =
        resolveFlagOverrideForUser(existing, flagOverrides) ||
        resolveFlagOverrideForUser(remote, flagOverrides);
      const prevActive = typeof existing.lastActiveAtMs === 'number' ? existing.lastActiveAtMs : 0;
      const incActive = typeof remote.lastActiveAtMs === 'number' ? remote.lastActiveAtMs : 0;
      const mergedIsOnline =
        typeof remote.isOnline === 'boolean' &&
        (incActive >= prevActive || existing.isOnline === undefined)
          ? remote.isOnline
          : existing.isOnline;
      const mergedLastActive = Math.max(prevActive, incActive) || undefined;

      result[matchIdx] = {
        ...existing,
        ...remote,
        id: existing.id,
        uid: remote.uid || existing.uid || (remote.id !== existing.id ? remote.id : undefined),
        isOnline: mergedIsOnline,
        ...(mergedLastActive ? { lastActiveAtMs: mergedLastActive } : {}),
        ...(ov && typeof ov.verified === 'boolean' ? { verified: ov.verified } : {}),
        ...(ov && typeof ov.boosted === 'boolean' ? { boosted: ov.boosted } : {}),
        ...(ov && typeof ov.restricted === 'boolean' ? { restricted: ov.restricted } : {}),
        followers:
          remote.followers.length >= existing.followers.length
            ? remote.followers
            : existing.followers,
        following:
          remote.following.length >= existing.following.length
            ? remote.following
            : existing.following,
        avatarUrl:
          remote.avatarUrl && remote.avatarUrl !== '/og-preview.jpg'
            ? remote.avatarUrl
            : existing.avatarUrl || '/og-preview.jpg',
        coverUrl: remote.coverUrl || existing.coverUrl,
        bio: remote.bio || existing.bio,
        website: remote.website || existing.website,
        email: existing.email || remote.email,
      };
    }
  }
  return result;
}

function mergeThreadsSmart(
  localThreads: DirectThread[],
  remoteThreads: DirectThread[],
  myIds: string[] = [],
  readWatermarks: Record<string, number> = {}
): DirectThread[] {
  const myIdSet = new Set(myIds.filter(Boolean));
  const mergeMsg = (
    base: DirectThread['messages'][number] | undefined,
    inc: DirectThread['messages'][number]
  ): DirectThread['messages'][number] => {
    if (!base) return inc;
    const mergedReadBy = Array.from(
      new Set([...(base.readBy || []), ...(inc.readBy || [])])
    );
    const mergedReactions =
      base.reactions || inc.reactions
        ? { ...(base.reactions || {}), ...(inc.reactions || {}) }
        : undefined;
    const mergedSeenAt =
      typeof base.seenAt === 'number' || typeof inc.seenAt === 'number'
        ? Math.max(base.seenAt || 0, inc.seenAt || 0)
        : undefined;
    return {
      ...base,
      ...inc,
      readBy: mergedReadBy.length > 0 ? mergedReadBy : undefined,
      reactions:
        mergedReactions && Object.keys(mergedReactions).length > 0
          ? mergedReactions
          : undefined,
      seenAt: mergedSeenAt,
    };
  };

  const map = new Map<string, DirectThread>();
  for (const t of localThreads) {
    map.set(t.id, t);
  }
  for (const rt of remoteThreads) {
    const existing = map.get(rt.id);
    if (!existing) {
      const wm = readWatermarks[rt.id] || 0;
      const mergedLastRead: Record<string, number> = { ...(rt.lastReadBy || {}) };
      for (const idVal of myIdSet) {
        if (wm > 0) mergedLastRead[idVal] = Math.max(mergedLastRead[idVal] || 0, wm);
      }
      const nextUnread = (rt.unreadBy || []).filter((uid) => {
        const readTs = mergedLastRead[uid] || (myIdSet.has(uid) ? wm : 0);
        return rt.messages.some(
          (m) =>
            m.senderId !== uid &&
            !(m.readBy || []).includes(uid) &&
            m.createdAt > readTs
        );
      });
      map.set(rt.id, {
        ...rt,
        unreadBy: nextUnread,
        ...(Object.keys(mergedLastRead).length > 0 ? { lastReadBy: mergedLastRead } : {}),
      });
    } else {
      const msgMap = new Map<string, DirectThread['messages'][number]>();
      for (const m of existing.messages) msgMap.set(m.id, m);
      for (const m of rt.messages) msgMap.set(m.id, mergeMsg(msgMap.get(m.id), m));
      const mergedMessages = Array.from(msgMap.values()).sort(
        (a, b) => a.createdAt - b.createdAt
      );

      const wm = readWatermarks[rt.id] || 0;
      const mergedLastRead: Record<string, number> = {
        ...(existing.lastReadBy || {}),
        ...(rt.lastReadBy || {}),
      };
      for (const [k, v] of Object.entries(existing.lastReadBy || {})) {
        mergedLastRead[k] = Math.max(mergedLastRead[k] || 0, v || 0);
      }
      for (const idVal of myIdSet) {
        if (wm > 0) mergedLastRead[idVal] = Math.max(mergedLastRead[idVal] || 0, wm);
      }

      const candidateUnread = Array.from(
        new Set([...(existing.unreadBy || []), ...(rt.unreadBy || [])])
      );
      const filteredUnread = candidateUnread.filter((uid) => {
        const readTs = mergedLastRead[uid] || (myIdSet.has(uid) ? wm : 0);
        const matchIds = myIdSet.has(uid) ? myIdSet : new Set([uid]);
        return mergedMessages.some((m) => {
          if (matchIds.has(m.senderId)) return false;
          const isReadInMsg = (m.readBy || []).some((rId) => matchIds.has(rId));
          if (isReadInMsg) return false;
          return m.createdAt > readTs;
        });
      });

      map.set(rt.id, {
        ...existing,
        ...rt,
        participantIds: Array.from(new Set([...existing.participantIds, ...rt.participantIds])),
        messages: mergedMessages,
        unreadBy: filteredUnread,
        ...(Object.keys(mergedLastRead).length > 0 ? { lastReadBy: mergedLastRead } : {}),
        updatedAt: Math.max(existing.updatedAt, rt.updatedAt),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadInitialState);
  const [invites, setInvites] = useState<InviteRecord[]>(loadInitialInvites);
  const [pendingProfileSlug, setPendingProfileSlug] = useState<string | null>(() =>
    extractInitialProfileParam()
  );
  const [profileLookupLoading, setProfileLookupLoading] = useState(false);
  const [profileMediaLoading, setProfileMediaLoading] = useState(false);
  const [demoMigrationStatus, setDemoMigrationStatus] = useState<{
    running: boolean;
    lastResult: {
      profilesMigrated: number;
      postsMigrated: number;
      storiesMigrated: number;
      skipped: number;
    } | null;
    error: string | null;
  }>({ running: false, lastResult: null, error: null });
  const [activeNav, setActiveNav] = useState<NavSection>(() =>
    extractInitialProfileParam() ? 'profile' : 'feed'
  );
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const fromQuery = new URLSearchParams(window.location.search).get('post')?.trim();
    if (fromQuery) return fromQuery;
    const pathMatch = window.location.pathname.match(/^\/(?:p|post)\/([a-zA-Z0-9_-]{1,128})\/?$/);
    return pathMatch ? pathMatch[1] : null;
  });
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
  const [guestBrowsing, setGuestBrowsing] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const hasInitialProfile = Boolean(extractInitialProfileParam());
    const params = new URLSearchParams(window.location.search);
    const hasInitialPost =
      Boolean(params.get('post')?.trim()) ||
      /^\/(?:p|post)\/([a-zA-Z0-9_-]{1,128})\/?$/.test(window.location.pathname);
    return Boolean(hasInitialProfile || hasInitialPost);
  });
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [adminMemoryToken, setAdminMemoryToken] = useState<string | null>(null);
  const [serverSyncAvailable, setServerSyncAvailable] = useState(false);
  const [siteMetaReady, setSiteMetaReady] = useState(false);
  const [runtimeConfigVersion, setRuntimeConfigVersion] = useState(0);

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
  const serverAdminFlagsRef = useRef<AdminUserFlagOverrideMap>({});
  const pendingAdminFlagsRef = useRef<AdminUserFlagOverrideMap>({});
  const threadReadWatermarkRef = useRef<Record<string, number>>(loadThreadReadWatermarks());
  const readNotifIdsRef = useRef<Set<string>>(loadReadNotifIds());
  const [typingByUserId, setTypingByUserId] = useState<Record<string, number>>({});
  const lastTypingEmitRef = useRef<Record<string, number>>({});
  const [chatPrefs, setChatPrefs] = useState<ChatPrefsStore>(loadChatPrefs);
  const chatPrefsRef = useRef(chatPrefs);
  chatPrefsRef.current = chatPrefs;

  // WebSocket + WebRTC Call refs & states
  const wsHandleRef = useRef<RealtimeSocketHandle | null>(null);
  const wsConnectedRef = useRef(false);
  const pullMessagesNowRef = useRef<(() => Promise<void>) | null>(null);
  const pullServerStateNowRef = useRef<(() => Promise<void>) | null>(null);
  const handleCallSignalRef = useRef<((sig: CallSignalPayload) => void) | null>(null);
  const seenCallSignalsRef = useRef<Set<string>>(new Set());
  const demoMigrationAttemptedUidRef = useRef<string | null>(null);

  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const activeCallRef = useRef<ActiveCallSession | null>(null);
  activeCallRef.current = activeCall;
  const [localCallStream, setLocalCallStream] = useState<MediaStream | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  localCallStreamRef.current = localCallStream;
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream | null>(null);
  const [isCallMicMuted, setIsCallMicMuted] = useState(false);
  const [isCallCameraOff, setIsCallCameraOff] = useState(false);
  const [callFacingMode, setCallFacingMode] = useState<'user' | 'environment'>('user');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIncomingOfferRef = useRef<CallSignalPayload | null>(null);
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callRingTimeoutRef = useRef<number | null>(null);

  const currentUserIdRef = useRef(state.currentUserId);
  currentUserIdRef.current = state.currentUserId;

  const getActiveAdminFlagOverrides = (): AdminUserFlagOverrideMap => {
    const now = Date.now();
    const combined: AdminUserFlagOverrideMap = {};
    const mergeSource = (src: AdminUserFlagOverrideMap, allowExpiredCheck = false) => {
      for (const [key, entry] of Object.entries(src)) {
        if (!entry) continue;
        if (allowExpiredCheck && typeof entry.expiresAt === 'number' && entry.expiresAt < now) {
          delete pendingAdminFlagsRef.current[key];
          continue;
        }
        const prev = combined[key];
        const prevTs = typeof prev?.updatedAt === 'number' ? prev.updatedAt : 0;
        const nextTs = typeof entry.updatedAt === 'number' ? entry.updatedAt : 0;
        if (!prev || nextTs >= prevTs) {
          combined[key] = { ...prev, ...entry };
        }
      }
    };
    mergeSource(loadLocalAdminUserFlags());
    mergeSource(serverAdminFlagsRef.current);
    mergeSource(pendingAdminFlagsRef.current, true);
    return combined;
  };

  const refreshSiteMeta = async () => {
    try {
      const res = await fetch('/api/site/meta');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as Partial<SiteMeta> & {
          supabase?: Partial<BrowserSupabaseConfig>;
        };
        if (data?.supabase) {
          setRuntimePublicSupabaseConfig(data.supabase);
        }
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
    } finally {
      try {
        const raw = localStorage.getItem('lumina_admin_local_state_v1');
        if (raw) {
          const parsed = JSON.parse(raw) as {
            site?: Partial<SiteMeta>;
            supabase?: Partial<BrowserSupabaseConfig>;
          };
          if (parsed?.supabase) {
            setRuntimePublicSupabaseConfig(parsed.supabase);
          }
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
      setSiteMetaReady(true);
      setRuntimeConfigVersion((v) => v + 1);
    }
  };

  useEffect(() => {
    void refreshSiteMeta();
    const timer = window.setInterval(() => {
      void refreshSiteMeta();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Hydrate full persistent IndexedDB profile cache into memory on mount
  useEffect(() => {
    let active = true;
    void readAllCachedProfilesIDB()
      .then((cachedProfiles) => {
        if (!active || cachedProfiles.length === 0) return;
        const activeFlags = getActiveAdminFlagOverrides();
        skipNextServerPushRef.current = true;
        skipNextStateBroadcastRef.current = true;
        setState((prev) => ({
          ...prev,
          users: mergeUsersSmart(prev.users, cachedProfiles, activeFlags),
        }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Keep client-side canonical URL and OpenGraph preview metadata synchronized
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const baseUrl = `${window.location.origin}/`;
    const activePost = selectedPostId
      ? state.posts.find((p) => p.id === selectedPostId)
      : undefined;
    const activeAuthor = activePost
      ? state.users.find((u) => u.id === activePost.authorId)
      : undefined;
    const activeProfileUser =
      !activePost && activeNav === 'profile'
        ? state.users.find((u) => u.id === viewingProfileId) ||
          (pendingProfileSlug
            ? state.users.find(
                (u) => u.username.toLowerCase() === pendingProfileSlug.toLowerCase()
              )
            : undefined)
        : undefined;

    const activeProfileSlug =
      !activePost && activeNav === 'profile'
        ? activeProfileUser?.username || pendingProfileSlug || ''
        : '';

    const nextUrl = activePost
      ? `${baseUrl}?post=${encodeURIComponent(activePost.id)}`
      : activeProfileSlug
      ? `${baseUrl}?perfil=${encodeURIComponent(activeProfileSlug)}`
      : baseUrl;
    const nextTitle = activePost
      ? `${activePost.isReel ? 'Reel' : 'Publicação'} de @${activeAuthor?.username || 'lumina'} na Lumina`
      : activeProfileUser
      ? `${activeProfileUser.displayName} (@${activeProfileUser.username}) na Lumina`
      : activeProfileSlug
      ? `@${activeProfileSlug} na Lumina`
      : 'Lumina — Rede Social Visual';
    const nextDesc = activePost
      ? activePost.caption?.trim().slice(0, 155) ||
        'Rede social visual com feed em tempo real, stories interativos, reels em vídeo, estúdio de filtros e mensagens diretas na Lumina.'
      : activeProfileUser
      ? activeProfileUser.bio?.trim().slice(0, 155) ||
        `Veja o perfil e as publicações de @${activeProfileUser.username} na Lumina.`
      : 'Rede social visual com feed em tempo real, stories interativos, reels em vídeo, estúdio de filtros e mensagens diretas na Lumina.';
    const rawFirstImg = activePost
      ? activePost.media.find((m) => m.mediaType !== 'video')?.url
      : activeProfileUser?.avatarUrl;
    const nextImage =
      rawFirstImg && /^https?:\/\//i.test(rawFirstImg)
        ? rawFirstImg
        : activePost && rawFirstImg?.startsWith('data:image/') && serverSyncAvailable
        ? `${window.location.origin}/api/og/image/${encodeURIComponent(activePost.id)}.jpg`
        : `${window.location.origin}/og-preview.jpg`;

    document.title = nextTitle;
    const setMeta = (selector: string, value: string, attr = 'content') => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    setMeta('link[rel="canonical"]', nextUrl, 'href');
    setMeta('meta[property="og:url"]', nextUrl);
    setMeta('meta[property="og:title"]', nextTitle);
    setMeta('meta[property="og:description"]', nextDesc);
    setMeta('meta[property="og:image"]', nextImage);
    setMeta('meta[property="og:image:secure_url"]', nextImage);
    setMeta('meta[property="og:image:alt"]', nextTitle);
    setMeta('meta[name="twitter:title"]', nextTitle);
    setMeta('meta[name="twitter:description"]', nextDesc);
    setMeta('meta[name="twitter:image"]', nextImage);
    setMeta('meta[name="twitter:image:alt"]', nextTitle);

    if (!window.location.search.includes('invite=')) {
      const url = new URL(window.location.href);
      if (/^\/(?:p|post|@|perfil\/)/.test(url.pathname)) {
        url.pathname = '/';
      }
      if (selectedPostId) {
        url.searchParams.set('post', selectedPostId);
        url.searchParams.delete('perfil');
        url.searchParams.delete('profile');
        url.searchParams.delete('u');
        url.searchParams.delete('user');
      } else if (activeNav === 'profile' && activeProfileSlug) {
        url.searchParams.delete('post');
        url.searchParams.set('perfil', activeProfileSlug);
        url.searchParams.delete('profile');
        url.searchParams.delete('u');
        url.searchParams.delete('user');
      } else {
        url.searchParams.delete('post');
        url.searchParams.delete('perfil');
        url.searchParams.delete('profile');
        url.searchParams.delete('u');
        url.searchParams.delete('user');
      }
      const nextRelative = url.pathname + url.search + url.hash;
      if (nextRelative !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState({}, '', nextRelative);
      }
    }
  }, [selectedPostId, activeNav, viewingProfileId, pendingProfileSlug, state.posts, state.users, serverSyncAvailable]);

  // Helper to merge remote records cleanly by ID without losing local seed fallback
  const mergeRecordsById = <T extends { id: string }>(localList: T[], remoteList: T[]): T[] => {
    const map = new Map<string, T>();
    for (const item of localList) map.set(item.id, item);
    for (const item of remoteList) map.set(item.id, item);
    return Array.from(map.values());
  };

  const isAuthenticatedRef = useRef(Boolean(state.isAuthenticated));
  isAuthenticatedRef.current = Boolean(state.isAuthenticated);
  const usersRef = useRef(state.users);
  usersRef.current = state.users;

  const hydrateGoogleProfileSession = (
    fbUser: FirebaseUser,
    options?: { silent?: boolean; openAdminIfEligible?: boolean }
  ) => {
    void ensureAdminDocIfMatched(fbUser).catch(() => {});

    const isExclusiveAdmin = isExclusiveAdminUser(fbUser);
    const cleanEmail = (fbUser.email || '').trim().toLowerCase();
    const existingMatch = usersRef.current.find(
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
        verified: isExclusiveAdmin ? true : existingMatch.verified,
        isOnline: true,
        lastActiveAtMs: Date.now(),
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
          ? usersRef.current.some((u) => u.username.toLowerCase() === baseHandle)
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
        bio: isExclusiveAdmin
          ? 'Administrador exclusivo da rede Lumina.'
          : 'Perfil conectado na nuvem Lumina.',
        email: cleanEmail || undefined,
        verified: isExclusiveAdmin,
        isOnline: true,
        lastActiveAtMs: Date.now(),
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

    void upsertCachedProfiles([activeProfile]);
    setGuestBrowsing(false);
    setViewingProfileId(null);
    setIsInviteModalOpen(false);
    if (options?.openAdminIfEligible && isExclusiveAdmin) {
      setActiveNav('admin');
    }

    void (async () => {
      await upsertOwnProfileInCloud(activeProfile, fbUser).catch(() => {});
      if (isExclusiveAdmin) {
        await adminUpdateProfileFlagsInCloud(activeProfile, fbUser).catch(() => {});
      }
      let serverSynced = false;
      try {
        const idToken = await fbUser.getIdToken();
        const syncRes = await fetch('/api/supabase/sync-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            username: activeProfile.username,
            displayName: activeProfile.displayName,
            bio: activeProfile.bio,
            avatarUrl: activeProfile.avatarUrl,
            coverUrl: activeProfile.coverUrl,
          }),
        });
        if (syncRes.ok && syncRes.headers.get('content-type')?.includes('application/json')) {
          const data = (await syncRes.json()) as { synced?: boolean };
          serverSynced = Boolean(data.synced);
        }
      } catch {
        // Ignore if running on static hosting without Node backend
      }
      if (!serverSynced) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.autoSyncUsers && sbConfig.anonKey) {
          await syncUsersToSupabaseFromBrowser(sbConfig, [activeProfile]).catch(() => {});
        }
      }
    })();

    if (!options?.silent) {
      showToast(
        isExclusiveAdmin
          ? `Administrador conectado: @${activeProfile.username}`
          : `Conectado na nuvem como @${activeProfile.username}`
      );
    }
    return activeProfile;
  };

  const migrateDemoToFirestore = async (): Promise<{
    profilesMigrated: number;
    postsMigrated: number;
    storiesMigrated: number;
    skipped: number;
  }> => {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified || !isExclusiveAdminUser(fbUser)) {
      const msg = 'Entre como administrador verificado no Firebase para migrar os dados demo.';
      setDemoMigrationStatus({ running: false, lastResult: null, error: msg });
      showToast(msg);
      return { profilesMigrated: 0, postsMigrated: 0, storiesMigrated: 0, skipped: 0 };
    }
    setDemoMigrationStatus((prev) => ({ ...prev, running: true, error: null }));
    try {
      const result = await migrateDemoDataToCloud(fbUser, SEED_USERS, SEED_POSTS, SEED_STORIES);
      setDemoMigrationStatus({ running: false, lastResult: result, error: null });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao migrar usuários demo para Firestore.';
      setDemoMigrationStatus((prev) => ({ ...prev, running: false, error: msg }));
      return { profilesMigrated: 0, postsMigrated: 0, storiesMigrated: 0, skipped: 0 };
    }
  };

  // Firebase Auth & Firestore real-time cross-device sync
  useEffect(() => {
    let unsubCloud: (() => void) | null = null;
    let unsubCallSignals: (() => void) | null = null;

    getRedirectResult(auth)
      .then((result) => {
        const fbUser = result?.user;
        if (fbUser && fbUser.emailVerified) {
          let openAdmin = false;
          try {
            openAdmin = sessionStorage.getItem('lumina_google_redirect_target') === 'admin';
            sessionStorage.removeItem('lumina_google_redirect_target');
          } catch {
            // Ignore storage access errors
          }
          hydrateGoogleProfileSession(fbUser, { openAdminIfEligible: openAdmin });
        }
      })
      .catch(() => {
        try {
          sessionStorage.removeItem('lumina_google_redirect_target');
        } catch {
          // Ignore
        }
      });

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      if (unsubCloud) {
        unsubCloud();
        unsubCloud = null;
      }
      if (unsubCallSignals) {
        unsubCallSignals();
        unsubCallSignals = null;
      }
      if (!fbUser || !fbUser.emailVerified) return;

      void ensureAdminDocIfMatched(fbUser).catch(() => {});
      if (!isAuthenticatedRef.current) {
        let openAdmin = false;
        try {
          openAdmin = sessionStorage.getItem('lumina_google_redirect_target') === 'admin';
          if (openAdmin) sessionStorage.removeItem('lumina_google_redirect_target');
        } catch {
          // Ignore
        }
        hydrateGoogleProfileSession(fbUser, {
          silent: true,
          openAdminIfEligible: openAdmin,
        });
      }

      if (isExclusiveAdminUser(fbUser) && demoMigrationAttemptedUidRef.current !== fbUser.uid) {
        demoMigrationAttemptedUidRef.current = fbUser.uid;
        void migrateDemoDataToCloud(fbUser, SEED_USERS, SEED_POSTS, SEED_STORIES)
          .then((result) => {
            setDemoMigrationStatus({ running: false, lastResult: result, error: null });
          })
          .catch(() => {});
      }

      unsubCloud = subscribeToCloudState(fbUser, {
        onProfiles: (cloudProfiles) => {
          if (cloudProfiles.length === 0) return;
          void upsertCachedProfiles(cloudProfiles.filter((u) => !u.isDemoSeed));
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          const activeFlags = getActiveAdminFlagOverrides();
          setState((prev) => {
            const merged = mergeUsersSmart(prev.users, cloudProfiles, activeFlags);
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
          setState((prev) => {
            const me = prev.users.find((u) => u.id === prev.currentUserId);
            const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
            return {
              ...prev,
              threads: mergeThreadsSmart(
                prev.threads,
                cloudThreads,
                myIds,
                threadReadWatermarkRef.current
              ),
            };
          });
        },
        onNotifications: (cloudNotifs) => {
          if (cloudNotifs.length === 0) return;
          skipNextStateBroadcastRef.current = true;
          skipNextServerPushRef.current = true;
          setState((prev) => ({
            ...prev,
            notifications: mergeNotificationsSmart(
              prev.notifications,
              cloudNotifs,
              readNotifIdsRef.current
            ),
          }));
        },
        onSiteMeta: (cloudMeta) => {
          setSiteMeta(cloudMeta);
        },
      });

      unsubCallSignals = subscribeToCallSignalsInCloud(fbUser, (sig) => {
        handleCallSignalRef.current?.(sig);
      });
    });

    return () => {
      unsubAuth();
      if (unsubCloud) unsubCloud();
      if (unsubCallSignals) unsubCallSignals();
    };
  }, []);

  const mergeExternalUsers = (incoming: UserProfile[]) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    void upsertCachedProfiles(incoming.filter((u) => !u.isDemoSeed));
    skipNextServerPushRef.current = true;
    skipNextStateBroadcastRef.current = true;
    const activeFlags = getActiveAdminFlagOverrides();
    setState((prev) => ({
      ...prev,
      users: mergeUsersSmart(prev.users, incoming, activeFlags),
    }));
  };

  const refreshPublicUsersFromSupabase = async (): Promise<UserProfile[]> => {
    let collected: UserProfile[] = [];
    const activeUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
    const activeIds =
      isAuthenticatedRef.current && activeUser && !activeUser.isDemoSeed
        ? [activeUser.id, activeUser.uid || ''].filter(Boolean)
        : [];
    const qs = activeIds.length > 0 ? `?userIds=${encodeURIComponent(activeIds.join(','))}` : '';

    try {
      const res = await fetch(`/api/social/state${qs}`);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        setServerSyncAvailable(true);
        const data = (await res.json()) as {
          ok?: boolean;
          state?: {
            updatedAt?: number;
            users?: UserProfile[];
            posts?: Post[];
            stories?: StoryItem[];
            threads?: DirectThread[];
            notifications?: NotificationItem[];
            userFlagOverrides?: AdminUserFlagOverrideMap;
          } | null;
        };
        const remote = data.state;
        if (remote?.userFlagOverrides && typeof remote.userFlagOverrides === 'object') {
          serverAdminFlagsRef.current = remote.userFlagOverrides;
        }
        if (remote && Array.isArray(remote.users) && Array.isArray(remote.posts)) {
          const activeFlags = getActiveAdminFlagOverrides();
          collected = mergeUsersSmart([], remote.users, activeFlags);
          void upsertCachedProfiles(collected.filter((u) => !u.isDemoSeed));
          lastServerUpdatedAtRef.current = Math.max(
            lastServerUpdatedAtRef.current,
            remote.updatedAt || Date.now()
          );
          skipNextServerPushRef.current = true;
          skipNextStateBroadcastRef.current = true;
          setState((prev) => {
            const me = prev.users.find((u) => u.id === prev.currentUserId);
            const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
            return {
              ...prev,
              users: mergeUsersSmart(prev.users, remote.users!, activeFlags),
              posts: mergeRecordsById(prev.posts, remote.posts!).sort((a, b) => b.createdAt - a.createdAt),
              stories: Array.isArray(remote.stories)
                ? mergeRecordsById(prev.stories, remote.stories).sort((a, b) => b.createdAt - a.createdAt)
                : prev.stories,
              threads: Array.isArray(remote.threads)
                ? mergeThreadsSmart(
                    prev.threads,
                    remote.threads,
                    myIds,
                    threadReadWatermarkRef.current
                  )
                : prev.threads,
              notifications: Array.isArray(remote.notifications)
                ? mergeNotificationsSmart(
                    prev.notifications,
                    remote.notifications,
                    readNotifIdsRef.current
                  )
                : prev.notifications,
            };
          });
        }
      }
    } catch {
      // Static hosting without /api/social/state
    }

    if (isExclusiveAdminUser(auth.currentUser)) {
      try {
        const cloudProfiles = await fetchAllProfilesFromCloud(auth.currentUser);
        if (cloudProfiles.length > 0) {
          const activeFlags = getActiveAdminFlagOverrides();
          collected = mergeUsersSmart(collected, cloudProfiles, activeFlags);
          void upsertCachedProfiles(cloudProfiles.filter((u) => !u.isDemoSeed));
          skipNextServerPushRef.current = true;
          skipNextStateBroadcastRef.current = true;
          setState((prev) => ({
            ...prev,
            users: mergeUsersSmart(prev.users, cloudProfiles, activeFlags),
          }));
        }
      } catch {
        // Non-fatal: continue with Supabase/Node fetch
      }
    }

    const sbConfig = getBrowserSupabaseConfig();
    if (sbConfig.autoSyncUsers && sbConfig.anonKey) {
      const [sbUsers, sbPosts, sbStories, sbThreads] = await Promise.all([
        fetchPublicUsersFromSupabaseBrowser(sbConfig),
        fetchPublicPostsFromSupabaseBrowser(sbConfig),
        fetchPublicStoriesFromSupabaseBrowser(sbConfig),
        activeIds.length > 0
          ? fetchDirectThreadsForUserFromSupabaseBrowser(sbConfig, activeIds)
          : Promise.resolve([] as DirectThread[]),
      ]);
      if (sbUsers.length > 0 || sbPosts.length > 0 || sbStories.length > 0 || sbThreads.length > 0) {
        const activeFlags = getActiveAdminFlagOverrides();
        collected = mergeUsersSmart(collected, sbUsers, activeFlags);
        if (sbUsers.length > 0) {
          void upsertCachedProfiles(sbUsers.filter((u) => !u.isDemoSeed));
        }
        skipNextServerPushRef.current = true;
        skipNextStateBroadcastRef.current = true;
        setState((prev) => {
          const me = prev.users.find((u) => u.id === prev.currentUserId);
          const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
          return {
            ...prev,
            users: sbUsers.length > 0 ? mergeUsersSmart(prev.users, sbUsers, activeFlags) : prev.users,
            posts:
              sbPosts.length > 0
                ? mergeRecordsById(prev.posts, sbPosts).sort((a, b) => b.createdAt - a.createdAt)
                : prev.posts,
            stories:
              sbStories.length > 0
                ? mergeRecordsById(prev.stories, sbStories).sort((a, b) => b.createdAt - a.createdAt)
                : prev.stories,
            threads:
              sbThreads.length > 0
                ? mergeThreadsSmart(prev.threads, sbThreads, myIds, threadReadWatermarkRef.current)
                : prev.threads,
          };
        });
      }
    }
    return collected;
  };

  // Resolve shared profile links (?perfil=username or /@username) across instant cache, server, Supabase, and Firestore
  useEffect(() => {
    if (!pendingProfileSlug) {
      setProfileLookupLoading(false);
      return;
    }
    const cleanSlug = pendingProfileSlug.trim().toLowerCase().replace(/^@/, '');
    const rawTrimmed = pendingProfileSlug.trim().replace(/^@/, '');
    const currentUsers = usersRef.current;
    const localMatches = currentUsers.filter(
      (u) =>
        u.username.toLowerCase() === cleanSlug ||
        u.id.toLowerCase() === cleanSlug ||
        (u.uid && u.uid.toLowerCase() === cleanSlug)
    );
    const localReal = localMatches.find((u) => !u.isDemoSeed);
    const cachedSyncHit = !localReal
      ? readCachedProfilesSync().find(
          (u) =>
            u.username.toLowerCase() === cleanSlug ||
            u.id.toLowerCase() === cleanSlug ||
            (u.uid && u.uid.toLowerCase() === cleanSlug)
        )
      : undefined;
    const immediateReal = localReal || cachedSyncHit;
    const localPreferred = immediateReal || localMatches[0];

    if (cachedSyncHit) {
      skipNextServerPushRef.current = true;
      skipNextStateBroadcastRef.current = true;
      const activeFlags = getActiveAdminFlagOverrides();
      setState((prev) => ({
        ...prev,
        users: mergeUsersSmart(prev.users, [cachedSyncHit], activeFlags),
      }));
    }

    if (immediateReal) {
      setViewingProfileId(immediateReal.id);
      setProfileLookupLoading(false);
    } else if (localPreferred && siteMetaReady && !getBrowserSupabaseConfig().anonKey) {
      setViewingProfileId(localPreferred.id);
    }

    let cancelled = false;
    if (!immediateReal) {
      setProfileLookupLoading(true);
    }

    const applyResolvedUser = (
      foundUser: UserProfile,
      foundPosts: Post[] = [],
      foundStories: StoryItem[] = []
    ) => {
      if (cancelled || !foundUser?.id) return;
      void upsertCachedProfiles([foundUser]);
      skipNextServerPushRef.current = true;
      skipNextStateBroadcastRef.current = true;
      const activeFlags = getActiveAdminFlagOverrides();
      setState((prev) => ({
        ...prev,
        users: mergeUsersSmart(prev.users, [foundUser], activeFlags),
        posts:
          foundPosts.length > 0
            ? mergeRecordsById(prev.posts, foundPosts).sort((a, b) => b.createdAt - a.createdAt)
            : prev.posts,
        stories:
          foundStories.length > 0
            ? mergeRecordsById(prev.stories, foundStories).sort((a, b) => b.createdAt - a.createdAt)
            : prev.stories,
      }));
      setViewingProfileId(foundUser.id);
      setProfileLookupLoading(false);
    };

    const lookupRemoteProfile = async () => {
      if (!immediateReal) {
        const idbHit = await lookupCachedProfileInstant(rawTrimmed).catch(() => null);
        if (!cancelled && idbHit && idbHit.id) {
          applyResolvedUser(idbHit);
        }
      }

      const sbConfig = getBrowserSupabaseConfig();
      const canQuerySupabase = Boolean(sbConfig.anonKey);

      const nodePromise = fetch(`/api/social/profile/${encodeURIComponent(cleanSlug)}`)
        .then(async (res) => {
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('application/json')) return null;
          const data = (await res.json()) as {
            ok?: boolean;
            user?: UserProfile;
            posts?: Post[];
            stories?: StoryItem[];
          };
          return data.ok && data.user ? data : null;
        })
        .catch(() => null);

      const sbPromise = canQuerySupabase
        ? fetchPublicUserByUsernameFromSupabaseBrowser(sbConfig, rawTrimmed).catch(() => null)
        : Promise.resolve(null);

      const cloudPromise =
        auth.currentUser && auth.currentUser.emailVerified
          ? fetchUserProfileAndMediaFromCloud(rawTrimmed, auth.currentUser).catch(() => null)
          : Promise.resolve(null);

      const [nodeHit, sbHit, cloudBundle] = await Promise.all([
        nodePromise,
        sbPromise,
        cloudPromise,
      ]);

      if (cancelled) return;

      const cloudPosts = cloudBundle?.posts || [];
      const cloudStories = cloudBundle?.stories || [];

      if (nodeHit?.user) {
        applyResolvedUser(
          nodeHit.user,
          mergeRecordsById(Array.isArray(nodeHit.posts) ? nodeHit.posts : [], cloudPosts),
          mergeRecordsById(Array.isArray(nodeHit.stories) ? nodeHit.stories : [], cloudStories)
        );
        return;
      }

      let remoteUser = sbHit || cloudBundle?.user || null;

      if (!remoteUser && canQuerySupabase) {
        const allPublic = await fetchPublicUsersFromSupabaseBrowser(sbConfig).catch(() => []);
        if (cancelled) return;
        if (allPublic.length > 0) {
          void upsertCachedProfiles(allPublic.filter((u) => !u.isDemoSeed));
          remoteUser =
            allPublic.find(
              (u) =>
                u.username.toLowerCase() === cleanSlug ||
                u.id.toLowerCase() === cleanSlug ||
                (u.uid && u.uid.toLowerCase() === cleanSlug)
            ) || null;
        }
      }

      if (remoteUser && remoteUser.id) {
        const authorFilters = [remoteUser.id, remoteUser.uid || ''].filter(Boolean);
        const [sbPosts, sbStories] = canQuerySupabase
          ? await Promise.all([
              fetchPublicPostsFromSupabaseBrowser(sbConfig, authorFilters),
              fetchPublicStoriesFromSupabaseBrowser(sbConfig, authorFilters),
            ])
          : [[], []];
        if (!cancelled) {
          applyResolvedUser(
            remoteUser,
            mergeRecordsById(sbPosts, cloudPosts),
            mergeRecordsById(sbStories, cloudStories)
          );
          return;
        }
      } else if (cloudPosts.length > 0 || cloudStories.length > 0) {
        skipNextServerPushRef.current = true;
        skipNextStateBroadcastRef.current = true;
        setState((prev) => ({
          ...prev,
          posts: mergeRecordsById(prev.posts, cloudPosts).sort((a, b) => b.createdAt - a.createdAt),
          stories: mergeRecordsById(prev.stories, cloudStories).sort(
            (a, b) => b.createdAt - a.createdAt
          ),
        }));
      }

      if (!cancelled) {
        if (!siteMetaReady && !immediateReal) {
          return;
        }
        if (localPreferred) {
          setViewingProfileId(localPreferred.id);
        }
        setProfileLookupLoading(false);
      }
    };
    void lookupRemoteProfile();
    return () => {
      cancelled = true;
    };
  }, [pendingProfileSlug, siteMetaReady, runtimeConfigVersion, firebaseUser?.uid]);

  // Hydrate visited profile's photos, Reels, stories & fresh profile metadata on openProfile / navigation
  const hydrateProfileMediaForTarget = async (identifier: string) => {
    const clean = identifier.trim().replace(/^@/, '');
    if (!clean) return;
    setProfileMediaLoading(true);
    try {
      const existingUser =
        usersRef.current.find(
          (u) =>
            u.id === clean ||
            u.uid === clean ||
            u.username.toLowerCase() === clean.toLowerCase()
        ) || null;
      const sbConfig = getBrowserSupabaseConfig();
      const canQuerySupabase = Boolean(sbConfig.anonKey);
      const authorFilters = Array.from(
        new Set([clean, existingUser?.id, existingUser?.uid].filter((v): v is string => Boolean(v)))
      );

      const nodePromise = fetch(`/api/social/profile/${encodeURIComponent(existingUser?.username || clean)}`)
        .then(async (res) => {
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('application/json')) return null;
          const data = (await res.json()) as {
            ok?: boolean;
            user?: UserProfile;
            posts?: Post[];
            stories?: StoryItem[];
          };
          return data.ok ? data : null;
        })
        .catch(() => null);

      const cloudPromise =
        auth.currentUser && auth.currentUser.emailVerified
          ? fetchUserProfileAndMediaFromCloud(existingUser?.username || clean, auth.currentUser).catch(
              () => null
            )
          : Promise.resolve(null);

      const sbPostsPromise =
        canQuerySupabase && authorFilters.length > 0
          ? fetchPublicPostsFromSupabaseBrowser(sbConfig, authorFilters).catch(() => [] as Post[])
          : Promise.resolve([] as Post[]);

      const sbStoriesPromise =
        canQuerySupabase && authorFilters.length > 0
          ? fetchPublicStoriesFromSupabaseBrowser(sbConfig, authorFilters).catch(
              () => [] as StoryItem[]
            )
          : Promise.resolve([] as StoryItem[]);

      const sbUserPromise =
        canQuerySupabase && !existingUser
          ? fetchPublicUserByUsernameFromSupabaseBrowser(sbConfig, clean).catch(() => null)
          : Promise.resolve(null);

      const [nodeHit, cloudBundle, sbPosts, sbStories, sbUser] = await Promise.all([
        nodePromise,
        cloudPromise,
        sbPostsPromise,
        sbStoriesPromise,
        sbUserPromise,
      ]);

      const mergedUsers = [nodeHit?.user, sbUser, cloudBundle?.user].filter(
        (u): u is UserProfile => Boolean(u && u.id)
      );
      const mergedPosts = mergeRecordsById(
        mergeRecordsById(Array.isArray(nodeHit?.posts) ? nodeHit!.posts! : [], sbPosts),
        cloudBundle?.posts || []
      );
      const mergedStories = mergeRecordsById(
        mergeRecordsById(Array.isArray(nodeHit?.stories) ? nodeHit!.stories! : [], sbStories),
        cloudBundle?.stories || []
      );

      if (mergedUsers.length > 0 || mergedPosts.length > 0 || mergedStories.length > 0) {
        if (mergedUsers.length > 0) {
          void upsertCachedProfiles(mergedUsers.filter((u) => !u.isDemoSeed));
        }
        const activeFlags = getActiveAdminFlagOverrides();
        skipNextServerPushRef.current = true;
        skipNextStateBroadcastRef.current = true;
        setState((prev) => ({
          ...prev,
          users: mergedUsers.length > 0 ? mergeUsersSmart(prev.users, mergedUsers, activeFlags) : prev.users,
          posts:
            mergedPosts.length > 0
              ? mergeRecordsById(prev.posts, mergedPosts).sort((a, b) => b.createdAt - a.createdAt)
              : prev.posts,
          stories:
            mergedStories.length > 0
              ? mergeRecordsById(prev.stories, mergedStories).sort(
                  (a, b) => b.createdAt - a.createdAt
                )
              : prev.stories,
        }));
      }
    } finally {
      setProfileMediaLoading(false);
    }
  };

  useEffect(() => {
    if (activeNav !== 'profile' || !viewingProfileId) return;
    void hydrateProfileMediaForTarget(viewingProfileId);
  }, [activeNav, viewingProfileId, firebaseUser?.uid, runtimeConfigVersion]);

  // Node server + Supabase cross-device sync (parallelized for lower latency)
  useEffect(() => {
    let active = true;
    const pullServerState = async () => {
      const activeUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
      const activeIds =
        isAuthenticatedRef.current && activeUser && !activeUser.isDemoSeed
          ? [activeUser.id, activeUser.uid || ''].filter(Boolean)
          : [];
      const qs = activeIds.length > 0 ? `?userIds=${encodeURIComponent(activeIds.join(','))}` : '';
      const sbConfig = getBrowserSupabaseConfig();

      const nodePromise = (async () => {
        try {
          const res = await fetch(`/api/social/state${qs}`);
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('application/json')) return null;
          return (await res.json()) as {
            ok?: boolean;
            state?: {
              updatedAt?: number;
              users?: UserProfile[];
              posts?: Post[];
              stories?: StoryItem[];
              threads?: DirectThread[];
              notifications?: NotificationItem[];
              userFlagOverrides?: AdminUserFlagOverrideMap;
            } | null;
          };
        } catch {
          return null;
        }
      })();

      const sbPromise =
        sbConfig.autoSyncUsers && sbConfig.anonKey
          ? Promise.all([
              fetchPublicUsersFromSupabaseBrowser(sbConfig),
              fetchPublicPostsFromSupabaseBrowser(sbConfig),
              fetchPublicStoriesFromSupabaseBrowser(sbConfig),
              activeIds.length > 0
                ? fetchDirectThreadsForUserFromSupabaseBrowser(sbConfig, activeIds)
                : Promise.resolve([] as DirectThread[]),
            ])
          : Promise.resolve(null);

      const [nodeData, sbData] = await Promise.all([nodePromise, sbPromise]);
      if (!active) return;

      if (nodeData?.ok) {
        setServerSyncAvailable(true);
        const remote = nodeData.state;
        if (remote?.userFlagOverrides && typeof remote.userFlagOverrides === 'object') {
          serverAdminFlagsRef.current = remote.userFlagOverrides;
        }
        if (remote && Array.isArray(remote.users) && Array.isArray(remote.posts)) {
          const isNewerTimestamp =
            !remote.updatedAt || remote.updatedAt > lastServerUpdatedAtRef.current;
          const hasUnseenUsers = remote.users.some(
            (ru) =>
              !usersRef.current.some(
                (lu) =>
                  lu.id === ru.id ||
                  (!ru.isDemoSeed &&
                    !lu.isDemoSeed &&
                    lu.username.toLowerCase() === ru.username.toLowerCase())
              )
          );
          if (isNewerTimestamp || hasUnseenUsers) {
            if (remote.updatedAt) {
              lastServerUpdatedAtRef.current = Math.max(
                lastServerUpdatedAtRef.current,
                remote.updatedAt
              );
            }
            const activeFlags = getActiveAdminFlagOverrides();
            void upsertCachedProfiles(remote.users.filter((u) => !u.isDemoSeed));
            skipNextServerPushRef.current = true;
            skipNextStateBroadcastRef.current = true;
            setState((prev) => {
              const me = prev.users.find((u) => u.id === prev.currentUserId);
              const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
              return {
                ...prev,
                users: mergeUsersSmart(prev.users, remote.users!, activeFlags),
                posts: mergeRecordsById(prev.posts, remote.posts!).sort(
                  (a, b) => b.createdAt - a.createdAt
                ),
                stories: Array.isArray(remote.stories)
                  ? mergeRecordsById(prev.stories, remote.stories).sort(
                      (a, b) => b.createdAt - a.createdAt
                    )
                  : prev.stories,
                threads: Array.isArray(remote.threads)
                  ? mergeThreadsSmart(
                      prev.threads,
                      remote.threads,
                      myIds,
                      threadReadWatermarkRef.current
                    )
                  : prev.threads,
                notifications: Array.isArray(remote.notifications)
                  ? mergeNotificationsSmart(
                      prev.notifications,
                      remote.notifications,
                      readNotifIdsRef.current
                    )
                  : prev.notifications,
              };
            });
          }
        }
      }

      if (active && sbData) {
        const [sbUsers, sbPosts, sbStories, sbThreads] = sbData;
        if (
          sbUsers.length > 0 ||
          sbPosts.length > 0 ||
          sbStories.length > 0 ||
          sbThreads.length > 0
        ) {
          const activeFlags = getActiveAdminFlagOverrides();
          if (sbUsers.length > 0) {
            void upsertCachedProfiles(sbUsers.filter((u) => !u.isDemoSeed));
          }
          skipNextServerPushRef.current = true;
          skipNextStateBroadcastRef.current = true;
          setState((prev) => {
            const me = prev.users.find((u) => u.id === prev.currentUserId);
            const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
            return {
              ...prev,
              users: sbUsers.length > 0 ? mergeUsersSmart(prev.users, sbUsers, activeFlags) : prev.users,
              posts:
                sbPosts.length > 0
                  ? mergeRecordsById(prev.posts, sbPosts).sort((a, b) => b.createdAt - a.createdAt)
                  : prev.posts,
              stories:
                sbStories.length > 0
                  ? mergeRecordsById(prev.stories, sbStories).sort(
                      (a, b) => b.createdAt - a.createdAt
                    )
                  : prev.stories,
              threads:
                sbThreads.length > 0
                  ? mergeThreadsSmart(
                      prev.threads,
                      sbThreads,
                      myIds,
                      threadReadWatermarkRef.current
                    )
                  : prev.threads,
            };
          });
        }
      }
    };
    pullServerStateNowRef.current = pullServerState;
    void pullServerState();
    const timer = window.setInterval(() => {
      void pullServerState();
    }, 3000);
    return () => {
      active = false;
      pullServerStateNowRef.current = null;
      window.clearInterval(timer);
    };
  }, [runtimeConfigVersion, state.currentUserId, state.isAuthenticated]);

  // Fast lightweight Messenger sync loop (messages + read receipts + live typing indicator)
  useEffect(() => {
    if (!state.isAuthenticated) return;
    const activeUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
    if (!activeUser || activeUser.isDemoSeed) return;
    const activeIds = [activeUser.id, activeUser.uid || ''].filter(Boolean);
    if (activeIds.length === 0) return;

    let active = true;
    const intervalMs = activeNav === 'messages' ? 1800 : 5000;

    const pullMessagesAndTyping = async () => {
      const qs = `?userIds=${encodeURIComponent(activeIds.join(','))}`;
      const sbConfig = getBrowserSupabaseConfig();

      const [nodeMsgsRes, typingRes, sbThreads] = await Promise.all([
        fetch(`/api/social/messages${qs}`)
          .then(async (r) => {
            if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) return null;
            return (await r.json()) as { ok?: boolean; threads?: DirectThread[] };
          })
          .catch(() => null),
        activeNav === 'messages'
          ? fetch(`/api/social/typing${qs}`)
              .then(async (r) => {
                if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) return null;
                return (await r.json()) as { ok?: boolean; typingFromIds?: string[] };
              })
              .catch(() => null)
          : Promise.resolve(null),
        !serverSyncAvailable && sbConfig.anonKey
          ? fetchDirectThreadsForUserFromSupabaseBrowser(sbConfig, activeIds).catch(() => [] as DirectThread[])
          : Promise.resolve([] as DirectThread[]),
      ]);

      if (!active) return;

      if (typingRes?.ok && Array.isArray(typingRes.typingFromIds)) {
        const now = Date.now();
        setTypingByUserId((prev) => {
          const next: Record<string, number> = {};
          for (const [k, ts] of Object.entries(prev)) {
            if (now - ts < 4200) next[k] = ts;
          }
          for (const id of typingRes.typingFromIds!) {
            next[id] = now;
          }
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (
            prevKeys.length === nextKeys.length &&
            nextKeys.every((k) => prev[k] !== undefined)
          ) {
            return prev;
          }
          return next;
        });
      }

      const incomingThreads = [
        ...(Array.isArray(nodeMsgsRes?.threads) ? nodeMsgsRes!.threads : []),
        ...sbThreads,
      ];
      if (incomingThreads.length === 0) return;

      skipNextServerPushRef.current = true;
      skipNextStateBroadcastRef.current = true;
      setState((prev) => {
        const me = prev.users.find((u) => u.id === prev.currentUserId);
        const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
        const merged = mergeThreadsSmart(
          prev.threads,
          incomingThreads,
          myIds,
          threadReadWatermarkRef.current
        );
        const sig = (list: DirectThread[]) =>
          list
            .map((t) => {
              const last = t.messages[t.messages.length - 1];
              const lastReadLen = last?.readBy?.length || 0;
              const reactCount = t.messages.reduce(
                (acc, m) => acc + Object.keys(m.reactions || {}).length + (m.reaction ? 1 : 0),
                0
              );
              return `${t.id}:${t.messages.length}:${t.unreadBy.join(',')}:${lastReadLen}:${reactCount}`;
            })
            .join('|');
        if (sig(merged) === sig(prev.threads)) {
          return prev;
        }
        return { ...prev, threads: merged };
      });
    };

    pullMessagesNowRef.current = pullMessagesAndTyping;
    void pullMessagesAndTyping();
    const timer = window.setInterval(() => {
      void pullMessagesAndTyping();
    }, intervalMs);
    return () => {
      active = false;
      pullMessagesNowRef.current = null;
      window.clearInterval(timer);
    };
  }, [activeNav, state.isAuthenticated, state.currentUserId, serverSyncAvailable, runtimeConfigVersion]);

  // Real-time WebSocket signaling + HTTP polling fallback for instant DM & WebRTC Calls
  useEffect(() => {
    if (!state.isAuthenticated) {
      wsHandleRef.current?.close();
      wsHandleRef.current = null;
      wsConnectedRef.current = false;
      return;
    }
    const activeUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
    if (!activeUser || activeUser.isDemoSeed) {
      wsHandleRef.current?.close();
      wsHandleRef.current = null;
      wsConnectedRef.current = false;
      return;
    }
    const activeIds = Array.from(new Set([activeUser.id, activeUser.uid || ''].filter(Boolean)));
    if (activeIds.length === 0) return;

    let active = true;
    const handle = connectRealtimeSocket(
      activeIds,
      (event) => {
        if (!active) return;
        if (event.type === 'call_signal' && event.signal) {
          handleCallSignalRef.current?.(event.signal);
        } else if (event.type === 'chat_message' || event.type === 'chat_read') {
          void pullMessagesNowRef.current?.();
        } else if (event.type === 'social_update') {
          void pullServerStateNowRef.current?.();
        } else if (event.type === 'site_meta_update') {
          void refreshSiteMeta();
        } else if (event.type === 'presence_update' && event.userId) {
          skipNextServerPushRef.current = true;
          skipNextStateBroadcastRef.current = true;
          setState((prev) => ({
            ...prev,
            users: prev.users.map((u) => {
              const matches =
                u.id === event.userId ||
                (event.uid && (u.uid === event.uid || u.id === event.uid));
              if (!matches) return u;
              return {
                ...u,
                isOnline: event.isOnline,
                lastActiveAtMs: event.lastActiveAtMs,
              };
            }),
          }));
        } else if (event.type === 'chat_typing' && event.fromUserId) {
          setTypingByUserId((prev) => {
            const next = { ...prev };
            if (event.isTyping) {
              next[event.fromUserId] = Date.now();
            } else {
              delete next[event.fromUserId];
            }
            return next;
          });
        }
      },
      (connected) => {
        wsConnectedRef.current = connected;
      }
    );
    wsHandleRef.current = handle;

    // Pull server-persisted blocked list for current user
    void (async () => {
      try {
        const res = await fetch(
          `/api/social/blocks?userId=${encodeURIComponent(activeUser.id)}`
        );
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = (await res.json()) as { ok?: boolean; blockedIds?: string[] };
          if (active && data.ok && Array.isArray(data.blockedIds)) {
            setChatPrefs((prev) => {
              const existing = prev.blockedByUser[activeUser.id] || [];
              const merged = Array.from(new Set([...existing, ...data.blockedIds!]));
              const nextStore = {
                ...prev,
                blockedByUser: { ...prev.blockedByUser, [activeUser.id]: merged },
              };
              saveChatPrefs(nextStore);
              return nextStore;
            });
          }
        }
      } catch {
        // Ignore on static hosting
      }
    })();

    // HTTP REST polling fallback for call signals (catches cross-device calls reliably)
    const pollCallSignals = async () => {
      if (!active) return;
      try {
        const res = await fetch(
          `/api/social/calls/poll?userIds=${encodeURIComponent(activeIds.join(','))}`
        );
        if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return;
        const data = (await res.json()) as { ok?: boolean; signals?: CallSignalPayload[] };
        if (active && data.ok && Array.isArray(data.signals)) {
          for (const sig of data.signals) {
            handleCallSignalRef.current?.(sig);
          }
        }
      } catch {
        // Ignore on static hosting
      }
    };

    void pollCallSignals();
    const callPollTimer = window.setInterval(() => {
      void pollCallSignals();
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(callPollTimer);
      handle.close();
      if (wsHandleRef.current === handle) {
        wsHandleRef.current = null;
      }
      wsConnectedRef.current = false;
    };
  }, [state.isAuthenticated, state.currentUserId, runtimeConfigVersion]);

  // Real-time online/offline presence heartbeat for real authenticated users
  useEffect(() => {
    if (!state.isAuthenticated) return;
    const activeUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
    if (!activeUser || activeUser.isDemoSeed) return;

    const profileId = activeUser.id;
    const profileUid = activeUser.uid;

    const sendPresence = (online: boolean, useBeacon = false) => {
      const now = Date.now();
      skipNextServerPushRef.current = true;
      setState((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.id === profileId ? { ...u, isOnline: online, lastActiveAtMs: now } : u
        ),
      }));

      const payload = JSON.stringify({
        userId: profileId,
        uid: profileUid,
        isOnline: online,
      });

      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          navigator.sendBeacon('/api/social/presence', new Blob([payload], { type: 'text/plain' }));
        } catch {
          // Ignore beacon errors on static hosts
        }
      } else {
        void fetch('/api/social/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: !online,
        }).catch(() => {});
      }

      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updateUserPresenceInCloud(profileId, online, auth.currentUser).catch(() => {});
      }
    };

    sendPresence(true);

    const heartbeatTimer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        sendPresence(true);
      }
    }, 20_000);

    const onVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        sendPresence(true);
      }
    };

    const onOfflineOrUnload = () => {
      sendPresence(false, true);
    };

    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('online', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('beforeunload', onOfflineOrUnload);
    window.addEventListener('pagehide', onOfflineOrUnload);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('online', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('beforeunload', onOfflineOrUnload);
      window.removeEventListener('pagehide', onOfflineOrUnload);
    };
  }, [state.isAuthenticated, state.currentUserId, firebaseUser?.uid]);

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
          fromUserId?: string;
          fromUid?: string;
          toUserId?: string;
          isTyping?: boolean;
          signal?: CallSignalPayload;
        };
        if (!payload || payload.senderTabId === tabIdRef.current) return;
        if (payload.type === 'call_signal' && payload.signal) {
          handleCallSignalRef.current?.(payload.signal);
          return;
        }
        if (payload.type === 'typing_sync' && payload.fromUserId) {
          const me = usersRef.current.find((u) => u.id === currentUserIdRef.current);
          const myIds = new Set([currentUserIdRef.current, me?.uid || ''].filter(Boolean));
          if (!payload.toUserId || myIds.has(payload.toUserId)) {
            setTypingByUserId((prev) => {
              const next = { ...prev };
              if (payload.isTyping) {
                next[payload.fromUserId!] = Date.now();
                if (payload.fromUid) next[payload.fromUid] = Date.now();
              } else {
                delete next[payload.fromUserId!];
                if (payload.fromUid) delete next[payload.fromUid];
              }
              return next;
            });
          }
          return;
        }
        if (payload.type === 'state_sync') {
          skipNextStateBroadcastRef.current = true;
          setState((prev) => {
            const me = prev.users.find((u) => u.id === prev.currentUserId);
            const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
            return {
              ...prev,
              users: Array.isArray(payload.users) ? payload.users : prev.users,
              posts: Array.isArray(payload.posts) ? payload.posts : prev.posts,
              stories: Array.isArray(payload.stories) ? payload.stories : prev.stories,
              threads: Array.isArray(payload.threads)
                ? mergeThreadsSmart(
                    prev.threads,
                    payload.threads,
                    myIds,
                    threadReadWatermarkRef.current
                  )
                : prev.threads,
              notifications: Array.isArray(payload.notifications)
                ? mergeNotificationsSmart(
                    prev.notifications,
                    payload.notifications,
                    readNotifIdsRef.current
                  )
                : prev.notifications,
            };
          });
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
            setState((prev) => {
              const me = prev.users.find((u) => u.id === prev.currentUserId);
              const myIds = [prev.currentUserId, me?.uid || ''].filter(Boolean);
              return {
                ...prev,
                users: parsed.users,
                posts: parsed.posts,
                stories: parsed.stories,
                threads: mergeThreadsSmart(
                  prev.threads,
                  parsed.threads || [],
                  myIds,
                  threadReadWatermarkRef.current
                ),
                notifications: mergeNotificationsSmart(
                  prev.notifications,
                  parsed.notifications || [],
                  readNotifIdsRef.current
                ),
              };
            });
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

  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  const persistLocalStorageNow = (snapshot: PersistedState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      try {
        const compactState: PersistedState = {
          ...snapshot,
          posts: snapshot.posts.map((p) => ({
            ...p,
            media: p.media.map((m) => ({
              ...m,
              url:
                m.url.startsWith('data:video/') && m.url.length > 750_000
                  ? SEED_POSTS[0].media[0].url
                  : m.url,
            })),
          })),
          threads: snapshot.threads.map((t) => ({
            ...t,
            messages: t.messages.map((m) => ({
              ...m,
              videoUrl: m.videoUrl && m.videoUrl.length > 500_000 ? undefined : m.videoUrl,
              audioUrl: m.audioUrl && m.audioUrl.length > 500_000 ? undefined : m.audioUrl,
              fileUrl: m.fileUrl && m.fileUrl.length > 350_000 ? undefined : m.fileUrl,
            })),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
      } catch {
        // Keep running smoothly in memory
      }
    }
  };

  useEffect(() => {
    const handleFlush = () => {
      persistLocalStorageNow(latestStateRef.current);
      const realUsers = latestStateRef.current.users.filter((u) => !u.isDemoSeed);
      if (realUsers.length > 0) {
        void upsertCachedProfiles(realUsers);
      }
    };
    window.addEventListener('beforeunload', handleFlush);
    window.addEventListener('pagehide', handleFlush);
    return () => {
      window.removeEventListener('beforeunload', handleFlush);
      window.removeEventListener('pagehide', handleFlush);
    };
  }, []);

  // Keep dedicated real-user localStorage + IndexedDB cache continuously updated
  useEffect(() => {
    const realUsers = state.users.filter((u) => !u.isDemoSeed);
    if (realUsers.length === 0) return;
    const timer = window.setTimeout(() => {
      void upsertCachedProfiles(realUsers);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [state.users]);

  useEffect(() => {
    if (skipNextStateBroadcastRef.current) {
      skipNextStateBroadcastRef.current = false;
      return;
    }

    const storageTimer = window.setTimeout(() => {
      persistLocalStorageNow(state);
      channelRef.current?.postMessage({
        senderTabId: tabIdRef.current,
        type: 'state_sync',
        users: state.users,
        posts: state.posts,
        stories: state.stories,
        threads: state.threads,
        notifications: state.notifications,
      });
    }, 150);

    let pushTimer: number | null = null;
    if (skipNextServerPushRef.current) {
      skipNextServerPushRef.current = false;
    } else if (serverSyncAvailable) {
      pushTimer = window.setTimeout(() => {
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
      }, 150);
    }

    return () => {
      window.clearTimeout(storageTimer);
      if (pushTimer !== null) window.clearTimeout(pushTimer);
    };
  }, [state, serverSyncAvailable]);

  // Always index public post previews on Node SSR server (even for posts loaded from Firestore)
  useEffect(() => {
    if (!serverSyncAvailable || state.posts.length === 0) return;
    const timer = window.setTimeout(() => {
      const items = state.posts.slice(0, 60).map((post) => {
        const author = state.users.find((u) => u.id === post.authorId);
        const firstImg = post.media.find((m) => m.mediaType !== 'video')?.url;
        const firstVid = post.media.find((m) => m.mediaType === 'video')?.url;
        return {
          id: post.id,
          authorUsername: author?.username || 'lumina',
          authorDisplayName: author?.displayName || 'Lumina',
          authorAvatarUrl: author?.avatarUrl,
          caption: (post.caption || '').slice(0, 400),
          isReel: Boolean(post.isReel),
          imageUrl: firstImg,
          videoUrl: firstVid && /^https?:\/\//i.test(firstVid) ? firstVid : undefined,
        };
      });
      fetch('/api/social/previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state.posts, state.users, serverSyncAvailable]);

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
    const nonRestricted = state.users.filter((u) => !u.restricted || u.id === state.currentUserId);
    if (!siteMeta.realUsersOnly) return nonRestricted;
    return nonRestricted.filter((u) => !u.isDemoSeed || u.id === state.currentUserId);
  }, [state.users, state.currentUserId, siteMeta.realUsersOnly]);

  const visibleUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const u of visibleUsers) {
      ids.add(u.id);
      if (u.uid) ids.add(u.uid);
    }
    return ids;
  }, [visibleUsers]);

  const visiblePosts = useMemo(() => {
    if (!siteMeta.realUsersOnly) return state.posts;
    return state.posts.filter(
      (p) => visibleUserIds.has(p.authorId) || (p.authorUid && visibleUserIds.has(p.authorUid))
    );
  }, [state.posts, visibleUserIds, siteMeta.realUsersOnly]);

  const visibleStories = useMemo(() => {
    const activeWindow = state.stories.filter(
      (s) => Date.now() - s.createdAt <= 24 * 60 * 60 * 1000
    );
    if (!siteMeta.realUsersOnly) return activeWindow;
    return activeWindow.filter(
      (s) => visibleUserIds.has(s.authorId) || (s.authorUid && visibleUserIds.has(s.authorUid))
    );
  }, [state.stories, visibleUserIds, siteMeta.realUsersOnly]);

  const usersIndexMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    // Index demo seeds first so real profiles win on handle collisions
    for (const u of state.users) {
      if (!u.isDemoSeed) continue;
      map.set(u.id, u);
      if (u.uid) map.set(u.uid, u);
      if (u.username) map.set(u.username.trim().toLowerCase(), u);
    }
    for (const u of state.users) {
      if (u.isDemoSeed) continue;
      map.set(u.id, u);
      if (u.uid) map.set(u.uid, u);
      if (u.username) map.set(u.username.trim().toLowerCase(), u);
    }
    return map;
  }, [state.users]);

  const getUserById = (id: string) => {
    if (!id) return undefined;
    const direct = usersIndexMap.get(id);
    if (direct) return direct;
    const normalized = id.trim().replace(/^@/, '').toLowerCase();
    return normalized ? usersIndexMap.get(normalized) : undefined;
  };

  const openProfile = (userId: string) => {
    const matched = getUserById(userId);
    const resolvedId = matched?.id || userId;
    setPendingProfileSlug(null);
    setViewingProfileId(resolvedId);
    setActiveNav('profile');
    void hydrateProfileMediaForTarget(matched?.username || resolvedId);
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

  const formatGoogleAuthError = (err: unknown): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Janela de login do Google fechada antes de concluir.';
    }
    if (code === 'auth/popup-blocked') {
      return 'O navegador bloqueou o pop-up do Google. Use o botão "Usar redirecionamento Google" abaixo ou entre com sua senha de administrador.';
    }
    if (code === 'auth/unauthorized-domain') {
      return `O domínio "${host}" precisa estar em Authorized domains do projeto Firebase "${FIREBASE_PROJECT_ID}" (Authentication > Settings > Authorized domains) ou entre com a senha de administrador.`;
    }
    if (code === 'auth/operation-not-allowed') {
      return 'O provedor Google não está habilitado no Firebase Authentication. Use a senha de administrador ou ative o Google no console.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Falha de conexão ao autenticar com o Google. Verifique sua internet ou use a senha de administrador.';
    }
    if (code) {
      return `Erro no login Google (${code}). Use "Redirecionamento Google" ou entre com a senha de administrador.`;
    }
    return 'Não foi possível conectar com o Google. Tente novamente ou use a senha de administrador.';
  };

  const loginWithGoogle = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const fbUser = cred.user;
      if (!fbUser || !fbUser.emailVerified) {
        return { ok: false, error: 'Use uma conta Google com e-mail verificado.' };
      }
      hydrateGoogleProfileSession(fbUser);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: formatGoogleAuthError(err) };
    }
  };

  const loginWithGoogleRedirect = async (
    target: 'feed' | 'admin' = 'feed'
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      try {
        sessionStorage.setItem('lumina_google_redirect_target', target);
      } catch {
        // Ignore sessionStorage restrictions
      }
      await signInWithRedirect(auth, googleProvider);
      return { ok: true };
    } catch (err) {
      try {
        sessionStorage.removeItem('lumina_google_redirect_target');
      } catch {
        // Ignore
      }
      return { ok: false, error: formatGoogleAuthError(err) };
    }
  };

  const activateAdminProfileSession = (token: string) => {
    setAdminMemoryToken(token);
    setState((prev) => {
      const existing = prev.users.find(
        (u) =>
          !u.isDemoSeed &&
          (u.id === 'admin_daniel' ||
            u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() ||
            u.username.toLowerCase() === 'dadaniel14hiphop')
      );
      const adminProfile: UserProfile = existing
        ? {
            ...existing,
            email: existing.email || ADMIN_EMAIL,
            verified: true,
            isOnline: true,
            lastActiveAtMs: Date.now(),
            isDemoSeed: false,
          }
        : {
            id: 'admin_daniel',
            username: 'dadaniel14hiphop',
            displayName: 'Daniel (Admin)',
            avatarUrl: SEED_USERS[0].avatarUrl,
            coverUrl: SEED_USERS[0].coverUrl,
            bio: 'Administrador exclusivo da rede Lumina.',
            email: ADMIN_EMAIL,
            verified: true,
            isOnline: true,
            lastActiveAtMs: Date.now(),
            isDemoSeed: false,
            followers: [],
            following: [],
          };
      const remaining = prev.users.filter((u) => u.id !== adminProfile.id);
      return {
        ...prev,
        users: [adminProfile, ...remaining],
        currentUserId: adminProfile.id,
        isAuthenticated: true,
      };
    });
    setGuestBrowsing(false);
    setViewingProfileId(null);
    setIsInviteModalOpen(false);
  };

  const logout = () => {
    const leavingUser = usersRef.current.find((u) => u.id === currentUserIdRef.current);
    const offlineTs = Date.now();
    if (leavingUser && !leavingUser.isDemoSeed) {
      void fetch('/api/social/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: leavingUser.id,
          uid: leavingUser.uid,
          isOnline: false,
        }),
      }).catch(() => {});
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updateUserPresenceInCloud(leavingUser.id, false, auth.currentUser).catch(() => {});
      }
    }
    clearBrowserSupabaseSession();
    setSelectedPostId(null);
    setActiveStoryAuthorId(null);
    setIsCreateOpen(false);
    setSharePostId(null);
    setGuestBrowsing(false);
    setViewingProfileId(null);
    setAdminMemoryToken(null);
    setActiveNav('feed');
    setState((prev) => ({
      ...prev,
      isAuthenticated: false,
      users: prev.users.map((u) =>
        u.id === prev.currentUserId ? { ...u, isOnline: false, lastActiveAtMs: offlineTs } : u
      ),
    }));
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
            displayName: payload.displayName.trim() || cleanHandle,
            bio: payload.bio.trim() || undefined,
            avatarUrl: payload.avatarUrl,
            coverUrl: payload.coverUrl,
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
          displayName: payload.displayName.trim() || cleanHandle,
          bio: payload.bio.trim() || undefined,
          avatarUrl: payload.avatarUrl,
          coverUrl: payload.coverUrl,
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

    let finalUid = auth.currentUser?.uid;
    const resolvedEmailForSb = cleanEmail || localMatch?.email || pendingInviteMeta?.email;
    const sbConfig = getBrowserSupabaseConfig();
    if (resolvedEmailForSb && sbConfig.autoSyncUsers && sbConfig.anonKey) {
      const sbRes = await signupRealUserInSupabaseFromBrowser(sbConfig, {
        id: newId,
        username: cleanHandle,
        displayName: payload.displayName.trim() || cleanHandle,
        email: resolvedEmailForSb,
        password,
        bio: payload.bio.trim() || 'Novo membro convidado na Lumina.',
        avatarUrl: payload.avatarUrl,
        coverUrl: payload.coverUrl,
      }).catch(() => null);
      if (sbRes?.authUid) {
        finalUid = sbRes.authUid;
      }
    }

    const newUser: UserProfile = {
      id: newId,
      uid: finalUid,
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

    void upsertCachedProfiles([newUser]);
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
    void refreshPublicUsersFromSupabase();

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

  const registerRealUser = async (payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    bio: string;
    inviteCode?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const cleanCode = (payload.inviteCode || '').trim().toUpperCase();
    if (cleanCode) {
      return registerWithInvite({
        code: cleanCode,
        username: payload.username,
        displayName: payload.displayName,
        email: payload.email,
        password: payload.password,
        bio: payload.bio,
        avatarUrl: payload.avatarUrl,
        coverUrl: payload.coverUrl,
      });
    }

    const rawHandle = payload.username.trim().toLowerCase().replace(/^@/, '');
    const cleanHandle = rawHandle.replace(/[^a-z0-9._]/g, '');
    if (cleanHandle.length < 3 || cleanHandle !== rawHandle) {
      return {
        ok: false,
        error: 'Escolha um @usuario válido com pelo menos 3 caracteres (letras, números, ponto e _).',
      };
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { ok: false, error: 'Informe um e-mail real válido para criar a conta.' };
    }

    const password = payload.password || '';
    if (password.length < 6) {
      return { ok: false, error: 'Crie uma senha de acesso com pelo menos 6 caracteres.' };
    }

    if (state.users.some((u) => !u.isDemoSeed && u.username.toLowerCase() === cleanHandle)) {
      return { ok: false, error: `O nome @${cleanHandle} já está em uso.` };
    }

    let resolvedId = `user_${Date.now()}`;
    let resolvedUid = auth.currentUser?.uid;
    let resolvedVerified = false;
    let supabaseSynced = false;
    let usedBackendApi = false;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanHandle,
          displayName: payload.displayName.trim() || cleanHandle,
          email: cleanEmail,
          password,
          bio: payload.bio.trim(),
          avatarUrl: payload.avatarUrl,
          coverUrl: payload.coverUrl,
        }),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        usedBackendApi = true;
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          user?: UserProfile;
          grantVerified?: boolean;
          supabaseSynced?: boolean;
        };
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Não foi possível concluir o cadastro.' };
        }
        if (data.user?.id) resolvedId = data.user.id;
        resolvedVerified = Boolean(data.grantVerified ?? data.user?.verified);
        supabaseSynced = Boolean(data.supabaseSynced);
      }
    } catch {
      // Static hosting without Node backend
    }

    let supabaseNeedsEmailConfirm = false;
    if (!usedBackendApi || !supabaseSynced) {
      const sbConfig = getBrowserSupabaseConfig();
      if (sbConfig.autoSyncUsers && sbConfig.anonKey) {
        const sbRes = await signupRealUserInSupabaseFromBrowser(sbConfig, {
          id: resolvedId,
          username: cleanHandle,
          displayName: payload.displayName.trim() || cleanHandle,
          email: cleanEmail,
          password,
          bio: payload.bio.trim(),
          avatarUrl: payload.avatarUrl,
          coverUrl: payload.coverUrl,
        });
        if (!usedBackendApi && !sbRes.ok) {
          return { ok: false, error: sbRes.error || 'Não foi possível gravar usuário no Supabase.' };
        }
        if (sbRes.authUid) resolvedUid = sbRes.authUid;
        if (sbRes.tableSynced) {
          supabaseSynced = true;
        } else if (sbRes.needsEmailConfirm) {
          supabaseNeedsEmailConfirm = true;
        }
      }
    }

    const salt = generateSaltHex();
    const hash = await derivePasswordHash(password, salt);
    const existingCreds = loadLocalCredentials().filter(
      (c) => c.userId !== resolvedId && c.username.toLowerCase() !== cleanHandle
    );
    existingCreds.unshift({
      userId: resolvedId,
      username: cleanHandle,
      email: cleanEmail,
      salt,
      hash,
      createdAt: Date.now(),
    });
    saveLocalCredentials(existingCreds);
    setCredentialsVersion((v) => v + 1);

    const newUser: UserProfile = {
      id: resolvedId,
      uid: resolvedUid,
      username: cleanHandle,
      displayName: payload.displayName.trim() || cleanHandle,
      avatarUrl: payload.avatarUrl || SEED_USERS[0].avatarUrl,
      coverUrl: payload.coverUrl || SEED_USERS[0].coverUrl,
      bio: payload.bio.trim() || 'Novo usuário real na Lumina.',
      email: cleanEmail,
      verified: resolvedVerified,
      isOnline: true,
      isDemoSeed: false,
      followers: [],
      following: [],
    };

    void upsertCachedProfiles([newUser]);
    setState((prev) => ({
      ...prev,
      users: [newUser, ...prev.users.filter((u) => u.id !== resolvedId)],
      currentUserId: resolvedId,
      isAuthenticated: true,
    }));
    setGuestBrowsing(false);
    setPendingInviteCode(null);
    setPendingInviteMeta(null);
    setIsInviteModalOpen(false);
    setPendingProfileSlug(null);
    setViewingProfileId(null);
    setActiveNav('feed');

    if (auth.currentUser && auth.currentUser.emailVerified) {
      void upsertOwnProfileInCloud(newUser, auth.currentUser).catch(() => {});
    }

    showToast(
      supabaseSynced
        ? `Conta @${cleanHandle} criada e gravada no Supabase!`
        : supabaseNeedsEmailConfirm
        ? `Conta @${cleanHandle} criada! Confirme o e-mail ou atualize o SQL do Supabase para listá-la.`
        : `Bem-vindo(a), @${cleanHandle}! Conta real criada.`
    );
    return { ok: true };
  };

  const upsertLocalCredentialCache = async (params: {
    userId: string;
    username: string;
    email?: string;
    password: string;
  }) => {
    try {
      const salt = generateSaltHex();
      const hash = await derivePasswordHash(params.password, salt);
      const next = loadLocalCredentials().filter(
        (c) =>
          c.userId !== params.userId &&
          c.username.toLowerCase() !== params.username.toLowerCase()
      );
      next.unshift({
        userId: params.userId,
        username: params.username.toLowerCase(),
        email: params.email?.toLowerCase(),
        salt,
        hash,
        createdAt: Date.now(),
      });
      saveLocalCredentials(next);
      setCredentialsVersion((v) => v + 1);
    } catch {
      // Ignore local credential cache errors
    }
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
      // Do not abort here: password may have been changed or registered on another browser/device.
    }

    // Fallback to Node backend verification when available
    let usedBackendApi = false;
    let backendError = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: rawId, password }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        usedBackendApi = true;
        const data = (await res.json()) as {
          ok?: boolean;
          userId?: string;
          username?: string;
          displayName?: string;
          email?: string;
          user?: UserProfile;
          isAdmin?: boolean;
          adminToken?: string;
          error?: string;
        };
        if (res.ok && data.ok) {
          if (data.isAdmin && data.adminToken) {
            activateAdminProfileSession(data.adminToken);
            showToast('Administrador conectado: @dadaniel14hiphop');
            return { ok: true };
          }
          const incomingProfile: UserProfile | null =
            data.user && data.user.id
              ? {
                  ...data.user,
                  email: data.email || data.user.email,
                  isOnline: true,
                  isDemoSeed: false,
                  followers: Array.isArray(data.user.followers) ? data.user.followers : [],
                  following: Array.isArray(data.user.following) ? data.user.following : [],
                }
              : data.userId && data.username
              ? {
                  id: data.userId,
                  username: data.username,
                  displayName: data.displayName || data.username,
                  avatarUrl: SEED_USERS[0].avatarUrl,
                  coverUrl: SEED_USERS[0].coverUrl,
                  bio: 'Usuário conectado na Lumina.',
                  email: data.email,
                  verified: false,
                  isOnline: true,
                  isDemoSeed: false,
                  followers: [],
                  following: [],
                }
              : null;

          const targetUser =
            state.users.find(
              (u) =>
                u.id === data.userId ||
                (data.username && u.username.toLowerCase() === data.username.toLowerCase())
            ) || incomingProfile;

          if (targetUser) {
            await upsertLocalCredentialCache({
              userId: targetUser.id,
              username: targetUser.username,
              email: data.email || targetUser.email,
              password,
            });
            setState((prev) => ({
              ...prev,
              users: incomingProfile
                ? mergeUsersSmart(prev.users, [incomingProfile])
                : prev.users,
              currentUserId: targetUser.id,
              isAuthenticated: true,
            }));
            setGuestBrowsing(false);
            setViewingProfileId(null);
            setIsInviteModalOpen(false);
            showToast(`Conectado como @${targetUser.username}`);
            void refreshPublicUsersFromSupabase();
            return { ok: true };
          }
        }
        backendError = data.error || '';
      }
    } catch {
      // Static hosting without backend auth endpoint
    }

    // Ensure runtime public Supabase config is hydrated if /api/site/meta is available
    let sbConfig = getBrowserSupabaseConfig();
    if (!sbConfig.anonKey) {
      try {
        const metaRes = await fetch('/api/site/meta');
        if (metaRes.ok && metaRes.headers.get('content-type')?.includes('application/json')) {
          const metaData = (await metaRes.json()) as {
            supabase?: Partial<BrowserSupabaseConfig>;
          };
          if (metaData.supabase) {
            setRuntimePublicSupabaseConfig(metaData.supabase);
            sbConfig = getBrowserSupabaseConfig();
          }
        }
      } catch {
        // Ignore on static hosts
      }
    }

    // Direct Supabase Auth fallback for static hosting & cross-device login
    const knownUserEmail =
      state.users.find((u) => u.username.toLowerCase() === cleanHandle && u.email)?.email ||
      localCred?.email;
    const supabaseEmail = rawId.includes('@') ? rawId : knownUserEmail;
    let supabaseAuthError = '';

    if (supabaseEmail && sbConfig.anonKey) {
      const sbLogin = await loginSupabaseFromBrowser(sbConfig, supabaseEmail, password);
      if (sbLogin.ok && sbLogin.userId && sbLogin.username) {
        const fallbackProfile: UserProfile = sbLogin.userProfile || {
          id: sbLogin.userId,
          uid: sbLogin.authUid,
          username: sbLogin.username,
          displayName: sbLogin.displayName || sbLogin.username,
          avatarUrl: SEED_USERS[0].avatarUrl,
          coverUrl: SEED_USERS[0].coverUrl,
          bio: 'Usuário conectado via Supabase Auth.',
          email: sbLogin.email || supabaseEmail,
          verified: false,
          isOnline: true,
          isDemoSeed: false,
          followers: [],
          following: [],
        };
        const existingSbUser = state.users.find(
          (u) =>
            u.id === fallbackProfile.id ||
            u.username.toLowerCase() === fallbackProfile.username.toLowerCase()
        );
        const resolvedProfileId = existingSbUser ? existingSbUser.id : fallbackProfile.id;
        await upsertLocalCredentialCache({
          userId: resolvedProfileId,
          username: fallbackProfile.username,
          email: sbLogin.email || supabaseEmail,
          password,
        });
        setState((prev) => ({
          ...prev,
          users: mergeUsersSmart(prev.users, [fallbackProfile]),
          currentUserId: resolvedProfileId,
          isAuthenticated: true,
        }));
        setGuestBrowsing(false);
        setViewingProfileId(null);
        setIsInviteModalOpen(false);
        showToast(`Conectado como @${fallbackProfile.username}`);
        void refreshPublicUsersFromSupabase();
        return { ok: true };
      }
      if (sbLogin.emailNotConfirmed && sbLogin.error) {
        supabaseAuthError = sbLogin.error;
      }
    }

    // Firebase Email/Password fallback (works across all browsers/devices when enabled in Firebase Console)
    const firebaseCandidateEmail =
      supabaseEmail || (cleanHandle === 'dadaniel14hiphop' ? ADMIN_EMAIL.toLowerCase() : '');
    if (firebaseCandidateEmail && firebaseCandidateEmail.includes('@')) {
      try {
        const fbCred = await signInWithEmailAndPassword(auth, firebaseCandidateEmail, password);
        if (fbCred.user) {
          if (!fbCred.user.emailVerified) {
            await signOut(auth).catch(() => {});
            return {
              ok: false,
              error: 'Confirme seu e-mail no link enviado pelo Firebase antes de entrar.',
            };
          }
          const isExclusiveAdmin =
            fbCred.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
          if (isExclusiveAdmin) {
            await ensureAdminDocIfMatched(fbCred.user).catch(() => {});
            try {
              const idToken = await fbCred.user.getIdToken();
              const adminRes = await fetch('/api/admin/auth/firebase', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
              });
              if (adminRes.ok && adminRes.headers.get('content-type')?.includes('application/json')) {
                const adminData = (await adminRes.json()) as { token?: string };
                if (adminData.token) {
                  setAdminMemoryToken(adminData.token);
                }
              } else {
                setAdminMemoryToken(`firebase_admin_${fbCred.user.uid}`);
              }
            } catch {
              setAdminMemoryToken(`firebase_admin_${fbCred.user.uid}`);
            }
          }
          const profile = await hydrateGoogleProfileSession(fbCred.user, {
            openAdminIfEligible: false,
          });
          await upsertLocalCredentialCache({
            userId: profile.id,
            username: profile.username,
            email: fbCred.user.email || firebaseCandidateEmail,
            password,
          });
          return { ok: true };
        }
      } catch (err) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code || '')
            : '';
        if (code === 'auth/too-many-requests') {
          return {
            ok: false,
            error: 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.',
          };
        }
      }
    }

    // Static hosting fallback for exclusive admin passcode (PBKDF2 in browser storage)
    if (rawId === ADMIN_EMAIL.toLowerCase() || cleanHandle === 'dadaniel14hiphop') {
      const okStatic = await verifyStaticAdminPasscode(password);
      if (okStatic) {
        activateAdminProfileSession('static_admin_local');
        showToast('Administrador conectado: @dadaniel14hiphop');
        return { ok: true };
      }
    }

    if (supabaseAuthError) {
      return { ok: false, error: supabaseAuthError };
    }
    if (backendError) {
      return { ok: false, error: backendError };
    }
    if (!usedBackendApi && !sbConfig.anonKey && rawId.includes('@')) {
      return {
        ok: false,
        error:
          'Este navegador não possui a chave pública do Supabase (VITE_SUPABASE_ANON_KEY) configurada para validar e-mail e senha remotamente. Entre com Google ou publique o site com o .env estático do Painel Admin.',
      };
    }
    if (!rawId.includes('@') && !knownUserEmail && !usedBackendApi) {
      return {
        ok: false,
        error:
          'Em outro navegador ou dispositivo, informe seu e-mail cadastrado e senha (em vez de apenas @usuário).',
      };
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

  // Cross-device persistence helpers (Express server + Supabase direct fallback)
  const persistUserPatchRemote = (
    userId: string,
    patch: Partial<
      Pick<
        UserProfile,
        'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl' | 'coverUrl' | 'followers' | 'following'
      >
    >
  ) => {
    void (async () => {
      let serverOk = false;
      try {
        const res = await fetch(`/api/social/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { supabaseSynced?: boolean };
          serverOk = Boolean(data.supabaseSynced);
        }
      } catch {
        // Static hosting fallback
      }
      if (!serverOk) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.anonKey) {
          await updateUserProfileInSupabaseBrowser(sbConfig, userId, patch);
        }
      }
    })();
  };

  const persistPostRemote = (post: Post) => {
    void (async () => {
      let serverOk = false;
      try {
        const res = await fetch('/api/social/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { supabaseSynced?: boolean };
          serverOk = Boolean(data.supabaseSynced);
        }
      } catch {
        // Static hosting fallback
      }
      if (!serverOk) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.anonKey) {
          const ok = await upsertPostToSupabaseBrowser(sbConfig, post);
          if (!ok) {
            const author = usersRef.current.find(
              (u) => !u.isDemoSeed && (u.id === post.authorId || (post.authorUid && u.uid === post.authorUid))
            );
            if (author) {
              await syncUsersToSupabaseFromBrowser(sbConfig, [author]);
              await upsertPostToSupabaseBrowser(sbConfig, post);
            }
          }
        }
      }
    })();
  };

  const persistDeletePostRemote = (postId: string) => {
    void (async () => {
      try {
        await fetch(`/api/social/posts/${encodeURIComponent(postId)}`, {
          method: 'DELETE',
        });
      } catch {
        // Ignore
      }
      const sbConfig = getBrowserSupabaseConfig();
      if (sbConfig.anonKey) {
        await deletePostFromSupabaseBrowser(sbConfig, postId);
      }
    })();
  };

  const persistStoryRemote = (story: StoryItem) => {
    void (async () => {
      let serverOk = false;
      try {
        const res = await fetch('/api/social/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ story }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { supabaseSynced?: boolean };
          serverOk = Boolean(data.supabaseSynced);
        }
      } catch {
        // Static hosting fallback
      }
      if (!serverOk) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.anonKey) {
          const ok = await upsertStoryToSupabaseBrowser(sbConfig, story);
          if (!ok) {
            const author = usersRef.current.find(
              (u) => !u.isDemoSeed && (u.id === story.authorId || (story.authorUid && u.uid === story.authorUid))
            );
            if (author) {
              await syncUsersToSupabaseFromBrowser(sbConfig, [author]);
              await upsertStoryToSupabaseBrowser(sbConfig, story);
            }
          }
        }
      }
    })();
  };

  const persistMessageRemote = (
    thread: DirectThread,
    senderId: string,
    recipientId: string,
    message: DirectThread['messages'][number]
  ) => {
    void (async () => {
      let serverOk = false;
      try {
        const res = await fetch('/api/social/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: thread.id,
            senderId,
            recipientId,
            message,
            thread,
          }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as { supabaseSynced?: boolean };
          serverOk = Boolean(data.supabaseSynced);
        }
      } catch {
        // Static hosting fallback
      }
      if (!serverOk) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.anonKey) {
          const msgPayload = {
            threadId: thread.id,
            senderId,
            recipientId,
            message,
          };
          const ok = await upsertDirectMessageToSupabaseBrowser(sbConfig, msgPayload);
          if (!ok) {
            const participants = [senderId, recipientId]
              .map((pid) =>
                usersRef.current.find((u) => !u.isDemoSeed && (u.id === pid || u.uid === pid))
              )
              .filter((u): u is UserProfile => Boolean(u));
            if (participants.length > 0) {
              await syncUsersToSupabaseFromBrowser(sbConfig, participants);
              await upsertDirectMessageToSupabaseBrowser(sbConfig, msgPayload);
            }
          }
        }
      }
    })();
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
    if (!updatedUser.isDemoSeed) {
      void upsertCachedProfiles([updatedUser]);
      persistUserPatchRemote(updatedUser.id, updates);
    }
    showToast('Perfil atualizado');
  };

  const toggleFollow = (targetUserId: string) => {
    if (!requireAuthForAction()) return;
    if (targetUserId === currentUser.id) return;
    const isFollowing = currentUser.following.includes(targetUserId);
    const targetUser = getUserById(targetUserId);
    const canonicalTargetId = targetUser?.id || targetUserId;
    const nextMeFollowing = isFollowing
      ? currentUser.following.filter((id) => id !== canonicalTargetId)
      : [...currentUser.following, canonicalTargetId];
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
        if (u.id === canonicalTargetId) {
          return { ...u, followers: nextTargetFollowers };
        }
        return u;
      });

      const newNotifs = !isFollowing
        ? [
            {
              id: `notif_${Date.now()}`,
              recipientId: canonicalTargetId,
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
    if (!currentUser.isDemoSeed) {
      persistUserPatchRemote(currentUser.id, { following: nextMeFollowing });
    }
    if (targetUser && !targetUser.isDemoSeed) {
      persistUserPatchRemote(targetUser.id, { followers: nextTargetFollowers });
    }
  };

  const syncNotificationToCloud = (notif: NotificationItem, recipientUser?: UserProfile) => {
    if (auth.currentUser && auth.currentUser.emailVerified && recipientUser?.uid) {
      void createNotificationInCloud(notif, recipientUser.uid, auth.currentUser).catch(() => {});
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

    const postAuthor = targetPost ? getUserById(targetPost.authorId) : undefined;
    const canonicalRecipientId = postAuthor?.id || targetPost?.authorId || '';
    const isSelfPost =
      !canonicalRecipientId ||
      canonicalRecipientId === currentUser.id ||
      (Boolean(currentUser.uid) && canonicalRecipientId === currentUser.uid);

    const likeNotif: NotificationItem | null =
      !alreadyLiked && targetPost && !isSelfPost
        ? {
            id: `notif_like_${postId}_${currentUser.id}_${Date.now()}`,
            recipientId: canonicalRecipientId,
            actorId: currentUser.id,
            type: 'like',
            postId,
            createdAt: Date.now(),
            read: false,
          }
        : null;

    setState((prev) => {
      const posts = prev.posts.map((p) =>
        p.id === postId ? { ...p, likes: nextLikes } : p
      );

      let notifications = prev.notifications;
      if (likeNotif) {
        const recentDuplicate = prev.notifications.some(
          (n) =>
            n.type === 'like' &&
            n.postId === postId &&
            n.actorId === prev.currentUserId &&
            n.recipientId === likeNotif.recipientId &&
            Date.now() - n.createdAt < 60_000
        );
        if (!recentDuplicate) {
          notifications = [likeNotif, ...prev.notifications];
        }
      }

      return { ...prev, posts, notifications };
    });

    if (likeNotif) {
      syncNotificationToCloud(likeNotif, postAuthor);
    }

    if (targetPost) {
      const updatedPost = { ...targetPost, likes: nextLikes };
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updatePostInteractionInCloud(updatedPost).catch(() => {});
      }
      persistPostRemote(updatedPost);
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

    if (targetPost) {
      const updatedPost = { ...targetPost, savedBy: nextSavedBy };
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updatePostInteractionInCloud(updatedPost).catch(() => {});
      }
      persistPostRemote(updatedPost);
    }
  };

  const addComment = (postId: string, text: string, parentCommentId?: string) => {
    if (!requireAuthForAction()) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const targetPost = state.posts.find((p) => p.id === postId);
    const now = Date.now();
    const nextComments = targetPost
      ? parentCommentId
        ? targetPost.comments.map((c) =>
            c.id === parentCommentId
              ? {
                  ...c,
                  replies: [
                    ...c.replies,
                    {
                      id: `rep_${now}`,
                      userId: currentUser.id,
                      text: trimmed,
                      createdAt: now,
                      likes: [],
                    },
                  ],
                }
              : c
          )
        : [
            ...targetPost.comments,
            {
              id: `com_${now}`,
              userId: currentUser.id,
              text: trimmed,
              createdAt: now,
              likes: [],
              replies: [],
            },
          ]
      : [];

    const newNotifications: Array<{ notif: NotificationItem; user?: UserProfile }> = [];
    const postAuthor = targetPost ? getUserById(targetPost.authorId) : undefined;
    const postAuthorId = postAuthor?.id || targetPost?.authorId || '';
    const isSelfPost =
      !postAuthorId ||
      postAuthorId === currentUser.id ||
      (Boolean(currentUser.uid) && postAuthorId === currentUser.uid);

    if (targetPost && !isSelfPost) {
      newNotifications.push({
        notif: {
          id: `notif_com_${now}_${Math.random().toString(36).slice(2, 6)}`,
          recipientId: postAuthorId,
          actorId: currentUser.id,
          type: 'comment',
          postId,
          text: trimmed.slice(0, 200),
          createdAt: now,
          read: false,
        },
        user: postAuthor,
      });
    }

    if (targetPost && parentCommentId) {
      const parentComment = targetPost.comments.find((c) => c.id === parentCommentId);
      if (parentComment) {
        const parentAuthor = getUserById(parentComment.userId);
        const parentAuthorId = parentAuthor?.id || parentComment.userId;
        const isSelfParent =
          parentAuthorId === currentUser.id ||
          (Boolean(currentUser.uid) && parentAuthorId === currentUser.uid);
        if (!isSelfParent && parentAuthorId !== postAuthorId) {
          newNotifications.push({
            notif: {
              id: `notif_rep_${now}_${Math.random().toString(36).slice(2, 6)}`,
              recipientId: parentAuthorId,
              actorId: currentUser.id,
              type: 'comment',
              postId,
              text: trimmed.slice(0, 200),
              createdAt: now,
              read: false,
            },
            user: parentAuthor,
          });
        }
      }
    }

    const mentionedUsers = extractMentionedUsers(trimmed, state.users, [
      currentUser.id,
      currentUser.uid || '',
    ]);
    for (const mentioned of mentionedUsers) {
      newNotifications.push({
        notif: {
          id: `notif_men_${now}_${mentioned.id}_${Math.random().toString(36).slice(2, 5)}`,
          recipientId: mentioned.id,
          actorId: currentUser.id,
          type: 'mention',
          postId,
          text: trimmed.slice(0, 200),
          createdAt: now,
          read: false,
        },
        user: mentioned,
      });
    }

    setState((prev) => {
      const posts = prev.posts.map((p) =>
        p.id === postId ? { ...p, comments: nextComments } : p
      );

      const notifications =
        newNotifications.length > 0
          ? [...newNotifications.map((entry) => entry.notif), ...prev.notifications]
          : prev.notifications;

      return { ...prev, posts, notifications };
    });

    for (const entry of newNotifications) {
      syncNotificationToCloud(entry.notif, entry.user);
    }

    if (targetPost) {
      const updatedPost = { ...targetPost, comments: nextComments };
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updatePostInteractionInCloud(updatedPost).catch(() => {});
      }
      persistPostRemote(updatedPost);
    }
  };

  const toggleLikeComment = (postId: string, commentId: string) => {
    if (!requireAuthForAction()) return;
    const targetPost = state.posts.find((p) => p.id === postId);
    const nextComments = targetPost
      ? targetPost.comments.map((c) => {
          if (c.id !== commentId) return c;
          const liked = c.likes.includes(currentUser.id);
          return {
            ...c,
            likes: liked
              ? c.likes.filter((id) => id !== currentUser.id)
              : [...c.likes, currentUser.id],
          };
        })
      : [];

    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) =>
        p.id === postId ? { ...p, comments: nextComments } : p
      ),
    }));

    if (targetPost) {
      persistPostRemote({ ...targetPost, comments: nextComments });
    }
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
    persistDeletePostRemote(postId);
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

    const now = Date.now();
    const newPost: Post = {
      id: `post_${now}_${Math.random().toString(36).slice(2, 6)}`,
      authorId: currentUser.id,
      authorUid: currentUser.uid || auth.currentUser?.uid,
      media: assets.map((asset, idx) => ({
        id: `m_${now}_${idx}`,
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
      createdAt: now,
    };

    const captionMentions = extractMentionedUsers(newPost.caption, state.users, [
      currentUser.id,
      currentUser.uid || '',
    ]).map((mentioned) => ({
      user: mentioned,
      notif: {
        id: `notif_postmen_${now}_${mentioned.id}_${Math.random().toString(36).slice(2, 5)}`,
        recipientId: mentioned.id,
        actorId: currentUser.id,
        type: 'mention' as const,
        postId: newPost.id,
        text: newPost.caption.slice(0, 200),
        createdAt: now,
        read: false,
      },
    }));

    setState((prev) => ({
      ...prev,
      posts: [newPost, ...prev.posts],
      notifications:
        captionMentions.length > 0
          ? [...captionMentions.map((m) => m.notif), ...prev.notifications]
          : prev.notifications,
    }));
    for (const entry of captionMentions) {
      syncNotificationToCloud(entry.notif, entry.user);
    }
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void createPostInCloud(newPost, currentUser, auth.currentUser).catch(() => {});
    }
    if (!currentUser.isDemoSeed) {
      persistPostRemote(newPost);
    }
    setActiveNav(payload.isReel ? 'reels' : 'feed');
    showToast(payload.isReel ? 'Reel publicado no feed' : 'Publicação compartilhada');
  };

  const publishStory = (payload: { mediaUrl: string; caption?: string; location?: string }) => {
    if (!requireAuthForAction()) return;
    const newStory: StoryItem = {
      id: `story_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      authorId: currentUser.id,
      authorUid: currentUser.uid || auth.currentUser?.uid,
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
    if (!currentUser.isDemoSeed) {
      persistStoryRemote(newStory);
    }
    setActiveNav('feed');
    showToast('Story publicado por 24 horas');
  };

  const markStoryViewed = (storyId: string) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story || story.viewedBy.includes(currentUser.id)) return;
    const nextViewed = [...story.viewedBy, currentUser.id];
    const updatedStory = { ...story, viewedBy: nextViewed };
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId ? updatedStory : s
      ),
    }));
    if (auth.currentUser && auth.currentUser.emailVerified) {
      void updateStoryInteractionInCloud(updatedStory).catch(() => {});
    }
    persistStoryRemote(updatedStory);
  };

  const reactToStory = (storyId: string, emoji: string) => {
    if (!requireAuthForAction()) return;
    const story = state.stories.find((s) => s.id === storyId);
    const nextReactions = story
      ? [...story.reactions, { userId: currentUser.id, emoji }]
      : [];
    const updatedStory = story ? { ...story, reactions: nextReactions } : null;
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId ? { ...s, reactions: nextReactions } : s
      ),
    }));
    if (updatedStory) {
      if (auth.currentUser && auth.currentUser.emailVerified) {
        void updateStoryInteractionInCloud(updatedStory).catch(() => {});
      }
      persistStoryRemote(updatedStory);
    }
    showToast(`Reação ${emoji} enviada`);
  };

  // Direct messages for real users (cross-device via Node server + Supabase + Firestore)
  const blockedUserIds = useMemo(() => {
    const raw = chatPrefs.blockedByUser[currentUser.id] || [];
    const uidRaw = currentUser.uid ? chatPrefs.blockedByUser[currentUser.uid] || [] : [];
    return Array.from(new Set([...raw, ...uidRaw]));
  }, [chatPrefs.blockedByUser, currentUser.id, currentUser.uid]);

  const mutedThreadIds = useMemo(() => {
    const raw = chatPrefs.mutedByUser[currentUser.id] || [];
    const uidRaw = currentUser.uid ? chatPrefs.mutedByUser[currentUser.uid] || [] : [];
    return Array.from(new Set([...raw, ...uidRaw]));
  }, [chatPrefs.mutedByUser, currentUser.id, currentUser.uid]);

  const pinnedThreadIds = useMemo(() => {
    const raw = chatPrefs.pinnedByUser[currentUser.id] || [];
    const uidRaw = currentUser.uid ? chatPrefs.pinnedByUser[currentUser.uid] || [] : [];
    return Array.from(new Set([...raw, ...uidRaw]));
  }, [chatPrefs.pinnedByUser, currentUser.id, currentUser.uid]);

  const isUserBlocked = (userId: string): boolean => {
    if (!userId) return false;
    const target = getUserById(userId);
    const candidates = [userId, target?.id || '', target?.uid || ''].filter(Boolean);
    return candidates.some((id) => blockedUserIds.includes(id));
  };

  const blockUser = (userId: string) => {
    if (!requireAuthForAction()) return;
    const target = getUserById(userId);
    const canonicalId = target?.id || userId;
    if (!canonicalId || canonicalId === currentUser.id) return;

    let nextBlockedForMe: string[] = [];
    setChatPrefs((prev) => {
      const existing = prev.blockedByUser[currentUser.id] || [];
      nextBlockedForMe = Array.from(new Set([...existing, canonicalId]));
      const nextStore: ChatPrefsStore = {
        ...prev,
        blockedByUser: {
          ...prev.blockedByUser,
          [currentUser.id]: nextBlockedForMe,
        },
      };
      saveChatPrefs(nextStore);
      return nextStore;
    });

    // Clear unread badge for conversations with blocked user
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) => {
        if (!t.participantIds.includes(canonicalId) && !(target?.uid && t.participantIds.includes(target.uid))) {
          return t;
        }
        return {
          ...t,
          unreadBy: t.unreadBy.filter(
            (id) => id !== currentUser.id && id !== currentUser.uid
          ),
        };
      }),
    }));

    if (activeCallRef.current && (activeCallRef.current.peerId === canonicalId || activeCallRef.current.peerId === target?.uid)) {
      endActiveCall('rejected');
    }

    if (serverSyncAvailable && !currentUser.isDemoSeed) {
      void fetch('/api/social/blocks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          blockedIds: nextBlockedForMe,
        }),
      }).catch(() => {});
    }
    showToast(
      target ? `@${target.username} bloqueado(a)` : 'Usuário bloqueado'
    );
  };

  const unblockUser = (userId: string) => {
    if (!requireAuthForAction()) return;
    const target = getUserById(userId);
    const removeSet = new Set([userId, target?.id || '', target?.uid || ''].filter(Boolean));
    let nextBlockedForMe: string[] = [];

    setChatPrefs((prev) => {
      const existing = prev.blockedByUser[currentUser.id] || [];
      nextBlockedForMe = existing.filter((id) => !removeSet.has(id));
      const nextStore: ChatPrefsStore = {
        ...prev,
        blockedByUser: {
          ...prev.blockedByUser,
          [currentUser.id]: nextBlockedForMe,
        },
      };
      saveChatPrefs(nextStore);
      return nextStore;
    });

    if (serverSyncAvailable && !currentUser.isDemoSeed) {
      void fetch('/api/social/blocks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          blockedIds: nextBlockedForMe,
        }),
      }).catch(() => {});
    }
    showToast(
      target ? `@${target.username} desbloqueado(a)` : 'Usuário desbloqueado'
    );
  };

  const toggleMuteThread = (threadId: string) => {
    if (!threadId) return;
    const willMute = !mutedThreadIds.includes(threadId);
    setChatPrefs((prev) => {
      const existing = prev.mutedByUser[currentUser.id] || [];
      const nextList = willMute
        ? Array.from(new Set([...existing, threadId]))
        : existing.filter((id) => id !== threadId);
      const nextStore: ChatPrefsStore = {
        ...prev,
        mutedByUser: {
          ...prev.mutedByUser,
          [currentUser.id]: nextList,
        },
      };
      saveChatPrefs(nextStore);
      return nextStore;
    });
    showToast(willMute ? 'Conversa silenciada' : 'Notificações da conversa reativadas');
  };

  const togglePinThread = (threadId: string) => {
    if (!threadId) return;
    const willPin = !pinnedThreadIds.includes(threadId);
    setChatPrefs((prev) => {
      const existing = prev.pinnedByUser[currentUser.id] || [];
      const nextList = willPin
        ? Array.from(new Set([threadId, ...existing]))
        : existing.filter((id) => id !== threadId);
      const nextStore: ChatPrefsStore = {
        ...prev,
        pinnedByUser: {
          ...prev.pinnedByUser,
          [currentUser.id]: nextList,
        },
      };
      saveChatPrefs(nextStore);
      return nextStore;
    });
    showToast(willPin ? 'Conversa fixada no topo' : 'Conversa desafixada');
  };

  const clearThreadMessages = (threadId: string) => {
    if (!threadId) return;
    const now = Date.now();
    threadReadWatermarkRef.current = {
      ...threadReadWatermarkRef.current,
      [threadId]: now,
    };
    saveThreadReadWatermarks(threadReadWatermarkRef.current);
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === threadId ? { ...t, messages: [], unreadBy: [], updatedAt: now } : t
      ),
    }));
    showToast('Histórico da conversa limpo neste dispositivo');
  };

  const deleteThread = (threadId: string) => {
    if (!threadId) return;
    const now = Date.now();
    threadReadWatermarkRef.current = {
      ...threadReadWatermarkRef.current,
      [threadId]: now,
    };
    saveThreadReadWatermarks(threadReadWatermarkRef.current);
    setState((prev) => ({
      ...prev,
      threads: prev.threads.filter((t) => t.id !== threadId),
    }));
    showToast('Conversa removida da lista');
  };

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
      fileUrl?: string;
      fileName?: string;
      fileMime?: string;
      fileSize?: number;
      replyToId?: string;
      replyToSenderId?: string;
      replyToText?: string;
      isCallLog?: boolean;
      callType?: CallType;
      callStatus?: 'completed' | 'missed' | 'rejected';
      callDurationSec?: number;
    }
  ) => {
    if (!requireAuthForAction()) return;
    const resolvedRecipient = getUserById(recipientId);
    const canonicalRecipientId = resolvedRecipient?.id || recipientId;
    if (!options?.isCallLog && isUserBlocked(canonicalRecipientId)) {
      showToast('Desbloqueie este usuário para enviar mensagens.');
      return;
    }

    const trimmed = text.trim();
    if (
      !trimmed &&
      !options?.sharedPostId &&
      !options?.audioUrl &&
      !options?.videoUrl &&
      !options?.fileUrl &&
      !options?.isCallLog
    ) {
      return;
    }

    const now = Date.now();
    const msgId = `dm_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const fallbackLabel = options?.isCallLog
      ? options.callType === 'video'
        ? 'Chamada de vídeo'
        : 'Chamada de áudio'
      : options?.audioUrl
      ? 'Mensagem de voz'
      : options?.videoUrl
      ? 'Vídeo'
      : options?.fileUrl
      ? `Arquivo: ${options.fileName || 'anexo'}`
      : options?.sharedPostId
      ? 'Compartilhou uma publicação'
      : '';

    const newMsg: DirectThread['messages'][number] = {
      id: msgId,
      senderId: currentUser.id,
      text: trimmed || fallbackLabel,
      sharedPostId: options?.sharedPostId,
      storyReplyUrl: options?.storyReplyUrl,
      audioUrl: options?.audioUrl,
      audioDurationSec: options?.audioDurationSec,
      videoUrl: options?.videoUrl,
      videoName: options?.videoName,
      fileUrl: options?.fileUrl,
      fileName: options?.fileName,
      fileMime: options?.fileMime,
      fileSize: options?.fileSize,
      replyToId: options?.replyToId,
      replyToSenderId: options?.replyToSenderId,
      replyToText: options?.replyToText,
      isCallLog: options?.isCallLog,
      callType: options?.callType,
      callStatus: options?.callStatus,
      callDurationSec: options?.callDurationSec,
      readBy: [currentUser.id],
      createdAt: now,
    };

    const existingThread = state.threads.find(
      (t) =>
        t.participantIds.includes(currentUser.id) &&
        (t.participantIds.includes(canonicalRecipientId) ||
          (resolvedRecipient?.uid ? t.participantIds.includes(resolvedRecipient.uid) : false))
    );

    const updatedThread: DirectThread = existingThread
      ? {
          ...existingThread,
          messages: [...existingThread.messages, newMsg],
          unreadBy:
            canonicalRecipientId !== currentUser.id ? [canonicalRecipientId] : [],
          lastReadBy: {
            ...(existingThread.lastReadBy || {}),
            [currentUser.id]: now,
          },
          updatedAt: now,
        }
      : {
          id: canonicalThreadIdForPair(currentUser.id, canonicalRecipientId),
          participantIds: [currentUser.id, canonicalRecipientId],
          messages: [newMsg],
          unreadBy:
            canonicalRecipientId !== currentUser.id ? [canonicalRecipientId] : [],
          lastReadBy: {
            [currentUser.id]: now,
          },
          updatedAt: now,
        };

    threadReadWatermarkRef.current = {
      ...threadReadWatermarkRef.current,
      [updatedThread.id]: now,
    };
    saveThreadReadWatermarks(threadReadWatermarkRef.current);

    setState((prev) => {
      const threadsList = existingThread
        ? prev.threads
            .map((t) => (t.id === existingThread.id ? updatedThread : t))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [updatedThread, ...prev.threads];

      return {
        ...prev,
        threads: threadsList,
      };
    });

    if (auth.currentUser && auth.currentUser.emailVerified) {
      const participantUids = [auth.currentUser.uid, resolvedRecipient?.uid || ''].filter(Boolean);
      void upsertThreadInCloud(updatedThread, participantUids, auth.currentUser).catch(() => {});
    }
    if (!currentUser.isDemoSeed) {
      persistMessageRemote(updatedThread, currentUser.id, canonicalRecipientId, newMsg);
    }
  };

  const markThreadRead = (threadId: string) => {
    const targetThread = state.threads.find((t) => t.id === threadId);
    const myIds = Array.from(new Set([currentUser.id, currentUser.uid || ''].filter(Boolean)));
    const myIdSet = new Set(myIds);
    const now = Date.now();

    threadReadWatermarkRef.current = {
      ...threadReadWatermarkRef.current,
      [threadId]: now,
    };
    saveThreadReadWatermarks(threadReadWatermarkRef.current);

    const hasUnread =
      targetThread &&
      (targetThread.unreadBy.some((id) => myIdSet.has(id)) ||
        targetThread.messages.some(
          (m) =>
            !myIdSet.has(m.senderId) &&
            !(m.readBy || []).some((rId) => myIdSet.has(rId))
        ));

    const partnerIds = targetThread
      ? targetThread.participantIds.filter((id) => !myIdSet.has(id))
      : [];

    const hasUnreadDmNotifs = state.notifications.some(
      (n) =>
        !n.read &&
        n.type === 'mention' &&
        !n.postId &&
        myIdSet.has(n.recipientId) &&
        partnerIds.includes(n.actorId)
    );

    if (!hasUnread && !hasUnreadDmNotifs) return;

    let nextUpdatedThread: DirectThread | null = null;
    setState((prev) => {
      const prevThreads = prev.threads.map((t) => {
        if (t.id !== threadId) return t;
        const nextLastRead = { ...(t.lastReadBy || {}) };
        for (const idVal of myIds) {
          nextLastRead[idVal] = Math.max(nextLastRead[idVal] || 0, now);
        }
        const nextMessages = t.messages.map((m) => {
          if (myIdSet.has(m.senderId)) return m;
          const existingRead = m.readBy || [];
          const hasAll = myIds.every((idVal) => existingRead.includes(idVal));
          if (hasAll && m.seenAt) return m;
          return {
            ...m,
            readBy: Array.from(new Set([...existingRead, ...myIds])),
            seenAt: m.seenAt || now,
          };
        });
        const nextThread: DirectThread = {
          ...t,
          unreadBy: t.unreadBy.filter((id) => !myIdSet.has(id)),
          lastReadBy: nextLastRead,
          messages: nextMessages,
        };
        nextUpdatedThread = nextThread;
        return nextThread;
      });

      const nextNotifications = prev.notifications.map((n) =>
        !n.read &&
        n.type === 'mention' &&
        !n.postId &&
        myIdSet.has(n.recipientId) &&
        partnerIds.includes(n.actorId)
          ? { ...n, read: true }
          : n
      );

      return {
        ...prev,
        threads: prevThreads,
        notifications: nextNotifications,
      };
    });

    if (!currentUser.isDemoSeed) {
      void (async () => {
        let serverSynced = false;
        try {
          const res = await fetch(`/api/social/threads/${encodeURIComponent(threadId)}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ readerIds: myIds, readAt: now }),
          });
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            const data = (await res.json()) as { supabaseSynced?: boolean };
            serverSynced = Boolean(data.supabaseSynced);
          }
        } catch {
          // Ignore on static hosting
        }
        if (!serverSynced) {
          const sbConfig = getBrowserSupabaseConfig();
          if (sbConfig.anonKey) {
            await markThreadMessagesReadInSupabaseBrowser(sbConfig, threadId, myIds).catch(
              () => false
            );
          }
        }
      })();
    }

    if (auth.currentUser && auth.currentUser.emailVerified && nextUpdatedThread) {
      const participantUsers = (nextUpdatedThread as DirectThread).participantIds
        .map((pid) => getUserById(pid))
        .filter((u): u is UserProfile => Boolean(u));
      const participantUids = [
        auth.currentUser.uid,
        ...participantUsers.map((u) => u.uid || '').filter(Boolean),
      ];
      void upsertThreadInCloud(nextUpdatedThread, participantUids, auth.currentUser).catch(() => {});
    }
  };

  const reactToMessage = (threadId: string, messageId: string, emoji: string) => {
    const targetThread = state.threads.find((t) => t.id === threadId);
    const targetMsg = targetThread?.messages.find((m) => m.id === messageId);
    if (!targetThread || !targetMsg) return;

    const prevMap = { ...(targetMsg.reactions || {}) };
    if (prevMap[currentUser.id] === emoji || (!Object.keys(prevMap).length && targetMsg.reaction === emoji)) {
      delete prevMap[currentUser.id];
    } else {
      prevMap[currentUser.id] = emoji;
    }
    const vals = Object.values(prevMap);
    const nextReaction = vals.length > 0 ? vals[vals.length - 1] : undefined;

    const updatedThread: DirectThread = {
      ...targetThread,
      messages: targetThread.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              reaction: nextReaction,
              reactions: Object.keys(prevMap).length > 0 ? prevMap : undefined,
            }
          : m
      ),
      updatedAt: Date.now(),
    };

    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) => (t.id === threadId ? updatedThread : t)),
    }));

    void (async () => {
      let serverSynced = false;
      try {
        const res = await fetch(
          `/api/social/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/react`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, emoji }),
          }
        );
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = (await res.json()) as { supabaseSynced?: boolean };
          serverSynced = Boolean(data.supabaseSynced);
        }
      } catch {
        // Static hosting fallback
      }
      if (!serverSynced) {
        const sbConfig = getBrowserSupabaseConfig();
        if (sbConfig.anonKey) {
          await reactToDirectMessageInSupabaseBrowser(
            sbConfig,
            messageId,
            nextReaction,
            prevMap
          ).catch(() => false);
        }
      }
    })();

    if (auth.currentUser && auth.currentUser.emailVerified) {
      const participantUids = updatedThread.participantIds
        .map((pid) => getUserById(pid)?.uid || '')
        .filter(Boolean);
      void upsertThreadInCloud(
        updatedThread,
        [auth.currentUser.uid, ...participantUids],
        auth.currentUser
      ).catch(() => {});
    }
  };

  const setTypingStatus = (recipientId: string, isTyping: boolean, threadId?: string) => {
    if (!state.isAuthenticated || !recipientId || currentUser.isDemoSeed) return;
    const resolved = getUserById(recipientId);
    const canonicalRecipientId = resolved?.id || recipientId;
    if (isUserBlocked(canonicalRecipientId)) return;

    const now = Date.now();
    const emitKey = `${canonicalRecipientId}:${isTyping ? '1' : '0'}`;
    if (isTyping && now - (lastTypingEmitRef.current[emitKey] || 0) < 1600) {
      return;
    }
    lastTypingEmitRef.current[emitKey] = now;

    channelRef.current?.postMessage({
      senderTabId: tabIdRef.current,
      type: 'typing_sync',
      fromUserId: currentUser.id,
      fromUid: currentUser.uid,
      toUserId: canonicalRecipientId,
      isTyping,
    });

    wsHandleRef.current?.send({
      type: 'chat_typing',
      fromUserId: currentUser.id,
      toUserId: canonicalRecipientId,
      isTyping,
    });

    if (serverSyncAvailable) {
      void fetch('/api/social/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId: currentUser.id,
          toUserId: canonicalRecipientId,
          threadId,
          isTyping,
        }),
      }).catch(() => {});
    }
  };

  // --- Real-Time Audio & Video Calls (WebRTC + WebSocket/REST/BroadcastChannel + Firestore) ---
  const sendCallSignal = (signal: CallSignalPayload) => {
    const peerUser = getUserById(signal.toUserId);
    const resolvedToUid = signal.toUid || peerUser?.uid;
    const enrichedSignal: CallSignalPayload = {
      ...signal,
      ...(resolvedToUid ? { toUid: resolvedToUid } : {}),
    };

    channelRef.current?.postMessage({
      senderTabId: tabIdRef.current,
      type: 'call_signal',
      signal: enrichedSignal,
    });
    const sentViaWs = wsHandleRef.current?.send({
      type: 'call_signal',
      signal: enrichedSignal,
    });
    if (!sentViaWs && serverSyncAvailable) {
      void fetch('/api/social/calls/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: enrichedSignal }),
      }).catch(() => {});
    }
    if (auth.currentUser && auth.currentUser.emailVerified) {
      const participantUids = [auth.currentUser.uid, resolvedToUid || ''].filter(Boolean);
      void sendCallSignalInCloud(enrichedSignal, participantUids, auth.currentUser).catch(() => {});
    }
  };

  const cleanupCallResources = () => {
    stopCallRingtone();
    if (callRingTimeoutRef.current !== null) {
      window.clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
      } catch {
        // Ignore close error
      }
      pcRef.current = null;
    }
    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((t) => t.stop());
      localCallStreamRef.current = null;
    }
    pendingIncomingOfferRef.current = null;
    pendingIceCandidatesRef.current.clear();
    activeCallRef.current = null;
    setLocalCallStream(null);
    setRemoteCallStream(null);
    setIsCallMicMuted(false);
    setIsCallCameraOff(false);
    setActiveCall(null);
  };

  const acquireCallMedia = async (callType: CallType, facing: 'user' | 'environment'): Promise<{ stream: MediaStream; cameraUnavailable: boolean }> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Navegador sem suporte a chamadas de áudio/vídeo.');
    }
    if (callType === 'video') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        return { stream, cameraUnavailable: false };
      } catch {
        // Fallback to audio-only if camera hardware/permission is unavailable
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        return { stream: audioOnly, cameraUnavailable: true };
      }
    }
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream: audioStream, cameraUnavailable: false };
  };

  const logCallInChat = (
    peerId: string,
    callType: CallType,
    callStatus: 'completed' | 'missed' | 'rejected',
    durationSec?: number
  ) => {
    const label =
      callStatus === 'completed'
        ? `${callType === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio'} encerrada`
        : callStatus === 'rejected'
        ? `${callType === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio'} recusada`
        : `${callType === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio'} perdida`;
    sendMessage(peerId, label, {
      isCallLog: true,
      callType,
      callStatus,
      callDurationSec: durationSec,
    });
  };

  const endActiveCall = (reasonStatus?: 'completed' | 'missed' | 'rejected') => {
    const session = activeCallRef.current;
    if (!session) {
      cleanupCallResources();
      return;
    }
    const peer = getUserById(session.peerId);
    const durationSec =
      session.startedAt && session.status === 'connected'
        ? Math.max(1, Math.round((Date.now() - session.startedAt) / 1000))
        : undefined;

    if (session.direction === 'incoming' && session.status === 'ringing') {
      sendCallSignal({
        callId: session.callId,
        type: 'call:reject',
        fromUserId: currentUser.id,
        fromUid: currentUser.uid,
        toUserId: session.peerId,
        toUid: session.peerUid || peer?.uid,
        reason: 'rejected',
        createdAt: Date.now(),
      });
    } else {
      sendCallSignal({
        callId: session.callId,
        type: 'call:end',
        fromUserId: currentUser.id,
        fromUid: currentUser.uid,
        toUserId: session.peerId,
        toUid: session.peerUid || peer?.uid,
        reason: reasonStatus || 'completed',
        createdAt: Date.now(),
      });

      const resolvedStatus: 'completed' | 'missed' | 'rejected' =
        reasonStatus || (session.status === 'connected' ? 'completed' : 'missed');
      if (session.direction === 'outgoing' || session.status === 'connected') {
        logCallInChat(session.peerId, session.callType, resolvedStatus, durationSec);
      }
    }

    cleanupCallResources();
  };

  const startCall = async (peerId: string, callType: CallType) => {
    if (!requireAuthForAction()) return;
    if (activeCallRef.current) {
      showToast('Você já está em uma chamada ativa.');
      return;
    }
    const target = getUserById(peerId);
    const canonicalPeerId = target?.id || peerId;
    if (!canonicalPeerId || canonicalPeerId === currentUser.id) return;
    if (isUserBlocked(canonicalPeerId)) {
      showToast('Desbloqueie este usuário antes de iniciar uma chamada.');
      return;
    }

    try {
      const { stream, cameraUnavailable } = await acquireCallMedia(callType, callFacingMode);
      if (cameraUnavailable) {
        showToast('Câmera indisponível — chamada iniciada apenas com áudio');
        setIsCallCameraOff(true);
      } else {
        setIsCallCameraOff(callType === 'audio');
      }
      setIsCallMicMuted(false);
      localCallStreamRef.current = stream;
      setLocalCallStream(stream);

      const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const threadId = canonicalThreadIdForPair(currentUser.id, canonicalPeerId);

      const pc = createCallPeerConnection({
        onIceCandidate: (candidate) => {
          sendCallSignal({
            callId,
            type: 'call:ice',
            fromUserId: currentUser.id,
            fromUid: currentUser.uid,
            toUserId: canonicalPeerId,
            toUid: target?.uid,
            candidate,
            createdAt: Date.now(),
          });
        },
        onRemoteTrack: (remoteStream) => {
          setRemoteCallStream(remoteStream);
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'connected') {
            stopCallRingtone();
            if (callRingTimeoutRef.current !== null) {
              window.clearTimeout(callRingTimeoutRef.current);
              callRingTimeoutRef.current = null;
            }
            setActiveCall((prev) =>
              prev && prev.callId === callId
                ? { ...prev, status: 'connected', startedAt: prev.startedAt || Date.now() }
                : prev
            );
          } else if (connState === 'failed') {
            showToast('Falha de conexão na chamada');
            endActiveCall('missed');
          }
        },
      });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      await pc.setLocalDescription(offer);

      const outgoingSession: ActiveCallSession = {
        callId,
        threadId,
        peerId: canonicalPeerId,
        peerUid: target?.uid,
        direction: 'outgoing',
        callType,
        status: 'ringing',
        minimized: false,
      };
      activeCallRef.current = outgoingSession;
      setActiveCall(outgoingSession);

      startCallRingtone('outgoing');
      sendCallSignal({
        callId,
        type: 'call:invite',
        fromUserId: currentUser.id,
        fromUid: currentUser.uid,
        fromUsername: currentUser.username,
        fromDisplayName: currentUser.displayName,
        fromAvatarUrl: currentUser.avatarUrl,
        toUserId: canonicalPeerId,
        toUid: target?.uid,
        callType,
        threadId,
        sdp: offer,
        createdAt: Date.now(),
      });

      callRingTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === callId && activeCallRef.current.status === 'ringing') {
          showToast('Chamada não atendida');
          endActiveCall('missed');
        }
      }, 45_000);
    } catch {
      cleanupCallResources();
      showToast('Permita acesso ao microfone/câmera para iniciar chamadas.');
    }
  };

  const acceptIncomingCall = async () => {
    const session = activeCallRef.current;
    const offerSignal = pendingIncomingOfferRef.current;
    if (!session || session.direction !== 'incoming' || !offerSignal?.sdp) return;

    stopCallRingtone();
    if (callRingTimeoutRef.current !== null) {
      window.clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = null;
    }

    try {
      const { stream, cameraUnavailable } = await acquireCallMedia(session.callType, callFacingMode);
      if (cameraUnavailable && session.callType === 'video') {
        showToast('Câmera indisponível — atendendo com áudio');
        setIsCallCameraOff(true);
      } else {
        setIsCallCameraOff(session.callType === 'audio');
      }
      setIsCallMicMuted(false);
      localCallStreamRef.current = stream;
      setLocalCallStream(stream);

      const peer = getUserById(session.peerId);
      const pc = createCallPeerConnection({
        onIceCandidate: (candidate) => {
          sendCallSignal({
            callId: session.callId,
            type: 'call:ice',
            fromUserId: currentUser.id,
            fromUid: currentUser.uid,
            toUserId: session.peerId,
            toUid: session.peerUid || peer?.uid,
            candidate,
            createdAt: Date.now(),
          });
        },
        onRemoteTrack: (remoteStream) => {
          setRemoteCallStream(remoteStream);
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'connected') {
            setActiveCall((prev) =>
              prev && prev.callId === session.callId
                ? { ...prev, status: 'connected', startedAt: prev.startedAt || Date.now() }
                : prev
            );
          } else if (connState === 'failed') {
            showToast('Conexão de chamada interrompida');
            endActiveCall('completed');
          }
        },
      });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(offerSignal.sdp));
      const queuedIce = pendingIceCandidatesRef.current.get(session.callId) || [];
      for (const ice of queuedIce) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(ice));
        } catch {
          // Ignore stale ICE
        }
      }
      pendingIceCandidatesRef.current.delete(session.callId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setActiveCall((prev) =>
        prev && prev.callId === session.callId
          ? { ...prev, status: 'connecting', startedAt: Date.now() }
          : prev
      );

      sendCallSignal({
        callId: session.callId,
        type: 'call:answer',
        fromUserId: currentUser.id,
        fromUid: currentUser.uid,
        toUserId: session.peerId,
        toUid: session.peerUid || peer?.uid,
        callType: session.callType,
        sdp: answer,
        createdAt: Date.now(),
      });
    } catch {
      rejectIncomingCall();
      showToast('Não foi possível acessar microfone/câmera para atender.');
    }
  };

  const rejectIncomingCall = () => {
    endActiveCall('rejected');
  };

  const toggleCallMic = () => {
    const stream = localCallStreamRef.current;
    const nextMuted = !isCallMicMuted;
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
    setIsCallMicMuted(nextMuted);
    const session = activeCallRef.current;
    if (session) {
      sendCallSignal({
        callId: session.callId,
        type: 'call:media-state',
        fromUserId: currentUser.id,
        fromUid: currentUser.uid,
        toUserId: session.peerId,
        toUid: session.peerUid,
        micMuted: nextMuted,
        camOff: isCallCameraOff,
        createdAt: Date.now(),
      });
    }
  };

  const toggleCallCamera = async () => {
    const stream = localCallStreamRef.current;
    const session = activeCallRef.current;
    if (!stream || !session) return;
    const nextOff = !isCallCameraOff;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks.forEach((t) => {
        t.enabled = !nextOff;
      });
      setIsCallCameraOff(nextOff);
    } else if (!nextOff) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: callFacingMode },
        });
        const newTrack = camStream.getVideoTracks()[0];
        if (newTrack) {
          stream.addTrack(newTrack);
          const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(newTrack);
          } else {
            pcRef.current?.addTrack(newTrack, stream);
          }
          setLocalCallStream(new MediaStream(stream.getTracks()));
          setIsCallCameraOff(false);
        }
      } catch {
        showToast('Câmera indisponível neste dispositivo');
        return;
      }
    }
    sendCallSignal({
      callId: session.callId,
      type: 'call:media-state',
      fromUserId: currentUser.id,
      fromUid: currentUser.uid,
      toUserId: session.peerId,
      toUid: session.peerUid,
      micMuted: isCallMicMuted,
      camOff: nextOff,
      createdAt: Date.now(),
    });
  };

  const switchCallCamera = async () => {
    const stream = localCallStreamRef.current;
    const session = activeCallRef.current;
    if (!stream || !session) return;
    const nextFacing = callFacingMode === 'user' ? 'environment' : 'user';
    try {
      const nextCam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
      });
      const newTrack = nextCam.getVideoTracks()[0];
      if (!newTrack) return;
      const oldTrack = stream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
      if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.addTrack(newTrack);
      setLocalCallStream(new MediaStream(stream.getTracks()));
      setCallFacingMode(nextFacing);
      setIsCallCameraOff(false);
    } catch {
      showToast('Não foi possível alternar a câmera neste dispositivo');
    }
  };

  const toggleMinimizeCall = () => {
    setActiveCall((prev) => (prev ? { ...prev, minimized: !prev.minimized } : null));
  };

  // Keep incoming WebRTC signal handler always pointing to latest closures
  handleCallSignalRef.current = (sig: CallSignalPayload) => {
    if (!sig?.callId || !sig?.type) return;
    const dedupeKey = `${sig.callId}:${sig.type}:${sig.createdAt}:${sig.candidate ? sig.candidate.candidate?.slice(0, 18) : ''}`;
    if (seenCallSignalsRef.current.has(dedupeKey)) return;
    seenCallSignalsRef.current.add(dedupeKey);
    if (seenCallSignalsRef.current.size > 200) {
      const first = seenCallSignalsRef.current.values().next().value;
      if (first) seenCallSignalsRef.current.delete(first);
    }

    const myIds = new Set([currentUser.id, currentUser.uid || ''].filter(Boolean));
    if (myIds.has(sig.fromUserId) || (sig.fromUid && myIds.has(sig.fromUid))) return;
    if (!myIds.has(sig.toUserId) && !(sig.toUid && myIds.has(sig.toUid))) return;

    // Ignore calls from blocked users
    if (isUserBlocked(sig.fromUserId) || (sig.fromUid && isUserBlocked(sig.fromUid))) {
      if (sig.type === 'call:invite') {
        sendCallSignal({
          callId: sig.callId,
          type: 'call:busy',
          fromUserId: currentUser.id,
          fromUid: currentUser.uid,
          toUserId: sig.fromUserId,
          toUid: sig.fromUid,
          reason: 'blocked',
          createdAt: Date.now(),
        });
      }
      return;
    }

    if (sig.type === 'call:invite') {
      if (activeCallRef.current && activeCallRef.current.callId !== sig.callId) {
        sendCallSignal({
          callId: sig.callId,
          type: 'call:busy',
          fromUserId: currentUser.id,
          fromUid: currentUser.uid,
          toUserId: sig.fromUserId,
          toUid: sig.fromUid,
          reason: 'busy',
          createdAt: Date.now(),
        });
        return;
      }

      // Ensure caller profile exists locally so UI renders their name/avatar
      if (!getUserById(sig.fromUserId) && sig.fromUsername) {
        mergeExternalUsers([
          {
            id: sig.fromUserId,
            uid: sig.fromUid,
            username: sig.fromUsername,
            displayName: sig.fromDisplayName || sig.fromUsername,
            avatarUrl: sig.fromAvatarUrl || '/og-preview.jpg',
            bio: '',
            followers: [],
            following: [],
            isOnline: true,
            isDemoSeed: false,
          },
        ]);
      }

      pendingIncomingOfferRef.current = sig;
      const threadId = sig.threadId || canonicalThreadIdForPair(currentUser.id, sig.fromUserId);
      const incomingSession: ActiveCallSession = {
        callId: sig.callId,
        threadId,
        peerId: sig.fromUserId,
        peerUid: sig.fromUid,
        direction: 'incoming',
        callType: sig.callType || 'audio',
        status: 'ringing',
        minimized: false,
      };
      activeCallRef.current = incomingSession;
      setActiveCall(incomingSession);

      const mutedList = chatPrefsRef.current.mutedByUser[currentUser.id] || [];
      if (!mutedList.includes(threadId)) {
        startCallRingtone('incoming');
      }

      if (callRingTimeoutRef.current !== null) {
        window.clearTimeout(callRingTimeoutRef.current);
      }
      callRingTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === sig.callId && activeCallRef.current.status === 'ringing') {
          cleanupCallResources();
        }
      }, 45_000);
      return;
    }

    // Buffer early ICE candidates per callId even before activeCall state finishes mounting
    if (sig.type === 'call:ice' && sig.candidate) {
      const currentSession = activeCallRef.current;
      if (
        currentSession &&
        currentSession.callId === sig.callId &&
        pcRef.current &&
        pcRef.current.remoteDescription
      ) {
        void pcRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {});
      } else {
        const list = pendingIceCandidatesRef.current.get(sig.callId) || [];
        list.push(sig.candidate);
        pendingIceCandidatesRef.current.set(sig.callId, list);
      }
      return;
    }

    const currentSession = activeCallRef.current;
    if (!currentSession || currentSession.callId !== sig.callId) return;

    if (sig.type === 'call:answer' && sig.sdp && pcRef.current) {
      stopCallRingtone();
      if (callRingTimeoutRef.current !== null) {
        window.clearTimeout(callRingTimeoutRef.current);
        callRingTimeoutRef.current = null;
      }
      void (async () => {
        try {
          await pcRef.current?.setRemoteDescription(new RTCSessionDescription(sig.sdp!));
          const queuedIce = pendingIceCandidatesRef.current.get(sig.callId) || [];
          for (const ice of queuedIce) {
            try {
              await pcRef.current?.addIceCandidate(new RTCIceCandidate(ice));
            } catch {
              // Ignore stale ICE
            }
          }
          pendingIceCandidatesRef.current.delete(sig.callId);
          setActiveCall((prev) =>
            prev && prev.callId === sig.callId
              ? { ...prev, status: 'connecting', startedAt: prev.startedAt || Date.now() }
              : prev
          );
        } catch {
          endActiveCall('missed');
        }
      })();
      return;
    }

    if (sig.type === 'call:media-state') {
      setActiveCall((prev) =>
        prev && prev.callId === sig.callId
          ? {
              ...prev,
              remoteMicMuted: sig.micMuted,
              remoteCamOff: sig.camOff,
            }
          : prev
      );
      return;
    }

    if (sig.type === 'call:reject') {
      showToast('Chamada recusada');
      if (currentSession.direction === 'outgoing') {
        logCallInChat(currentSession.peerId, currentSession.callType, 'rejected');
      }
      cleanupCallResources();
      return;
    }

    if (sig.type === 'call:busy') {
      showToast(
        sig.reason === 'blocked'
          ? 'Não foi possível completar a chamada.'
          : 'Usuário ocupado em outra chamada.'
      );
      if (currentSession.direction === 'outgoing') {
        logCallInChat(currentSession.peerId, currentSession.callType, 'missed');
      }
      cleanupCallResources();
      return;
    }

    if (sig.type === 'call:end') {
      showToast('Chamada encerrada');
      cleanupCallResources();
    }
  };

  useEffect(() => {
    if (!state.isAuthenticated && activeCallRef.current) {
      cleanupCallResources();
    }
  }, [state.isAuthenticated, state.currentUserId]);

  useEffect(() => {
    return () => {
      cleanupCallResources();
    };
  }, []);

  const markNotificationsRead = () => {
    const myIdSet = new Set([currentUser.id, currentUser.uid || ''].filter(Boolean));
    const unreadIds = state.notifications
      .filter((n) => myIdSet.has(n.recipientId) && !n.read)
      .map((n) => n.id);
    if (unreadIds.length === 0) return;

    for (const id of unreadIds) {
      readNotifIdsRef.current.add(id);
    }
    saveReadNotifIds(readNotifIdsRef.current);

    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        myIdSet.has(n.recipientId) ? { ...n, read: true } : n
      ),
    }));

    if (auth.currentUser && auth.currentUser.emailVerified) {
      void markNotificationsReadInCloud(unreadIds, auth.currentUser).catch(() => {});
    }
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
    const preservedRealUsers = readCachedProfilesSync();
    setState({
      currentUserId: 'user_daniel',
      isAuthenticated: true,
      users:
        preservedRealUsers.length > 0
          ? mergeUsersSmart(SEED_USERS, preservedRealUsers)
          : SEED_USERS,
      posts: SEED_POSTS,
      stories: SEED_STORIES,
      threads: SEED_THREADS,
      notifications: SEED_NOTIFICATIONS,
      recentSearches: ['arquitetura', 'clara.lentes', '35mm'],
      theme: state.theme,
    });
    showToast('Feed restaurado para os dados originais');
  };

  const persistAdminFlagUpdate = (
    userId: string,
    target: UserProfile | undefined,
    patch: Partial<{ verified: boolean; boosted: boolean; restricted: boolean }>,
    tokenOverride?: string | null
  ) => {
    const now = Date.now();
    const cleanHandle = target?.username
      ? target.username.trim().toLowerCase().replace(/^@/, '')
      : '';
    const keysToMark = [userId, target?.uid || '', cleanHandle ? `handle:${cleanHandle}` : ''].filter(
      Boolean
    );

    const localMap = loadLocalAdminUserFlags();
    const prevMerged =
      pendingAdminFlagsRef.current[userId] ||
      serverAdminFlagsRef.current[userId] ||
      localMap[userId] ||
      (cleanHandle
        ? pendingAdminFlagsRef.current[`handle:${cleanHandle}`] ||
          serverAdminFlagsRef.current[`handle:${cleanHandle}`] ||
          localMap[`handle:${cleanHandle}`]
        : undefined);

    const entry: AdminUserFlagOverride = {
      ...(prevMerged || {}),
      id: userId,
      ...(cleanHandle ? { username: cleanHandle } : {}),
      ...patch,
      updatedAt: now,
      expiresAt: now + 90_000,
    };

    const persistentEntry: AdminUserFlagOverride = {
      id: entry.id,
      username: entry.username,
      verified: entry.verified,
      boosted: entry.boosted,
      restricted: entry.restricted,
      updatedAt: now,
    };

    for (const k of keysToMark) {
      pendingAdminFlagsRef.current[k] = entry;
      serverAdminFlagsRef.current[k] = persistentEntry;
      localMap[k] = persistentEntry;
    }
    saveLocalAdminUserFlags(localMap);

    if (target && !target.isDemoSeed) {
      void upsertCachedProfiles([{ ...target, ...patch }]);
    }

    if (target && isExclusiveAdminUser(auth.currentUser)) {
      void adminUpdateProfileFlagsInCloud(
        {
          ...target,
          verified:
            typeof patch.verified === 'boolean' ? patch.verified : Boolean(target.verified),
          boosted:
            typeof patch.boosted === 'boolean' ? patch.boosted : Boolean(target.boosted),
          restricted:
            typeof patch.restricted === 'boolean'
              ? patch.restricted
              : Boolean(target.restricted),
        },
        auth.currentUser!
      ).catch(() => {
        showToast(
          'Alterado localmente, mas não foi possível gravar no Firestore. Verifique sua conexão.'
        );
      });
    }

    const sbConfig = getBrowserSupabaseConfig();
    if (sbConfig.anonKey) {
      void updateUserFlagsInSupabaseBrowser(sbConfig, {
        userId,
        username: cleanHandle || undefined,
        ...patch,
      }).catch(() => {});
    }

    if (serverSyncAvailable) {
      void (async () => {
        const exchangeFirebaseAdminToken = async (): Promise<string | null> => {
          if (!isExclusiveAdminUser(auth.currentUser)) return null;
          try {
            const idToken = await auth.currentUser!.getIdToken();
            const exRes = await fetch('/api/admin/auth/firebase', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
            });
            if (exRes.ok && exRes.headers.get('content-type')?.includes('application/json')) {
              const exData = (await exRes.json()) as { token?: string };
              if (exData.token) {
                setAdminMemoryToken(exData.token);
                return exData.token;
              }
            }
          } catch {
            // Keep existing token
          }
          return null;
        };

        let token = tokenOverride || adminMemoryToken;
        if (!token || token.startsWith('firebase_admin_') || token === 'static_admin_local') {
          const exchanged = await exchangeFirebaseAdminToken();
          if (exchanged) token = exchanged;
        }
        if (!token || token.startsWith('firebase_admin_') || token === 'static_admin_local') {
          return;
        }
        const sendFlagPatch = (bearer: string) =>
          fetch(`/api/admin/users/${encodeURIComponent(userId)}/flags`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify({
              ...patch,
              username: cleanHandle || undefined,
              uid: target?.uid || undefined,
            }),
          });
        try {
          let res = await sendFlagPatch(token);
          if (res.status === 401 && isExclusiveAdminUser(auth.currentUser)) {
            const refreshed = await exchangeFirebaseAdminToken();
            if (refreshed) {
              res = await sendFlagPatch(refreshed);
            }
          }
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            const data = (await res.json()) as {
              updatedAt?: number;
              userFlags?: AdminUserFlagOverrideMap;
            };
            if (data.userFlags) {
              serverAdminFlagsRef.current = data.userFlags;
              const mergedLocal = { ...loadLocalAdminUserFlags(), ...data.userFlags };
              saveLocalAdminUserFlags(mergedLocal);
            }
            if (data.updatedAt) {
              lastServerUpdatedAtRef.current = Math.max(
                lastServerUpdatedAtRef.current,
                data.updatedAt
              );
            }
          }
        } catch {
          // Non-fatal: localMap + pendingAdminFlagsRef keep UI consistent
        }
      })();
    }
  };

  const applyFlagPatchToMatchingUsers = (
    usersList: UserProfile[],
    userId: string,
    target: UserProfile | undefined,
    patch: Partial<{ verified: boolean; boosted: boolean; restricted: boolean }>
  ): UserProfile[] => {
    const cleanHandle = target?.username
      ? target.username.trim().toLowerCase().replace(/^@/, '')
      : '';
    return usersList.map((u) => {
      const uHandle = u.username.trim().toLowerCase().replace(/^@/, '');
      const matches =
        u.id === userId ||
        (target?.uid && (u.uid === target.uid || u.id === target.uid)) ||
        (!target?.isDemoSeed && !u.isDemoSeed && cleanHandle && uHandle === cleanHandle);
      return matches ? { ...u, ...patch } : u;
    });
  };

  const toggleRestrictUser = (userId: string, tokenOverride?: string | null) => {
    const target = state.users.find((u) => u.id === userId || u.uid === userId);
    const nextVal = !target?.restricted;
    if (target) {
      showToast(
        nextVal
          ? `@${target.username} foi restringido`
          : `Restrição removida de @${target.username}`
      );
    }
    persistAdminFlagUpdate(target?.id || userId, target, { restricted: nextVal }, tokenOverride);
    setState((prev) => ({
      ...prev,
      users: applyFlagPatchToMatchingUsers(prev.users, target?.id || userId, target, {
        restricted: nextVal,
      }),
    }));
  };

  const toggleBoostUser = (userId: string, tokenOverride?: string | null) => {
    const target = state.users.find((u) => u.id === userId || u.uid === userId);
    const nextVal = !target?.boosted;
    if (target) {
      showToast(
        nextVal
          ? `Perfil @${target.username} impulsionado no feed`
          : `Impulsionamento desativado para @${target.username}`
      );
    }
    persistAdminFlagUpdate(target?.id || userId, target, { boosted: nextVal }, tokenOverride);
    setState((prev) => ({
      ...prev,
      users: applyFlagPatchToMatchingUsers(prev.users, target?.id || userId, target, {
        boosted: nextVal,
      }),
    }));
  };

  const toggleVerifyUser = (userId: string, tokenOverride?: string | null) => {
    const target = state.users.find((u) => u.id === userId || u.uid === userId);
    const nextVal = !target?.verified;
    if (target) {
      showToast(
        nextVal
          ? `Selo de verificação concedido a @${target.username}`
          : `Selo de verificação removido de @${target.username}`
      );
    }
    persistAdminFlagUpdate(target?.id || userId, target, { verified: nextVal }, tokenOverride);
    setState((prev) => ({
      ...prev,
      users: applyFlagPatchToMatchingUsers(prev.users, target?.id || userId, target, {
        verified: nextVal,
      }),
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
        pendingProfileSlug,
        setPendingProfileSlug,
        profileLookupLoading,
        profileMediaLoading,
        exploreQuery,
        selectedPostId,
        activeStoryAuthorId,
        isCreateOpen,
        sharePostId,
        toastMessage,
        siteMeta,
        setSiteMeta: handleSetSiteMeta,
        refreshSiteMeta,
        refreshPublicUsersFromSupabase,
        mergeExternalUsers,
        demoMigrationStatus,
        migrateDemoToFirestore,
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
        setGuestBrowsing: (guest) => {
          setGuestBrowsing(guest);
          if (guest) {
            void refreshPublicUsersFromSupabase();
          }
        },
        firebaseUser,
        cloudConnected,
        adminMemoryToken,
        setAdminMemoryToken,
        activateAdminProfileSession,
        loginWithGoogle,
        loginWithGoogleRedirect,
        logout,
        hasPasswordForCurrentUser,
        hasPasswordForUser,
        changePassword,
        createInvite,
        revokeInvite,
        registerWithInvite,
        registerRealUser,
        loginWithCredentials,
        purgeDemoUsers,
        pendingChatUserId,
        setPendingChatUserId,
        openChatWithUser,
        setActiveNav: (nav) => {
          setPendingProfileSlug(null);
          if (nav === 'profile') {
            setViewingProfileId(currentUser.id);
          } else {
            setViewingProfileId(null);
          }
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
        activeCall,
        localCallStream,
        remoteCallStream,
        isCallMicMuted,
        isCallCameraOff,
        callFacingMode,
        startCall,
        acceptIncomingCall,
        rejectIncomingCall,
        endActiveCall,
        toggleCallMic,
        toggleCallCamera,
        switchCallCamera,
        toggleMinimizeCall,
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
