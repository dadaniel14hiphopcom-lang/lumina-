import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createZipBuffer } from './server/zip.ts';
import type { ZipEntryInput } from './server/zip.ts';
import {
  buildReelObjectKey,
  getAwsCredentialsFromEnv,
  getSignedReelDownloadUrl,
  getSignedReelUploadUrl,
  headS3Bucket,
  isSafeS3ObjectKey,
  resolveAwsS3Config,
  resolveReelPlaybackUrl,
  sanitizeAwsRegion,
  sanitizeCloudFrontDomain,
  sanitizeS3Bucket,
  uploadReelToS3,
} from './server/s3Service.ts';
import {
  detectGoogleCloudRuntime,
  getGcpServiceAccountFromEnv,
  getSignedGcsDownloadUrl,
  isSafeGcsObjectKey,
  probeGcsBucket,
  readFirebaseAppletConfig,
  resolveGcsPlaybackUrl,
  sanitizeGcpHostingDomain,
  sanitizeGcpProjectId,
  sanitizeGcpRegion,
  sanitizeGcsBucket,
  uploadMediaToGcs,
} from './server/gcpService.ts';
import { normalizeVideoFileForWeb } from './server/videoTranscoder.ts';
import {
  DEFAULT_SUPABASE_URL,
  deletePostFromSupabase,
  fetchDirectThreadsForUserFromSupabase,
  fetchPublicPostsFromSupabase,
  fetchPublicRealUsersFromSupabase,
  fetchPublicStoriesFromSupabase,
  fetchPublicUserByUsernameFromSupabase,
  isSecretSupabaseKey,
  markThreadMessagesReadInSupabase,
  reactToMessageInSupabase,
  registerOrSyncUserToSupabase,
  resolveSupabaseEmailByUsername,
  testSupabaseConnection,
  updateUserInSupabase,
  upsertMessageToSupabase,
  upsertPostToSupabase,
  upsertStoryToSupabase,
  verifySupabasePasswordLogin,
} from './server/supabaseService.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.resolve(process.cwd());
const ADMIN_AUTH_FILE = path.join(ROOT_DIR, '.lumina-admin-auth.json');
const ADMIN_STATE_FILE = path.join(ROOT_DIR, '.lumina-admin-state.json');
const USER_AUTH_FILE = path.join(ROOT_DIR, '.lumina-user-auth.json');
const SOCIAL_STATE_FILE = path.join(ROOT_DIR, '.lumina-social-state.json');
const POST_PREVIEWS_FILE = path.join(ROOT_DIR, '.lumina-post-previews.json');
const USER_BLOCKS_FILE = path.join(ROOT_DIR, '.lumina-user-blocks.json');
const UPLOADS_DIR = path.join(ROOT_DIR, '.lumina-uploads');

const FALLBACK_RANDOM_KEY = crypto.randomBytes(32);
const ADMIN_EMAIL = 'dadaniel14hiphop.com@gmail.com';

function loadFirebaseProjectId(): string | null {
  try {
    const cfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Ignore invalid firebase config
  }
  return null;
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();
let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (cachedFirebaseCerts && cachedFirebaseCerts.expiresAt > Date.now()) {
    return cachedFirebaseCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Falha ao obter certificados públicos do Firebase Auth.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.min(86400, Math.max(60, Number(maxAgeMatch[1]))) : 3600;
  cachedFirebaseCerts = { certs, expiresAt: Date.now() + maxAgeSec * 1000 };
  return certs;
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email: string; emailVerified: boolean }> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Firebase não configurado no servidor.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new Error('Token Firebase inválido.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Cabeçalho JWT inválido.');
  }

  const certs = await getFirebasePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('Chave pública do token não encontrada.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const validSig = verifier.verify(certPem, Buffer.from(sigB64, 'base64url'));
  if (!validSig) {
    throw new Error('Assinatura do token Firebase inválida.');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Audience do token incompatível.');
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error('Issuer do token incompatível.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new Error('UID do token inválido.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Token Firebase expirado.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 600) {
    throw new Error('Data de emissão do token inválida.');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSec + 600) {
    throw new Error('auth_time inválido.');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
  };
}

interface AdminAuthRecord {
  email?: string;
  salt: string;
  hash: string;
  createdAt: number;
}

interface UserAuthRecord {
  userId: string;
  username: string;
  email?: string;
  salt: string;
  hash: string;
  createdAt: number;
}

interface SharedSocialState {
  version: number;
  updatedAt: number;
  users: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  stories: Record<string, unknown>[];
  threads: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
}

interface PostPreviewRecord {
  id: string;
  authorUsername: string;
  authorDisplayName: string;
  caption: string;
  isReel: boolean;
  imageUrl?: string;
  authorAvatarUrl?: string;
  videoUrl?: string;
  updatedAt: number;
}

let memoryAuthRecord: AdminAuthRecord | null = null;
let memoryAdminState: IntegrationState | null = null;
let memoryUserAuthRecords: UserAuthRecord[] | null = null;
let memorySocialState: SharedSocialState | null = null;
let memoryPostPreviews: Map<string, PostPreviewRecord> | null = null;
let supabaseUsersCache: { fetchedAt: number; users: Record<string, unknown>[] } | null = null;
let supabaseContentCache: {
  fetchedAt: number;
  posts: Record<string, unknown>[];
  stories: Record<string, unknown>[];
} | null = null;
const deletedPostIds = new Set<string>();
const typingStateMap = new Map<
  string,
  { fromUserId: string; toUserId: string; threadId?: string; updatedAt: number }
>();

let memoryUserBlocks: Record<string, string[]> | null = null;
function readUserBlocksStore(): Record<string, string[]> {
  if (memoryUserBlocks) return memoryUserBlocks;
  try {
    if (fs.existsSync(USER_BLOCKS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_BLOCKS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        memoryUserBlocks = parsed as Record<string, string[]>;
        return memoryUserBlocks;
      }
    }
  } catch {
    // Ignore malformed blocks store
  }
  memoryUserBlocks = {};
  return memoryUserBlocks;
}

function writeUserBlocksStore(store: Record<string, string[]>): void {
  memoryUserBlocks = store;
  try {
    fs.writeFileSync(USER_BLOCKS_FILE, JSON.stringify(store), 'utf8');
  } catch {
    // Keep in memory if filesystem is read-only
  }
}

function isUserBlockedPair(userIdA: string, userIdB: string): boolean {
  if (!userIdA || !userIdB) return false;
  const store = readUserBlocksStore();
  const listA = store[userIdA] || [];
  const listB = store[userIdB] || [];
  return listA.includes(userIdB) || listB.includes(userIdA);
}

interface QueuedCallSignal {
  id: string;
  signal: Record<string, unknown>;
  createdAt: number;
}

const callSignalQueueMap = new Map<string, QueuedCallSignal[]>();
const wsClientsByUserId = new Map<string, Set<WebSocket>>();

function sendRealtimeToUserIds(userIds: string[], payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);
  const delivered = new Set<WebSocket>();
  for (const uid of userIds) {
    if (!uid) continue;
    const sockets = wsClientsByUserId.get(uid);
    if (!sockets) continue;
    for (const sock of sockets) {
      if (delivered.has(sock)) continue;
      if (sock.readyState === WebSocket.OPEN) {
        try {
          sock.send(serialized);
          delivered.add(sock);
        } catch {
          // Ignore broken socket write
        }
      }
    }
  }
}

function broadcastRealtimeEvent(payload: Record<string, unknown>, excludeUserIds: string[] = []): void {
  const serialized = JSON.stringify(payload);
  const excludeSockets = new Set<WebSocket>();
  for (const uid of excludeUserIds) {
    if (!uid) continue;
    const set = wsClientsByUserId.get(uid);
    if (!set) continue;
    for (const sock of set) excludeSockets.add(sock);
  }
  const delivered = new Set<WebSocket>();
  for (const sockets of wsClientsByUserId.values()) {
    for (const sock of sockets) {
      if (delivered.has(sock) || excludeSockets.has(sock)) continue;
      if (sock.readyState === WebSocket.OPEN) {
        try {
          sock.send(serialized);
          delivered.add(sock);
        } catch {
          // Ignore broken socket write
        }
      }
    }
  }
}

function resolveCallRecipientIds(toId: string, toUid?: string): string[] {
  const ids = new Set<string>();
  if (toId) ids.add(toId);
  if (toUid) ids.add(toUid);
  const social = readSharedSocialState();
  if (social?.users) {
    const matched = social.users.find(
      (u) =>
        (toId && String(u.id || '') === toId) ||
        (toId && typeof u.uid === 'string' && u.uid === toId) ||
        (toUid && (String(u.id || '') === toUid || u.uid === toUid))
    );
    if (matched) {
      if (typeof matched.id === 'string' && matched.id) ids.add(matched.id);
      if (typeof matched.uid === 'string' && matched.uid) ids.add(matched.uid);
    }
  }
  return Array.from(ids);
}

function setUserPresenceInSharedState(
  targetIds: string[],
  isOnline: boolean,
  lastActiveAtMs: number
): { userId?: string; uid?: string; changed: boolean } {
  const cleanIds = Array.from(new Set(targetIds.map((s) => s.trim()).filter(Boolean)));
  if (cleanIds.length === 0) return { changed: false };
  const idSet = new Set(cleanIds);
  const social = readSharedSocialState();
  if (!social) return { changed: false };
  let matchedUserId: string | undefined;
  let matchedUid: string | undefined;
  let changed = false;

  const updatedUsers = social.users.map((u) => {
    const uid = typeof u.uid === 'string' ? u.uid : undefined;
    const id = typeof u.id === 'string' ? u.id : undefined;
    if ((id && idSet.has(id)) || (uid && idSet.has(uid))) {
      matchedUserId = id;
      matchedUid = uid;
      if (u.isOnline !== isOnline || Number(u.lastActiveAtMs || 0) < lastActiveAtMs) {
        changed = true;
      }
      return {
        ...u,
        isOnline,
        lastActiveAtMs,
      };
    }
    return u;
  });

  if (changed) {
    writeSharedSocialState({
      ...social,
      version: (social.version || 0) + 1,
      updatedAt: lastActiveAtMs,
      users: updatedUsers,
    });
  }
  return { userId: matchedUserId || cleanIds[0], uid: matchedUid, changed };
}

