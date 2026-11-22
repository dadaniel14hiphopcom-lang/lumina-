import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
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
  uploadReelToS3,
} from './server/s3Service.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.resolve(process.cwd());
const ADMIN_AUTH_FILE = path.join(ROOT_DIR, '.lumina-admin-auth.json');
const ADMIN_STATE_FILE = path.join(ROOT_DIR, '.lumina-admin-state.json');
const USER_AUTH_FILE = path.join(ROOT_DIR, '.lumina-user-auth.json');
const SOCIAL_STATE_FILE = path.join(ROOT_DIR, '.lumina-social-state.json');
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

let memoryAuthRecord: AdminAuthRecord | null = null;
let memoryAdminState: IntegrationState | null = null;
let memoryUserAuthRecords: UserAuthRecord[] | null = null;
let memorySocialState: SharedSocialState | null = null;

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
    projectUrl: process.env.SUPABASE_URL || '',
    schemaName: 'public',
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
  site: {
    version: '2.4.0',
    channel: 'stable',
    announcementBanner: '',
    maintenanceMode: false,
    realUsersOnly: false,
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
        supabase: { ...DEFAULT_ADMIN_STATE.supabase, ...(parsed.supabase || {}) },
        wordpress: { ...DEFAULT_ADMIN_STATE.wordpress, ...(parsed.wordpress || {}) },
        site: {
          ...DEFAULT_ADMIN_STATE.site,
          ...(parsed.site || {}),
          videoRules: {
            ...DEFAULT_ADMIN_STATE.site.videoRules,
            ...(parsed.site?.videoRules || {}),
          },
        },
        invites: Array.isArray(parsed.invites) ? parsed.invites : [],
      };
    }
  } catch {
    // Fallback to default state
  }
  return structuredClone(DEFAULT_ADMIN_STATE);
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

  let title = defaultTitle;
  let description = defaultDescription;
  let imageUrl = defaultImage;
  let canonicalUrl = `${origin}/`;

  const postParam = typeof req.query.post === 'string' ? req.query.post.trim() : '';
  const inviteParam = typeof req.query.invite === 'string' ? req.query.invite.trim().toUpperCase() : '';

  if (postParam && /^[a-zA-Z0-9_-]{1,128}$/.test(postParam)) {
    canonicalUrl = `${origin}/?post=${encodeURIComponent(postParam)}`;
    const sharedState = readSharedSocialState();
    const matchedPost = sharedState?.posts.find((p) => p.id === postParam) as
      | {
          authorId?: string;
          caption?: string;
          isReel?: boolean;
          media?: { url?: string; mediaType?: string }[];
        }
      | undefined;

    if (matchedPost) {
      const matchedAuthor = sharedState?.users.find((u) => u.id === matchedPost.authorId) as
        | { username?: string; displayName?: string }
        | undefined;
      const authorLabel = matchedAuthor?.username
        ? `@${matchedAuthor.username}`
        : matchedAuthor?.displayName || 'Lumina';
      title = matchedPost.isReel
        ? `Reel de ${authorLabel} na Lumina`
        : `Publicação de ${authorLabel} na Lumina`;
      if (typeof matchedPost.caption === 'string' && matchedPost.caption.trim()) {
        description = matchedPost.caption.trim().slice(0, 155);
      }
      const firstImg = matchedPost.media?.find(
        (m) => m.mediaType !== 'video' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url)
      )?.url;
      if (firstImg) {
        imageUrl = firstImg;
      }
    } else {
      title = 'Publicação na Lumina — Rede Social Visual';
    }
  } else if (inviteParam && /^[A-Z0-9_-]{4,32}$/.test(inviteParam)) {
    canonicalUrl = `${origin}/?invite=${encodeURIComponent(inviteParam)}`;
    title = 'Convite exclusivo para entrar na Lumina';
    description =
      'Você recebeu um convite para criar sua conta e compartilhar fotos, stories e reels na Lumina.';
  }

  const safeTitle = escapeHtmlAttr(title);
  const safeDesc = escapeHtmlAttr(description);
  const safeUrl = escapeHtmlAttr(canonicalUrl);
  const safeImage = escapeHtmlAttr(imageUrl);

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
    );
}