function enqueueCallSignalForUserIds(recipientIds: string[], signal: Record<string, unknown>): void {
  const now = Date.now();
  const cutoff = now - 45_000;
  const id = `sig_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const item: QueuedCallSignal = { id, signal, createdAt: now };

  for (const uid of recipientIds) {
    if (!uid) continue;
    const prev = (callSignalQueueMap.get(uid) || []).filter((s) => s.createdAt >= cutoff);
    prev.push(item);
    callSignalQueueMap.set(uid, prev.slice(-80));
  }
  sendRealtimeToUserIds(recipientIds, { type: 'call_signal', signal });
}

interface IntegrationState {
  aws: {
    region: string;
    bucket: string;
    cloudFrontDomain: string;
    sesSender: string;
    s3Enabled: boolean;
    cloudFrontEnabled: boolean;
    sesEnabled: boolean;
    rekognitionEnabled: boolean;
    lastVerifiedAt: number | null;
  };
  supabase: {
    projectUrl: string;
    schemaName: string;
    anonKey?: string;
    autoSyncUsers: boolean;
    autoSyncPosts: boolean;
    rlsEnforced: boolean;
    lastVerifiedAt: number | null;
    lastStatus: string | null;
  };
  wordpress: {
    siteUrl: string;
    siteTitle: string;
    dbEngine: 'mariadb-11' | 'mysql-8';
    dbName: string;
    tablePrefix: string;
    phpVersion: '8.3' | '8.2';
    permalinks: string;
    sslEnabled: boolean;
    redisCache: boolean;
    disableXmlRpc: boolean;
    maintenanceMode: boolean;
    lastSyncedAt: number | null;
  };
  gcp: {
    projectId: string;
    firestoreDatabaseId: string;
    region: string;
    hostingService: 'cloud-run' | 'firebase-hosting' | 'app-engine';
    hostingDomain: string;
    gcsBucket: string;
    firestoreEnabled: boolean;
    hostingEnabled: boolean;
    gcsMediaEnabled: boolean;
    cloudSqlNote?: string;
    lastVerifiedAt: number | null;
    lastStatus: string | null;
  };
  site: {
    version: string;
    channel: 'stable' | 'beta';
    announcementBanner: string;
    maintenanceMode: boolean;
    realUsersOnly: boolean;
    videoRules: {
      maxVideoSizeMB: number;
      maxReelDurationSec: number;
      allowVideoReels: boolean;
    };
    updateHistory: {
      id: string;
      version: string;
      source: 'upload' | 'remote';
      notes: string[];
      appliedAt: number;
    }[];
  };
  invites: {
    id: string;
    code: string;
    email: string;
    invitedName?: string;
    grantVerified: boolean;
    status: 'pending' | 'accepted' | 'revoked';
    createdAt: number;
    expiresAt: number;
    acceptedByUserId?: string;
  }[];
  userFlags?: Record<
    string,
    {
      id?: string;
      username?: string;
      verified?: boolean;
      boosted?: boolean;
      restricted?: boolean;
      updatedAt: number;
    }
  >;
}

const DEFAULT_ADMIN_STATE: IntegrationState = {
  aws: {
    region: process.env.AWS_REGION || 'sa-east-1',
    bucket: process.env.AWS_S3_BUCKET || 'lumina-media-prod',
    cloudFrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN || 'cdn.lumina.social',
    sesSender: 'no-reply@lumina.social',
    s3Enabled: true,
    cloudFrontEnabled: true,
    sesEnabled: false,
    rekognitionEnabled: true,
    lastVerifiedAt: null,
  },
  supabase: {
    projectUrl: process.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL,
    schemaName: 'public',
    anonKey: '',
    autoSyncUsers: true,
    autoSyncPosts: true,
    rlsEnforced: true,
    lastVerifiedAt: null,
    lastStatus: null,
  },
  wordpress: {
    siteUrl: process.env.WORDPRESS_SITE_URL || '',
    siteTitle: 'Lumina Editorial WP',
    dbEngine: 'mariadb-11',
    dbName: 'lumina_wp',
    tablePrefix: 'wp_lum_',
    phpVersion: '8.3',
    permalinks: '/%postname%/',
    sslEnabled: true,
    redisCache: true,
    disableXmlRpc: true,
    maintenanceMode: false,
    lastSyncedAt: null,
  },
  gcp: (() => {
    const fbDefaults = readFirebaseAppletConfig();
    return {
      projectId: sanitizeGcpProjectId(process.env.GCP_PROJECT_ID, fbDefaults.projectId),
      firestoreDatabaseId: fbDefaults.firestoreDatabaseId,
      region: sanitizeGcpRegion(process.env.GCP_REGION, 'us-east1'),
      hostingService: 'cloud-run',
      hostingDomain: sanitizeGcpHostingDomain(
        process.env.GCP_HOSTING_DOMAIN,
        fbDefaults.hostingDomain
      ),
      gcsBucket: sanitizeGcsBucket(process.env.GCS_BUCKET, fbDefaults.storageBucket),
      firestoreEnabled: true,
      hostingEnabled: true,
      gcsMediaEnabled: false,
      cloudSqlNote: '',
      lastVerifiedAt: null,
      lastStatus: null,
    };
  })(),
  site: {
    version: '2.4.0',
    channel: 'stable',
    announcementBanner: '',
    maintenanceMode: false,
    realUsersOnly: true,
    videoRules: {
      maxVideoSizeMB: 25,
      maxReelDurationSec: 60,
      allowVideoReels: true,
    },
    updateHistory: [
      {
        id: 'upd_init',
        version: '2.4.0',
        source: 'remote',
        notes: [
          'Seletor de tema claro/escuro na navegação',
          'Mensagens de voz e vídeo no bate-papo',
          'Indicador de status ativo nas miniaturas',
        ],
        appliedAt: Date.now() - 86_400_000,
      },
    ],
  },
  invites: [],
  userFlags: {},
};

function readAdminState(): IntegrationState {
  if (memoryAdminState) {
    return memoryAdminState;
  }
  try {
    if (fs.existsSync(ADMIN_STATE_FILE)) {
      const raw = fs.readFileSync(ADMIN_STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IntegrationState>;
      return {
        aws: { ...DEFAULT_ADMIN_STATE.aws, ...(parsed.aws || {}) },
        supabase: (() => {
          const rawSchema = String(parsed.supabase?.schemaName || '').trim();
          const schemaLooksLikeKey =
            /^sb_(publishable|secret)_/i.test(rawSchema) ||
            /^eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/.test(rawSchema) ||
            rawSchema.length > 32;
          const cleanSchema = schemaLooksLikeKey
            ? 'public'
            : rawSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'public';
          const candidateAnon =
            parsed.supabase?.anonKey && !isSecretSupabaseKey(parsed.supabase.anonKey)
              ? String(parsed.supabase.anonKey).trim().slice(0, 600)
              : schemaLooksLikeKey && !isSecretSupabaseKey(rawSchema)
              ? rawSchema.slice(0, 600)
              : '';
          return {
            ...DEFAULT_ADMIN_STATE.supabase,
            ...(parsed.supabase || {}),
            projectUrl:
              (parsed.supabase?.projectUrl || '').trim() ||
              DEFAULT_ADMIN_STATE.supabase.projectUrl,
            schemaName: /^[a-z_][a-z0-9_]*$/.test(cleanSchema) ? cleanSchema : 'public',
            anonKey: candidateAnon,
          };
        })(),
        wordpress: { ...DEFAULT_ADMIN_STATE.wordpress, ...(parsed.wordpress || {}) },
        gcp: {
          ...DEFAULT_ADMIN_STATE.gcp,
          ...(parsed.gcp || {}),
          firestoreDatabaseId: DEFAULT_ADMIN_STATE.gcp.firestoreDatabaseId,
        },
        site: {
          ...DEFAULT_ADMIN_STATE.site,
          ...(parsed.site || {}),
          videoRules: {
            ...DEFAULT_ADMIN_STATE.site.videoRules,
            ...(parsed.site?.videoRules || {}),
          },
        },
        invites: Array.isArray(parsed.invites) ? parsed.invites : [],
        userFlags:
          parsed.userFlags && typeof parsed.userFlags === 'object' && !Array.isArray(parsed.userFlags)
            ? parsed.userFlags
            : {},
      };
    }
  } catch {
    // Fallback to default state
  }
  memoryAdminState = structuredClone(DEFAULT_ADMIN_STATE);
  return memoryAdminState;
}

function writeAdminState(state: IntegrationState): void {
  memoryAdminState = structuredClone(state);
  try {
    fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Hosting filesystem may be read-only; keep state in memory
  }
}

function readAuthRecord(): AdminAuthRecord | null {
  if (memoryAuthRecord) return memoryAuthRecord;
  try {
    if (fs.existsSync(ADMIN_AUTH_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ADMIN_AUTH_FILE, 'utf8')) as AdminAuthRecord;
      if (parsed.salt && parsed.hash) {
        memoryAuthRecord = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore invalid file
  }
  return null;
}

function getSessionSigningKey(): Buffer {
  if (process.env.SESSION_SECRET?.trim()) {
    return crypto.createHash('sha256').update(process.env.SESSION_SECRET.trim()).digest();
  }
  if (process.env.ADMIN_PASSCODE?.trim()) {
    return crypto
      .createHash('sha256')
      .update(`lumina-session:${process.env.ADMIN_PASSCODE.trim()}`)
      .digest();
  }
  const record = readAuthRecord();
  if (record) {
    return crypto
      .createHash('sha256')
      .update(`lumina-session:${record.salt}:${record.hash}`)
      .digest();
  }
  return FALLBACK_RANDOM_KEY;
}

function hashPasscode(passcode: string, salt: string): string {
  return crypto.scryptSync(passcode, salt, 64).toString('hex');
}

function verifyPasscode(passcode: string): boolean {
  const envPasscode = process.env.ADMIN_PASSCODE?.trim();
  if (envPasscode) {
    const a = Buffer.from(passcode, 'utf8');
    const b = Buffer.from(envPasscode, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  const record = readAuthRecord();
  if (!record) return false;
  const candidate = Buffer.from(hashPasscode(passcode, record.salt), 'hex');
  const stored = Buffer.from(record.hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function readUserAuthRecords(): UserAuthRecord[] {
  if (memoryUserAuthRecords) return memoryUserAuthRecords;
  try {
    if (fs.existsSync(USER_AUTH_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_AUTH_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        memoryUserAuthRecords = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore malformed user auth store
  }
  return [];
}

function writeUserAuthRecords(records: UserAuthRecord[]): void {
  memoryUserAuthRecords = records;
  try {
    fs.writeFileSync(USER_AUTH_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch {
    // Keep in memory if hosting filesystem is read-only
  }
}

function verifyUserPassword(password: string, record: UserAuthRecord): boolean {
  const candidate = Buffer.from(hashPasscode(password, record.salt), 'hex');
  const stored = Buffer.from(record.hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function readSharedSocialState(): SharedSocialState | null {
  if (memorySocialState) return memorySocialState;
  try {
    if (fs.existsSync(SOCIAL_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SOCIAL_STATE_FILE, 'utf8')) as SharedSocialState;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.posts)) {
        memorySocialState = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore malformed social state file
  }
  return null;
}

function writeSharedSocialState(next: SharedSocialState): void {
  memorySocialState = next;
  try {
    fs.writeFileSync(SOCIAL_STATE_FILE, JSON.stringify(next), 'utf8');
  } catch {
    // Keep in memory if filesystem is read-only
  }
}

function mergeByIdRecords(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
  limit: number,
  sortField?: 'createdAt' | 'updatedAt'
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of existing) {
    if (item && typeof item.id === 'string' && item.id) {
      map.set(item.id, item);
    }
  }
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
    } else if (Array.isArray(prev.messages) && Array.isArray(item.messages)) {
      const msgMap = new Map<string, Record<string, unknown>>();
      const mergeMsg = (base: Record<string, unknown> | undefined, inc: Record<string, unknown>) => {
        if (!base) return inc;
        const prevReadBy = Array.isArray(base.readBy) ? (base.readBy as string[]) : [];
        const incReadBy = Array.isArray(inc.readBy) ? (inc.readBy as string[]) : [];
        const mergedReadBy = Array.from(new Set([...prevReadBy, ...incReadBy]));
        const prevReactions =
          base.reactions && typeof base.reactions === 'object' && !Array.isArray(base.reactions)
            ? (base.reactions as Record<string, string>)
            : {};
        const incReactions =
          inc.reactions && typeof inc.reactions === 'object' && !Array.isArray(inc.reactions)
            ? (inc.reactions as Record<string, string>)
            : {};
        const mergedReactions = { ...prevReactions, ...incReactions };
        const mergedSeenAt =
          typeof base.seenAt === 'number' || typeof inc.seenAt === 'number'
            ? Math.max(Number(base.seenAt || 0), Number(inc.seenAt || 0))
            : undefined;
        return {
          ...base,
          ...inc,
          ...(mergedReadBy.length > 0 ? { readBy: mergedReadBy } : {}),
          ...(Object.keys(mergedReactions).length > 0 ? { reactions: mergedReactions } : {}),
          ...(mergedSeenAt ? { seenAt: mergedSeenAt } : {}),
        };
      };
      for (const m of prev.messages as Record<string, unknown>[]) {
        if (m && typeof m.id === 'string') msgMap.set(m.id, m);
      }
      for (const m of item.messages as Record<string, unknown>[]) {
        if (m && typeof m.id === 'string') msgMap.set(m.id, mergeMsg(msgMap.get(m.id), m));
      }
      const mergedMessages = Array.from(msgMap.values()).sort(
        (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)
      );
      const prevLastRead =
        prev.lastReadBy && typeof prev.lastReadBy === 'object' && !Array.isArray(prev.lastReadBy)
          ? (prev.lastReadBy as Record<string, number>)
          : {};
      const incLastRead =
        item.lastReadBy && typeof item.lastReadBy === 'object' && !Array.isArray(item.lastReadBy)
          ? (item.lastReadBy as Record<string, number>)
          : {};
      const mergedLastRead: Record<string, number> = { ...prevLastRead };
      for (const [uid, ts] of Object.entries(incLastRead)) {
        mergedLastRead[uid] = Math.max(Number(mergedLastRead[uid] || 0), Number(ts || 0));
      }
      const prevUnread = Array.isArray(prev.unreadBy) ? (prev.unreadBy as string[]) : [];
      const incUnread = Array.isArray(item.unreadBy) ? (item.unreadBy as string[]) : [];
      const candidateUnread = Array.from(new Set([...prevUnread, ...incUnread]));
      const filteredUnread = candidateUnread.filter((uid) => {
        const readAt = Number(mergedLastRead[uid] || 0);
        const hasUnreadFromOther = mergedMessages.some((m) => {
          const sender = String(m.senderId || '');
          if (!sender || sender === uid) return false;
          const mReadBy = Array.isArray(m.readBy) ? (m.readBy as string[]) : [];
          if (mReadBy.includes(uid)) return false;
          return Number(m.createdAt || 0) > readAt;
        });
        return hasUnreadFromOther;
      });
      map.set(item.id, {
        ...prev,
        ...item,
        messages: mergedMessages,
        unreadBy: filteredUnread,
        ...(Object.keys(mergedLastRead).length > 0 ? { lastReadBy: mergedLastRead } : {}),
        updatedAt: Math.max(Number(prev.updatedAt || 0), Number(item.updatedAt || 0)),
      });
    } else if ('recipientId' in item && 'actorId' in item && 'read' in item) {
      map.set(item.id, {
        ...prev,
        ...item,
        read: Boolean(prev.read || item.read),
      });
    } else {
      map.set(item.id, { ...prev, ...item });
    }
  }
  const arr = Array.from(map.values());
  if (sortField) {
    arr.sort((a, b) => Number(b[sortField] || 0) - Number(a[sortField] || 0));
  }
  return arr.slice(0, limit);
}

function mergeSharedUsersList(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  const list = existing.map((u) => {
    const copy = { ...u };
    delete copy.email;
    return copy;
  });

  for (const raw of incoming) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.username !== 'string') continue;
    const item: Record<string, unknown> = { ...raw };
    delete item.email;
    const cleanUname = raw.username.trim().toLowerCase();
    const isDemo = item.isDemoSeed === true;
    const matchIdx = list.findIndex(
      (u) =>
        u.id === item.id ||
        (!isDemo &&
          u.isDemoSeed !== true &&
          typeof u.username === 'string' &&
          u.username.trim().toLowerCase() === cleanUname)
    );
    if (matchIdx === -1) {
      list.push(item);
    } else {
      const prev = list[matchIdx];
      const prevFollowers = Array.isArray(prev.followers) ? prev.followers : [];
      const incFollowers = Array.isArray(item.followers) ? item.followers : [];
      const prevFollowing = Array.isArray(prev.following) ? prev.following : [];
      const incFollowing = Array.isArray(item.following) ? item.following : [];
      const prevActive = typeof prev.lastActiveAtMs === 'number' ? prev.lastActiveAtMs : 0;
      const incActive = typeof item.lastActiveAtMs === 'number' ? item.lastActiveAtMs : 0;
      const mergedIsOnline =
        typeof item.isOnline === 'boolean' && (incActive >= prevActive || prev.isOnline === undefined)
          ? item.isOnline
          : typeof prev.isOnline === 'boolean'
          ? prev.isOnline
          : false;
      const mergedLastActive = Math.max(prevActive, incActive) || undefined;

      list[matchIdx] = {
        ...prev,
        ...item,
        id: String(prev.id || item.id),
        uid: item.uid || prev.uid,
        isOnline: mergedIsOnline,
        ...(mergedLastActive ? { lastActiveAtMs: mergedLastActive } : {}),
        // Preserve existing moderation/verification flags against unauthenticated sync payloads
        verified: prev.verified !== undefined ? Boolean(prev.verified) : Boolean(item.verified),
        boosted: prev.boosted !== undefined ? Boolean(prev.boosted) : Boolean(item.boosted),
        restricted: prev.restricted !== undefined ? Boolean(prev.restricted) : Boolean(item.restricted),
        avatarUrl:
          typeof item.avatarUrl === 'string' && item.avatarUrl.trim() && item.avatarUrl !== '/og-preview.jpg'
            ? item.avatarUrl
            : prev.avatarUrl || item.avatarUrl,
        coverUrl: item.coverUrl || prev.coverUrl,
        bio: typeof item.bio === 'string' && item.bio.trim() ? item.bio : prev.bio,
        website: item.website || prev.website,
        displayName:
          typeof item.displayName === 'string' && item.displayName.trim()
            ? item.displayName
            : prev.displayName,
        followers: incFollowers.length >= prevFollowers.length ? incFollowers : prevFollowers,
        following: incFollowing.length >= prevFollowing.length ? incFollowing : prevFollowing,
      };
    }
  }
  return list.slice(0, 250);
}

function applyAuthoritativeUserFlags(
  users: Record<string, unknown>[],
  userFlags?: IntegrationState['userFlags']
): Record<string, unknown>[] {
  if (!userFlags || Object.keys(userFlags).length === 0) return users;
  return users.map((u) => {
    const id = typeof u.id === 'string' ? u.id : '';
    const uid = typeof u.uid === 'string' ? u.uid : '';
    const handle =
      typeof u.username === 'string' ? u.username.trim().toLowerCase().replace(/^@/, '') : '';
    const match =
      (id && userFlags[id]) ||
      (uid && userFlags[uid]) ||
      (handle && userFlags[`handle:${handle}`]) ||
      undefined;
    if (!match) return u;
    return {
      ...u,
      ...(typeof match.verified === 'boolean' ? { verified: match.verified } : {}),
      ...(typeof match.boosted === 'boolean' ? { boosted: match.boosted } : {}),
      ...(typeof match.restricted === 'boolean' ? { restricted: match.restricted } : {}),
    };
  });
}

function signSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      exp: Date.now() + 12 * 60 * 60 * 1000,
      jti: crypto.randomBytes(12).toString('hex'),
    }),
    'utf8'
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { role?: string; exp?: number };
    return decoded.role === 'admin' && typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Autenticação administrativa necessária.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!verifySessionToken(token)) {
    res.status(401).json({ error: 'Sessão administrativa expirada ou inválida.' });
    return;
  }
  next();
}

function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    ) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrBlockedIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

async function validateExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL inválida.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Apenas protocolos HTTP ou HTTPS são permitidos.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Hosts internos ou locais não são permitidos.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrBlockedIp(host)) {
      throw new Error('Endereços IP privados ou reservados não são permitidos.');
    }
  } else {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0 || records.some((r) => isPrivateOrBlockedIp(r.address))) {
      throw new Error('O domínio resolveu para um endereço de rede privado ou inválido.');
    }
  }

  return parsed;
}

function sanitizeIdentifier(value: string, fallback: string, pattern = /[^a-zA-Z0-9_-]/g): string {
  const cleaned = value.replace(pattern, '').slice(0, 48);
  return cleaned || fallback;
}

function sanitizeHost(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 100);
  return cleaned || fallback;
}

function collectAllowlistedProjectFiles(): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  const topFiles = [
    'package.json',
    'index.html',
    'metadata.json',
    'tsconfig.json',
    'vite.config.ts',
    '.env.example',
    '.gitignore',
    '.nvmrc',
    '.node-version',
    'server.ts',
  ];

  for (const rel of topFiles) {
    const full = path.resolve(ROOT_DIR, rel);
    if (full.startsWith(ROOT_DIR + path.sep) && fs.existsSync(full)) {
      entries.push({ name: rel, content: fs.readFileSync(full) });
    }
  }

  const walkDir = (dirRel: string) => {
    const baseDir = path.resolve(ROOT_DIR, dirRel);
    if (!baseDir.startsWith(ROOT_DIR + path.sep) || !fs.existsSync(baseDir)) return;

    const items = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const item of items) {
      const itemRel = path.posix.join(dirRel, item.name);
      const itemFull = path.resolve(ROOT_DIR, itemRel);
      if (!itemFull.startsWith(ROOT_DIR + path.sep)) continue;

      if (item.isDirectory()) {
        if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.git') continue;
        walkDir(itemRel);
      } else if (item.isFile()) {
        if (item.name.endsWith('.env') || item.name.startsWith('.lumina-admin')) continue;
        entries.push({ name: itemRel, content: fs.readFileSync(itemFull) });
      }
    }
  };

  walkDir('src');
  walkDir('server');
  walkDir('public');
  return entries;
}

function isSafePreviewMediaUrl(raw?: string): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 560_000) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return true;
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function readPostPreviewsMap(): Map<string, PostPreviewRecord> {
  if (memoryPostPreviews) return memoryPostPreviews;
  const map = new Map<string, PostPreviewRecord>();
  try {
    if (fs.existsSync(POST_PREVIEWS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(POST_PREVIEWS_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id)) {
            map.set(item.id, item as PostPreviewRecord);
          }
        }
      }
    }
  } catch {
    // Ignore malformed preview store
  }
  memoryPostPreviews = map;
  return map;
}

function writePostPreviewsMap(map: Map<string, PostPreviewRecord>): void {
  memoryPostPreviews = map;
  try {
    const entries = Array.from(map.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 300);
    fs.writeFileSync(POST_PREVIEWS_FILE, JSON.stringify(entries), 'utf8');
  } catch {
    // Keep in memory if filesystem is read-only
  }
}

function resolvePostPreviewData(postId: string): {
  authorLabel: string;
  caption: string;
  isReel: boolean;
  rawImage?: string;
  rawVideo?: string;
} | null {
  const previewMap = readPostPreviewsMap();
  const cached = previewMap.get(postId);
  if (cached) {
    const authorLabel = cached.authorUsername
      ? `@${cached.authorUsername.replace(/^@/, '')}`
      : cached.authorDisplayName || 'Lumina';
    return {
      authorLabel,
      caption: cached.caption || '',
      isReel: Boolean(cached.isReel),
      rawImage: cached.imageUrl || cached.authorAvatarUrl,
      rawVideo: cached.videoUrl,
    };
  }

  const sharedState = readSharedSocialState();
  const matchedPost = sharedState?.posts.find((p) => p.id === postId) as
    | {
        authorId?: string;
        caption?: string;
        isReel?: boolean;
        media?: { url?: string; mediaType?: string }[];
      }
    | undefined;
  if (!matchedPost) return null;

  const matchedAuthor = sharedState?.users.find((u) => u.id === matchedPost.authorId) as
    | { username?: string; displayName?: string; avatarUrl?: string }
    | undefined;
  const authorLabel = matchedAuthor?.username
    ? `@${matchedAuthor.username.replace(/^@/, '')}`
    : matchedAuthor?.displayName || 'Lumina';
  const firstImg = matchedPost.media?.find(
    (m) => m.mediaType !== 'video' && isSafePreviewMediaUrl(m.url)
  )?.url;
  const firstVid = matchedPost.media?.find(
    (m) => m.mediaType === 'video' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url)
  )?.url;
  const fallbackAvatar = isSafePreviewMediaUrl(matchedAuthor?.avatarUrl)
    ? matchedAuthor?.avatarUrl
    : undefined;

  return {
    authorLabel,
    caption: typeof matchedPost.caption === 'string' ? matchedPost.caption.trim() : '',
    isReel: Boolean(matchedPost.isReel),
    rawImage: firstImg || fallbackAvatar,
    rawVideo: firstVid,
  };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePublicOrigin(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Fallback to request host headers
    }
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = forwardedProto === 'https' || req.secure ? 'https' : 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : `localhost:${PORT}`;
  return `${proto}://${safeHost}`;
}

function injectLinkPreviewMeta(html: string, req: Request): string {
  const origin = resolvePublicOrigin(req);
  const defaultTitle = 'Lumina — Rede Social Visual';
  const defaultDescription =
    'Rede social visual com feed em tempo real, stories interativos, reels em vídeo, estúdio de filtros e mensagens diretas na Lumina.';
  const defaultImage = `${origin}/og-preview.jpg`;

  let ogType = 'website';
  let title = defaultTitle;
  let description = defaultDescription;
  let imageUrl = defaultImage;
  let imageAlt = 'Lumina — Rede Social Visual com feed, stories, reels e mensagens';
  let canonicalUrl = `${origin}/`;

  const queryPostParam = typeof req.query.post === 'string' ? req.query.post.trim() : '';
  const pathMatch = req.path.match(/^\/(?:p|post)\/([a-zA-Z0-9_-]{1,128})\/?$/);
  const postParam = queryPostParam || (pathMatch ? pathMatch[1] : '');
  const inviteParam = typeof req.query.invite === 'string' ? req.query.invite.trim().toUpperCase() : '';
  const rawProfileQuery =
    (typeof req.query.perfil === 'string' && req.query.perfil) ||
    (typeof req.query.profile === 'string' && req.query.profile) ||
    (typeof req.query.u === 'string' && req.query.u) ||
    (typeof req.query.user === 'string' && req.query.user) ||
    '';
  const profilePathMatch = req.path.match(/^\/(?:@|perfil\/)([a-zA-Z0-9._]{2,40})\/?$/i);
  const profileParam = (rawProfileQuery.trim().replace(/^@/, '') || (profilePathMatch ? profilePathMatch[1] : ''))
    .toLowerCase()
    .slice(0, 40);

  if (postParam && /^[a-zA-Z0-9_-]{1,128}$/.test(postParam)) {
    canonicalUrl = `${origin}/?post=${encodeURIComponent(postParam)}`;
    const resolved = resolvePostPreviewData(postParam);

    if (resolved) {
      ogType = resolved.isReel ? 'video.other' : 'article';
      title = resolved.isReel
        ? `Reel de ${resolved.authorLabel} na Lumina`
        : `Publicação de ${resolved.authorLabel} na Lumina`;
      imageAlt = title;
      if (resolved.caption) {
        description = resolved.caption.slice(0, 155);
      }
      if (resolved.rawImage) {
        if (/^https?:\/\//i.test(resolved.rawImage)) {
          imageUrl = resolved.rawImage;
        } else if (resolved.rawImage.startsWith('data:image/')) {
          imageUrl = `${origin}/api/og/image/${encodeURIComponent(postParam)}.jpg`;
        } else if (resolved.rawImage.startsWith('/')) {
          imageUrl = `${origin}${resolved.rawImage}`;
        }
      }
    } else {
      ogType = 'article';
      title = 'Publicação na Lumina — Rede Social Visual';
      imageAlt = title;
    }
  } else if (profileParam && /^[a-z0-9._]{2,40}$/.test(profileParam)) {
    canonicalUrl = `${origin}/?perfil=${encodeURIComponent(profileParam)}`;
    ogType = 'profile';
    const shared = readSharedSocialState();
    const candidates = [...(shared?.users || []), ...(supabaseUsersCache?.users || [])];
    const matchedProfile = candidates.find(
      (u) =>
        (typeof u.username === 'string' && u.username.toLowerCase() === profileParam) ||
        (typeof u.id === 'string' && u.id.toLowerCase() === profileParam)
    ) as
      | { username?: string; displayName?: string; bio?: string; avatarUrl?: string }
      | undefined;
    if (matchedProfile) {
      const uname = (matchedProfile.username || profileParam).replace(/^@/, '');
      const dname = matchedProfile.displayName?.trim() || uname;
      title = `${dname} (@${uname}) na Lumina`;
      description =
        matchedProfile.bio?.trim().slice(0, 155) ||
        `Veja o perfil e as publicações de @${uname} na Lumina.`;
      imageAlt = title;
      if (matchedProfile.avatarUrl && isSafePreviewMediaUrl(matchedProfile.avatarUrl)) {
        if (/^https?:\/\//i.test(matchedProfile.avatarUrl)) {
          imageUrl = matchedProfile.avatarUrl;
        } else if (matchedProfile.avatarUrl.startsWith('/')) {
          imageUrl = `${origin}${matchedProfile.avatarUrl}`;
        }
      }
    } else {
      title = `@${profileParam} na Lumina`;
      description = `Confira o perfil de @${profileParam} na Lumina.`;
      imageAlt = title;
    }
  } else if (inviteParam && /^[A-Z0-9_-]{4,32}$/.test(inviteParam)) {
    canonicalUrl = `${origin}/?invite=${encodeURIComponent(inviteParam)}`;
    title = 'Convite exclusivo para entrar na Lumina';
    description =
      'Você recebeu um convite para criar sua conta e compartilhar fotos, stories e reels na Lumina.';
    imageAlt = title;
  }

  const safeType = escapeHtmlAttr(ogType);
  const safeTitle = escapeHtmlAttr(title);
  const safeDesc = escapeHtmlAttr(description);
  const safeUrl = escapeHtmlAttr(canonicalUrl);
  const safeImage = escapeHtmlAttr(imageUrl);
  const safeAlt = escapeHtmlAttr(imageAlt);

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${safeDesc}" />`
    )
    .replace(
      /<link\s+rel="canonical"[^>]*>/i,
      `<link rel="canonical" href="${safeUrl}" />`
    )
    .replace(
      /<meta\s+property="og:type"[^>]*>/i,
      `<meta property="og:type" content="${safeType}" />`
    )
    .replace(
      /<meta\s+property="og:url"[^>]*>/i,
      `<meta property="og:url" content="${safeUrl}" />`
    )
    .replace(
      /<meta\s+property="og:title"[^>]*>/i,
      `<meta property="og:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+property="og:description"[^>]*>/i,
      `<meta property="og:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"[^>]*>/i,
      `<meta property="og:image" content="${safeImage}" />`
    )
    .replace(
      /<meta\s+property="og:image:secure_url"[^>]*>/i,
      `<meta property="og:image:secure_url" content="${safeImage}" />`
    )
    .replace(
      /<meta\s+property="og:image:alt"[^>]*>/i,
      `<meta property="og:image:alt" content="${safeAlt}" />`
    )
    .replace(
      /<meta\s+name="twitter:title"[^>]*>/i,
      `<meta name="twitter:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+name="twitter:description"[^>]*>/i,
      `<meta name="twitter:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"[^>]*>/i,
      `<meta name="twitter:image" content="${safeImage}" />`
    )
    .replace(
      /<meta\s+name="twitter:image:alt"[^>]*>/i,
      `<meta name="twitter:image:alt" content="${safeAlt}" />`
    );
}

const ALLOWED_MEDIA_MIME_EXT: Record<
  string,
  { ext: string; kind: 'video' | 'image' | 'audio' | 'file' }