const ALLOWED_MEDIA_MIME_EXT: Record<string, { ext: string; kind: 'video' | 'image' }> = {
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/x-m4v': { ext: 'm4v', kind: 'video' },
  'video/ogg': { ext: 'ogv', kind: 'video' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/jpg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

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
  app.use(express.json({ limit: '4mb' }));

  // Media delivery capability check
  app.get('/api/media/status', (_req, res) => {
    const state = readAdminState();
    const creds = getAwsCredentialsFromEnv();
    const target = resolveAwsMediaTarget(state);
    const awsReady = Boolean(creds && state.aws.s3Enabled);
    res.json({
      uploadAvailable: true,
      storageProvider: awsReady ? 'aws-s3' : 'server-disk',
      awsCredentialsConfigured: Boolean(creds),
      s3Enabled: state.aws.s3Enabled,
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

  // Upload Reel video or photo directly to Amazon S3 (with CloudFront/Presigned delivery) or local HTTP-206 disk store
  app.post(
    '/api/media/upload',
    express.raw({
      type: ['video/*', 'image/*', 'application/octet-stream'],
      limit: '260mb',
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
            'Formato de mídia não suportado. Envie MP4, WebM, MOV, M4V, JPG, PNG ou WebP.',
        });
        return;
      }

      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuffer.length === 0) {
        res.status(400).json({ error: 'Arquivo vazio ou corrompido.' });
        return;
      }

      const maxVideoBytes = state.site.videoRules.maxVideoSizeMB * 1024 * 1024;
      const maxImageBytes = 15 * 1024 * 1024;
      const maxAllowedBytes = spec.kind === 'video' ? maxVideoBytes : maxImageBytes;
      if (bodyBuffer.length > maxAllowedBytes) {
        res.status(413).json({
          error: `Arquivo excede o limite de ${
            spec.kind === 'video' ? `${state.site.videoRules.maxVideoSizeMB} MB` : '15 MB'
          }.`,
        });
        return;
      }

      const objectKey = buildReelObjectKey(spec.ext, spec.kind);
      const fileName = path.posix.basename(objectKey);
      const awsCreds = getAwsCredentialsFromEnv();
      const awsTarget = resolveAwsMediaTarget(state);

      if (awsCreds && state.aws.s3Enabled) {
        try {
          const uploadResult = await uploadReelToS3({
            key: objectKey,
            body: bodyBuffer,
            contentType: rawType,
            config: awsTarget,
          });
          if (uploadResult.ok) {
            const deliveryUrl = resolveReelPlaybackUrl(objectKey, awsTarget);
            res.json({
              ok: true,
              url: deliveryUrl,
              storageProvider: awsTarget.hasRealCloudFront ? 'aws-cloudfront' : 'aws-s3',
              key: objectKey,
              sizeBytes: bodyBuffer.length,
              contentType: rawType,
            });
            return;
          }
          console.error(`AWS S3 upload HTTP ${uploadResult.status}: ${uploadResult.message}`);
        } catch (err) {
          console.error('AWS S3 upload failed, falling back to server media stream:', err);
        }
      }

      // Server local disk stream fallback with full HTTP 206 byte-range seeking
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const safePath = path.resolve(UPLOADS_DIR, fileName);
        if (!safePath.startsWith(UPLOADS_DIR + path.sep)) {
          res.status(400).json({ error: 'Caminho de arquivo inválido.' });
          return;
        }
        fs.writeFileSync(safePath, bodyBuffer);
        res.json({
          ok: true,
          url: `/api/media/file/${fileName}`,
          storageProvider: 'server-disk',
          key: fileName,
          sizeBytes: bodyBuffer.length,
          contentType: rawType,
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

  // Stream uploaded server media with full HTTP 206 Partial Content Range support for mobile/desktop video playback
  app.get('/api/media/file/:filename', (req, res) => {
    const filename = String(req.params.filename || '').trim();
    const match = filename.match(/^([a-zA-Z0-9_-]{4,80})\.(mp4|webm|mov|m4v|ogv|jpg|png|webp|gif)$/i);
    if (!match) {
      res.status(400).json({ error: 'Nome de arquivo inválido.' });
      return;
    }
    const safePath = path.resolve(UPLOADS_DIR, filename);
    if (!safePath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(safePath)) {
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

  // Public lightweight site metadata (version, banner, realUsersOnly, videoRules)
  app.get('/api/site/meta', (_req, res) => {
    const state = readAdminState();
    res.json({
      version: state.site.version,
      announcementBanner: state.site.announcementBanner,
      maintenanceMode: state.site.maintenanceMode,
      realUsersOnly: Boolean(state.site.realUsersOnly),
      videoRules: state.site.videoRules,
    });
  });

  // Protected Admin Overview
  app.get('/api/admin/overview', requireAdminAuth, (_req, res) => {
    const state = readAdminState();
    res.json({
      state,
      envStatus: {
        awsCredentialsConfigured: Boolean(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ),
        awsRegionEnv: Boolean(process.env.AWS_REGION),
        supabaseUrlEnv: Boolean(process.env.SUPABASE_URL),
        supabaseKeysEnv: Boolean(
          process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
        ),
        wordpressEnv: Boolean(process.env.WORDPRESS_SITE_URL),
      },
    });
  });

  // Save Integration Configuration (Non-secret settings only)
  app.put('/api/admin/integrations', requireAdminAuth, (req, res) => {
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
      current.supabase = {
        ...current.supabase,
        projectUrl: String(body.supabase.projectUrl || '').trim().slice(0, 200),
        schemaName: sanitizeIdentifier(
          String(body.supabase.schemaName || ''),
          'public',
          /[^a-zA-Z0-9_]/g
        ),
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

    writeAdminState(current);
    res.json({ ok: true, state: current });
  });

  // SSRF-safe Live Connectivity Test for Supabase or Self-Hosted WordPress
  app.post('/api/admin/integrations/test', requireAdminAuth, async (req, res) => {
    const provider = req.body?.provider;
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const state = readAdminState();

    if (provider === 'aws') {
      const awsCreds = getAwsCredentialsFromEnv();
      const target = resolveAwsMediaTarget(state);
      state.aws.lastVerifiedAt = Date.now();
      writeAdminState(state);

      if (!awsCreds) {
        res.json({
          ok: true,
          reachable: false,
          statusLabel: `Modo local ativo (${target.region} · s3://${target.bucket}). Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY nos Segredos do servidor para hospedar vídeos diretamente na Amazon S3.`,
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

    try {
      const parsed = await validateExternalUrl(rawUrl);

      if (provider === 'supabase') {
        const endpoint = new URL('/rest/v1/', parsed.origin);
        const headers: Record<string, string> = {};
        if (process.env.SUPABASE_ANON_KEY) {
          headers.apikey = process.env.SUPABASE_ANON_KEY;
        }
        const response = await fetch(endpoint.toString(), {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        state.supabase.projectUrl = parsed.origin;
        state.supabase.lastVerifiedAt = Date.now();
        state.supabase.lastStatus = `HTTP ${response.status}`;
        writeAdminState(state);
        res.json({
          ok: true,
          reachable: response.status < 500,
          httpStatus: response.status,
          statusLabel: `Supabase respondeu com HTTP ${response.status} em ${parsed.hostname}`,
        });
        return;
      }

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

  app.post('/api/invites/accept', (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().replace(/^@/, '')
        : '';
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
          email: email || invite.email.toLowerCase(),
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
    res.json({ ok: true, invite, grantVerified: invite.grantVerified });
  });

  app.post('/api/auth/login', (req, res) => {
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

    if (!match || !verifyUserPassword(password, match)) {
      res.status(401).json({ error: 'Usuário/e-mail ou senha incorretos.' });
      return;
    }

    res.json({ ok: true, userId: match.userId, username: match.username });
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

  // Shared Social State Sync (multi-device fallback for Node-hosted instances)
  app.get('/api/social/state', (_req, res) => {
    const social = readSharedSocialState();
    res.json({ ok: true, state: social });
  });

  app.put('/api/social/state', express.json({ limit: '10mb' }), (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.users) || !Array.isArray(body.posts)) {
      res.status(400).json({ error: 'Estrutura de sincronização inválida.' });
      return;
    }

    const sanitizedUsers = (body.users as Record<string, unknown>[])
      .slice(0, 200)
      .map((u) => {
        const { email: _stripEmail, ...publicFields } = u;
        return publicFields;
      });

    const nextState: SharedSocialState = {
      version: (memorySocialState?.version || 0) + 1,
      updatedAt: Date.now(),
      users: sanitizedUsers,
      posts: (body.posts as Record<string, unknown>[]).slice(0, 200),
      stories: Array.isArray(body.stories) ? (body.stories as Record<string, unknown>[]).slice(0, 100) : [],
      threads: Array.isArray(body.threads) ? (body.threads as Record<string, unknown>[]).slice(0, 100) : [],
      notifications: Array.isArray(body.notifications)
        ? (body.notifications as Record<string, unknown>[]).slice(0, 200)
        : [],
    };
    writeSharedSocialState(nextState);
    res.json({ ok: true, version: nextState.version, updatedAt: nextState.updatedAt });
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

  // Development vs Production static serving with dynamic OpenGraph preview tags
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(ROOT_DIR, 'dist');
    const distIndexPath = path.join(distDir, 'index.html');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (req, res) => {
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
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.get('*', async (req, res, next) => {
      const accept = req.headers.accept || '';
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/@') ||
        req.path.startsWith('/src/') ||
        req.path.startsWith('/node_modules/') ||
        path.extname(req.path) !== '' ||
        !accept.includes('text/html')
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Lumina server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