> = {
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/x-m4v': { ext: 'm4v', kind: 'video' },
  'video/mp4v-es': { ext: 'mp4', kind: 'video' },
  'video/ogg': { ext: 'ogv', kind: 'video' },
  'video/3gpp': { ext: '3gp', kind: 'video' },
  'video/3gpp2': { ext: '3g2', kind: 'video' },
  'video/x-matroska': { ext: 'mkv', kind: 'video' },
  'video/mpeg': { ext: 'mpg', kind: 'video' },
  'video/avi': { ext: 'mp4', kind: 'video' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/jpg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'audio/webm': { ext: 'weba', kind: 'audio' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio' },
  'audio/mp3': { ext: 'mp3', kind: 'audio' },
  'audio/mp4': { ext: 'm4a', kind: 'audio' },
  'audio/x-m4a': { ext: 'm4a', kind: 'audio' },
  'audio/ogg': { ext: 'ogg', kind: 'audio' },
  'audio/wav': { ext: 'wav', kind: 'audio' },
  'audio/x-wav': { ext: 'wav', kind: 'audio' },
  'audio/aac': { ext: 'aac', kind: 'audio' },
  'audio/opus': { ext: 'opus', kind: 'audio' },
  'audio/flac': { ext: 'flac', kind: 'audio' },
  'application/pdf': { ext: 'pdf', kind: 'file' },
  'text/plain': { ext: 'txt', kind: 'file' },
  'text/csv': { ext: 'csv', kind: 'file' },
  'application/json': { ext: 'json', kind: 'file' },
  'application/zip': { ext: 'zip', kind: 'file' },
  'application/x-zip-compressed': { ext: 'zip', kind: 'file' },
  'application/msword': { ext: 'doc', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    kind: 'file',
  },
  'application/vnd.ms-excel': { ext: 'xls', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    kind: 'file',
  },
  'application/vnd.ms-powerpoint': { ext: 'ppt', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    kind: 'file',
  },
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  weba: 'audio/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mkv: 'video/x-matroska',
  mpg: 'video/mpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  opus: 'audio/opus',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

let resolvedUploadsDirCache: string | null = null;

function getWritableUploadsDir(): string {
  if (resolvedUploadsDirCache && fs.existsSync(resolvedUploadsDirCache)) {
    return resolvedUploadsDirCache;
  }
  const candidates = [UPLOADS_DIR, path.join(os.tmpdir(), 'lumina-uploads')];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.accessSync(dir, fs.constants.W_OK);
      resolvedUploadsDirCache = dir;
      return dir;
    } catch {
      // Try next writable directory
    }
  }
  return UPLOADS_DIR;
}

interface PendingChunkUpload {
  id: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  kind: 'video' | 'image' | 'audio' | 'file';
  expectedBytes: number;
  receivedBytes: number;
  nextIndex: number;
  tempPartPath: string;
  createdAt: number;
}

const pendingChunkUploads = new Map<string, PendingChunkUpload>();

function cleanupExpiredChunkUploads() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, session] of pendingChunkUploads.entries()) {
    if (session.createdAt < cutoff) {
      pendingChunkUploads.delete(id);
      try {
        if (fs.existsSync(session.tempPartPath)) fs.unlinkSync(session.tempPartPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function resolveAwsMediaTarget(state: IntegrationState) {
  return resolveAwsS3Config({
    region: state.aws.region,
    bucket: state.aws.bucket,
    cloudFrontDomain: state.aws.cloudFrontDomain,
    cloudFrontEnabled: state.aws.cloudFrontEnabled,
  });
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  app.use(express.json({ limit: '4mb' }));
  app.use(['/api/site/meta', '/api/social'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname !== '/ws/realtime') {
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    let boundIds: string[] = [];
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const rawIds = reqUrl.searchParams.get('userIds') || '';
      boundIds = Array.from(
        new Set(
          rawIds
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length <= 128)
        )
      ).slice(0, 4);
    } catch {
      boundIds = [];
    }

    for (const uid of boundIds) {
      let set = wsClientsByUserId.get(uid);
      if (!set) {
        set = new Set();
        wsClientsByUserId.set(uid, set);
      }
      set.add(ws);
    }

    if (boundIds.length > 0) {
      const now = Date.now();
      const pres = setUserPresenceInSharedState(boundIds, true, now);
      broadcastRealtimeEvent({
        type: 'presence_update',
        userId: pres.userId || boundIds[0],
        uid: pres.uid || boundIds[1],
        isOnline: true,
        lastActiveAtMs: now,
      });
    }

    ws.on('message', (rawData) => {
      try {
        const parsed = JSON.parse(String(rawData || '')) as {
          type?: string;
          signal?: Record<string, unknown>;
        };
        if (parsed?.type === 'call_signal' && parsed.signal && typeof parsed.signal === 'object') {
          const sig = parsed.signal;
          const fromId = typeof sig.fromUserId === 'string' ? sig.fromUserId.trim() : '';
          const toId = typeof sig.toUserId === 'string' ? sig.toUserId.trim() : '';
          const toUid = typeof sig.toUid === 'string' ? sig.toUid.trim() : '';
          const sigType = typeof sig.type === 'string' ? sig.type : '';
          if (!fromId || !toId) return;

          if (
            sigType === 'call:invite' &&
            (isUserBlockedPair(fromId, toId) || (toUid && isUserBlockedPair(fromId, toUid)))
          ) {
            sendRealtimeToUserIds([fromId], {
              type: 'call_signal',
              signal: {
                callId: sig.callId,
                type: 'call:busy',
                fromUserId: toId,
                toUserId: fromId,
                reason: 'blocked',
                createdAt: Date.now(),
              },
            });
            return;
          }

          enqueueCallSignalForUserIds(resolveCallRecipientIds(toId, toUid), sig);
        }
      } catch {
        // Ignore malformed client WS frame
      }
    });

    ws.on('close', () => {
      let anyStillConnected = false;
      for (const uid of boundIds) {
        const set = wsClientsByUserId.get(uid);
        if (!set) continue;
        set.delete(ws);
        if (set.size === 0) wsClientsByUserId.delete(uid);
        else anyStillConnected = true;
      }
      if (boundIds.length > 0 && !anyStillConnected) {
        const now = Date.now();
        const pres = setUserPresenceInSharedState(boundIds, false, now);
        broadcastRealtimeEvent({
          type: 'presence_update',
          userId: pres.userId || boundIds[0],
          uid: pres.uid || boundIds[1],
          isOnline: false,
          lastActiveAtMs: now,
        });
      }
    });
  });

  // Media delivery capability check
  app.get('/api/media/status', (_req, res) => {
    const state = readAdminState();
    const creds = getAwsCredentialsFromEnv();
    const target = resolveAwsMediaTarget(state);
    const awsReady = Boolean(creds && state.aws.s3Enabled);
    const gcpCreds = getGcpServiceAccountFromEnv();
    const gcsReady = Boolean(gcpCreds && state.gcp.gcsMediaEnabled && state.gcp.gcsBucket);
    res.json({
      uploadAvailable: true,
      storageProvider: awsReady ? 'aws-s3' : gcsReady ? 'google-cloud-storage' : 'server-disk',
      awsCredentialsConfigured: Boolean(creds),
      s3Enabled: state.aws.s3Enabled,
      gcpCredentialsConfigured: Boolean(gcpCreds),
      gcsMediaEnabled: state.gcp.gcsMediaEnabled,
      gcsBucket: state.gcp.gcsBucket,
      cloudFrontActive: awsReady && target.hasRealCloudFront,
      region: target.region,
      bucket: target.bucket,
      maxVideoSizeMB: state.site.videoRules.maxVideoSizeMB,
    });
  });

  // Generate an AWS S3 SigV4 pre-signed PUT URL for direct Reel uploads (requires AWS env credentials)
  app.post('/api/media/presign-upload', (req, res) => {
    const state = readAdminState();
    const creds = getAwsCredentialsFromEnv();
    if (!creds || !state.aws.s3Enabled) {
      res.status(503).json({
        error:
          'AWS S3 não configurado no servidor. Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY ou use POST /api/media/upload.',
      });
      return;
    }

    const rawType = String(req.body?.contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const spec = ALLOWED_MEDIA_MIME_EXT[rawType];
    if (!spec) {
      res.status(415).json({
        error:
          'Formato de mídia não suportado. Envie MP4, WebM, MOV, M4V, JPG, PNG ou WebP.',
      });
      return;
    }

    const sizeBytes = Number(req.body?.sizeBytes || 0);
    const maxVideoBytes = state.site.videoRules.maxVideoSizeMB * 1024 * 1024;
    const maxImageBytes = 15 * 1024 * 1024;
    const maxAllowedBytes = spec.kind === 'video' ? maxVideoBytes : maxImageBytes;
    if (sizeBytes > 0 && sizeBytes > maxAllowedBytes) {
      res.status(413).json({
        error: `Arquivo excede o limite de ${
          spec.kind === 'video' ? `${state.site.videoRules.maxVideoSizeMB} MB` : '15 MB'
        }.`,
      });
      return;
    }

    const target = resolveAwsMediaTarget(state);
    const objectKey = buildReelObjectKey(spec.ext, spec.kind);
    const presigned = getSignedReelUploadUrl({
      key: objectKey,
      contentType: rawType,
      expiresSec: 300,
      config: target,
    });

    res.json({
      ok: true,
      ...presigned,
      playbackUrl: resolveReelPlaybackUrl(objectKey, target),
      bucket: target.bucket,
      region: target.region,
    });
  });

  // Generate a temporary AWS S3 SigV4 pre-signed GET URL for an existing Reel/media object
  app.get('/api/media/s3-signed-url', (req, res) => {
    const rawKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (!isSafeS3ObjectKey(rawKey) || !/^(reels|media)\//.test(rawKey)) {
      res.status(400).json({ error: 'Chave S3 inválida.' });
      return;
    }
    if (!getAwsCredentialsFromEnv()) {
      res.status(503).json({ error: 'Credenciais AWS não configuradas no servidor.' });
      return;
    }
    const expiresInput = Number(req.query.expiresSec || 3600);
    const expiresSec = Number.isFinite(expiresInput)
      ? Math.min(86400, Math.max(60, Math.round(expiresInput)))
      : 3600;
    const state = readAdminState();
    const target = resolveAwsMediaTarget(state);
    const signedUrl = getSignedReelDownloadUrl({
      key: rawKey,
      expiresSec,
      config: target,
    });
    res.json({
      ok: true,
      key: rawKey,
      signedUrl,
      expiresSec,
    });
  });

  // Chunked upload session initialization (bypasses proxy single-request body limits for Reels videos)
  app.post('/api/media/upload-init', (req, res) => {
    cleanupExpiredChunkUploads();
    const state = readAdminState();
    const rawType = String(req.body?.contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const spec = ALLOWED_MEDIA_MIME_EXT[rawType];
    if (!spec) {
      res.status(415).json({
        error:
          'Formato de arquivo não suportado para envio na nuvem.',
      });
      return;
    }

    const totalBytes = Number(req.body?.sizeBytes || 0);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      res.status(400).json({ error: 'Tamanho de arquivo inválido.' });
      return;
    }

    const maxVideoBytes = state.site.videoRules.maxVideoSizeMB * 1024 * 1024;
    const maxAudioBytes = 30 * 1024 * 1024;
    const maxOtherBytes = 25 * 1024 * 1024;
    const maxAllowedBytes =
      spec.kind === 'video' ? maxVideoBytes : spec.kind === 'audio' ? maxAudioBytes : maxOtherBytes;
    if (totalBytes > maxAllowedBytes) {
      res.status(413).json({
        error: `Arquivo excede o limite de ${
          spec.kind === 'video'
            ? `${state.site.videoRules.maxVideoSizeMB} MB`
            : spec.kind === 'audio'
            ? '30 MB'
            : '25 MB'
        }.`,
      });
      return;
    }

    const uploadsDir = getWritableUploadsDir();
    const uploadId = crypto.randomBytes(16).toString('hex');
    const objectKey = buildReelObjectKey(spec.ext, spec.kind);
    const fileName = path.posix.basename(objectKey);
    const tempPartPath = path.resolve(uploadsDir, `part_${uploadId}.bin`);
    if (!tempPartPath.startsWith(uploadsDir + path.sep)) {
      res.status(400).json({ error: 'Caminho temporário inválido.' });
      return;
    }

    try {
      fs.writeFileSync(tempPartPath, Buffer.alloc(0));
    } catch {
      res.status(500).json({ error: 'Não foi possível preparar o armazenamento temporário.' });
      return;
    }

    pendingChunkUploads.set(uploadId, {
      id: uploadId,
      objectKey,
      fileName,
      contentType: rawType,
      kind: spec.kind,
      expectedBytes: Math.round(totalBytes),
      receivedBytes: 0,
      nextIndex: 0,
      tempPartPath,
      createdAt: Date.now(),
    });

    res.json({
      ok: true,
      uploadId,
      chunkSizeBytes: 3 * 1024 * 1024,
    });
  });

  // Append a binary chunk (<= 6 MB) to an active chunked upload session
  app.post(
    '/api/media/upload-chunk',
    express.raw({ type: () => true, limit: '8mb' }),
    (req, res) => {
      const uploadId = String(req.headers['x-upload-id'] || '').trim();
      const chunkIndex = Number(req.headers['x-chunk-index']);
      if (!/^[a-f0-9]{32}$/.test(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
        res.status(400).json({ error: 'Identificador de envio em partes inválido.' });
        return;
      }

      const session = pendingChunkUploads.get(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Sessão de envio expirada ou não encontrada.' });
        return;
      }

      if (chunkIndex !== session.nextIndex) {
        res.status(409).json({ error: 'Ordem dos blocos de envio inconsistente.' });
        return;
      }

      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (chunk.length === 0) {
        res.status(400).json({ error: 'Bloco de dados vazio.' });
        return;
      }

      if (session.receivedBytes + chunk.length > session.expectedBytes) {
        pendingChunkUploads.delete(uploadId);
        try {
          if (fs.existsSync(session.tempPartPath)) fs.unlinkSync(session.tempPartPath);
        } catch {
          // Ignore cleanup errors
        }
        res.status(413).json({ error: 'Tamanho total excedeu o declarado inicialmente.' });
        return;
      }

      try {
        fs.appendFileSync(session.tempPartPath, chunk);
        session.receivedBytes += chunk.length;
        session.nextIndex += 1;
        res.json({
          ok: true,
          receivedBytes: session.receivedBytes,
          expectedBytes: session.expectedBytes,
        });
      } catch {
        res.status(500).json({ error: 'Falha ao gravar bloco de mídia no servidor.' });
      }
    }
  );

  // Finalize a chunked upload: push to Amazon S3 (with fallback to local HTTP 206 streaming)
  app.post('/api/media/upload-complete', async (req, res) => {
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
    if (!/^[a-f0-9]{32}$/.test(uploadId)) {
      res.status(400).json({ error: 'Identificador de envio inválido.' });
      return;
    }

    const session = pendingChunkUploads.get(uploadId);
    if (!session) {
      res.status(404).json({ error: 'Sessão de envio não encontrada ou expirada.' });
      return;
    }
    pendingChunkUploads.delete(uploadId);

    const cleanupPart = () => {
      try {
        if (fs.existsSync(session.tempPartPath)) fs.unlinkSync(session.tempPartPath);
      } catch {
        // Ignore cleanup errors
      }
    };

    if (session.receivedBytes !== session.expectedBytes || !fs.existsSync(session.tempPartPath)) {
      cleanupPart();
      res.status(400).json({ error: 'Upload incompleto. Tente enviar o vídeo novamente.' });
      return;
    }

    const state = readAdminState();
    const uploadsDir = getWritableUploadsDir();
    const awsCreds = getAwsCredentialsFromEnv();
    const awsTarget = resolveAwsMediaTarget(state);

    let finalPath = session.tempPartPath;
    let finalContentType = session.contentType;
    let finalObjectKey = session.objectKey;
    let finalFileName = session.fileName;
    let cleanupNormalized = () => {};

    if (session.kind === 'video') {
      const origExt = path.extname(session.fileName).replace('.', '') || 'mp4';
      const normalized = await normalizeVideoFileForWeb({
        inputPath: session.tempPartPath,
        originalExt: origExt,
        originalContentType: session.contentType,
        workDir: uploadsDir,
      });
      finalPath = normalized.filePath;
      finalContentType = normalized.contentType;
      cleanupNormalized = normalized.cleanupTempFiles;
      if (normalized.ext !== origExt) {
        finalObjectKey = buildReelObjectKey(normalized.ext, 'video');
        finalFileName = path.posix.basename(finalObjectKey);
      }
      if (normalized.transcoded) {
        cleanupPart();
      }
    }

    const finalSizeBytes = fs.existsSync(finalPath)
      ? fs.statSync(finalPath).size
      : session.receivedBytes;

    if (awsCreds && state.aws.s3Enabled) {
      try {
        const bodyBuffer = fs.readFileSync(finalPath);
        const uploadResult = await uploadReelToS3({
          key: finalObjectKey,
          body: bodyBuffer,
          contentType: finalContentType,
          config: awsTarget,
        });
        if (uploadResult.ok) {
          cleanupPart();
          cleanupNormalized();
          const deliveryUrl = resolveReelPlaybackUrl(finalObjectKey, awsTarget);
          res.json({
            ok: true,
            url: deliveryUrl,
            storageProvider: awsTarget.hasRealCloudFront ? 'aws-cloudfront' : 'aws-s3',
            key: finalObjectKey,
            sizeBytes: finalSizeBytes,
            contentType: finalContentType,
          });
          return;
        }
        console.error(`AWS S3 chunk upload HTTP ${uploadResult.status}: ${uploadResult.message}`);
      } catch (err) {
        console.error('AWS S3 chunk upload failed, falling back to next storage provider:', err);
      }
    }

    const gcpCreds = getGcpServiceAccountFromEnv();
    if (gcpCreds && state.gcp.gcsMediaEnabled && state.gcp.gcsBucket) {
      try {
        const bodyBuffer = fs.readFileSync(finalPath);
        const gcsResult = await uploadMediaToGcs({
          key: finalObjectKey,
          body: bodyBuffer,
          contentType: finalContentType,
          bucket: state.gcp.gcsBucket,
          creds: gcpCreds,
        });
        if (gcsResult.ok) {
          cleanupPart();
          cleanupNormalized();
          res.json({
            ok: true,
            url: resolveGcsPlaybackUrl(finalObjectKey),
            storageProvider: 'google-cloud-storage',
            key: finalObjectKey,
            sizeBytes: finalSizeBytes,
            contentType: finalContentType,
          });
          return;
        }
        console.error(`GCS chunk upload HTTP ${gcsResult.status}: ${gcsResult.message}`);
      } catch (err) {
        console.error('GCS chunk upload failed, falling back to server stream:', err);
      }
    }

    try {
      const safePath = path.resolve(uploadsDir, finalFileName);
      if (!safePath.startsWith(uploadsDir + path.sep)) {
        cleanupPart();
        cleanupNormalized();
        res.status(400).json({ error: 'Caminho de arquivo inválido.' });
        return;
      }
      fs.renameSync(finalPath, safePath);
      cleanupPart();
      res.json({
        ok: true,
        url: `/api/media/file/${finalFileName}`,
        storageProvider: 'server-disk',
        key: finalFileName,
        sizeBytes: finalSizeBytes,
        contentType: finalContentType,
      });
    } catch {
      cleanupPart();
      cleanupNormalized();
      res.status(500).json({ error: 'Não foi possível finalizar o vídeo no servidor.' });
    }
  });

  // Upload Reel video or photo directly to Amazon S3 (with CloudFront/Presigned delivery) or local HTTP-206 disk store
  app.post(
    '/api/media/upload',
    express.raw({
      type: () => true,
      limit: '30mb',
    }),
    async (req, res) => {
      const state = readAdminState();
      const rawType = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const spec = ALLOWED_MEDIA_MIME_EXT[rawType];
      if (!spec) {
        res.status(415).json({
          error:
            'Formato de arquivo não suportado para envio na nuvem.',
        });
        return;
      }

      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuffer.length === 0) {
        res.status(400).json({ error: 'Arquivo vazio ou corrompido.' });
        return;
      }

      const maxVideoBytes = state.site.videoRules.maxVideoSizeMB * 1024 * 1024;
      const maxAudioBytes = 30 * 1024 * 1024;
      const maxOtherBytes = 25 * 1024 * 1024;
      const maxAllowedBytes =
        spec.kind === 'video' ? maxVideoBytes : spec.kind === 'audio' ? maxAudioBytes : maxOtherBytes;
      if (bodyBuffer.length > maxAllowedBytes) {
        res.status(413).json({
          error: `Arquivo excede o limite de ${
            spec.kind === 'video'
              ? `${state.site.videoRules.maxVideoSizeMB} MB`
              : spec.kind === 'audio'
              ? '30 MB'
              : '25 MB'
          }.`,
        });
        return;
      }

      const uploadsDir = getWritableUploadsDir();
      let finalBuffer = bodyBuffer;
      let finalContentType = rawType;
      let finalExt = spec.ext;

      if (spec.kind === 'video') {
        const tempRawPath = path.resolve(
          uploadsDir,
          `raw_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${spec.ext}`
        );
        if (tempRawPath.startsWith(uploadsDir + path.sep)) {
          let cleanupNormalized = () => {};
          try {
            fs.writeFileSync(tempRawPath, bodyBuffer);
            const normalized = await normalizeVideoFileForWeb({
              inputPath: tempRawPath,
              originalExt: spec.ext,
              originalContentType: rawType,
              workDir: uploadsDir,
            });
            cleanupNormalized = normalized.cleanupTempFiles;
            if (normalized.transcoded && fs.existsSync(normalized.filePath)) {
              finalBuffer = fs.readFileSync(normalized.filePath);
              finalContentType = normalized.contentType;
              finalExt = normalized.ext;
            }
          } finally {
            cleanupNormalized();
            try {
              if (fs.existsSync(tempRawPath)) fs.unlinkSync(tempRawPath);
            } catch {
              // Ignore temp cleanup
            }
          }
        }
      }

      const objectKey = buildReelObjectKey(finalExt, spec.kind);
      const fileName = path.posix.basename(objectKey);
      const awsCreds = getAwsCredentialsFromEnv();
      const awsTarget = resolveAwsMediaTarget(state);

      if (awsCreds && state.aws.s3Enabled) {
        try {
          const uploadResult = await uploadReelToS3({
            key: objectKey,
            body: finalBuffer,
            contentType: finalContentType,
            config: awsTarget,
          });
          if (uploadResult.ok) {
            const deliveryUrl = resolveReelPlaybackUrl(objectKey, awsTarget);
            res.json({
              ok: true,
              url: deliveryUrl,
              storageProvider: awsTarget.hasRealCloudFront ? 'aws-cloudfront' : 'aws-s3',
              key: objectKey,
              sizeBytes: finalBuffer.length,
              contentType: finalContentType,
            });
            return;
          }
          console.error(`AWS S3 upload HTTP ${uploadResult.status}: ${uploadResult.message}`);
        } catch (err) {
          console.error('AWS S3 upload failed, falling back to next storage provider:', err);
        }
      }

      const gcpCreds = getGcpServiceAccountFromEnv();
      if (gcpCreds && state.gcp.gcsMediaEnabled && state.gcp.gcsBucket) {
        try {
          const gcsResult = await uploadMediaToGcs({
            key: objectKey,
            body: finalBuffer,
            contentType: finalContentType,
            bucket: state.gcp.gcsBucket,
            creds: gcpCreds,
          });
          if (gcsResult.ok) {
            res.json({
              ok: true,
              url: resolveGcsPlaybackUrl(objectKey),
              storageProvider: 'google-cloud-storage',
              key: objectKey,
              sizeBytes: finalBuffer.length,
              contentType: finalContentType,
            });
            return;
          }
          console.error(`GCS upload HTTP ${gcsResult.status}: ${gcsResult.message}`);
        } catch (err) {
          console.error('GCS upload failed, falling back to server media stream:', err);
        }
      }

      // Server local disk stream fallback with full HTTP 206 byte-range seeking
      try {
        const safePath = path.resolve(uploadsDir, fileName);
        if (!safePath.startsWith(uploadsDir + path.sep)) {
          res.status(400).json({ error: 'Caminho de arquivo inválido.' });
          return;
        }
        fs.writeFileSync(safePath, finalBuffer);
        res.json({
          ok: true,
          url: `/api/media/file/${fileName}`,
          storageProvider: 'server-disk',
          key: fileName,
          sizeBytes: finalBuffer.length,
          contentType: finalContentType,
        });
      } catch {
        res.status(500).json({ error: 'Não foi possível salvar a mídia no servidor.' });
      }
    }
  );

  // Redirect to a short-lived AWS S3 SigV4 presigned GET URL (supports private buckets & Range seeking)
  app.get('/api/media/s3/*', (req, res) => {
    const rawKey = String((req.params as Record<string, string>)[0] || '').trim();
    if (!isSafeS3ObjectKey(rawKey)) {
      res.status(400).json({ error: 'Chave S3 inválida.' });
      return;
    }
    if (!getAwsCredentialsFromEnv()) {
      res.status(503).json({ error: 'Credenciais AWS não configuradas no servidor.' });
      return;
    }
    const state = readAdminState();
    const target = resolveAwsMediaTarget(state);
    const signedUrl = getSignedReelDownloadUrl({
      key: rawKey,
      expiresSec: 3600,
      config: target,
    });
    res.setHeader('Cache-Control', 'private, max-age=3000');
    res.redirect(302, signedUrl);
  });

  // Redirect to a short-lived Google Cloud Storage V4 signed GET URL
  app.get('/api/media/gcs/*', (req, res) => {
    const rawKey = String((req.params as Record<string, string>)[0] || '').trim();
    if (!isSafeGcsObjectKey(rawKey)) {
      res.status(400).json({ error: 'Chave GCS inválida.' });
      return;
    }
    const gcpCreds = getGcpServiceAccountFromEnv();
    if (!gcpCreds) {
      res.status(503).json({ error: 'Credenciais Google Cloud não configuradas no servidor.' });
      return;
    }
    const state = readAdminState();
    const signedUrl = getSignedGcsDownloadUrl({
      key: rawKey,
      bucket: state.gcp.gcsBucket,
      expiresSec: 3600,
      creds: gcpCreds,
    });
    res.setHeader('Cache-Control', 'private, max-age=3000');
    res.redirect(302, signedUrl);
  });

  // Stream uploaded server media with full HTTP 206 Partial Content Range support for mobile/desktop video playback
  app.get('/api/media/file/:filename', (req, res) => {
    const filename = String(req.params.filename || '').trim();
    const match = filename.match(
      /^([a-zA-Z0-9_-]{4,80})\.(mp4|webm|weba|mov|m4v|ogv|3gp|3g2|mkv|mpg|jpg|png|webp|gif|mp3|m4a|ogg|wav|aac|opus|flac|pdf|txt|csv|json|zip|doc|docx|xls|xlsx|ppt|pptx)$/i
    );
    if (!match) {
      res.status(400).json({ error: 'Nome de arquivo inválido.' });
      return;
    }
    const uploadsDir = getWritableUploadsDir();
    const safePath = path.resolve(uploadsDir, filename);
    if (!safePath.startsWith(uploadsDir + path.sep) || !fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Mídia não encontrada.' });
      return;
    }

    const ext = match[2].toLowerCase();
    const contentType = EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
    const stat = fs.statSync(safePath);
    const total = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', contentType);

    if (range && /^bytes=\d*-\d*$/i.test(range)) {
      const [startRaw, endRaw] = range.replace(/bytes=/i, '').split('-');
      const start = startRaw ? Number.parseInt(startRaw, 10) : 0;
      const end = endRaw ? Math.min(total - 1, Number.parseInt(endRaw, 10)) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(safePath, { start, end }).pipe(res);
      return;
    }

    res.status(200);
    res.setHeader('Content-Length', String(total));
    fs.createReadStream(safePath).pipe(res);
  });

  app.use(
    '/api/media',
    (
      err: { status?: number; type?: string },
      _req: Request,
      res: Response,
      next: NextFunction
    ) => {
      if (!err) {
        next();
        return;
      }
      if (err.type === 'entity.too.large' || err.status === 413) {
        res.status(413).json({
          error:
            'O arquivo de vídeo excede o limite máximo suportado pelo servidor (260 MB).',
        });
        return;
      }
      res.status(err.status && err.status >= 400 ? err.status : 400).json({
        error: 'Falha ao processar o arquivo de mídia enviado.',
      });
    }
  );

  // Auth status (public check for admin gate)
  app.get('/api/admin/auth/status', (_req, res) => {
    const envConfigured = Boolean(process.env.ADMIN_PASSCODE?.trim());
    const claimed = envConfigured || Boolean(readAuthRecord());
    res.json({
      claimed,
      envConfigured,
      firebaseAdminConfigured: Boolean(FIREBASE_PROJECT_ID),
      adminEmail: ADMIN_EMAIL,
    });
  });

  // Exclusive Firebase Admin sign-in (only verified ADMIN_EMAIL)
  app.post('/api/admin/auth/firebase', async (req, res) => {
    const authHeader = req.headers.authorization;
    const rawToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : typeof req.body?.idToken === 'string'
        ? req.body.idToken.trim()
        : '';

    if (!rawToken) {
      res.status(401).json({ error: 'Token Firebase não enviado.' });
      return;
    }

    try {
      const verified = await verifyFirebaseIdToken(rawToken);
      if (!verified.emailVerified || verified.email !== ADMIN_EMAIL.toLowerCase()) {
        res.status(403).json({
          error: `Acesso exclusivo: somente a conta ${ADMIN_EMAIL} pode entrar como administrador.`,
        });
        return;
      }
      const token = signSessionToken();
      res.json({ token, email: verified.email, uid: verified.uid });
    } catch {
      res.status(401).json({ error: 'Sessão Google/Firebase inválida ou expirada.' });
    }
  });

  // First-run atomic admin password claim bound exclusively to ADMIN_EMAIL
  app.post('/api/admin/auth/claim', (req, res) => {
    if (process.env.ADMIN_PASSCODE?.trim()) {
      res.status(409).json({ error: 'Senha administrativa gerenciada via variável de ambiente.' });
      return;
    }
    if (readAuthRecord()) {
      res.status(409).json({ error: 'A senha administrativa já foi definida. Use a aba Entrar.' });
      return;
    }

    const emailInput =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ADMIN_EMAIL.toLowerCase();
    if (emailInput !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({
        error: `Somente a conta administradora (${ADMIN_EMAIL}) pode configurar esta senha.`,
      });
      return;
    }

    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (passcode.length < 6) {
      res.status(400).json({ error: 'A senha administrativa deve ter pelo menos 6 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPasscode(passcode, salt);
    const record: AdminAuthRecord = {
      email: ADMIN_EMAIL,
      salt,
      hash,
      createdAt: Date.now(),
    };
    memoryAuthRecord = record;
    try {
      fs.writeFileSync(
        ADMIN_AUTH_FILE,
        JSON.stringify(record, null, 2),
        { encoding: 'utf8', flag: 'wx' }
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') {
        res.status(409).json({ error: 'A conta administrativa já foi configurada.' });
        return;
      }
      // Read-only filesystem fallback: memoryAuthRecord remains active
    }
    const token = signSessionToken();
    res.json({ token, email: ADMIN_EMAIL });
  });

  // Admin Login (exclusive email + passcode)
  app.post('/api/admin/auth/login', (req, res) => {
    const emailInput =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (emailInput && emailInput !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({
        error: `Acesso exclusivo: somente a conta ${ADMIN_EMAIL} é administradora.`,
      });
      return;
    }
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (!passcode || !verifyPasscode(passcode)) {
      res.status(401).json({ error: 'Senha administrativa incorreta.' });
      return;
    }
    const token = signSessionToken();
    res.json({ token, email: ADMIN_EMAIL });
  });

  // Authenticated Admin Passcode Rotation (when not overridden by ADMIN_PASSCODE env)
  app.post('/api/admin/auth/change-passcode', requireAdminAuth, (req, res) => {
    if (process.env.ADMIN_PASSCODE?.trim()) {
      res.status(409).json({
        error: 'A senha está fixada pela variável de ambiente ADMIN_PASSCODE do servidor.',
      });
      return;
    }
    const newPasscode =
      typeof req.body?.newPasscode === 'string' ? req.body.newPasscode.trim() : '';
    if (newPasscode.length < 6) {
      res.status(400).json({ error: 'A nova senha administrativa deve ter pelo menos 6 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPasscode(newPasscode, salt);
    const record: AdminAuthRecord = {
      email: ADMIN_EMAIL,
      salt,
      hash,
      createdAt: Date.now(),
    };
    memoryAuthRecord = record;
    try {
      fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify(record, null, 2), 'utf8');
    } catch {
      // Read-only filesystem fallback: memoryAuthRecord remains active
    }
    res.json({ ok: true, token: signSessionToken(), email: ADMIN_EMAIL });
  });

  // Public lightweight site metadata (version, banner, realUsersOnly, videoRules, non-secret Supabase public config)
  app.get('/api/site/meta', (_req, res) => {
    const state = readAdminState();
    const candidateAnon =
      (state.supabase.anonKey || '').trim() ||
      (process.env.SUPABASE_ANON_KEY || '').trim() ||
      (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const safePublicAnon =
      candidateAnon && !isSecretSupabaseKey(candidateAnon) ? candidateAnon : '';
    res.json({
      version: state.site.version,
      announcementBanner: state.site.announcementBanner,
      maintenanceMode: state.site.maintenanceMode,
      realUsersOnly: Boolean(state.site.realUsersOnly),
      videoRules: state.site.videoRules,
      supabase: {
        projectUrl: state.supabase.projectUrl || DEFAULT_SUPABASE_URL,
        schemaName: state.supabase.schemaName || 'public',
        anonKey: safePublicAnon,
        autoSyncUsers: Boolean(state.supabase.autoSyncUsers),
      },
    });
  });

  // Protected Admin Overview
  app.get('/api/admin/overview', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    const gcpRuntime = detectGoogleCloudRuntime();
    const gcpCreds = getGcpServiceAccountFromEnv();
    res.json({
      state,
      envStatus: {
        awsCredentialsConfigured: Boolean(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ),
        awsRegionEnv: Boolean(process.env.AWS_REGION),
        supabaseUrlEnv: Boolean(process.env.SUPABASE_URL),
        supabaseKeysEnv: Boolean(
          process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            (state.supabase.anonKey && !isSecretSupabaseKey(state.supabase.anonKey))
        ),
        wordpressEnv: Boolean(process.env.WORDPRESS_SITE_URL),
        gcpCredentialsConfigured: Boolean(gcpCreds),
        gcpCloudRunDetected: gcpRuntime.cloudRunDetected,
        gcpServiceName: gcpRuntime.serviceName,
        gcpFirestoreConfigured: Boolean(FIREBASE_PROJECT_ID),
      },
    });
  });

  // Save Integration Configuration (Non-secret settings only)
  app.put('/api/admin/integrations', requireAdminAuth, async (req, res) => {
    const current = readAdminState();
    const body = req.body || {};

    if (body.aws && typeof body.aws === 'object') {
      current.aws = {
        ...current.aws,
        region: sanitizeIdentifier(String(body.aws.region || ''), current.aws.region),
        bucket: sanitizeHost(String(body.aws.bucket || ''), current.aws.bucket),
        cloudFrontDomain: sanitizeHost(
          String(body.aws.cloudFrontDomain || ''),
          current.aws.cloudFrontDomain
        ),
        sesSender: String(body.aws.sesSender || current.aws.sesSender).slice(0, 120),
        s3Enabled: Boolean(body.aws.s3Enabled),
        cloudFrontEnabled: Boolean(body.aws.cloudFrontEnabled),
        sesEnabled: Boolean(body.aws.sesEnabled),
        rekognitionEnabled: Boolean(body.aws.rekognitionEnabled),
      };
    }

    if (body.supabase && typeof body.supabase === 'object') {
      const rawUrl = String(body.supabase.projectUrl || '').trim();
      let cleanUrl = DEFAULT_SUPABASE_URL;
      if (rawUrl) {
        try {
          const validated = await validateExternalUrl(rawUrl);
          if (validated.protocol !== 'https:') {
            res.status(400).json({ error: 'A URL do Supabase deve usar HTTPS.' });
            return;
          }
          cleanUrl = validated.origin;
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'URL do projeto Supabase inválida.',
          });
          return;
        }
      }
      let nextAnonKey = current.supabase.anonKey || '';
      if (typeof body.supabase.anonKey === 'string') {
        const trimmedAnonKey = body.supabase.anonKey.trim();
        if (trimmedAnonKey && isSecretSupabaseKey(trimmedAnonKey)) {
          res.status(400).json({
            error:
              'Por segurança, nunca envie a chave secreta (service_role / sb_secret) para o navegador. Use apenas a chave pública (anon / publishable).',
          });
          return;
        }
        nextAnonKey = trimmedAnonKey.slice(0, 600);
      }

      const rawSchemaInput = String(body.supabase.schemaName || '').trim();
      const schemaLooksLikeKey =
        /^sb_(publishable|secret)_/i.test(rawSchemaInput) ||
        /^eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/.test(rawSchemaInput) ||
        rawSchemaInput.length > 32;
      if (schemaLooksLikeKey && isSecretSupabaseKey(rawSchemaInput)) {
        res.status(400).json({
          error:
            'Por segurança, nunca envie a chave secreta (service_role / sb_secret) no navegador. Use apenas a chave pública (anon / publishable).',
        });
        return;
      }
      if (!nextAnonKey && schemaLooksLikeKey && !isSecretSupabaseKey(rawSchemaInput)) {
        nextAnonKey = rawSchemaInput.slice(0, 600);
      }
      const cleanedSchema = schemaLooksLikeKey
        ? 'public'
        : sanitizeIdentifier(rawSchemaInput, 'public', /[^a-zA-Z0-9_]/g).toLowerCase();

      current.supabase = {
        ...current.supabase,
        projectUrl: cleanUrl.slice(0, 200),
        schemaName: /^[a-z_][a-z0-9_]*$/.test(cleanedSchema) ? cleanedSchema : 'public',
        anonKey: nextAnonKey,
        autoSyncUsers: Boolean(body.supabase.autoSyncUsers),
        autoSyncPosts: Boolean(body.supabase.autoSyncPosts),
        rlsEnforced: Boolean(body.supabase.rlsEnforced),
      };
    }

    if (body.wordpress && typeof body.wordpress === 'object') {
      current.wordpress = {
        ...current.wordpress,
        siteUrl: String(body.wordpress.siteUrl || '').trim().slice(0, 200),
        siteTitle: String(body.wordpress.siteTitle || current.wordpress.siteTitle).slice(0, 100),
        dbEngine: body.wordpress.dbEngine === 'mysql-8' ? 'mysql-8' : 'mariadb-11',
        dbName: sanitizeIdentifier(String(body.wordpress.dbName || ''), 'lumina_wp', /[^a-zA-Z0-9_]/g),
        tablePrefix: sanitizeIdentifier(
          String(body.wordpress.tablePrefix || ''),
          'wp_lum_',
          /[^a-zA-Z0-9_]/g
        ),
        phpVersion: body.wordpress.phpVersion === '8.2' ? '8.2' : '8.3',
        permalinks: String(body.wordpress.permalinks || '/%postname%/').slice(0, 80),
        sslEnabled: Boolean(body.wordpress.sslEnabled),
        redisCache: Boolean(body.wordpress.redisCache),
        disableXmlRpc: Boolean(body.wordpress.disableXmlRpc),
        maintenanceMode: Boolean(body.wordpress.maintenanceMode),
      };
    }

    if (body.gcp && typeof body.gcp === 'object') {
      const hostingService =
        body.gcp.hostingService === 'firebase-hosting' || body.gcp.hostingService === 'app-engine'
          ? body.gcp.hostingService
          : 'cloud-run';
      const rawHostingDomain = String(body.gcp.hostingDomain || '').trim();
      let cleanHostingDomain = '';
      if (rawHostingDomain) {
        const domainCandidate = rawHostingDomain
          .replace(/^https?:\/\//i, '')
          .split('/')[0]
          .split(':')[0]
          .trim()
          .toLowerCase();
        const sanitizedDomain = sanitizeGcpHostingDomain(domainCandidate, '__invalid__');
        if (sanitizedDomain === '__invalid__') {
          res.status(400).json({
            error:
              'Domínio de hospedagem Google Cloud inválido (informe um domínio público válido, ex.: seu-projeto.web.app).',
          });
          return;
        }
        cleanHostingDomain = sanitizedDomain;
      }

      current.gcp = {
        ...current.gcp,
        projectId: sanitizeGcpProjectId(String(body.gcp.projectId || ''), current.gcp.projectId),
        firestoreDatabaseId: DEFAULT_ADMIN_STATE.gcp.firestoreDatabaseId,
        region: sanitizeGcpRegion(String(body.gcp.region || ''), current.gcp.region),
        hostingService,
        hostingDomain: cleanHostingDomain,
        gcsBucket: sanitizeGcsBucket(String(body.gcp.gcsBucket || ''), current.gcp.gcsBucket),
        firestoreEnabled: Boolean(body.gcp.firestoreEnabled),
        hostingEnabled: Boolean(body.gcp.hostingEnabled),
        gcsMediaEnabled: Boolean(body.gcp.gcsMediaEnabled),
        cloudSqlNote: String(body.gcp.cloudSqlNote || '').slice(0, 180),
      };
    }

    writeAdminState(current);
    supabaseUsersCache = null;
    supabaseContentCache = null;
    res.json({ ok: true, state: current });
  });

  // SSRF-safe Live Connectivity Test for Supabase or Self-Hosted WordPress
  app.post('/api/admin/integrations/test', requireAdminAuth, async (req, res) => {
    const provider = req.body?.provider;
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const state = readAdminState();

    if (provider === 'aws') {
      const awsInput =
        req.body?.aws && typeof req.body.aws === 'object'
          ? (req.body.aws as Record<string, unknown>)
          : null;

      if (awsInput && typeof awsInput.region === 'string' && awsInput.region.trim()) {
        if (sanitizeAwsRegion(awsInput.region, '__INVALID__') === '__INVALID__') {
          res.status(400).json({
            ok: false,
            error: 'Região AWS inválida (ex.: sa-east-1, us-east-1).',
          });
          return;
        }
      }
      if (awsInput && typeof awsInput.bucket === 'string' && awsInput.bucket.trim()) {
        if (sanitizeS3Bucket(awsInput.bucket, '__INVALID__') === '__INVALID__') {
          res.status(400).json({
            ok: false,
            error:
              'Nome do bucket S3 inválido. Use 3 a 63 caracteres minúsculos, números, pontos ou hífens.',
          });
          return;
        }
      }

      const effectiveState: IntegrationState = awsInput
        ? {
            ...state,
            aws: {
              ...state.aws,
              region:
                typeof awsInput.region === 'string'
                  ? sanitizeAwsRegion(awsInput.region, state.aws.region)
                  : state.aws.region,
              bucket:
                typeof awsInput.bucket === 'string'
                  ? sanitizeS3Bucket(awsInput.bucket, state.aws.bucket)
                  : state.aws.bucket,
              cloudFrontDomain:
                typeof awsInput.cloudFrontDomain === 'string'
                  ? sanitizeCloudFrontDomain(awsInput.cloudFrontDomain)
                  : state.aws.cloudFrontDomain,
              cloudFrontEnabled:
                typeof awsInput.cloudFrontEnabled === 'boolean'
                  ? awsInput.cloudFrontEnabled
                  : state.aws.cloudFrontEnabled,
            },
          }
        : state;

      const awsCreds = getAwsCredentialsFromEnv();
      const target = resolveAwsMediaTarget(effectiveState);
      state.aws.lastVerifiedAt = Date.now();
      writeAdminState(state);

      if (!awsCreds) {
        res.json({
          ok: true,
          reachable: false,
          statusLabel: `Servidor conectado, mas as chaves AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY não estão nos Segredos do servidor (${target.region} · s3://${target.bucket}). Modo local de disco permanece ativo.`,
        });
        return;
      }

      try {
        const probe = await headS3Bucket(target);
        res.json({
          ok: true,
          reachable: probe.ok,
          httpStatus: probe.status,
          statusLabel: probe.ok
            ? `Amazon S3 conectado em s3://${target.bucket} (${target.region})${
                target.hasRealCloudFront ? ` · CloudFront: ${target.cloudFrontDomain}` : ' · Entrega com URL assinada S3'
              }`
            : probe.status === 403
            ? `Credenciais AWS detectadas, mas o bucket s3://${target.bucket} retornou HTTP 403 (verifique permissões IAM s3:PutObject/GetObject/ListBucket).`
            : probe.status === 301
            ? `Bucket s3://${target.bucket} existe em outra região AWS (ajuste a Região AWS e salve).`
            : `Bucket s3://${target.bucket} retornou HTTP ${probe.status}.`,
        });
      } catch {
        res.json({
          ok: true,
          reachable: false,
          statusLabel: `Credenciais AWS configuradas, mas não foi possível alcançar s3://${target.bucket} (${target.region}).`,
        });
      }
      return;
    }

    if (provider === 'gcp') {
      const gcpInput =
        req.body?.gcp && typeof req.body.gcp === 'object'
          ? (req.body.gcp as Record<string, unknown>)
          : null;

      if (gcpInput && typeof gcpInput.projectId === 'string' && gcpInput.projectId.trim()) {
        if (sanitizeGcpProjectId(gcpInput.projectId, '__invalid__') === '__invalid__') {
          res.status(400).json({
            ok: false,
            error: 'ID do projeto Google Cloud inválido (use 6 a 30 letras minúsculas, números ou hífens).',
          });
          return;
        }
      }
      if (gcpInput && typeof gcpInput.region === 'string' && gcpInput.region.trim()) {
        if (sanitizeGcpRegion(gcpInput.region, '__invalid__') === '__invalid__') {
          res.status(400).json({
            ok: false,
            error: 'Região Google Cloud inválida (ex.: southamerica-east1, us-east1).',
          });
          return;
        }
      }
      if (gcpInput && typeof gcpInput.gcsBucket === 'string' && gcpInput.gcsBucket.trim()) {
        if (sanitizeGcsBucket(gcpInput.gcsBucket, '__invalid__') === '__invalid__') {
          res.status(400).json({
            ok: false,
            error: 'Nome do bucket Google Cloud Storage inválido.',
          });
          return;
        }
      }

      const effectiveProjectId =
        typeof gcpInput?.projectId === 'string'
          ? sanitizeGcpProjectId(gcpInput.projectId, state.gcp.projectId)
          : state.gcp.projectId;
      const effectiveRegion =
        typeof gcpInput?.region === 'string'
          ? sanitizeGcpRegion(gcpInput.region, state.gcp.region)
          : state.gcp.region;
      const effectiveBucket =
        typeof gcpInput?.gcsBucket === 'string'
          ? sanitizeGcsBucket(gcpInput.gcsBucket, state.gcp.gcsBucket)
          : state.gcp.gcsBucket;
      const rawHostingInput =
        typeof gcpInput?.hostingDomain === 'string'
          ? gcpInput.hostingDomain.trim()
          : state.gcp.hostingDomain;

      let hostingReachable = false;
      let hostingStatusLabel = 'Domínio não informado';
      if (rawHostingInput) {
        try {
          const cleanHost = rawHostingInput.replace(/^https?:\/\//i, '').split('/')[0];
          const validatedHosting = await validateExternalUrl(`https://${cleanHost}`);
          const hostResp = await fetch(validatedHosting.origin, {
            method: 'HEAD',
            signal: AbortSignal.timeout(4500),
          });
          hostingReachable = hostResp.status > 0 && hostResp.status < 500;
          hostingStatusLabel = `Hosting HTTPS (${validatedHosting.hostname}): HTTP ${hostResp.status}`;
        } catch (err) {
          hostingStatusLabel =
            err instanceof Error
              ? `Hosting (${rawHostingInput}): ${err.message}`
              : `Hosting (${rawHostingInput}): inacessível`;
        }
      }

      const gcpCreds = getGcpServiceAccountFromEnv();
      const gcpRuntime = detectGoogleCloudRuntime();
      let bucketProbe: Awaited<ReturnType<typeof probeGcsBucket>>;
      try {
        bucketProbe = await probeGcsBucket(effectiveBucket, gcpCreds);
      } catch {
        bucketProbe = { reachable: false, authenticated: false, status: 0 };
      }

      const runtimeText = gcpRuntime.cloudRunDetected
        ? `Cloud Run ativo${gcpRuntime.serviceName ? ` (${gcpRuntime.serviceName})` : ''}`
        : gcpRuntime.appEngineDetected
        ? 'App Engine ativo'
        : 'Servidor Node.js pronto para Cloud Run';
      const bucketText = bucketProbe.reachable
        ? `GCS gs://${effectiveBucket} alcançável (HTTP ${bucketProbe.status}${
            bucketProbe.authenticated ? ', autenticado via Conta de Serviço' : ''
          })`
        : `GCS gs://${effectiveBucket} retornou HTTP ${bucketProbe.status || 'timeout'}`;
      const credsText = gcpCreds
        ? 'Conta de serviço GCP configurada no servidor'
        : 'Sem GCP_SERVICE_ACCOUNT_JSON no servidor (Firestore via Firebase SDK ativo; defina segredos para upload GCS privado)';

      state.gcp.lastVerifiedAt = Date.now();
      state.gcp.lastStatus = bucketProbe.reachable || Boolean(FIREBASE_PROJECT_ID)
        ? 'Conectado (Firestore + GCP)'
        : 'Configuração parcial';
      writeAdminState(state);

      res.json({
        ok: true,
        reachable: Boolean(FIREBASE_PROJECT_ID) || bucketProbe.reachable || hostingReachable,
        httpStatus: bucketProbe.status,
        hostingReachable,
        statusLabel: `Projeto ${effectiveProjectId} (${effectiveRegion}) · Firestore Enterprise ativo (${DEFAULT_ADMIN_STATE.gcp.firestoreDatabaseId}) · ${runtimeText} · ${bucketText} · ${hostingStatusLabel} · ${credsText}.`,
      });
      return;
    }

    try {
      if (provider === 'supabase') {
        const requestedAnonKey =
          typeof req.body?.anonKey === 'string' ? req.body.anonKey.trim() : '';
        if (requestedAnonKey && isSecretSupabaseKey(requestedAnonKey)) {
          res.status(400).json({
            ok: false,
            error:
              'Por segurança, nunca envie a chave secreta (service_role / sb_secret) no navegador. Cole apenas a chave pública (anon / publishable).',
          });
          return;
        }
        const effectiveAnonKey = requestedAnonKey
          ? requestedAnonKey.slice(0, 600)
          : state.supabase.anonKey;
        if (requestedAnonKey) {
          state.supabase.anonKey = effectiveAnonKey;
        }

        const result = await testSupabaseConnection(
          rawUrl || state.supabase.projectUrl,
          state.supabase.schemaName,
          effectiveAnonKey
        );
        state.supabase.projectUrl = result.origin;
        state.supabase.lastVerifiedAt = Date.now();
        state.supabase.lastStatus = result.tablesReady
          ? 'Conectado (Pronto)'
          : result.hasKeys
          ? 'Chave OK · Falta SQL'
          : 'Falta chave pública (anon)';
        writeAdminState(state);
        supabaseUsersCache = null;
        res.json({
          ok: true,
          reachable: result.reachable,
          tablesReady: result.tablesReady,
          hasKeys: result.hasKeys,
          hasServiceRole: result.hasServiceRole,
          httpStatus: result.httpStatus,
          statusLabel: result.statusLabel,
        });
        return;
      }

      const parsed = await validateExternalUrl(rawUrl);

      if (provider === 'wordpress') {
        const endpoint = new URL('/wp-json/wp/v2/posts?per_page=5', parsed.origin);
        const response = await fetch(endpoint.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        let posts: { id: number; title: string; link: string; date: string }[] = [];
        if (response.ok) {
          const data = (await response.json()) as Array<{
            id?: number;
            title?: { rendered?: string };
            link?: string;
            date?: string;
          }>;
          if (Array.isArray(data)) {
            posts = data.slice(0, 5).map((item) => ({
              id: Number(item.id || 0),
              title: String(item.title?.rendered || 'Post sem título').replace(/<[^>]+>/g, ''),
              link: String(item.link || parsed.origin),
              date: String(item.date || ''),
            }));
          }
        }
        state.wordpress.siteUrl = parsed.origin;
        state.wordpress.lastSyncedAt = Date.now();
        writeAdminState(state);
        res.json({
          ok: true,
          reachable: response.ok,
          httpStatus: response.status,
          posts,
          statusLabel: response.ok
            ? `WordPress REST API conectada (${posts.length} posts obtidos)`
            : `Endpoint respondeu HTTP ${response.status}`,
        });
        return;
      }

      res.status(400).json({ error: 'Provedor inválido.' });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Falha ao validar conexão externa.',
      });
    }
  });

  // Sync existing real users and posts into Supabase PostgreSQL immediately
  app.post('/api/admin/supabase/sync-now', requireAdminAuth, async (req, res) => {
    const state = readAdminState();
    const rawRequestedUrl =
      typeof req.body?.projectUrl === 'string' && req.body.projectUrl.trim()
        ? req.body.projectUrl.trim()
        : state.supabase.projectUrl || DEFAULT_SUPABASE_URL;

    let cleanProjectUrl = state.supabase.projectUrl || DEFAULT_SUPABASE_URL;
    try {
      const parsed = await validateExternalUrl(rawRequestedUrl);
      if (parsed.protocol === 'https:') {
        cleanProjectUrl = parsed.origin.slice(0, 200);
      }
    } catch {
      // Keep existing validated projectUrl if transient parse issue
    }

    if (typeof req.body?.anonKey === 'string') {
      const candidateAnon = req.body.anonKey.trim();
      if (candidateAnon && isSecretSupabaseKey(candidateAnon)) {
        res.status(400).json({
          ok: false,
          error:
            'Por segurança, nunca envie a chave secreta (service_role / sb_secret) no navegador. Cole apenas a chave pública (anon / publishable).',
        });
        return;
      }
      if (candidateAnon) {
        state.supabase.anonKey = candidateAnon.slice(0, 600);
      }
    }

    if (typeof req.body?.schemaName === 'string') {
      const rawSchema = req.body.schemaName.trim();
      const schemaLooksLikeKey =
        /^sb_(publishable|secret)_/i.test(rawSchema) ||
        /^eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/.test(rawSchema) ||
        rawSchema.length > 32;
      if (schemaLooksLikeKey && isSecretSupabaseKey(rawSchema)) {
        res.status(400).json({
          ok: false,
          error:
            'Por segurança, nunca envie a chave secreta (service_role / sb_secret) no navegador.',
        });
        return;
      }
      if (!schemaLooksLikeKey && rawSchema) {
        const cleaned = sanitizeIdentifier(rawSchema, 'public', /[^a-zA-Z0-9_]/g).toLowerCase();
        state.supabase.schemaName = /^[a-z_][a-z0-9_]*$/.test(cleaned) ? cleaned : 'public';
      }
    }

    if (typeof req.body?.autoSyncUsers === 'boolean') {
      state.supabase.autoSyncUsers = req.body.autoSyncUsers;
    }
    if (typeof req.body?.autoSyncPosts === 'boolean') {
      state.supabase.autoSyncPosts = req.body.autoSyncPosts;
    }
    state.supabase.projectUrl = cleanProjectUrl;

    const social = readSharedSocialState();
    const authRecords = readUserAuthRecords();
    const clientUsers = Array.isArray(req.body?.users)
      ? (req.body.users as Array<Record<string, unknown>>).slice(0, 150)
      : [];

    const userMap = new Map<
      string,
      {
        id: string;
        authUid?: string;
        username: string;
        displayName: string;
        email?: string;
        bio?: string;
        website?: string;
        avatarUrl?: string;
        coverUrl?: string;
        verified?: boolean;
        boosted?: boolean;
        restricted?: boolean;
        followers?: string[];
        following?: string[];
      }
    >();

    for (const src of [...(social?.users || []), ...clientUsers]) {
      if (!src || typeof src !== 'object' || src.isDemoSeed === true) continue;
      const id = typeof src.id === 'string' ? src.id.trim() : '';
      const username = typeof src.username === 'string' ? src.username.trim().toLowerCase() : '';
      if (!id || !username) continue;
      userMap.set(id, {
        id,
        authUid: typeof src.uid === 'string' && src.uid.trim() ? src.uid.trim() : undefined,
        username,
        displayName:
          typeof src.displayName === 'string' && src.displayName.trim()
            ? src.displayName.trim()
            : username,
        email: typeof src.email === 'string' ? src.email.trim().toLowerCase() : undefined,
        bio: typeof src.bio === 'string' ? src.bio : '',
        website: typeof src.website === 'string' ? src.website : undefined,
        avatarUrl: typeof src.avatarUrl === 'string' ? src.avatarUrl : undefined,
        coverUrl: typeof src.coverUrl === 'string' ? src.coverUrl : undefined,
        verified: Boolean(src.verified),
        boosted: Boolean(src.boosted),
        restricted: Boolean(src.restricted),
        followers: Array.isArray(src.followers) ? (src.followers as string[]) : undefined,
        following: Array.isArray(src.following) ? (src.following as string[]) : undefined,
      });
    }

    for (const rec of authRecords) {
      const existing = userMap.get(rec.userId);
      userMap.set(rec.userId, {
        id: rec.userId,
        authUid: existing?.authUid,
        username: rec.username,
        displayName: existing?.displayName || rec.username,
        email: existing?.email || rec.email,
        bio: existing?.bio || '',
        website: existing?.website,
        avatarUrl: existing?.avatarUrl,
        coverUrl: existing?.coverUrl,
        verified: existing?.verified ?? false,
        boosted: existing?.boosted ?? false,
        restricted: existing?.restricted ?? false,
        followers: existing?.followers,
        following: existing?.following,
      });
    }

    const sbConfig = {
      ...state.supabase,
      projectUrl: cleanProjectUrl,
    };

    let syncedUsers = 0;
    let missingKeys = false;
    let tableMissing = false;
    let lastErrorMessage = '';

    for (const rawUser of userMap.values()) {
      const handleKey = `handle:${rawUser.username.trim().toLowerCase()}`;
      const flagOverride =
        state.userFlags?.[rawUser.id] ||
        (rawUser.authUid ? state.userFlags?.[rawUser.authUid] : undefined) ||
        state.userFlags?.[handleKey];
      const u = flagOverride
        ? {
            ...rawUser,
            verified:
              typeof flagOverride.verified === 'boolean' ? flagOverride.verified : rawUser.verified,
            boosted:
              typeof flagOverride.boosted === 'boolean' ? flagOverride.boosted : rawUser.boosted,
            restricted:
              typeof flagOverride.restricted === 'boolean'
                ? flagOverride.restricted
                : rawUser.restricted,
          }
        : rawUser;
      const result = await registerOrSyncUserToSupabase(sbConfig, {
        ...u,
        source: 'admin-sync',
      });
      if (result.synced) {
        syncedUsers += 1;
      } else {
        if (result.missingKeys) missingKeys = true;
        if (result.tableMissing) tableMissing = true;
        lastErrorMessage = result.message;
        if (missingKeys || tableMissing) break;
      }
    }

    const realUserIdSet = new Set<string>();
    for (const u of userMap.values()) {
      realUserIdSet.add(u.id);
      if (u.authUid) realUserIdSet.add(u.authUid);
    }

    const clientPosts = Array.isArray(req.body?.posts)
      ? (req.body.posts as Array<Record<string, unknown>>).slice(0, 100)
      : [];
    const clientStories = Array.isArray(req.body?.stories)
      ? (req.body.stories as Array<Record<string, unknown>>).slice(0, 80)
      : [];

    const mergedPostsToPush = mergeByIdRecords(social?.posts || [], clientPosts, 150, 'createdAt').filter((p) => {
      const authorId = typeof p.authorId === 'string' ? p.authorId : '';
      const authorUid = typeof p.authorUid === 'string' ? p.authorUid : '';
      return (
        (realUserIdSet.has(authorId) || (authorUid && realUserIdSet.has(authorUid))) &&
        !deletedPostIds.has(String(p.id || ''))
      );
    });

    const mergedStoriesToPush = mergeByIdRecords(social?.stories || [], clientStories, 80, 'createdAt').filter((s) => {
      const authorId = typeof s.authorId === 'string' ? s.authorId : '';
      const authorUid = typeof s.authorUid === 'string' ? s.authorUid : '';
      return realUserIdSet.has(authorId) || (authorUid && realUserIdSet.has(authorUid));
    });

    let syncedPosts = 0;
    if (!missingKeys && !tableMissing && sbConfig.autoSyncPosts) {
      for (const p of mergedPostsToPush.slice(0, 100)) {
        const mediaArr = Array.isArray(p.media) ? (p.media as Array<Record<string, unknown>>) : [];
        const mediaUrls = mediaArr
          .map((m) => (typeof m.url === 'string' ? m.url : ''))
          .filter(Boolean);
        const postRes = await upsertPostToSupabase(sbConfig, {
          id: String(p.id || ''),
          authorId: String(p.authorId || ''),
          authorUid: typeof p.authorUid === 'string' ? p.authorUid : undefined,
          caption: typeof p.caption === 'string' ? p.caption : '',
          location: typeof p.location === 'string' ? p.location : undefined,
          category: typeof p.category === 'string' ? p.category : 'Fotografia',
          aspectRatio: typeof p.aspectRatio === 'string' ? p.aspectRatio : '4:5',
          isReel: Boolean(p.isReel),
          audioTrack: typeof p.audioTrack === 'string' ? p.audioTrack : undefined,
          mediaUrls,
          mediaAssets: mediaArr.map((m) => ({
            id: typeof m.id === 'string' ? m.id : undefined,
            url: typeof m.url === 'string' ? m.url : '',
            alt: typeof m.alt === 'string' ? m.alt : undefined,
            filterCss: typeof m.filterCss === 'string' ? m.filterCss : undefined,
            mediaType: m.mediaType === 'video' ? 'video' : 'image',
            durationSec: typeof m.durationSec === 'number' ? m.durationSec : undefined,
          })),
          likes: Array.isArray(p.likes) ? (p.likes as string[]) : [],
          savedBy: Array.isArray(p.savedBy) ? (p.savedBy as string[]) : [],
          comments: Array.isArray(p.comments) ? p.comments : [],
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        });
        if (postRes.synced) syncedPosts += 1;
      }

      for (const s of mergedStoriesToPush.slice(0, 60)) {
        await upsertStoryToSupabase(sbConfig, {
          id: String(s.id || ''),
          authorId: String(s.authorId || ''),
          authorUid: typeof s.authorUid === 'string' ? s.authorUid : undefined,
          mediaUrl: typeof s.mediaUrl === 'string' ? s.mediaUrl : '',
          caption: typeof s.caption === 'string' ? s.caption : undefined,
          location: typeof s.location === 'string' ? s.location : undefined,
          viewedBy: Array.isArray(s.viewedBy) ? (s.viewedBy as string[]) : [],
          reactions: Array.isArray(s.reactions)
            ? (s.reactions as Array<{ userId: string; emoji: string }>)
            : [],
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        });
      }
    }

    // Pull latest public data from Supabase and persist into sharedSocialState so all browsers see updates immediately
    let pulledUsers: Record<string, unknown>[] = [];
    let pulledPosts: Record<string, unknown>[] = [];
    let pulledStories: Record<string, unknown>[] = [];
    if (!missingKeys && !tableMissing) {
      [pulledUsers, pulledPosts, pulledStories] = await Promise.all([
        fetchPublicRealUsersFromSupabase(sbConfig),
        fetchPublicPostsFromSupabase(sbConfig),
        fetchPublicStoriesFromSupabase(sbConfig),
      ]);
      const baseShared: SharedSocialState = social || {
        version: 0,
        updatedAt: Date.now(),
        users: [],
        posts: [],
        stories: [],
        threads: [],
        notifications: [],
      };
      const sanitizedClientUsers = Array.from(userMap.values()).map((u) => ({
        id: u.id,
        uid: u.authUid,
        username: u.username,
        displayName: u.displayName,
        bio: u.bio || 'Novo usuário real na Lumina.',
        website: u.website,
        avatarUrl: u.avatarUrl || '/og-preview.jpg',
        coverUrl: u.coverUrl,
        verified: Boolean(u.verified),
        boosted: Boolean(u.boosted),
        restricted: Boolean(u.restricted),
        isOnline: false,
        isDemoSeed: false,
        followers: u.followers || [],
        following: u.following || [],
      }));
      writeSharedSocialState({
        ...baseShared,
        version: (baseShared.version || 0) + 1,
        updatedAt: Date.now(),
        users: applyAuthoritativeUserFlags(
          mergeSharedUsersList(
            mergeSharedUsersList(baseShared.users, sanitizedClientUsers),
            pulledUsers
          ),
          state.userFlags
        ),
        posts: mergeByIdRecords(
          mergeByIdRecords(baseShared.posts, mergedPostsToPush, 220, 'createdAt'),
          pulledPosts,
          220,
          'createdAt'
        ).filter((p) => !deletedPostIds.has(String(p.id || ''))),
        stories: mergeByIdRecords(
          mergeByIdRecords(baseShared.stories, mergedStoriesToPush, 120, 'createdAt'),
          pulledStories,
          120,
          'createdAt'
        ).filter((s) => Date.now() - Number(s.createdAt || 0) <= 24 * 60 * 60 * 1000),
      });
    }

    const allUsersFailed = userMap.size > 0 && syncedUsers === 0;
    const partialUserFailure = userMap.size > 0 && syncedUsers < userMap.size;

    state.supabase.lastVerifiedAt = Date.now();
    state.supabase.lastStatus = missingKeys
      ? 'Aguardando chave no servidor'
      : tableMissing
      ? 'Tabela lumina_users pendente'
      : allUsersFailed
      ? 'Falha ao gravar no Supabase'
      : `${Math.max(syncedUsers, pulledUsers.length)} usuário(s) · ${Math.max(syncedPosts, pulledPosts.length)} post(s)`;
    writeAdminState(state);
    supabaseUsersCache = null;
    supabaseContentCache = null;

    const statusLabel = missingKeys
      ? lastErrorMessage
      : tableMissing
      ? lastErrorMessage
      : userMap.size === 0 && pulledUsers.length === 0
      ? 'Conexão pronta! Nenhum usuário real cadastrado ainda para sincronizar.'
      : partialUserFailure && lastErrorMessage
      ? `Sincronização parcial: ${syncedUsers}/${userMap.size} usuário(s) gravado(s) (${lastErrorMessage}). ${pulledUsers.length} usuário(s) ativos no Supabase.`
      : `Sincronização concluída: ${syncedUsers}/${userMap.size} usuário(s) enviado(s), ${pulledUsers.length} usuário(s) e ${Math.max(syncedPosts, pulledPosts.length)} publicação(ões) ativos no Supabase.`;

    res.json({
      ok: !missingKeys && !tableMissing && !allUsersFailed,
      totalRealUsers: userMap.size,
      syncedUsers,
      syncedPosts,
      pulledUsers: pulledUsers.length,
      missingKeys,
      tableMissing,
      statusLabel,
    });
  });

  // Check for available site updates
  app.get('/api/admin/updates/check', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    const latestAvailable = '2.5.0';
    const hasUpdate = state.site.version !== latestAvailable;
    res.json({
      currentVersion: state.site.version,
      latestVersion: latestAvailable,
      hasUpdate,
      releaseDate: '2026-11-21',
      changelog: [
        'Motor de feed com prioridade para criadores impulsionados',
        'Suporte a banner de comunicado global e modo manutenção',
        'Otimização do exportador WXR e bridge WordPress REST API',
        'Melhorias de contraste e compressão de mídia local',
      ],
    });
  });

  // Download full source code bundle (.zip)
  app.get('/api/admin/updates/download-code', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    const files = collectAllowlistedProjectFiles();
    files.push({
      name: 'lumina-release-manifest.json',
      content: JSON.stringify(
        {
          app: 'Lumina',
          version: state.site.version,
          exportedAt: new Date().toISOString(),
          filesCount: files.length,
        },
        null,
        2
      ),
    });

    const zipBuffer = createZipBuffer(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lumina-source-v${state.site.version}.zip"`
    );
    res.send(zipBuffer);
  });

  // Download sample update package (.json) for easy testing of upload & apply
  app.get('/api/admin/updates/sample-package', requireAdminAuth, (_req, res) => {
    const pkg = {
      packageType: 'lumina-site-update',
      version: '2.5.0',
      channel: 'stable',
      releasedAt: '2026-11-21T14:00:00Z',
      notes: [
        'Novo suporte a destaques impulsionados no feed principal',
        'Otimizações no conector Supabase e ponte WordPress auto-hospedado',
        'Correções de acessibilidade e contraste no tema escuro',
      ],
      configPatch: {
        announcementBanner: 'Lumina v2.5.0 instalada com sucesso — nova geração de mídia e painel cloud.',
        maintenanceMode: false,
      },
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="lumina-update-2.5.0.json"'
    );
    res.send(JSON.stringify(pkg, null, 2));
  });

  // Insert & apply an uploaded update file (.json manifest)
  app.post('/api/admin/updates/apply', requireAdminAuth, (req, res) => {
    const pkg = req.body;
    if (!pkg || typeof pkg !== 'object') {
      res.status(400).json({ error: 'Arquivo de atualização inválido.' });
      return;
    }

    const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
      res.status(400).json({ error: 'Versão semântica inválida no pacote (ex: 2.5.0).' });
      return;
    }

    const notes = Array.isArray(pkg.notes)
      ? pkg.notes.filter((n: unknown): n is string => typeof n === 'string').slice(0, 12)
      : ['Atualização aplicada via pacote manual'];

    const state = readAdminState();
    state.site.version = version;
    if (pkg.channel === 'beta' || pkg.channel === 'stable') {
      state.site.channel = pkg.channel;
    }
    if (pkg.configPatch && typeof pkg.configPatch === 'object') {
      if (typeof pkg.configPatch.announcementBanner === 'string') {
        state.site.announcementBanner = pkg.configPatch.announcementBanner.slice(0, 220);
      }
      if (typeof pkg.configPatch.maintenanceMode === 'boolean') {
        state.site.maintenanceMode = pkg.configPatch.maintenanceMode;
      }
    }

    state.site.updateHistory.unshift({
      id: `upd_${Date.now()}`,
      version,
      source: pkg.source === 'remote' ? 'remote' : 'upload',
      notes,
      appliedAt: Date.now(),
    });
    state.site.updateHistory = state.site.updateHistory.slice(0, 20);

    writeAdminState(state);
    broadcastRealtimeEvent({ type: 'site_meta_update', updatedAt: Date.now() });
    res.json({ ok: true, site: state.site });
  });

  // Update site banner / maintenance mode / realUsersOnly / video rules directly
  app.patch('/api/admin/updates/site-flags', requireAdminAuth, (req, res) => {
    const state = readAdminState();
    if (typeof req.body?.announcementBanner === 'string') {
      state.site.announcementBanner = req.body.announcementBanner.slice(0, 220);
    }
    if (typeof req.body?.maintenanceMode === 'boolean') {
      state.site.maintenanceMode = req.body.maintenanceMode;
    }
    if (typeof req.body?.realUsersOnly === 'boolean') {
      state.site.realUsersOnly = req.body.realUsersOnly;
    }
    if (req.body?.videoRules && typeof req.body.videoRules === 'object') {
      const vr = req.body.videoRules;
      if (typeof vr.maxVideoSizeMB === 'number' && Number.isFinite(vr.maxVideoSizeMB)) {
        state.site.videoRules.maxVideoSizeMB = Math.min(250, Math.max(1, Math.round(vr.maxVideoSizeMB)));
      }
      if (typeof vr.maxReelDurationSec === 'number' && Number.isFinite(vr.maxReelDurationSec)) {
        state.site.videoRules.maxReelDurationSec = Math.min(300, Math.max(5, Math.round(vr.maxReelDurationSec)));
      }
      if (typeof vr.allowVideoReels === 'boolean') {
        state.site.videoRules.allowVideoReels = vr.allowVideoReels;
      }
    }
    writeAdminState(state);
    broadcastRealtimeEvent({ type: 'site_meta_update', updatedAt: Date.now() });
    res.json({ ok: true, site: state.site });
  });

  // Admin User Invitations
  app.get('/api/admin/invites', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    res.json({ invites: state.invites });
  });

  app.post('/api/admin/invites', requireAdminAuth, (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 140) : '';
    const invitedName =
      typeof req.body?.invitedName === 'string' ? req.body.invitedName.trim().slice(0, 80) : '';
    const grantVerified = Boolean(req.body?.grantVerified);
    const expiresDays =
      typeof req.body?.expiresDays === 'number'
        ? Math.min(90, Math.max(1, Math.round(req.body.expiresDays)))
        : 7;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Informe um e-mail válido para o convite.' });
      return;
    }

    const code = `LUM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const invite = {
      id: `inv_${now}`,
      code,
      email,
      invitedName: invitedName || undefined,
      grantVerified,
      status: 'pending' as const,
      createdAt: now,
      expiresAt: now + expiresDays * 86_400_000,
    };

    const state = readAdminState();
    state.invites.unshift(invite);
    state.invites = state.invites.slice(0, 100);
    writeAdminState(state);
    res.json({ ok: true, invite, invites: state.invites });
  });

  app.patch('/api/admin/invites/:id/revoke', requireAdminAuth, (req, res) => {
    const state = readAdminState();
    const target = state.invites.find((i) => i.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Convite não encontrado.' });
      return;
    }
    target.status = 'revoked';
    writeAdminState(state);
    res.json({ ok: true, invites: state.invites });
  });

  app.post('/api/invites/accept', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().replace(/^@/, '')
        : '';
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 60) : '';
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 160) : '';
    const avatarUrl =
      typeof req.body?.avatarUrl === 'string' && isSafePreviewMediaUrl(req.body.avatarUrl)
        ? req.body.avatarUrl.trim()
        : undefined;
    const coverUrl =
      typeof req.body?.coverUrl === 'string' && isSafePreviewMediaUrl(req.body.coverUrl)
        ? req.body.coverUrl.trim()
        : undefined;
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!code) {
      res.status(400).json({ error: 'Código de convite obrigatório.' });
      return;
    }
    const state = readAdminState();
    const invite = state.invites.find((i) => i.code.toUpperCase() === code);
    if (!invite) {
      res.status(404).json({ error: 'Convite não encontrado.' });
      return;
    }
    if (invite.status !== 'pending' || invite.expiresAt < Date.now()) {
      res.status(409).json({ error: 'Este convite já foi usado, revogado ou expirou.' });
      return;
    }

    const resolvedEmail = email || invite.email.toLowerCase();
    if (password) {
      if (password.length < 6) {
        res.status(400).json({ error: 'A senha de acesso deve ter pelo menos 6 caracteres.' });
        return;
      }
      if (userId && username) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPasscode(password, salt);
        const existing = readUserAuthRecords().filter(
          (r) => r.userId !== userId && r.username.toLowerCase() !== username
        );
        existing.unshift({
          userId,
          username,
          email: resolvedEmail,
          salt,
          hash,
          createdAt: Date.now(),
        });
        writeUserAuthRecords(existing);
      }
    }

    invite.status = 'accepted';
    invite.acceptedByUserId = userId || undefined;
    writeAdminState(state);

    let supabaseResult: { synced: boolean; message: string } = {
      synced: false,
      message: 'Sincronização automática desativada.',
    };
    if (userId && username && state.supabase.autoSyncUsers && state.supabase.projectUrl) {
      supabaseResult = await registerOrSyncUserToSupabase(state.supabase, {
        id: userId,
        username,
        displayName: displayName || invite.invitedName || username,
        email: resolvedEmail,
        password: password || undefined,
        bio: bio || 'Novo membro convidado na Lumina.',
        avatarUrl,
        coverUrl,
        verified: invite.grantVerified,
        source: 'invite',
      });
    }
    supabaseUsersCache = null;

    res.json({
      ok: true,
      invite,
      grantVerified: invite.grantVerified,
      supabaseSynced: supabaseResult.synced,
      supabaseMessage: supabaseResult.message,
    });
  });

  // Direct Real User Registration (stores scrypt hash + shared public profile + Supabase DB)
  app.post('/api/auth/register', express.json({ limit: '1mb' }), async (req, res) => {
    const rawUsername =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().replace(/^@/, '')
        : '';
    const cleanUsername = rawUsername.replace(/[^a-z0-9._]/g, '').slice(0, 32);
    const displayName =
      typeof req.body?.displayName === 'string'
        ? req.body.displayName.trim().slice(0, 60)
        : '';
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 140) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 160) : '';
    const inviteCode =
      typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim().toUpperCase() : '';
    const avatarUrl =
      typeof req.body?.avatarUrl === 'string' && isSafePreviewMediaUrl(req.body.avatarUrl)
        ? req.body.avatarUrl.trim()
        : undefined;
    const coverUrl =
      typeof req.body?.coverUrl === 'string' && isSafePreviewMediaUrl(req.body.coverUrl)
        ? req.body.coverUrl.trim()
        : undefined;

    if (cleanUsername.length < 3 || cleanUsername !== rawUsername) {
      res.status(400).json({
        error: 'Escolha um @usuario válido com 3 a 32 caracteres (apenas letras, números, ponto e _).',
      });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Informe um e-mail real válido.' });
      return;
    }
    if (email === ADMIN_EMAIL.toLowerCase() || cleanUsername === 'dadaniel14hiphop') {
      res.status(403).json({ error: 'Este identificador pertence à conta administrativa.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Crie uma senha com entre 6 e 128 caracteres.' });
      return;
    }

    const records = readUserAuthRecords();
    const shared = readSharedSocialState();
    const existingUsernameInRecords = records.some(
      (r) => r.username.toLowerCase() === cleanUsername
    );
    const existingEmailInRecords = records.some(
      (r) => r.email && r.email.toLowerCase() === email
    );
    const existingUsernameInSocial = Boolean(
      shared?.users?.some(
        (u) =>
          typeof u.username === 'string' &&
          u.username.toLowerCase() === cleanUsername &&
          u.isDemoSeed !== true
      )
    );

    if (existingUsernameInRecords || existingUsernameInSocial) {
      res.status(409).json({ error: `O nome de usuário @${cleanUsername} já está cadastrado.` });
      return;
    }
    if (existingEmailInRecords) {
      res.status(409).json({ error: 'Este e-mail já está cadastrado na Lumina.' });
      return;
    }

    const adminState = readAdminState();
    let grantVerified = false;
    let matchedInviteId: string | null = null;
    if (inviteCode) {
      const invite = adminState.invites.find((i) => i.code.toUpperCase() === inviteCode);
      if (!invite) {
        res.status(404).json({ error: 'Código de convite não encontrado.' });
        return;
      }
      if (invite.status !== 'pending' || invite.expiresAt < Date.now()) {
        res.status(409).json({ error: 'Este código de convite já foi usado, revogado ou expirou.' });
        return;
      }
      grantVerified = Boolean(invite.grantVerified);
      matchedInviteId = invite.id;
    }

    const userId = `user_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPasscode(password, salt);

    records.unshift({
      userId,
      username: cleanUsername,
      email,
      salt,
      hash,
      createdAt: Date.now(),
    });
    writeUserAuthRecords(records);

    if (matchedInviteId) {
      const targetInvite = adminState.invites.find((i) => i.id === matchedInviteId);
      if (targetInvite) {
        targetInvite.status = 'accepted';
        targetInvite.acceptedByUserId = userId;
        writeAdminState(adminState);
      }
    }

    const resolvedDisplayName = displayName || cleanUsername;
    const resolvedBio = bio || 'Novo usuário real na Lumina.';
    const publicUser = {
      id: userId,
      username: cleanUsername,
      displayName: resolvedDisplayName,
      avatarUrl: avatarUrl || '/og-preview.jpg',
      coverUrl: coverUrl || '/og-preview.jpg',
      bio: resolvedBio,
      verified: grantVerified,
      isOnline: true,
      isDemoSeed: false,
      followers: [] as string[],
      following: [] as string[],
    };

    const currentShared = shared || {
      version: 0,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };
    const nextUsers = [
      publicUser,
      ...currentShared.users.filter((u) => u.id !== userId && u.username !== cleanUsername),
    ].slice(0, 200);
    writeSharedSocialState({
      ...currentShared,
      version: (currentShared.version || 0) + 1,
      updatedAt: Date.now(),
      users: nextUsers,
    });

    let supabaseSynced = false;
    let supabaseMessage = '';
    if (adminState.supabase.autoSyncUsers && adminState.supabase.projectUrl) {
      const sbRes = await registerOrSyncUserToSupabase(adminState.supabase, {
        id: userId,
        username: cleanUsername,
        displayName: resolvedDisplayName,
        email,
        password,
        bio: resolvedBio,
        avatarUrl,
        coverUrl,
        verified: grantVerified,
        source: matchedInviteId ? 'invite' : 'register',
      });
      supabaseSynced = sbRes.synced;
      supabaseMessage = sbRes.message;
    }
    supabaseUsersCache = null;

    res.json({
      ok: true,
      user: publicUser,
      email,
      grantVerified,
      supabaseSynced,
      supabaseMessage,
    });
  });

  // Sync Firebase Google-authenticated real users into Supabase PostgreSQL
  app.post('/api/supabase/sync-user', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token de sessão necessário.' });
      return;
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    let tokenInfo: { uid: string; email: string; emailVerified: boolean };
    try {
      tokenInfo = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Token Firebase inválido.',
      });
      return;
    }
    if (!tokenInfo.emailVerified) {
      res.status(403).json({ error: 'Conta Google sem e-mail verificado.' });
      return;
    }

    const adminState = readAdminState();
    if (!adminState.supabase.autoSyncUsers || !adminState.supabase.projectUrl) {
      res.json({ ok: true, synced: false, message: 'Sincronização automática desativada.' });
      return;
    }

    const isExclusiveAdmin = tokenInfo.email === ADMIN_EMAIL.toLowerCase();
    const rawUsername =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '')
        : '';
    const username = rawUsername.length >= 3 ? rawUsername : `user.${tokenInfo.uid.slice(0, 6).toLowerCase()}`;
    const displayName =
      typeof req.body?.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim().slice(0, 60)
        : username;
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 160) : '';
    const avatarUrl =
      typeof req.body?.avatarUrl === 'string' && isSafePreviewMediaUrl(req.body.avatarUrl)
        ? req.body.avatarUrl.trim()
        : undefined;
    const coverUrl =
      typeof req.body?.coverUrl === 'string' && isSafePreviewMediaUrl(req.body.coverUrl)
        ? req.body.coverUrl.trim()
        : undefined;

    const result = await registerOrSyncUserToSupabase(adminState.supabase, {
      id: tokenInfo.uid,
      authUid: tokenInfo.uid,
      username,
      displayName,
      email: tokenInfo.email,
      bio,
      avatarUrl,
      coverUrl,
      verified: isExclusiveAdmin,
      source: 'google',
    });
    supabaseUsersCache = null;

    res.json({ ok: result.synced, ...result });
  });

  app.post('/api/auth/login', async (req, res) => {
    const identifierRaw =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const identifier = identifierRaw.replace(/^@/, '');
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      res.status(400).json({ error: 'Informe seu usuário/e-mail e senha.' });
      return;
    }

    // Allow exclusive admin account login using configured admin passcode
    if (
      (identifierRaw === ADMIN_EMAIL.toLowerCase() || identifier === 'dadaniel14hiphop') &&
      verifyPasscode(password)
    ) {
      res.json({
        ok: true,
        userId: 'admin_daniel',
        username: 'dadaniel14hiphop',
        email: ADMIN_EMAIL,
        isAdmin: true,
        adminToken: signSessionToken(),
      });
      return;
    }

    const records = readUserAuthRecords();
    const match = records.find(
      (r) =>
        r.username.toLowerCase() === identifier ||
        (r.email && r.email.toLowerCase() === identifierRaw)
    );

    if (match && verifyUserPassword(password, match)) {
      const shared = readSharedSocialState();
      const matchedProfile = shared?.users.find(
        (u) =>
          String(u.id || '') === match.userId ||
          (typeof u.username === 'string' && u.username.toLowerCase() === match.username.toLowerCase())
      );
      if (matchedProfile) {
        const { email: _stripEmail, ...publicProfile } = matchedProfile;
        res.json({ ok: true, userId: match.userId, username: match.username, user: publicProfile });
      } else {
        res.json({ ok: true, userId: match.userId, username: match.username });
      }
      return;
    }

    // Fallback to Supabase Auth if account was registered on another device or directly in Supabase
    const adminState = readAdminState();
    if (adminState.supabase.projectUrl) {
      let resolvedEmail = identifierRaw.includes('@') ? identifierRaw : '';
      if (!resolvedEmail) {
        resolvedEmail =
          records.find((r) => r.username.toLowerCase() === identifier && r.email)?.email?.toLowerCase() ||
          (await resolveSupabaseEmailByUsername(adminState.supabase, identifier)) ||
          '';
      }
      let supabaseLoginError = '';
      if (resolvedEmail) {
        const sbLogin = await verifySupabasePasswordLogin(
          adminState.supabase.projectUrl,
          resolvedEmail,
          password,
          adminState.supabase.anonKey,
          adminState.supabase.schemaName
        );
        if (sbLogin.ok) {
          const resolvedUsername =
            sbLogin.username ||
            resolvedEmail.split('@')[0].replace(/[^a-z0-9._]/g, '').slice(0, 24);
          const resolvedId = sbLogin.userId || sbLogin.authUid || `sb_${Date.now()}`;
          if (sbLogin.user) {
            const shared = readSharedSocialState() || {
              version: 0,
              updatedAt: Date.now(),
              users: [],
              posts: [],
              stories: [],
              threads: [],
              notifications: [],
            };
            writeSharedSocialState({
              ...shared,
              version: (shared.version || 0) + 1,
              updatedAt: Date.now(),
              users: mergeSharedUsersList(shared.users, [sbLogin.user]),
            });
          }
          res.json({
            ok: true,
            userId: resolvedId,
            username: resolvedUsername,
            displayName: sbLogin.displayName,
            email: resolvedEmail,
            user: sbLogin.user,
          });
          return;
        }
        if (sbLogin.emailNotConfirmed && sbLogin.error) {
          supabaseLoginError = sbLogin.error;
        }
      }
      if (supabaseLoginError) {
        res.status(401).json({ error: supabaseLoginError });
        return;
      }
    }

    res.status(401).json({ error: 'Usuário/e-mail ou senha incorretos.' });
  });

  app.get('/api/auth/has-password', (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const username =
      typeof req.query.username === 'string'
        ? req.query.username.trim().toLowerCase().replace(/^@/, '')
        : '';
    const records = readUserAuthRecords();
    const exists = records.some(
      (r) =>
        (userId && r.userId === userId) ||
        (username && r.username.toLowerCase() === username)
    );
    res.json({ hasPassword: exists });
  });

  app.post('/api/auth/change-password', (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().replace(/^@/, '')
        : '';
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!userId && !username) {
      res.status(400).json({ error: 'Usuário não identificado.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    const records = readUserAuthRecords();
    const match = records.find(
      (r) =>
        (userId && r.userId === userId) ||
        (username && r.username.toLowerCase() === username)
    );

    if (match) {
      if (!currentPassword || !verifyUserPassword(currentPassword, match)) {
        res.status(401).json({ error: 'A senha atual está incorreta.' });
        return;
      }
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPasscode(newPassword, salt);
    const filtered = records.filter(
      (r) =>
        !(userId && r.userId === userId) &&
        !(username && r.username.toLowerCase() === username)
    );
    filtered.unshift({
      userId: userId || match?.userId || `user_${Date.now()}`,
      username: username || match?.username || '',
      email: email || match?.email,
      salt,
      hash,
      createdAt: match?.createdAt || Date.now(),
    });
    writeUserAuthRecords(filtered);

    res.json({ ok: true });
  });

  // Public profile lookup by @username, ID or UID (used for shared profile links)
  app.get('/api/social/profile/:username', async (req, res) => {
    const rawParam = String(req.params.username || '').trim().replace(/^@/, '').slice(0, 80);
    const cleanHandle = rawParam.toLowerCase();
    if (!cleanHandle) {
      res.status(400).json({ error: 'Perfil inválido.' });
      return;
    }

    const social = readSharedSocialState();
    const adminState = readAdminState();
    let resolvedUser: Record<string, unknown> | null =
      social?.users.find(
        (u) =>
          (typeof u.username === 'string' && u.username.toLowerCase() === cleanHandle) ||
          (typeof u.id === 'string' && u.id.toLowerCase() === cleanHandle) ||
          (typeof u.uid === 'string' && u.uid.toLowerCase() === cleanHandle)
      ) || null;

    if (!resolvedUser && supabaseUsersCache?.users) {
      resolvedUser =
        supabaseUsersCache.users.find(
          (u) =>
            (typeof u.username === 'string' && u.username.toLowerCase() === cleanHandle) ||
            (typeof u.id === 'string' && u.id.toLowerCase() === cleanHandle) ||
            (typeof u.uid === 'string' && u.uid.toLowerCase() === cleanHandle)
        ) || null;
    }

    if (!resolvedUser && adminState.supabase.projectUrl) {
      resolvedUser = await fetchPublicUserByUsernameFromSupabase(adminState.supabase, rawParam);
    }

    if (!resolvedUser) {
      res.status(404).json({ ok: false, error: 'Perfil não encontrado.' });
      return;
    }

    const flaggedUser = applyAuthoritativeUserFlags([resolvedUser], adminState.userFlags)[0] || resolvedUser;
    const { email: _stripEmail, ...publicFields } = flaggedUser;
    const targetIds = new Set(
      [String(publicFields.id || ''), typeof publicFields.uid === 'string' ? publicFields.uid : ''].filter(Boolean)
    );

    const localPosts = (social?.posts || []).filter(
      (p) =>
        !deletedPostIds.has(String(p.id || '')) &&
        (targetIds.has(String(p.authorId || '')) ||
          (typeof p.authorUid === 'string' && targetIds.has(p.authorUid)))
    );
    const localStories = (social?.stories || []).filter(
      (s) =>
        (targetIds.has(String(s.authorId || '')) ||
          (typeof s.authorUid === 'string' && targetIds.has(s.authorUid))) &&
        Date.now() - Number(s.createdAt || 0) <= 24 * 60 * 60 * 1000
    );

    let sbPosts: Record<string, unknown>[] = [];
    let sbStories: Record<string, unknown>[] = [];
    if (adminState.supabase.projectUrl && targetIds.size > 0) {
      const targetIdList = Array.from(targetIds);
      [sbPosts, sbStories] = await Promise.all([
        fetchPublicPostsFromSupabase(adminState.supabase, targetIdList),
        fetchPublicStoriesFromSupabase(adminState.supabase, targetIdList),
      ]);
    }

    const posts = mergeByIdRecords(localPosts, sbPosts, 100, 'createdAt').filter(
      (p) => !deletedPostIds.has(String(p.id || ''))
    );
    const stories = mergeByIdRecords(localStories, sbStories, 40, 'createdAt');

    res.json({ ok: true, user: publicFields, posts, stories });
  });

  // Shared Social State Sync (multi-device fallback for Node-hosted instances + Supabase public data)
  app.get('/api/social/state', async (req, res) => {
    const social = readSharedSocialState();
    const adminState = readAdminState();
    const viewerIdsParam = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const viewerIds = viewerIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);

    if (
      adminState.supabase.autoSyncUsers &&
      adminState.supabase.projectUrl &&
      (!supabaseUsersCache || Date.now() - supabaseUsersCache.fetchedAt > 1_500)
    ) {
      const sbUsers = await fetchPublicRealUsersFromSupabase(adminState.supabase);
      supabaseUsersCache = { fetchedAt: Date.now(), users: sbUsers };
    }

    if (
      adminState.supabase.autoSyncPosts &&
      adminState.supabase.projectUrl &&
      (!supabaseContentCache || Date.now() - supabaseContentCache.fetchedAt > 1_500)
    ) {
      const [sbPosts, sbStories] = await Promise.all([
        fetchPublicPostsFromSupabase(adminState.supabase),
        fetchPublicStoriesFromSupabase(adminState.supabase),
      ]);
      supabaseContentCache = {
        fetchedAt: Date.now(),
        posts: sbPosts,
        stories: sbStories,
      };
    }

    const sbUsers = supabaseUsersCache?.users || [];
    const sbPosts = supabaseContentCache?.posts || [];
    const sbStories = supabaseContentCache?.stories || [];

    let sbThreads: Record<string, unknown>[] = [];
    if (viewerIds.length > 0 && adminState.supabase.projectUrl) {
      sbThreads = await fetchDirectThreadsForUserFromSupabase(adminState.supabase, viewerIds);
    }

    const baseState: SharedSocialState = social || {
      version: 1,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };

    const mergedUsers = applyAuthoritativeUserFlags(
      mergeSharedUsersList(baseState.users, sbUsers),
      adminState.userFlags
    );
    const mergedPosts = mergeByIdRecords(baseState.posts, sbPosts, 200, 'createdAt').filter(
      (p) => !deletedPostIds.has(String(p.id || ''))
    );
    const mergedStories = mergeByIdRecords(baseState.stories, sbStories, 100, 'createdAt').filter(
      (s) => Date.now() - Number(s.createdAt || 0) <= 24 * 60 * 60 * 1000
    );
    const mergedThreads = mergeByIdRecords(baseState.threads, sbThreads, 150, 'updatedAt');

    const latestFlagUpdate = Object.values(adminState.userFlags || {}).reduce(
      (maxTs, entry) => Math.max(maxTs, Number(entry?.updatedAt || 0)),
      0
    );
    const effectiveUpdatedAt = Math.max(
      baseState.updatedAt || 0,
      supabaseUsersCache?.fetchedAt || 0,
      supabaseContentCache?.fetchedAt || 0,
      latestFlagUpdate
    );

    res.json({
      ok: true,
      state: {
        ...baseState,
        updatedAt: effectiveUpdatedAt,
        users: mergedUsers,
        posts: mergedPosts,
        stories: mergedStories,
        threads: mergedThreads,
        userFlagOverrides: adminState.userFlags || {},
      },
    });
  });

  // Protected admin endpoint to persist verified, boosted, and restricted flags across devices and Supabase
  app.patch('/api/admin/users/:id/flags', requireAdminAuth, async (req, res) => {
    const userId = String(req.params.id || '').trim().slice(0, 128);
    if (!userId) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const verified = typeof body.verified === 'boolean' ? body.verified : undefined;
    const boosted = typeof body.boosted === 'boolean' ? body.boosted : undefined;
    const restricted = typeof body.restricted === 'boolean' ? body.restricted : undefined;
    if (verified === undefined && boosted === undefined && restricted === undefined) {
      res.status(400).json({ error: 'Informe ao menos um selo ou status para atualizar.' });
      return;
    }

    const rawUsername =
      typeof body.username === 'string'
        ? body.username.trim().toLowerCase().replace(/^@/, '').slice(0, 40)
        : '';
    const rawUid = typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '';
    const now = Date.now();

    const adminState = readAdminState();
    const nextUserFlags = { ...(adminState.userFlags || {}) };
    const prevEntry =
      nextUserFlags[userId] ||
      (rawUid ? nextUserFlags[rawUid] : undefined) ||
      (rawUsername ? nextUserFlags[`handle:${rawUsername}`] : undefined) ||
      { updatedAt: now };

    const updatedEntry = {
      ...prevEntry,
      id: userId,
      ...(rawUsername ? { username: rawUsername } : {}),
      ...(verified !== undefined ? { verified } : {}),
      ...(boosted !== undefined ? { boosted } : {}),
      ...(restricted !== undefined ? { restricted } : {}),
      updatedAt: now,
    };

    nextUserFlags[userId] = updatedEntry;
    if (rawUid) nextUserFlags[rawUid] = updatedEntry;
    if (rawUsername) nextUserFlags[`handle:${rawUsername}`] = updatedEntry;
    adminState.userFlags = nextUserFlags;
    writeAdminState(adminState);

    const social = readSharedSocialState();
    if (social) {
      const updatedUsers = social.users.map((u) => {
        const uHandle =
          typeof u.username === 'string' ? u.username.trim().toLowerCase().replace(/^@/, '') : '';
        const matchId =
          String(u.id || '') === userId ||
          (rawUid && (String(u.uid || '') === rawUid || String(u.id || '') === rawUid)) ||
          (rawUsername && u.isDemoSeed !== true && uHandle === rawUsername);
        if (!matchId) return u;
        return {
          ...u,
          ...(verified !== undefined ? { verified } : {}),
          ...(boosted !== undefined ? { boosted } : {}),
          ...(restricted !== undefined ? { restricted } : {}),
        };
      });
      writeSharedSocialState({
        ...social,
        version: (social.version || 0) + 1,
        updatedAt: now,
        users: updatedUsers,
      });
    }
    supabaseUsersCache = null;

    let supabaseSynced = false;
    if (adminState.supabase.projectUrl) {
      supabaseSynced = await updateUserInSupabase(adminState.supabase, userId, {
        verified,
        boosted,
        restricted,
        matchUsername: rawUsername || undefined,
        matchUid: rawUid || undefined,
      });
    }

    res.json({
      ok: true,
      supabaseSynced,
      updatedAt: now,
      userFlags: nextUserFlags,
    });
    broadcastRealtimeEvent({ type: 'social_update', scope: 'users', updatedAt: now });
  });

  // Real-time presence heartbeat & immediate online/offline endpoint (supports JSON & sendBeacon text/plain)
  app.post('/api/social/presence', express.text({ type: 'text/plain', limit: '8kb' }), (req, res) => {
    let body: Record<string, unknown> = {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as Record<string, unknown>;
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim().slice(0, 128) : '';
    const uid = typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '';
    if (!userId && !uid) {
      res.status(400).json({ error: 'userId obrigatório.' });
      return;
    }
    const isOnline = body.isOnline !== false;
    const now = Date.now();
    const resPres = setUserPresenceInSharedState([userId, uid].filter(Boolean), isOnline, now);
    broadcastRealtimeEvent({
      type: 'presence_update',
      userId: resPres.userId || userId,
      uid: resPres.uid || (uid || undefined),
      isOnline,
      lastActiveAtMs: now,
    });
    res.json({ ok: true, isOnline, lastActiveAtMs: now });
  });

  app.put('/api/social/state', express.json({ limit: '10mb' }), (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.users) || !Array.isArray(body.posts)) {
      res.status(400).json({ error: 'Estrutura de sincronização inválida.' });
      return;
    }

    const current = readSharedSocialState() || {
      version: 0,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };

    const incomingUsers = (body.users as Record<string, unknown>[]).slice(0, 200);
    const incomingPosts = (body.posts as Record<string, unknown>[])
      .filter((p) => !deletedPostIds.has(String(p?.id || '')))
      .slice(0, 200);
    const incomingStories = Array.isArray(body.stories)
      ? (body.stories as Record<string, unknown>[]).slice(0, 100)
      : [];
    const incomingThreads = Array.isArray(body.threads)
      ? (body.threads as Record<string, unknown>[]).slice(0, 100)
      : [];
    const incomingNotifications = Array.isArray(body.notifications)
      ? (body.notifications as Record<string, unknown>[]).slice(0, 200)
      : [];

    const nextState: SharedSocialState = {
      version: Math.max(memorySocialState?.version || 0, current.version || 0) + 1,
      updatedAt: Date.now(),
      users: mergeSharedUsersList(current.users, incomingUsers),
      posts: mergeByIdRecords(
        current.posts.filter((p) => !deletedPostIds.has(String(p?.id || ''))),
        incomingPosts,
        220,
        'createdAt'
      ),
      stories: mergeByIdRecords(current.stories, incomingStories, 120, 'createdAt').filter(
        (s) => Date.now() - Number(s.createdAt || 0) <= 24 * 60 * 60 * 1000
      ),
      threads: mergeByIdRecords(current.threads, incomingThreads, 150, 'updatedAt'),
      notifications: mergeByIdRecords(
        current.notifications,
        incomingNotifications,
        250,
        'createdAt'
      ),
    };
    writeSharedSocialState(nextState);
    const senderScopeIds = incomingUsers
      .slice(0, 2)
      .flatMap((u) => [
        typeof u.id === 'string' ? u.id : '',
        typeof u.uid === 'string' ? u.uid : '',
      ])
      .filter(Boolean);
    broadcastRealtimeEvent(
      { type: 'social_update', scope: 'all', updatedAt: nextState.updatedAt },
      senderScopeIds
    );
    res.json({ ok: true, version: nextState.version, updatedAt: nextState.updatedAt });
  });

  const ensureSupabaseUsersExistForIds = async (
    sbConfig: ReturnType<typeof readAdminState>['supabase'],
    sharedUsers: Record<string, unknown>[],
    candidateIds: Array<string | undefined>
  ) => {
    const cleanIds = Array.from(new Set(candidateIds.map((v) => (v || '').trim()).filter(Boolean)));
    if (cleanIds.length === 0 || !sbConfig.projectUrl) return;
    let syncedAny = false;
    for (const targetId of cleanIds) {
      const matched = sharedUsers.find(
        (u) =>
          u &&
          u.isDemoSeed !== true &&
          (String(u.id || '') === targetId || (typeof u.uid === 'string' && u.uid === targetId))
      );
      if (!matched || typeof matched.username !== 'string' || !matched.username.trim()) continue;
      const syncRes = await registerOrSyncUserToSupabase(sbConfig, {
        id: String(matched.id || targetId),
        authUid: typeof matched.uid === 'string' ? matched.uid : undefined,
        username: String(matched.username).trim().toLowerCase(),
        displayName:
          typeof matched.displayName === 'string' && matched.displayName.trim()
            ? matched.displayName.trim()
            : String(matched.username),
        bio: typeof matched.bio === 'string' ? matched.bio : '',
        website: typeof matched.website === 'string' ? matched.website : undefined,
        avatarUrl: typeof matched.avatarUrl === 'string' ? matched.avatarUrl : undefined,
        coverUrl: typeof matched.coverUrl === 'string' ? matched.coverUrl : undefined,
        followers: Array.isArray(matched.followers) ? (matched.followers as string[]) : undefined,
        following: Array.isArray(matched.following) ? (matched.following as string[]) : undefined,
        source: 'admin-sync',
      });
      if (syncRes.synced) syncedAny = true;
    }
    if (syncedAny) {
      supabaseUsersCache = null;
    }
  };

  // Immediate real-time endpoints for posts, stories, DMs, and profile updates (synced to Supabase)
  app.post('/api/social/posts', express.json({ limit: '6mb' }), async (req, res) => {
    const post = req.body?.post as Record<string, unknown> | undefined;
    if (!post || typeof post.id !== 'string' || typeof post.authorId !== 'string') {
      res.status(400).json({ error: 'Publicação inválida.' });
      return;
    }
    deletedPostIds.delete(post.id);
    const current = readSharedSocialState() || {
      version: 0,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };
    const nextPosts = mergeByIdRecords(current.posts, [post], 220, 'createdAt');
    writeSharedSocialState({
      ...current,
      version: (current.version || 0) + 1,
      updatedAt: Date.now(),
      posts: nextPosts,
    });
    supabaseContentCache = null;

    const adminState = readAdminState();
    let synced = false;
    if (adminState.supabase.autoSyncPosts && adminState.supabase.projectUrl) {
      const mediaArr = Array.isArray(post.media) ? (post.media as Array<Record<string, unknown>>) : [];
      const postPayload = {
        id: String(post.id),
        authorId: String(post.authorId),
        authorUid: typeof post.authorUid === 'string' ? post.authorUid : undefined,
        caption: typeof post.caption === 'string' ? post.caption : '',
        location: typeof post.location === 'string' ? post.location : undefined,
        category: typeof post.category === 'string' ? post.category : 'Fotografia',
        aspectRatio: typeof post.aspectRatio === 'string' ? post.aspectRatio : '4:5',
        isReel: Boolean(post.isReel),
        audioTrack: typeof post.audioTrack === 'string' ? post.audioTrack : undefined,
        mediaUrls: mediaArr
          .map((m) => (typeof m.url === 'string' ? m.url : ''))
          .filter(Boolean),
        mediaAssets: mediaArr.map((m) => ({
          id: typeof m.id === 'string' ? m.id : undefined,
          url: typeof m.url === 'string' ? m.url : '',
          alt: typeof m.alt === 'string' ? m.alt : undefined,
          filterCss: typeof m.filterCss === 'string' ? m.filterCss : undefined,
          mediaType: (m.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video',
          durationSec: typeof m.durationSec === 'number' ? m.durationSec : undefined,
        })),
        likes: Array.isArray(post.likes) ? (post.likes as string[]) : [],
        savedBy: Array.isArray(post.savedBy) ? (post.savedBy as string[]) : [],
        comments: Array.isArray(post.comments) ? post.comments : [],
        createdAt: typeof post.createdAt === 'number' ? post.createdAt : Date.now(),
      };
      let sbRes = await upsertPostToSupabase(adminState.supabase, postPayload);
      if (!sbRes.synced) {
        await ensureSupabaseUsersExistForIds(adminState.supabase, current.users, [
          postPayload.authorId,
          postPayload.authorUid,
        ]);
        sbRes = await upsertPostToSupabase(adminState.supabase, postPayload);
      }
      synced = sbRes.synced;
    }
    broadcastRealtimeEvent({ type: 'social_update', scope: 'posts', updatedAt: Date.now() });
    res.json({ ok: true, supabaseSynced: synced });
  });

  app.delete('/api/social/posts/:id', async (req, res) => {
    const postId = String(req.params.id || '').trim();
    if (!postId || !/^[a-zA-Z0-9_-]{1,128}$/.test(postId)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    deletedPostIds.add(postId);
    const current = readSharedSocialState();
    if (current) {
      writeSharedSocialState({
        ...current,
        version: (current.version || 0) + 1,
        updatedAt: Date.now(),
        posts: current.posts.filter((p) => String(p.id || '') !== postId),
      });
    }
    supabaseContentCache = null;
    const adminState = readAdminState();
    if (adminState.supabase.projectUrl) {
      await deletePostFromSupabase(adminState.supabase, postId);
    }
    broadcastRealtimeEvent({ type: 'social_update', scope: 'posts', updatedAt: Date.now() });
    res.json({ ok: true });
  });

  app.post('/api/social/stories', express.json({ limit: '5mb' }), async (req, res) => {
    const story = req.body?.story as Record<string, unknown> | undefined;
    if (!story || typeof story.id !== 'string' || typeof story.authorId !== 'string') {
      res.status(400).json({ error: 'Story inválido.' });
      return;
    }
    const current = readSharedSocialState() || {
      version: 0,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };
    const nextStories = mergeByIdRecords(current.stories, [story], 120, 'createdAt');
    writeSharedSocialState({
      ...current,
      version: (current.version || 0) + 1,
      updatedAt: Date.now(),
      stories: nextStories,
    });
    supabaseContentCache = null;

    const adminState = readAdminState();
    let synced = false;
    if (adminState.supabase.projectUrl) {
      const storyPayload = {
        id: String(story.id),
        authorId: String(story.authorId),
        authorUid: typeof story.authorUid === 'string' ? story.authorUid : undefined,
        mediaUrl: typeof story.mediaUrl === 'string' ? story.mediaUrl : '',
        caption: typeof story.caption === 'string' ? story.caption : undefined,
        location: typeof story.location === 'string' ? story.location : undefined,
        viewedBy: Array.isArray(story.viewedBy) ? (story.viewedBy as string[]) : [],
        reactions: Array.isArray(story.reactions)
          ? (story.reactions as Array<{ userId: string; emoji: string }>)
          : [],
        createdAt: typeof story.createdAt === 'number' ? story.createdAt : Date.now(),
      };
      synced = await upsertStoryToSupabase(adminState.supabase, storyPayload);
      if (!synced) {
        await ensureSupabaseUsersExistForIds(adminState.supabase, current.users, [
          storyPayload.authorId,
          storyPayload.authorUid,
        ]);
        synced = await upsertStoryToSupabase(adminState.supabase, storyPayload);
      }
    }
    broadcastRealtimeEvent({ type: 'social_update', scope: 'stories', updatedAt: Date.now() });
    res.json({ ok: true, supabaseSynced: synced });
  });

  app.get('/api/social/messages', async (req, res) => {
    const userIdsParam = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = userIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (userIds.length === 0) {
      res.status(400).json({ error: 'userIds obrigatório.' });
      return;
    }
    const idSet = new Set(userIds);
    const current = readSharedSocialState();
    const localThreads = (current?.threads || []).filter(
      (t) => Array.isArray(t.participantIds) && t.participantIds.some((id) => idSet.has(String(id)))
    );

    const adminState = readAdminState();
    let sbThreads: Record<string, unknown>[] = [];
    if (adminState.supabase.projectUrl) {
      sbThreads = await fetchDirectThreadsForUserFromSupabase(adminState.supabase, userIds);
    }

    const merged = mergeByIdRecords(localThreads, sbThreads, 150, 'updatedAt');
    res.json({ ok: true, threads: merged });
  });

  app.post('/api/social/messages', express.json({ limit: '5mb' }), async (req, res) => {
    const { threadId, senderId, recipientId, message, thread } = req.body || {};
    if (
      typeof threadId !== 'string' ||
      typeof senderId !== 'string' ||
      typeof recipientId !== 'string' ||
      !message ||
      typeof message.id !== 'string'
    ) {
      res.status(400).json({ error: 'Mensagem inválida.' });
      return;
    }
    if (isUserBlockedPair(senderId, recipientId)) {
      res.status(403).json({
        error: 'Não foi possível enviar a mensagem porque este contato está bloqueado.',
      });
      return;
    }
    const current = readSharedSocialState() || {
      version: 0,
      updatedAt: Date.now(),
      users: [],
      posts: [],
      stories: [],
      threads: [],
      notifications: [],
    };
    const threadRecord =
      thread && typeof thread === 'object'
        ? (thread as Record<string, unknown>)
        : {
            id: threadId,
            participantIds: [senderId, recipientId].filter((v, i, arr) => arr.indexOf(v) === i),
            messages: [message],
            unreadBy: [recipientId],
            updatedAt: Number(message.createdAt || Date.now()),
          };
    const nextThreads = mergeByIdRecords(current.threads, [threadRecord], 150, 'updatedAt');
    writeSharedSocialState({
      ...current,
      version: (current.version || 0) + 1,
      updatedAt: Date.now(),
      threads: nextThreads,
    });
    typingStateMap.delete(`${senderId}=>${recipientId}`);

    const adminState = readAdminState();
    let synced = false;
    if (adminState.supabase.projectUrl) {
      const msgPayload = {
        id: String(message.id),
        threadId,
        senderId,
        recipientId,
        text: typeof message.text === 'string' ? message.text : '',
        sharedPostId: typeof message.sharedPostId === 'string' ? message.sharedPostId : undefined,
        storyReplyUrl: typeof message.storyReplyUrl === 'string' ? message.storyReplyUrl : undefined,
        audioUrl: typeof message.audioUrl === 'string' ? message.audioUrl : undefined,
        audioDurationSec:
          typeof message.audioDurationSec === 'number' ? message.audioDurationSec : undefined,
        videoUrl: typeof message.videoUrl === 'string' ? message.videoUrl : undefined,
        videoName: typeof message.videoName === 'string' ? message.videoName : undefined,
        fileUrl: typeof message.fileUrl === 'string' ? message.fileUrl : undefined,
        fileName: typeof message.fileName === 'string' ? message.fileName : undefined,
        fileMime: typeof message.fileMime === 'string' ? message.fileMime : undefined,
        fileSize: typeof message.fileSize === 'number' ? message.fileSize : undefined,
        replyToId: typeof message.replyToId === 'string' ? message.replyToId : undefined,
        replyToSenderId:
          typeof message.replyToSenderId === 'string' ? message.replyToSenderId : undefined,
        replyToText: typeof message.replyToText === 'string' ? message.replyToText : undefined,
        reaction: typeof message.reaction === 'string' ? message.reaction : undefined,
        reactions:
          message.reactions && typeof message.reactions === 'object' && !Array.isArray(message.reactions)
            ? (message.reactions as Record<string, string>)
            : undefined,
        readBy: Array.isArray(message.readBy) ? (message.readBy as string[]) : [senderId],
        seenAt: typeof message.seenAt === 'number' ? message.seenAt : undefined,
        createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
      };
      synced = await upsertMessageToSupabase(adminState.supabase, msgPayload);
      if (!synced) {
        await ensureSupabaseUsersExistForIds(adminState.supabase, current.users, [
          senderId,
          recipientId,
        ]);
        synced = await upsertMessageToSupabase(adminState.supabase, msgPayload);
      }
    }
    sendRealtimeToUserIds([recipientId], {
      type: 'chat_message',
      threadId,
      senderId,
      recipientId,
    });
    res.json({ ok: true, supabaseSynced: synced });
  });

  app.patch('/api/social/threads/:id/read', express.json({ limit: '64kb' }), async (req, res) => {
    const threadId = String(req.params.id || '').trim();
    const rawReaders = Array.isArray(req.body?.readerIds) ? (req.body.readerIds as unknown[]) : [];
    const readerIds = Array.from(
      new Set(
        rawReaders
          .filter((r): r is string => typeof r === 'string' && r.trim().length > 0 && r.length <= 128)
          .map((r) => r.trim())
      )
    ).slice(0, 6);
    if (!threadId || threadId.length > 160 || readerIds.length === 0) {
      res.status(400).json({ error: 'Parâmetros de leitura inválidos.' });
      return;
    }

    const now = typeof req.body?.readAt === 'number' && Number.isFinite(req.body.readAt)
      ? req.body.readAt
      : Date.now();
    const readerSet = new Set(readerIds);

    const current = readSharedSocialState();
    if (current) {
      const nextThreads = current.threads.map((t) => {
        if (String(t.id || '') !== threadId) return t;
        const prevUnread = Array.isArray(t.unreadBy) ? (t.unreadBy as string[]) : [];
        const prevLastRead =
          t.lastReadBy && typeof t.lastReadBy === 'object' && !Array.isArray(t.lastReadBy)
            ? { ...(t.lastReadBy as Record<string, number>) }
            : {};
        for (const rId of readerIds) {
          prevLastRead[rId] = Math.max(Number(prevLastRead[rId] || 0), now);
        }
        const prevMsgs = Array.isArray(t.messages) ? (t.messages as Record<string, unknown>[]) : [];
        const nextMsgs = prevMsgs.map((m) => {
          const sender = String(m.senderId || '');
          if (!sender || readerSet.has(sender)) return m;
          const curReadBy = Array.isArray(m.readBy) ? (m.readBy as string[]) : [];
          const nextReadBy = Array.from(new Set([...curReadBy, ...readerIds]));
          return {
            ...m,
            readBy: nextReadBy,
            seenAt: typeof m.seenAt === 'number' ? Math.min(m.seenAt, now) : now,
          };
        });
        return {
          ...t,
          unreadBy: prevUnread.filter((id) => !readerSet.has(id)),
          lastReadBy: prevLastRead,
          messages: nextMsgs,
        };
      });

      writeSharedSocialState({
        ...current,
        version: (current.version || 0) + 1,
        updatedAt: Date.now(),
        threads: nextThreads,
      });
    }

    const adminState = readAdminState();
    let supabaseSynced = false;
    if (adminState.supabase.projectUrl) {
      supabaseSynced = await markThreadMessagesReadInSupabase(
        adminState.supabase,
        threadId,
        readerIds
      );
    }

    const matchedThread = current?.threads.find((t) => String(t.id || '') === threadId);
    const otherParticipantIds = Array.isArray(matchedThread?.participantIds)
      ? matchedThread.participantIds.filter(
          (pid: unknown): pid is string => typeof pid === 'string' && !readerSet.has(pid)
        )
      : [];
    sendRealtimeToUserIds(otherParticipantIds, {
      type: 'chat_read',
      threadId,
      readerIds,
    });
    res.json({ ok: true, supabaseSynced });
  });

  app.patch(
    '/api/social/threads/:id/messages/:msgId/react',
    express.json({ limit: '32kb' }),
    async (req, res) => {
      const threadId = String(req.params.id || '').trim();
      const msgId = String(req.params.msgId || '').trim();
      const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
      if (!threadId || !msgId || !userId || !emoji) {
        res.status(400).json({ error: 'Dados de reação inválidos.' });
        return;
      }

      let nextReaction: string | undefined;
      let nextReactionsMap: Record<string, string> = {};

      const current = readSharedSocialState();
      if (current) {
        const nextThreads = current.threads.map((t) => {
          if (String(t.id || '') !== threadId) return t;
          const prevMsgs = Array.isArray(t.messages) ? (t.messages as Record<string, unknown>[]) : [];
          const nextMsgs = prevMsgs.map((m) => {
            if (String(m.id || '') !== msgId) return m;
            const prevMap =
              m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)
                ? { ...(m.reactions as Record<string, string>) }
                : {};
            if (prevMap[userId] === emoji || (!Object.keys(prevMap).length && m.reaction === emoji)) {
              delete prevMap[userId];
            } else {
              prevMap[userId] = emoji;
            }
            nextReactionsMap = prevMap;
            const values = Object.values(prevMap);
            nextReaction = values.length > 0 ? values[values.length - 1] : undefined;
            return {
              ...m,
              reaction: nextReaction,
              reactions: prevMap,
            };
          });
          return {
            ...t,
            messages: nextMsgs,
            updatedAt: Date.now(),
          };
        });
        writeSharedSocialState({
          ...current,
          version: (current.version || 0) + 1,
          updatedAt: Date.now(),
          threads: nextThreads,
        });
      }

      const adminState = readAdminState();
      let supabaseSynced = false;
      if (adminState.supabase.projectUrl) {
        supabaseSynced = await reactToMessageInSupabase(
          adminState.supabase,
          msgId,
          nextReaction,
          nextReactionsMap
        );
      }

      res.json({ ok: true, reaction: nextReaction, reactions: nextReactionsMap, supabaseSynced });
    }
  );

  app.post('/api/social/typing', express.json({ limit: '8kb' }), (req, res) => {
    const fromUserId =
      typeof req.body?.fromUserId === 'string' ? req.body.fromUserId.trim().slice(0, 128) : '';
    const toUserId =
      typeof req.body?.toUserId === 'string' ? req.body.toUserId.trim().slice(0, 128) : '';
    const threadId =
      typeof req.body?.threadId === 'string' ? req.body.threadId.trim().slice(0, 160) : undefined;
    const isTyping = Boolean(req.body?.isTyping);

    if (!fromUserId || !toUserId) {
      res.status(400).json({ error: 'Parâmetros de digitação inválidos.' });
      return;
    }

    const key = `${fromUserId}=>${toUserId}`;
    if (isTyping) {
      if (typingStateMap.size > 500) {
        const cutoff = Date.now() - 4500;
        for (const [k, v] of typingStateMap.entries()) {
          if (v.updatedAt < cutoff) typingStateMap.delete(k);
        }
      }
      typingStateMap.set(key, {
        fromUserId,
        toUserId,
        threadId,
        updatedAt: Date.now(),
      });
    } else {
      typingStateMap.delete(key);
    }

    sendRealtimeToUserIds([toUserId], {
      type: 'chat_typing',
      fromUserId,
      toUserId,
      isTyping,
    });

    res.json({ ok: true });
  });

  app.get('/api/social/typing', (req, res) => {
    const rawIds = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const myIds = new Set(
      rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4)
    );
    const now = Date.now();
    const typingFromIds: string[] = [];
    for (const [k, entry] of typingStateMap.entries()) {
      if (now - entry.updatedAt > 4500) {
        typingStateMap.delete(k);
        continue;
      }
      if (myIds.size === 0 || myIds.has(entry.toUserId)) {
        typingFromIds.push(entry.fromUserId);
      }
    }
    res.json({ ok: true, typingFromIds: Array.from(new Set(typingFromIds)) });
  });

  // Persistent per-user block list
  app.get('/api/social/blocks', (req, res) => {
    const rawIds = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 128)
      .slice(0, 4);
    const store = readUserBlocksStore();
    const merged = new Set<string>();
    for (const uid of userIds) {
      for (const b of store[uid] || []) merged.add(b);
    }
    res.json({ ok: true, blockedIds: Array.from(merged) });
  });

  app.put('/api/social/blocks', express.json({ limit: '16kb' }), (req, res) => {
    const rawUserIds = Array.isArray(req.body?.userIds) ? (req.body.userIds as unknown[]) : [];
    const userIds = rawUserIds
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 128)
      .map((v) => v.trim())
      .slice(0, 4);
    const targetIdsRaw = Array.isArray(req.body?.targetIds)
      ? (req.body.targetIds as unknown[])
      : typeof req.body?.blockedUserId === 'string'
      ? [req.body.blockedUserId]
      : [];
    const targetIds = targetIdsRaw
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 128)
      .map((v) => v.trim())
      .slice(0, 4);
    const action = req.body?.action === 'unblock' ? 'unblock' : 'block';
    if (userIds.length === 0 || targetIds.length === 0) {
      res.status(400).json({ error: 'Parâmetros de bloqueio inválidos.' });
      return;
    }

    const store = { ...readUserBlocksStore() };
    for (const uid of userIds) {
      const set = new Set(store[uid] || []);
      for (const tid of targetIds) {
        if (action === 'block') set.add(tid);
        else set.delete(tid);
      }
      store[uid] = Array.from(set).slice(0, 500);
    }
    writeUserBlocksStore(store);

    const merged = new Set<string>();
    for (const uid of userIds) {
      for (const b of store[uid] || []) merged.add(b);
    }
    res.json({ ok: true, blockedIds: Array.from(merged) });
  });

  // WebRTC audio/video call signaling REST endpoints (with WS broadcast + HTTP poll fallback)
  app.post('/api/social/calls/signal', express.json({ limit: '64kb' }), (req, res) => {
    const signal = req.body?.signal as Record<string, unknown> | undefined;
    if (!signal || typeof signal !== 'object') {
      res.status(400).json({ error: 'Sinal de chamada inválido.' });
      return;
    }
    const fromId = typeof signal.fromUserId === 'string' ? signal.fromUserId.trim() : '';
    const toId = typeof signal.toUserId === 'string' ? signal.toUserId.trim() : '';
    const toUid = typeof signal.toUid === 'string' ? signal.toUid.trim() : '';
    const sigType = typeof signal.type === 'string' ? signal.type : '';
    if (!fromId || !toId || !sigType) {
      res.status(400).json({ error: 'Destinatário ou remetente de chamada ausente.' });
      return;
    }

    if (
      sigType === 'call:invite' &&
      (isUserBlockedPair(fromId, toId) || (toUid && isUserBlockedPair(fromId, toUid)))
    ) {
      enqueueCallSignalForUserIds([fromId], {
        callId: signal.callId,
        type: 'call:busy',
        fromUserId: toId,
        toUserId: fromId,
        reason: 'blocked',
        createdAt: Date.now(),
      });
      res.status(403).json({ error: 'Contato bloqueado ou indisponível para chamadas.' });
      return;
    }

    enqueueCallSignalForUserIds(resolveCallRecipientIds(toId, toUid), signal);
    res.json({ ok: true });
  });

  app.get('/api/social/calls/poll', (req, res) => {
    const rawIds = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 128)
      .slice(0, 4);
    if (userIds.length === 0) {
      res.json({ ok: true, signals: [] });
      return;
    }
    const cutoff = Date.now() - 45_000;
    const seenIds = new Set<string>();
    const signals: Record<string, unknown>[] = [];
    for (const uid of userIds) {
      const queue = callSignalQueueMap.get(uid);
      if (!queue || queue.length === 0) continue;
      for (const entry of queue) {
        if (entry.createdAt >= cutoff && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          signals.push(entry.signal);
        }
      }
      callSignalQueueMap.delete(uid);
    }
    res.json({ ok: true, signals });
  });

  app.patch('/api/social/users/:id', express.json({ limit: '4mb' }), async (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }
    const patch = (req.body || {}) as Record<string, unknown>;
    const current = readSharedSocialState();
    if (current) {
      const updatedUsers = current.users.map((u) => {
        if (String(u.id || '') !== userId) return u;
        return {
          ...u,
          ...(typeof patch.displayName === 'string' ? { displayName: patch.displayName } : {}),
          ...(typeof patch.username === 'string' ? { username: patch.username } : {}),
          ...(typeof patch.bio === 'string' ? { bio: patch.bio } : {}),
          ...(typeof patch.website === 'string' ? { website: patch.website } : {}),
          ...(typeof patch.avatarUrl === 'string' ? { avatarUrl: patch.avatarUrl } : {}),
          ...(typeof patch.coverUrl === 'string' ? { coverUrl: patch.coverUrl } : {}),
          ...(Array.isArray(patch.followers) ? { followers: patch.followers } : {}),
          ...(Array.isArray(patch.following) ? { following: patch.following } : {}),
        };
      });
      writeSharedSocialState({
        ...current,
        version: (current.version || 0) + 1,
        updatedAt: Date.now(),
        users: updatedUsers,
      });
    }
    supabaseUsersCache = null;

    const adminState = readAdminState();
    let synced = false;
    if (adminState.supabase.projectUrl) {
      synced = await updateUserInSupabase(adminState.supabase, userId, {
        displayName: typeof patch.displayName === 'string' ? patch.displayName : undefined,
        username: typeof patch.username === 'string' ? patch.username : undefined,
        bio: typeof patch.bio === 'string' ? patch.bio : undefined,
        website: typeof patch.website === 'string' ? patch.website : undefined,
        avatarUrl: typeof patch.avatarUrl === 'string' ? patch.avatarUrl : undefined,
        coverUrl: typeof patch.coverUrl === 'string' ? patch.coverUrl : undefined,
        followers: Array.isArray(patch.followers) ? (patch.followers as string[]) : undefined,
        following: Array.isArray(patch.following) ? (patch.following as string[]) : undefined,
      });
    }
    broadcastRealtimeEvent({ type: 'social_update', scope: 'users', updatedAt: Date.now() });
    res.json({ ok: true, supabaseSynced: synced });
  });

  // Public post OpenGraph preview index (synced from Firestore & local posts for external link cards)
  app.get('/api/social/previews/status', (_req, res) => {
    const map = readPostPreviewsMap();
    res.json({ ok: true, ssrActive: true, cachedPosts: map.size });
  });

  app.post('/api/social/previews', express.json({ limit: '6mb' }), (req, res) => {
    const rawItems = Array.isArray(req.body?.items)
      ? (req.body.items as unknown[])
      : req.body?.item
      ? [req.body.item]
      : [];
    if (rawItems.length === 0) {
      res.status(400).json({ error: 'Nenhum item de pré-visualização informado.' });
      return;
    }

    const map = readPostPreviewsMap();
    let upserted = 0;
    for (const raw of rawItems.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) continue;

      const authorUsername =
        typeof item.authorUsername === 'string'
          ? item.authorUsername.trim().replace(/^@/, '').slice(0, 40)
          : '';
      const authorDisplayName =
        typeof item.authorDisplayName === 'string' ? item.authorDisplayName.trim().slice(0, 80) : '';
      const caption = typeof item.caption === 'string' ? item.caption.trim().slice(0, 400) : '';
      const isReel = Boolean(item.isReel);
      const imageUrl =
        typeof item.imageUrl === 'string' && isSafePreviewMediaUrl(item.imageUrl)
          ? item.imageUrl.trim()
          : undefined;
      const authorAvatarUrl =
        typeof item.authorAvatarUrl === 'string' && isSafePreviewMediaUrl(item.authorAvatarUrl)
          ? item.authorAvatarUrl.trim()
          : undefined;
      const videoUrl =
        typeof item.videoUrl === 'string' && /^https?:\/\//i.test(item.videoUrl.trim())
          ? item.videoUrl.trim().slice(0, 500)
          : undefined;

      map.set(id, {
        id,
        authorUsername,
        authorDisplayName,
        caption,
        isReel,
        imageUrl,
        authorAvatarUrl,
        videoUrl,
        updatedAt: Date.now(),
      });
      upserted += 1;
    }

    if (upserted > 0) {
      writePostPreviewsMap(map);
    }
    res.json({ ok: true, upserted, totalCached: map.size });
  });

  // Serve decoded OpenGraph preview image (converts data:image/... posts into crawlable HTTPS image URLs)
  app.get('/api/og/image/:postFile', (req, res) => {
    const rawParam = String(req.params.postFile || '').replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(rawParam)) {
      res.status(400).end();
      return;
    }

    const preview = resolvePostPreviewData(rawParam);
    const imgSrc = preview?.rawImage || '';
    const dataMatch = imgSrc.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([a-zA-Z0-9+/=]+)$/i);
    if (dataMatch) {
      try {
        const mime = dataMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataMatch[1].toLowerCase();
        const buf = Buffer.from(dataMatch[2], 'base64');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(buf);
        return;
      } catch {
        // Fallback to default OG banner
      }
    }

    if (/^https?:\/\//i.test(imgSrc)) {
      res.redirect(302, imgSrc);
      return;
    }

    const fallbackBanner = path.join(ROOT_DIR, 'public', 'og-preview.jpg');
    if (fs.existsSync(fallbackBanner)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(fallbackBanner);
      return;
    }
    res.status(404).end();
  });

  // Download Complete Self-Hosted WordPress Kit (.zip)
  app.get('/api/admin/wordpress/download-kit', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    const wp = state.wordpress;
    const domain = sanitizeHost(
      wp.siteUrl.replace(/^https?:\/\//, '').split('/')[0] || 'meudominio.com.br',
      'meudominio.com.br'
    );
    const dbName = sanitizeIdentifier(wp.dbName, 'lumina_wp', /[^a-zA-Z0-9_]/g);
    const prefix = sanitizeIdentifier(wp.tablePrefix, 'wp_lum_', /[^a-zA-Z0-9_]/g);
    const wpImage = wp.phpVersion === '8.2' ? 'wordpress:6.7-php8.2-fpm-alpine' : 'wordpress:6.7-php8.3-fpm-alpine';
    const dbImage = wp.dbEngine === 'mysql-8' ? 'mysql:8.4' : 'mariadb:11.4';

    const dockerCompose = `services:
  db:
    image: ${dbImage}
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${dbName}
      MYSQL_USER: lumina_wp_user
      MYSQL_PASSWORD: \${WP_DB_PASSWORD:?Defina WP_DB_PASSWORD no .env}
      MYSQL_ROOT_PASSWORD: \${WP_DB_ROOT_PASSWORD:?Defina WP_DB_ROOT_PASSWORD no .env}
    volumes:
      - db_data:/var/lib/mysql

  wordpress:
    image: ${wpImage}
    restart: unless-stopped
    depends_on:
      - db
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${dbName}
      WORDPRESS_DB_USER: lumina_wp_user
      WORDPRESS_DB_PASSWORD: \${WP_DB_PASSWORD}
      WORDPRESS_TABLE_PREFIX: ${prefix}
    volumes:
      - wp_content:/var/www/html/wp-content
      - ./lumina-bridge.php:/var/www/html/wp-content/plugins/lumina-bridge/lumina-bridge.php:ro
${
  wp.redisCache
    ? `
  redis:
    image: redis:7-alpine
    restart: unless-stopped
`
    : ''
}
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      - wordpress
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - wp_content:/var/www/html/wp-content:ro

volumes:
  db_data:
  wp_content:
`;

    const wpConfig = `<?php
define('DB_NAME', getenv('WORDPRESS_DB_NAME') ?: '${dbName}');
define('DB_USER', getenv('WORDPRESS_DB_USER') ?: 'lumina_wp_user');
define('DB_PASSWORD', getenv('WORDPRESS_DB_PASSWORD'));
define('DB_HOST', getenv('WORDPRESS_DB_HOST') ?: 'db:3306');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

$table_prefix = '${prefix}';

define('WP_HOME', '${wp.sslEnabled ? 'https' : 'http'}://${domain}');
define('WP_SITEURL', '${wp.sslEnabled ? 'https' : 'http'}://${domain}');
define('WP_CACHE', ${wp.redisCache ? 'true' : 'false'});
define('DISALLOW_FILE_EDIT', true);
define('FORCE_SSL_ADMIN', ${wp.sslEnabled ? 'true' : 'false'});

if (!defined('ABSPATH')) {
  define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
`;

    const nginxConf = `server {
    listen 80;
    server_name ${domain};

    client_max_body_size 64M;
${
  wp.disableXmlRpc
    ? `
    location = /xmlrpc.php {
        deny all;
        return 403;
    }
`
    : ''
}
    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \\.php$ {
        include fastcgi_params;
        fastcgi_pass wordpress:9000;
        fastcgi_param SCRIPT_FILENAME /var/www/html$fastcgi_script_name;
    }
}
`;

    const luminaPlugin = `<?php
/**
 * Plugin Name: Lumina Self-Hosted Bridge
 * Description: Integra publicações, usuários e feed da rede social Lumina ao seu WordPress auto-hospedado.
 * Version: ${state.site.version}
 * Author: ${wp.siteTitle}
 */

if (!defined('ABSPATH')) exit;

add_shortcode('lumina_feed', function ($atts) {
    $atts = shortcode_atts(['limit' => '12'], $atts);
    return '<div id="lumina-wp-embed" data-limit="' . esc_attr($atts['limit']) . '">Lumina Feed conectado.</div>';
});

add_action('rest_api_init', function () {
    register_rest_route('lumina/v1', '/health', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function () {
            return ['status' => 'ok', 'self_hosted' => true, 'version' => '${state.site.version}'];
        },
    ]);

    add_filter('rest_pre_serve_request', function ($value) {
        if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD', 'OPTIONS'], true)) {
            header('Access-Control-Allow-Origin: *');
            header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Accept');
        }
        return $value;
    });
});
`;

    const readme = `# WordPress Auto-Hospedado — ${wp.siteTitle}

Este pacote dá controle total da infraestrutura ao administrador:

1. Copie \`.env.example\` para \`.env\` e defina \`WP_DB_PASSWORD\` e \`WP_DB_ROOT_PASSWORD\`.
2. Execute: \`docker compose up -d\`
3. Acesse \`${wp.sslEnabled ? 'https' : 'http'}://${domain}/wp-admin\` para concluir a instalação.
4. Ative o plugin **Lumina Self-Hosted Bridge** em Plugins e configure os links permanentes para \`${wp.permalinks}\`.
`;

    const zipBuffer = createZipBuffer([
      { name: 'docker-compose.yml', content: dockerCompose },
      { name: 'wp-config.php', content: wpConfig },
      { name: 'nginx.conf', content: nginxConf },
      { name: 'lumina-bridge.php', content: luminaPlugin },
      {
        name: '.env.example',
        content: 'WP_DB_PASSWORD=troque_esta_senha\nWP_DB_ROOT_PASSWORD=troque_esta_senha_root\n',
      },
      { name: 'README-AUTO-HOSPEDAGEM.md', content: readme },
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lumina-wordpress-selfhosted-${domain}.zip"`
    );
    res.send(zipBuffer);
  });

  // Prune expired ephemeral typing/signaling entries so long-running containers stay lean
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of typingStateMap.entries()) {
      if (now - entry.updatedAt > 10_000) {
        typingStateMap.delete(key);
      }
    }
    const signalCutoff = now - 45_000;
    for (const [uid, queue] of callSignalQueueMap.entries()) {
      const active = queue.filter((s) => s.createdAt >= signalCutoff);
      if (active.length === 0) {
        callSignalQueueMap.delete(uid);
      } else if (active.length !== queue.length) {
        callSignalQueueMap.set(uid, active);
      }
    }
  }, 60_000);
  cleanupTimer.unref();

  // Development vs Production static serving with dynamic OpenGraph preview tags
  const distDir = path.join(ROOT_DIR, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');
  const hasDistBuild = fs.existsSync(distIndexPath);
  const isExplicitDev =
    process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev';
  const shouldServeStaticDist =
    process.env.NODE_ENV === 'production' || (!isExplicitDev && hasDistBuild);

  if (shouldServeStaticDist) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => {
      if (!fs.existsSync(distIndexPath)) {
        res.status(503).send('Build de produção ausente. Execute npm run build.');
        return;
      }
      try {
        const rawHtml = fs.readFileSync(distIndexPath, 'utf8');
        const html = injectLinkPreviewMeta(rawHtml, req);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
      } catch {
        res.sendFile(distIndexPath);
      }
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch:
          process.env.DISABLE_HMR === 'true'
            ? null
            : {
                ignored: [
                  '**/node_modules/**',
                  '**/.lumina-uploads/**',
                  '**/dist/**',
                  '**/.git/**',
                ],
              },
      },
      appType: 'spa',
    });

    app.get('*', async (req, res, next) => {
      const accept = String(req.headers.accept || '').toLowerCase();
      const wantsHtmlOrCrawler = !accept || accept.includes('text/html') || accept.includes('*/*');
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/@') ||
        req.path.startsWith('/src/') ||
        req.path.startsWith('/node_modules/') ||
        path.extname(req.path) !== '' ||
        !wantsHtmlOrCrawler
      ) {
        next();
        return;
      }
      try {
        const rawHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const html = injectLinkPreviewMeta(transformed, req);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });

    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Lumina server running on http://0.0.0.0:${PORT} (${shouldServeStaticDist ? 'production-static' : 'vite-dev'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
