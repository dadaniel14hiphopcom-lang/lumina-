import type { DirectMessage, DirectThread, MediaAsset, Post, PostCategory, PostComment, StoryItem, UserProfile } from '../types';

export const DEFAULT_SUPABASE_URL = 'https://jpllpvfunpsqexnvjgdt.supabase.co';
const ADMIN_LOCAL_STATE_KEY = 'lumina_admin_local_state_v1';
const SUPABASE_SESSION_KEY = 'lumina_sb_session_v1';

export interface BrowserSupabaseConfig {
  projectUrl: string;
  schemaName: string;
  anonKey: string;
  autoSyncUsers: boolean;
}

export interface BrowserSupabaseSession {
  accessToken: string;
  authUid?: string;
  email?: string;
  luminaId?: string;
  savedAt: number;
}

const SELECT_USERS_EXTENDED =
  'id,auth_uid,username,display_name,bio,website,avatar_url,cover_url,verified,boosted,restricted,followers,following,updated_at,created_at';
const SELECT_USERS_CORE =
  'id,auth_uid,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at';

const SELECT_POSTS_EXTENDED =
  'id,author_id,author_uid,caption,location,category,aspect_ratio,is_reel,media_urls,media_assets,audio_track,likes,saved_by,comments,created_at';
const SELECT_POSTS_CORE =
  'id,author_id,caption,location,category,aspect_ratio,is_reel,media_urls,created_at';

const SELECT_STORIES =
  'id,author_id,author_uid,media_url,caption,location,viewed_by,reactions,created_at,expires_at';

const SELECT_MESSAGES_EXTENDED =
  'id,thread_id,sender_id,recipient_id,text,shared_post_id,story_reply_url,audio_url,audio_duration_sec,video_url,video_name,file_url,file_name,file_mime,file_size,reply_to_id,reply_to_sender_id,reply_to_text,reaction,reactions,read_by,seen_at,created_at';
const SELECT_MESSAGES_CORE =
  'id,thread_id,sender_id,recipient_id,text,shared_post_id,story_reply_url,audio_url,audio_duration_sec,video_url,video_name,reaction,read_by,created_at';

const SUPABASE_SYNC_LOGS_KEY = 'lumina_sb_sync_logs_v1';
const MAX_SUPABASE_SYNC_LOGS = 150;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_HANDLE_RE = /^[a-z0-9._]{3,32}$/;

export type SupabaseSyncLogLevel = 'error' | 'warn' | 'info';
export type SupabaseSyncLogCategory =
  | 'user_sync'
  | 'signup'
  | 'login'
  | 'fetch'
  | 'post'
  | 'message'
  | 'id_mismatch'
  | 'missing_field';

export interface SupabaseSyncLogEntry {
  id: string;
  timestamp: number;
  level: SupabaseSyncLogLevel;
  category: SupabaseSyncLogCategory;
  userId?: string;
  username?: string;
  httpStatus?: number;
  summary: string;
  details?: string;
}

export interface SupabaseCacheAuditIssue {
  type: 'id_mismatch' | 'uid_mismatch' | 'duplicate_username' | 'missing_field' | 'missing_remote' | 'missing_local';
  severity: 'error' | 'warn';
  userId?: string;
  username?: string;
  summary: string;
  details: string;
}

export interface SupabaseCacheAuditResult {
  ranAt: number;
  checkedLocal: number;
  checkedRemote: number;
  issues: SupabaseCacheAuditIssue[];
}

const syncLogListeners = new Set<() => void>();

function sanitizeLogText(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(sb_(?:secret|publishable)_[A-Za-z0-9_-]+)/gi, '[redacted-key]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email-protegido]')
    .slice(0, 420);
}

export function getSupabaseSyncLogs(): SupabaseSyncLogEntry[] {
  try {
    const raw = localStorage.getItem(SUPABASE_SYNC_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SupabaseSyncLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveSupabaseSyncLogs(entries: SupabaseSyncLogEntry[]): void {
  try {
    localStorage.setItem(SUPABASE_SYNC_LOGS_KEY, JSON.stringify(entries.slice(0, MAX_SUPABASE_SYNC_LOGS)));
  } catch {
    // Ignore storage quota errors
  }
  syncLogListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore subscriber error
    }
  });
}

export function recordSupabaseSyncLog(entry: Omit<SupabaseSyncLogEntry, 'id' | 'timestamp'>): void {
  const nextEntry: SupabaseSyncLogEntry = {
    id: `sblog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    level: entry.level,
    category: entry.category,
    userId: entry.userId,
    username: entry.username,
    httpStatus: entry.httpStatus,
    summary: sanitizeLogText(entry.summary) || 'Evento de sincronização',
    details: sanitizeLogText(entry.details),
  };
  const current = getSupabaseSyncLogs();
  saveSupabaseSyncLogs([nextEntry, ...current]);
}

export function clearSupabaseSyncLogs(): void {
  try {
    localStorage.removeItem(SUPABASE_SYNC_LOGS_KEY);
  } catch {
    // Ignore
  }
  syncLogListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore
    }
  });
}

export function subscribeSupabaseSyncLogs(listener: () => void): () => void {
  syncLogListeners.add(listener);
  return () => {
    syncLogListeners.delete(listener);
  };
}

export function auditRealUsersVsSupabaseCache(
  localUsers: UserProfile[],
  remoteUsers: UserProfile[]
): SupabaseCacheAuditResult {
  const localReal = localUsers.filter((u) => !u.isDemoSeed);
  const remoteReal = remoteUsers.filter((u) => !u.isDemoSeed);
  const issues: SupabaseCacheAuditIssue[] = [];

  const localByUsername = new Map<string, UserProfile[]>();
  for (const u of localReal) {
    const missing: string[] = [];
    if (!u.id || !u.id.trim()) missing.push('id');
    const cleanHandle = (u.username || '').trim().toLowerCase();
    if (!cleanHandle) {
      missing.push('username');
    } else if (!VALID_HANDLE_RE.test(cleanHandle)) {
      missing.push(`username inválido ("${cleanHandle}")`);
    }
    if (!u.displayName || !u.displayName.trim()) missing.push('displayName');
    if (u.uid && !UUID_V4_RE.test(u.uid.trim())) {
      missing.push('uid não é UUID válido');
    }
    if (missing.length > 0) {
      issues.push({
        type: 'missing_field',
        severity: 'error',
        userId: u.id,
        username: u.username,
        summary: `Campos obrigatórios ausentes/inválidos no cache local (${missing.join(', ')})`,
        details: `Usuário local "${u.username || u.id || 'sem-id'}" possui pendências: ${missing.join(', ')}.`,
      });
    }
    if (cleanHandle) {
      const list = localByUsername.get(cleanHandle) || [];
      list.push(u);
      localByUsername.set(cleanHandle, list);
    }
  }

  for (const [handle, list] of localByUsername.entries()) {
    const distinctIds = Array.from(new Set(list.map((u) => u.id).filter(Boolean)));
    if (distinctIds.length > 1) {
      issues.push({
        type: 'duplicate_username',
        severity: 'error',
        username: handle,
        summary: `Disparidade de IDs no cache local para @${handle}`,
        details: `Encontrados ${distinctIds.length} IDs locais diferentes para @${handle}: ${distinctIds.join(', ')}.`,
      });
    }
  }

  const remoteByHandle = new Map<string, UserProfile>();
  const remoteById = new Map<string, UserProfile>();
  for (const r of remoteReal) {
    if (r.id) remoteById.set(r.id, r);
    const h = (r.username || '').trim().toLowerCase();
    if (h) remoteByHandle.set(h, r);
    if (!r.uid) {
      issues.push({
        type: 'missing_field',
        severity: 'warn',
        userId: r.id,
        username: r.username,
        summary: `auth_uid ausente no Supabase para @${r.username}`,
        details: `Registro remoto "${r.id}" está sem auth_uid vinculado; login em outros dispositivos pode gerar novo ID se não reconciliado.`,
      });
    }
  }

  const localById = new Map<string, UserProfile>(localReal.map((u) => [u.id, u]));

  for (const l of localReal) {
    const h = (l.username || '').trim().toLowerCase();
    const matchedRemote = (h ? remoteByHandle.get(h) : undefined) || remoteById.get(l.id);
    if (!matchedRemote) {
      issues.push({
        type: 'missing_remote',
        severity: 'warn',
        userId: l.id,
        username: l.username,
        summary: `Usuário local @${l.username || l.id} ainda não existe no Supabase`,
        details: `ID local "${l.id}" não encontrado na tabela lumina_users. Execute "Sincronizar usuários" para persistir.`,
      });
      continue;
    }

    if (matchedRemote.id !== l.id) {
      issues.push({
        type: 'id_mismatch',
        severity: 'error',
        userId: l.id,
        username: l.username,
        summary: `Disparidade de ID para @${l.username}: local="${l.id}" vs Supabase="${matchedRemote.id}"`,
        details: `O mesmo username aponta para IDs diferentes entre o cache local (${l.id}) e o Supabase (${matchedRemote.id}).`,
      });
    }
    if (l.uid && matchedRemote.uid && l.uid !== matchedRemote.uid) {
      issues.push({
        type: 'uid_mismatch',
        severity: 'error',
        userId: l.id,
        username: l.username,
        summary: `Disparidade de auth_uid para @${l.username}`,
        details: `UID local (${l.uid}) difere do auth_uid no Supabase (${matchedRemote.uid}).`,
      });
    }
  }

  for (const r of remoteReal) {
    const h = (r.username || '').trim().toLowerCase();
    const existsLocal =
      localById.has(r.id) || (h ? localByUsername.has(h) : false);
    if (!existsLocal) {
      issues.push({
        type: 'missing_local',
        severity: 'warn',
        userId: r.id,
        username: r.username,
        summary: `Usuário do Supabase @${r.username} ausente no cache local`,
        details: `ID remoto "${r.id}" existe no Supabase e ainda não foi mesclado ao cache deste navegador.`,
      });
    }
  }

  for (const issue of issues.slice(0, 25)) {
    recordSupabaseSyncLog({
      level: issue.severity,
      category:
        issue.type === 'missing_field' ? 'missing_field' : 'id_mismatch',
      userId: issue.userId,
      username: issue.username,
      summary: issue.summary,
      details: issue.details,
    });
  }

  if (issues.length === 0) {
    recordSupabaseSyncLog({
      level: 'info',
      category: 'user_sync',
      summary: `Auditoria concluída sem falhas (${localReal.length} locais / ${remoteReal.length} remotos)`,
    });
  }

  return {
    ranAt: Date.now(),
    checkedLocal: localReal.length,
    checkedRemote: remoteReal.length,
    issues,
  };
}

export function isServiceRoleOrSecretKey(rawKey: string): boolean {
  const key = rawKey.trim();
  if (!key) return false;
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
      const payload = JSON.parse(atob(b64 + pad)) as { role?: string };
      if (payload?.role && payload.role.toLowerCase() === 'service_role') {
        return true;
      }
    } catch {
      // Ignore malformed JWT inspection
    }
  }
  return false;
}

export function normalizeSupabaseOrigin(rawUrl?: string): string {
  const candidate = (rawUrl || DEFAULT_SUPABASE_URL).trim();
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:') {
    throw new Error('A URL do Supabase deve usar HTTPS.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Hosts locais ou internos não são permitidos.');
  }
  return parsed.origin;
}

export function isJwtLike(token?: string): boolean {
  const parts = (token || '').trim().split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function isSupabaseApiKeyLike(raw?: string): boolean {
  const trimmed = (raw || '').trim();
  if (!trimmed) return false;
  return (
    /^sb_(publishable|secret)_/i.test(trimmed) ||
    /^eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/.test(trimmed)
  );
}

export function sanitizeSupabaseSchemaName(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || isSupabaseApiKeyLike(trimmed) || trimmed.length > 32) {
    return 'public';
  }
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  if (!cleaned || !/^[a-z_][a-z0-9_]*$/.test(cleaned)) {
    return 'public';
  }
  return cleaned;
}

function isJwtExpired(token: string): boolean {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad)) as { exp?: number };
    if (typeof payload?.exp === 'number' && payload.exp > 0) {
      return payload.exp * 1000 <= Date.now() + 15_000;
    }
  } catch {
    // Ignore decode failure
  }
  return false;
}

export function getBrowserSupabaseSession(): BrowserSupabaseSession | null {
  try {
    const raw = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowserSupabaseSession;
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
      if (isJwtExpired(parsed.accessToken)) {
        localStorage.removeItem(SUPABASE_SESSION_KEY);
        return null;
      }
      return parsed;
    }
  } catch {
    // Ignore session storage errors
  }
  return null;
}

export function setBrowserSupabaseSession(session: BrowserSupabaseSession | null): void {
  try {
    if (!session || !session.accessToken.trim()) {
      localStorage.removeItem(SUPABASE_SESSION_KEY);
      return;
    }
    localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearBrowserSupabaseSession(): void {
  try {
    localStorage.removeItem(SUPABASE_SESSION_KEY);
  } catch {
    // Ignore
  }
}

function buildBrowserSupabaseHeaders(
  anonKey: string,
  bearerOverride?: string,
  publicRead = false
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cleanKey = anonKey.trim();
  if (cleanKey) {
    headers.apikey = cleanKey;
    const storedToken = publicRead ? '' : getBrowserSupabaseSession()?.accessToken?.trim() || '';
    const effectiveBearer =
      (bearerOverride || '').trim() ||
      storedToken ||
      (isJwtLike(cleanKey) ? cleanKey : '');
    if (effectiveBearer) {
      headers.Authorization = `Bearer ${effectiveBearer}`;
    }
  }
  return headers;
}

let runtimeServerPublicConfig: Partial<BrowserSupabaseConfig> | null = null;

export function setRuntimePublicSupabaseConfig(
  cfg?: Partial<BrowserSupabaseConfig> | null
): void {
  if (!cfg) return;
  const candidateAnon = (cfg.anonKey || '').trim();
  const safeAnon =
    candidateAnon && !isServiceRoleOrSecretKey(candidateAnon) ? candidateAnon : '';
  runtimeServerPublicConfig = {
    projectUrl: cfg.projectUrl?.trim() || undefined,
    schemaName: cfg.schemaName ? sanitizeSupabaseSchemaName(cfg.schemaName) : undefined,
    anonKey: safeAnon || undefined,
    autoSyncUsers: typeof cfg.autoSyncUsers === 'boolean' ? cfg.autoSyncUsers : undefined,
  };
}

export function getBrowserSupabaseConfig(): BrowserSupabaseConfig {
  const envUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
      ? String(import.meta.env.VITE_SUPABASE_URL).trim()
      : '';
  const envAnonKey =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
      : '';

  let storedUrl = '';
  let storedSchema = 'public';
  let storedAnonKey = '';
  let autoSyncUsers = true;

  try {
    const raw = localStorage.getItem(ADMIN_LOCAL_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        supabase?: {
          projectUrl?: string;
          schemaName?: string;
          anonKey?: string;
          autoSyncUsers?: boolean;
        };
      };
      if (parsed.supabase) {
        storedUrl = (parsed.supabase.projectUrl || '').trim();
        const rawSchema = (parsed.supabase.schemaName || '').trim();
        storedSchema = sanitizeSupabaseSchemaName(rawSchema);
        const candidateKey = (parsed.supabase.anonKey || '').trim();
        if (candidateKey && !isServiceRoleOrSecretKey(candidateKey)) {
          storedAnonKey = candidateKey;
        } else if (
          isSupabaseApiKeyLike(rawSchema) &&
          !isServiceRoleOrSecretKey(rawSchema)
        ) {
          storedAnonKey = rawSchema;
        }
        if (typeof parsed.supabase.autoSyncUsers === 'boolean') {
          autoSyncUsers = parsed.supabase.autoSyncUsers;
        }
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }

  const safeEnvAnon = envAnonKey && !isServiceRoleOrSecretKey(envAnonKey) ? envAnonKey : '';
  const runtimeAnon =
    runtimeServerPublicConfig?.anonKey &&
    !isServiceRoleOrSecretKey(runtimeServerPublicConfig.anonKey)
      ? runtimeServerPublicConfig.anonKey
      : '';

  return {
    projectUrl:
      storedUrl ||
      runtimeServerPublicConfig?.projectUrl ||
      envUrl ||
      DEFAULT_SUPABASE_URL,
    schemaName:
      storedSchema ||
      runtimeServerPublicConfig?.schemaName ||
      'public',
    anonKey: storedAnonKey || runtimeAnon || safeEnvAnon,
    autoSyncUsers:
      runtimeServerPublicConfig?.autoSyncUsers !== undefined
        ? runtimeServerPublicConfig.autoSyncUsers
        : autoSyncUsers,
  };
}

export async function testSupabaseFromBrowser(params: {
  projectUrl?: string;
  schemaName?: string;
  anonKey?: string;
}): Promise<{
  reachable: boolean;
  hasKey: boolean;
  tablesReady: boolean;
  schemaOutdated?: boolean;
  httpStatus: number;
  origin: string;
  statusLabel: string;
}> {
  const origin = normalizeSupabaseOrigin(params.projectUrl);
  const schema = sanitizeSupabaseSchemaName(params.schemaName);
  const anonKey = (params.anonKey || '').trim();

  if (anonKey && isServiceRoleOrSecretKey(anonKey)) {
    throw new Error(
      'Por segurança, nunca use a chave secreta (service_role) no navegador. Cole apenas a chave pública (anon / publishable).'
    );
  }

  const host = new URL(origin).hostname;

  if (!anonKey) {
    const res = await fetch(`${origin}/rest/v1/`, {
      method: 'GET',
      signal: AbortSignal.timeout(6000),
    });
    return {
      reachable: res.status > 0 && res.status < 500,
      hasKey: false,
      tablesReady: false,
      httpStatus: res.status,
      origin,
      statusLabel:
        `Servidor Supabase online em ${host} (HTTP ${res.status}). Cole sua Chave Pública (anon / publishable) do Supabase abaixo e clique em Salvar para cadastrar usuários reais direto do site.`,
    };
  }

  const tableRes = await fetch(`${origin}/rest/v1/lumina_users?select=id&limit=1`, {
    method: 'GET',
    headers: {
      ...buildBrowserSupabaseHeaders(anonKey, undefined, true),
      'Accept-Profile': schema,
    },
    signal: AbortSignal.timeout(6000),
  });

  if (tableRes.ok) {
    let schemaOutdated = false;
    try {
      const schemaProbe = await fetch(
        `${origin}/rest/v1/lumina_users?select=id,is_real_user,followers,following,website&limit=1`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(anonKey, undefined, true),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (schemaProbe.status === 400) {
        schemaOutdated = true;
      }
    } catch {
      // Non-fatal probe
    }

    return {
      reachable: true,
      hasKey: true,
      tablesReady: true,
      schemaOutdated,
      httpStatus: tableRes.status,
      origin,
      statusLabel: schemaOutdated
        ? `Conectado ao Supabase (${host}), mas a tabela ${schema}.lumina_users está com estrutura antiga — clique em "Copiar SQL" e execute novamente no SQL Editor do Supabase.`
        : `Conectado direto ao Supabase (${host})! Tabela ${schema}.lumina_users pronta para receber usuários reais.`,
    };
  }

  if (tableRes.status === 404 || tableRes.status === 400) {
    return {
      reachable: true,
      hasKey: true,
      tablesReady: false,
      httpStatus: tableRes.status,
      origin,
      statusLabel: `Chave pública válida e Supabase conectado em ${host}! Agora clique em "Copiar SQL" e execute no SQL Editor do Supabase para criar ${schema}.lumina_users.`,
    };
  }

  if (tableRes.status === 401 || tableRes.status === 403) {
    return {
      reachable: true,
      hasKey: true,
      tablesReady: false,
      httpStatus: tableRes.status,
      origin,
      statusLabel: `Supabase respondeu HTTP ${tableRes.status}: verifique se a Chave Pública (anon / publishable) pertence ao projeto ${host}.`,
    };
  }

  return {
    reachable: tableRes.status < 500,
    hasKey: true,
    tablesReady: false,
    httpStatus: tableRes.status,
    origin,
    statusLabel: `Supabase respondeu HTTP ${tableRes.status} em ${host}.`,
  };
}

function compactBrowserMediaUrl(raw?: string, maxDataLen = 280_000): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 1000);
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return trimmed.slice(0, 300);
  if (/^data:image\/(png|jpeg|jpg|webp|gif);/i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  if (/^data:audio\/(webm|ogg|mp4|mpeg|wav);/i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  if (/^data:video\/(mp4|webm|quicktime);/i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  return null;
}

function compactBrowserAttachmentUrl(raw?: string, maxDataLen = 450_000): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^data:(?:text\/html|image\/svg\+xml|application\/xhtml\+xml)/i.test(trimmed)) return null;
  if (/^javascript:/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 1000);
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return trimmed.slice(0, 300);
  if (
    /^data:(?:image\/(?:png|jpeg|jpg|webp|gif)|audio\/(?:webm|ogg|mp4|mpeg|wav|aac)|video\/(?:mp4|webm|quicktime)|application\/(?:pdf|json|zip|x-zip-compressed|msword|octet-stream)|text\/(?:plain|csv)|application\/vnd\.);/i.test(
      trimmed
    ) &&
    trimmed.length <= maxDataLen
  ) {
    return trimmed;
  }
  return null;
}

export async function signupRealUserInSupabaseFromBrowser(
  config: BrowserSupabaseConfig,
  payload: {
    id: string;
    username: string;
    displayName: string;
    email: string;
    password: string;
    bio?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }
): Promise<{
  ok: boolean;
  authUid?: string;
  tableSynced?: boolean;
  needsEmailConfirm?: boolean;
  error?: string;
}> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return { ok: false, error: 'Chave pública anon do Supabase não configurada.' };
  }

  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'URL do Supabase inválida.' };
  }

  const schema = sanitizeSupabaseSchemaName(config.schemaName);
  const rawCleanHandle = payload.username
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 32);
  const cleanHandle =
    rawCleanHandle.length >= 3
      ? rawCleanHandle
      : `user.${payload.id.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 8) || 'lumina'}`.slice(0, 32);
  const safeAvatar = compactBrowserMediaUrl(payload.avatarUrl, 220_000);
  const safeCover = compactBrowserMediaUrl(payload.coverUrl, 220_000);

  // Check if handle already exists in lumina_users before creating Auth account
  try {
    const dupRes = await fetch(
      `${origin}/rest/v1/lumina_users?select=id,username&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
      {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (dupRes.ok) {
      const existingRows = (await dupRes.json().catch(() => [])) as Array<{ id?: string }>;
      if (Array.isArray(existingRows) && existingRows.length > 0) {
        return { ok: false, error: `O nome de usuário @${cleanHandle} já está cadastrado.` };
      }
    }
  } catch {
    // Continue if pre-check fails transiently
  }

  let authUid: string | undefined;
  let signupAccessToken: string | undefined;
  let signupIdentities: unknown[] | undefined;

  const signupRes = await fetch(`${origin}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
    },
    body: JSON.stringify({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      data: {
        lumina_id: payload.id,
        username: cleanHandle,
        display_name: payload.displayName.slice(0, 60),
        bio: (payload.bio || '').slice(0, 160),
        ...(safeAvatar && safeAvatar.length <= 2048 ? { avatar_url: safeAvatar } : {}),
        ...(safeCover && safeCover.length <= 2048 ? { cover_url: safeCover } : {}),
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const signupData = (await signupRes.json().catch(() => ({}))) as {
    id?: string;
    access_token?: string;
    user?: { id?: string; email?: string; identities?: unknown[] };
    msg?: string;
    error_description?: string;
    message?: string;
  };

  if (!signupRes.ok) {
    const rawMsg = signupData.msg || signupData.error_description || signupData.message || '';
    if (/already registered|already exists/i.test(rawMsg)) {
      return { ok: false, error: 'Este e-mail já está cadastrado no banco Supabase.' };
    }
    const isSoftAuthSkip =
      signupRes.status === 429 ||
      /rate limit|email rate|signups not allowed|disabled/i.test(rawMsg);
    if (!isSoftAuthSkip) {
      return {
        ok: false,
        error: rawMsg || `Supabase Auth retornou HTTP ${signupRes.status}.`,
      };
    }
  } else {
    authUid = signupData.user?.id || signupData.id;
    signupAccessToken = signupData.access_token;
    signupIdentities = signupData.user?.identities;
    if (signupAccessToken) {
      setBrowserSupabaseSession({
        accessToken: signupAccessToken,
        authUid,
        email: payload.email.trim().toLowerCase(),
        luminaId: payload.id,
        savedAt: Date.now(),
      });
    }
  }

  let tableSynced = false;
  let lastRestError = '';

  try {
    // Do NOT send verified/boosted/restricted on anon/authenticated inserts: column-level GRANT restricts them and DB defaults set false.
    const validAuthUid =
      authUid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUid.trim())
        ? authUid.trim()
        : null;
    const insertBody: Record<string, unknown> = {
      id: payload.id,
      auth_uid: validAuthUid,
      username: cleanHandle,
      display_name: payload.displayName.slice(0, 60),
      email: payload.email.trim().toLowerCase(),
      bio: (payload.bio || '').slice(0, 160),
      avatar_url: safeAvatar,
      cover_url: safeCover,
      is_real_user: true,
      auth_source: 'register',
      updated_at: new Date().toISOString(),
    };

    const postUserInsert = (useAnonOnly = false) =>
      fetch(`${origin}/rest/v1/lumina_users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey, useAnonOnly ? undefined : signupAccessToken, useAnonOnly),
          'Content-Profile': schema,
          // Never request return=representation here: RETURNING * fails with 42501 when email lacks SELECT grant
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(insertBody),
        signal: AbortSignal.timeout(6000),
      });

    let restRes = await postUserInsert(false);
    if (restRes.status === 401 && signupAccessToken) {
      restRes = await postUserInsert(true);
    }

    if (restRes.ok) {
      tableSynced = true;
    } else if (restRes.status === 409) {
      const patchRes = await fetch(
        `${origin}/rest/v1/lumina_users?username=ilike.${encodeURIComponent(cleanHandle)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...buildBrowserSupabaseHeaders(config.anonKey, signupAccessToken, !signupAccessToken),
            'Content-Profile': schema,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            display_name: payload.displayName.slice(0, 60),
            bio: (payload.bio || '').slice(0, 160),
            avatar_url: safeAvatar,
            cover_url: safeCover,
            updated_at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(5000),
        }
      ).catch(() => null);
      if (patchRes?.ok) {
        tableSynced = true;
      } else {
        lastRestError = await restRes.text().catch(() => `HTTP ${restRes.status}`);
      }
    } else {
      lastRestError = await restRes.text().catch(() => `HTTP ${restRes.status}`);
    }
  } catch {
    // Check below whether auth trigger inserted the row
  }

  if (!tableSynced) {
    try {
      const verifyRes = await fetch(
        `${origin}/rest/v1/lumina_users?select=id,username&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (verifyRes.ok) {
        const rows = (await verifyRes.json()) as Array<{ id?: string }>;
        if (Array.isArray(rows) && rows.length > 0) {
          tableSynced = true;
        }
      }
    } catch {
      // Ignore verification network error
    }
  }

  if (!payload.id?.trim() || !payload.email?.trim() || !payload.username?.trim()) {
    recordSupabaseSyncLog({
      level: 'error',
      category: 'missing_field',
      userId: payload.id,
      username: payload.username,
      summary: 'Cadastro abortado: campos obrigatórios ausentes (id, username ou e-mail)',
    });
    return { ok: false, error: 'Campos obrigatórios ausentes para o cadastro.' };
  }

  if (!tableSynced) {
    recordSupabaseSyncLog({
      level: 'warn',
      category: 'signup',
      userId: payload.id,
      username: cleanHandle,
      summary: `Usuário @${cleanHandle} criado no Auth, mas inserção direta em lumina_users falhou`,
      details: lastRestError || 'Verifique políticas RLS ou execute o SQL atualizado.',
    });
  } else {
    recordSupabaseSyncLog({
      level: 'info',
      category: 'signup',
      userId: payload.id,
      username: cleanHandle,
      summary: `Novo usuário real @${cleanHandle} gravado no Supabase`,
    });
  }

  if (!tableSynced && Array.isArray(signupIdentities) && signupIdentities.length === 0) {
    return {
      ok: false,
      error: 'Este e-mail já existe no Supabase Auth ou não pôde ser gravado em lumina_users.',
    };
  }

  return {
    ok: true,
    authUid,
    tableSynced,
    needsEmailConfirm: !signupAccessToken,
    error: tableSynced ? undefined : lastRestError || undefined,
  };
}

export async function syncUsersToSupabaseFromBrowser(
  config: BrowserSupabaseConfig,
  users: Array<{
    id: string;
    uid?: string;
    username: string;
    displayName: string;
    email?: string;
    bio?: string;
    website?: string;
    avatarUrl?: string;
    coverUrl?: string;
    followers?: string[];
    following?: string[];
    verified?: boolean;
    boosted?: boolean;
    restricted?: boolean;
    isDemoSeed?: boolean;
  }>
): Promise<{ attempted: number; inserted: number; updated: number; failed: number; lastError?: string }> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return { attempted: 0, inserted: 0, updated: 0, failed: 0, lastError: 'Chave pública anon não configurada.' };
  }
  const realUsers = users.filter((u) => !u.isDemoSeed && u.id && u.username);
  if (realUsers.length === 0) {
    return { attempted: 0, inserted: 0, updated: 0, failed: 0 };
  }

  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return {
      attempted: realUsers.length,
      inserted: 0,
      updated: 0,
      failed: realUsers.length,
      lastError: err instanceof Error ? err.message : 'URL do Supabase inválida.',
    };
  }

  const schema = sanitizeSupabaseSchemaName(config.schemaName);
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let lastError = '';

  const sanitizeHandleForRls = (rawHandle: string, fallbackId: string): string => {
    const cleaned = rawHandle.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '').slice(0, 32);
    if (cleaned.length >= 3) return cleaned;
    const suffix = fallbackId.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 8) || 'user';
    return `user.${suffix}`.slice(0, 32);
  };

  const patchExistingUser = async (
    targetFilter: string,
    u: (typeof realUsers)[number]
  ): Promise<{ ok: boolean; err?: string }> => {
    const patchBody: Record<string, unknown> = {
      display_name: (u.displayName || u.username).slice(0, 80),
      bio: (u.bio || 'Novo usuário real na Lumina.').slice(0, 220),
      avatar_url: compactBrowserMediaUrl(u.avatarUrl, 220_000),
      cover_url: compactBrowserMediaUrl(u.coverUrl, 220_000),
      updated_at: new Date().toISOString(),
    };
    if (typeof u.website === 'string') patchBody.website = u.website.slice(0, 200);
    if (Array.isArray(u.followers)) patchBody.followers = u.followers.slice(0, 2000);
    if (Array.isArray(u.following)) patchBody.following = u.following.slice(0, 2000);

    let patchRes = await fetch(`${origin}/rest/v1/lumina_users?${targetFilter}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
        'Content-Profile': schema,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patchBody),
      signal: AbortSignal.timeout(6000),
    });
    if (patchRes.status === 400) {
      const corePatch = { ...patchBody };
      delete corePatch.website;
      delete corePatch.followers;
      delete corePatch.following;
      patchRes = await fetch(`${origin}/rest/v1/lumina_users?${targetFilter}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
          'Content-Profile': schema,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(corePatch),
        signal: AbortSignal.timeout(6000),
      });
    }
    if (patchRes.ok) return { ok: true };
    const errText = await patchRes.text().catch(() => `HTTP ${patchRes.status}`);
    return { ok: false, err: errText };
  };

  for (const u of realUsers) {
    const cleanHandle = sanitizeHandleForRls(u.username || '', u.id);
    if (!cleanHandle) continue;
    try {
      const authUidValue =
        u.uid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.uid.trim())
          ? u.uid.trim()
          : null;

      // Pre-check if row already exists by id or username to avoid blind RETURNING *
      let existingRowId: string | null = null;
      let existingRowAuthUid: string | null = null;
      const preCheck = await fetch(
        `${origin}/rest/v1/lumina_users?select=id,auth_uid,username&or=(id.eq.${encodeURIComponent(u.id)},username.ilike.${encodeURIComponent(cleanHandle)})&limit=1`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      ).catch(() => null);
      if (preCheck?.ok) {
        const preRows = (await preCheck.json().catch(() => [])) as Array<{ id?: string; auth_uid?: string }>;
        if (Array.isArray(preRows) && preRows.length > 0 && preRows[0]?.id) {
          existingRowId = String(preRows[0].id);
          existingRowAuthUid = typeof preRows[0].auth_uid === 'string' ? preRows[0].auth_uid : null;
        }
      } else if (preCheck && !preCheck.ok) {
        const preErr = await preCheck.text().catch(() => `HTTP ${preCheck.status}`);
        recordSupabaseSyncLog({
          level: 'warn',
          category: 'user_sync',
          userId: u.id,
          username: cleanHandle,
          httpStatus: preCheck.status,
          summary: `Pré-verificação falhou para @${cleanHandle} (HTTP ${preCheck.status})`,
          details: preErr,
        });
      }

      if (existingRowId && existingRowId !== u.id) {
        recordSupabaseSyncLog({
          level: 'warn',
          category: 'id_mismatch',
          userId: u.id,
          username: cleanHandle,
          summary: `Disparidade de ID detectada durante sync para @${cleanHandle}`,
          details: `Cache local usa id="${u.id}", enquanto Supabase já possui id="${existingRowId}". Atualizando pelo ID remoto.`,
        });
      }
      if (authUidValue && existingRowAuthUid && existingRowAuthUid !== authUidValue) {
        recordSupabaseSyncLog({
          level: 'warn',
          category: 'id_mismatch',
          userId: u.id,
          username: cleanHandle,
          summary: `Disparidade de auth_uid para @${cleanHandle}`,
          details: `auth_uid local="${authUidValue}" vs remoto="${existingRowAuthUid}".`,
        });
      }

      if (existingRowId) {
        const patchRes = await patchExistingUser(`id=eq.${encodeURIComponent(existingRowId)}`, u);
        if (
          typeof u.verified === 'boolean' ||
          typeof u.boosted === 'boolean' ||
          typeof u.restricted === 'boolean'
        ) {
          await updateUserFlagsInSupabaseBrowser(config, {
            userId: existingRowId,
            username: cleanHandle,
            verified: u.verified,
            boosted: u.boosted,
            restricted: u.restricted,
          }).catch(() => false);
        }
        if (patchRes.ok) {
          updated += 1;
        } else {
          failed += 1;
          lastError = patchRes.err || 'Falha ao atualizar usuário existente';
          recordSupabaseSyncLog({
            level: 'error',
            category: 'user_sync',
            userId: u.id,
            username: cleanHandle,
            summary: `Erro ao atualizar @${cleanHandle} no Supabase`,
            details: lastError,
          });
        }
        continue;
      }

      if (!u.email?.trim()) {
        recordSupabaseSyncLog({
          level: 'warn',
          category: 'missing_field',
          userId: u.id,
          username: cleanHandle,
          summary: `Campo "email" ausente ao sincronizar usuário novo @${cleanHandle}`,
          details: 'Persistindo registro público sem e-mail no cache sincronizado.',
        });
      }

      const coreInsert: Record<string, unknown> = {
        id: u.id,
        auth_uid: authUidValue,
        username: cleanHandle,
        display_name: (u.displayName || cleanHandle).slice(0, 80),
        email: u.email ? u.email.trim().toLowerCase().slice(0, 140) : null,
        bio: (u.bio || 'Novo usuário real na Lumina.').slice(0, 220),
        avatar_url: compactBrowserMediaUrl(u.avatarUrl, 220_000),
        cover_url: compactBrowserMediaUrl(u.coverUrl, 220_000),
        is_real_user: true,
        auth_source: 'admin-sync',
        updated_at: new Date().toISOString(),
      };
      const extendedInsert: Record<string, unknown> = {
        ...coreInsert,
        ...(typeof u.website === 'string' ? { website: u.website.slice(0, 200) } : {}),
        ...(Array.isArray(u.followers) ? { followers: u.followers.slice(0, 2000) } : {}),
        ...(Array.isArray(u.following) ? { following: u.following.slice(0, 2000) } : {}),
      };

      const doPost = (body: Record<string, unknown>) =>
        fetch(`${origin}/rest/v1/lumina_users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
            'Content-Profile': schema,
            // Never request return=representation: RETURNING * requires SELECT grant on every column (blocked on email)
            Prefer: 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(6000),
        });

      let res = await doPost(extendedInsert);
      if (res.status === 400) {
        res = await doPost(coreInsert);
      }

      if (res.ok) {
        inserted += 1;
      } else if (res.status === 409) {
        const lookupRes = await fetch(
          `${origin}/rest/v1/lumina_users?select=id,username&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
          {
            method: 'GET',
            headers: {
              ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
              'Accept-Profile': schema,
            },
            signal: AbortSignal.timeout(5000),
          }
        );
        const existingRows = lookupRes.ok
          ? ((await lookupRes.json().catch(() => [])) as Array<{ id?: string }>)
          : [];
        const existingId = existingRows[0]?.id;
        if (existingId) {
          const patchRes = await patchExistingUser(`id=eq.${encodeURIComponent(existingId)}`, u);
          if (patchRes.ok) {
            updated += 1;
          } else {
            failed += 1;
            lastError = patchRes.err || 'HTTP 409/PATCH falhou';
            recordSupabaseSyncLog({
              level: 'error',
              category: 'user_sync',
              userId: u.id,
              username: cleanHandle,
              httpStatus: 409,
              summary: `Conflito 409 e falha no PATCH para @${cleanHandle}`,
              details: lastError,
            });
          }
        } else {
          failed += 1;
          lastError = await res.text().catch(() => `HTTP ${res.status}`);
          recordSupabaseSyncLog({
            level: 'error',
            category: 'user_sync',
            userId: u.id,
            username: cleanHandle,
            httpStatus: res.status,
            summary: `Conflito 409 sem linha localizável para @${cleanHandle}`,
            details: lastError,
          });
        }
      } else {
        failed += 1;
        lastError = await res.text().catch(() => `HTTP ${res.status}`);
        recordSupabaseSyncLog({
          level: 'error',
          category: 'user_sync',
          userId: u.id,
          username: cleanHandle,
          httpStatus: res.status,
          summary: `Falha HTTP ${res.status} ao inserir @${cleanHandle} em lumina_users`,
          details: lastError,
        });
      }
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : 'Erro de rede';
      recordSupabaseSyncLog({
        level: 'error',
        category: 'user_sync',
        userId: u.id,
        username: cleanHandle,
        summary: `Exceção de rede ao sincronizar @${cleanHandle}`,
        details: lastError,
      });
    }
  }

  return {
    attempted: realUsers.length,
    inserted: inserted + updated,
    updated,
    failed,
    lastError: lastError || undefined,
  };
}

export async function loginSupabaseFromBrowser(
  config: BrowserSupabaseConfig,
  email: string,
  password: string
): Promise<{
  ok: boolean;
  userId?: string;
  authUid?: string;
  username?: string;
  displayName?: string;
  email?: string;
  userProfile?: UserProfile;
  emailNotConfirmed?: boolean;
  error?: string;
}> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey) || !email.includes('@')) {
    return { ok: false };
  }

  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error_description?: string;
        msg?: string;
        message?: string;
        error?: string;
      };
      const rawMsg =
        errBody.error_description || errBody.msg || errBody.message || errBody.error || '';
      if (/email not confirmed/i.test(rawMsg)) {
        return {
          ok: false,
          emailNotConfirmed: true,
          error:
            'Seu e-mail ainda não foi confirmado no Supabase. Confirme pelo link recebido ou desative "Confirm email" em Authentication → Providers → Email no Supabase.',
        };
      }
      return { ok: false, error: rawMsg || undefined };
    }
    const data = (await res.json()) as {
      access_token?: string;
      user?: {
        id?: string;
        email?: string;
        user_metadata?: { lumina_id?: string; username?: string; display_name?: string };
      };
    };
    const authUid = data.user?.id;
    const meta = data.user?.user_metadata;
    const cleanEmail = (data.user?.email || email).trim().toLowerCase();

    if (data.access_token) {
      setBrowserSupabaseSession({
        accessToken: data.access_token,
        authUid,
        email: cleanEmail,
        luminaId: meta?.lumina_id || authUid,
        savedAt: Date.now(),
      });
    }

    // Look up canonical lumina_users row by auth_uid, then lumina_id, then username
    let rowProfile: UserProfile | null = null;
    const filters: string[] = [];
    if (authUid) filters.push(`auth_uid=eq.${encodeURIComponent(authUid)}`);
    if (meta?.lumina_id) filters.push(`id=eq.${encodeURIComponent(meta.lumina_id)}`);
    if (meta?.username) filters.push(`username=ilike.${encodeURIComponent(meta.username.trim().toLowerCase())}`);

    for (const filter of filters) {
      if (rowProfile) break;
      const queries = [
        `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_EXTENDED}&${filter}&limit=1`,
        `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&${filter}&limit=1`,
      ];
      for (const qUrl of queries) {
        try {
          const rowRes = await fetch(qUrl, {
            method: 'GET',
            headers: {
              ...buildBrowserSupabaseHeaders(config.anonKey, data.access_token),
              'Accept-Profile': schema,
            },
            signal: AbortSignal.timeout(5000),
          });
          if (rowRes.ok) {
            const rows = (await rowRes.json()) as Array<Record<string, unknown>>;
            if (Array.isArray(rows) && rows.length > 0) {
              rowProfile = mapBrowserSupabaseUserRow(rows[0]);
              rowProfile.email = cleanEmail;
              if (authUid && rows[0].auth_uid !== authUid && rowProfile.id) {
                await fetch(
                  `${origin}/rest/v1/lumina_users?id=eq.${encodeURIComponent(rowProfile.id)}`,
                  {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      ...buildBrowserSupabaseHeaders(config.anonKey, data.access_token),
                      'Content-Profile': schema,
                      Prefer: 'return=minimal',
                    },
                    body: JSON.stringify({ auth_uid: authUid, updated_at: new Date().toISOString() }),
                    signal: AbortSignal.timeout(4000),
                  }
                ).catch(() => {});
                rowProfile.uid = authUid;
              }
              break;
            }
          } else if (rowRes.status !== 400) {
            break;
          }
        } catch {
          break;
        }
      }
    }

    const fallbackHandle = (
      meta?.username ||
      cleanEmail.split('@')[0].replace(/[^a-z0-9._]/g, '') ||
      `user.${(authUid || Date.now().toString(36)).slice(0, 6)}`
    )
      .toLowerCase()
      .slice(0, 24);
    const resolvedId = rowProfile?.id || meta?.lumina_id || authUid || `sb_${Date.now()}`;

    if (!rowProfile && data.access_token) {
      await fetch(`${origin}/rest/v1/lumina_users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey, data.access_token),
          'Content-Profile': schema,
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: resolvedId,
          auth_uid: authUid || null,
          username: fallbackHandle,
          display_name: (meta?.display_name || fallbackHandle).slice(0, 60),
          email: cleanEmail,
          bio: 'Usuário conectado via Supabase Auth.',
          is_real_user: true,
          auth_source: 'supabase-login',
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    if (data.access_token) {
      setBrowserSupabaseSession({
        accessToken: data.access_token,
        authUid,
        email: cleanEmail,
        luminaId: resolvedId,
        savedAt: Date.now(),
      });
    }

    return {
      ok: true,
      userId: resolvedId,
      authUid,
      username: rowProfile?.username || fallbackHandle,
      displayName: rowProfile?.displayName || meta?.display_name || fallbackHandle,
      email: cleanEmail,
      userProfile: rowProfile || undefined,
    };
  } catch {
    return { ok: false };
  }
}

function parseStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function mapBrowserSupabaseUserRow(r: Record<string, unknown>): UserProfile {
  const username = String(r.username || '');
  const updatedMs =
    typeof r.last_active_at === 'string'
      ? Date.parse(r.last_active_at)
      : typeof r.updated_at === 'string'
      ? Date.parse(r.updated_at)
      : undefined;
  return {
    id: String(r.id || ''),
    uid: typeof r.auth_uid === 'string' && r.auth_uid ? r.auth_uid : undefined,
    username,
    displayName: String(r.display_name || username || ''),
    bio: String(r.bio || 'Novo usuário real na Lumina.'),
    website: typeof r.website === 'string' && r.website.trim() ? r.website.trim() : undefined,
    avatarUrl:
      typeof r.avatar_url === 'string' && r.avatar_url.trim()
        ? r.avatar_url.trim()
        : '/og-preview.jpg',
    coverUrl:
      typeof r.cover_url === 'string' && r.cover_url.trim()
        ? r.cover_url.trim()
        : undefined,
    verified: Boolean(r.verified),
    boosted: Boolean(r.boosted),
    restricted: Boolean(r.restricted),
    isOnline: typeof r.is_online === 'boolean' ? r.is_online : undefined,
    lastActiveAtMs:
      typeof updatedMs === 'number' && Number.isFinite(updatedMs) ? updatedMs : undefined,
    isDemoSeed: false,
    followers: parseStringArray(r.followers),
    following: parseStringArray(r.following),
  };
}

export async function fetchPublicUsersFromSupabaseBrowser(
  config: BrowserSupabaseConfig
): Promise<UserProfile[]> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const urls = [
      `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_EXTENDED}&and=(or(is_real_user.eq.true,is_real_user.is.null),or(restricted.eq.false,restricted.is.null))&order=created_at.desc&limit=250`,
      `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&and=(or(is_real_user.eq.true,is_real_user.is.null),or(restricted.eq.false,restricted.is.null))&order=created_at.desc&limit=250`,
      `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&order=created_at.desc&limit=250`,
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        const mapped = rows.map(mapBrowserSupabaseUserRow);
        const invalidRows = mapped.filter((u) => !u.id || !u.username);
        if (invalidRows.length > 0) {
          recordSupabaseSyncLog({
            level: 'warn',
            category: 'missing_field',
            summary: `${invalidRows.length} registro(s) no Supabase sem id ou username válidos`,
          });
        }
        return mapped.filter((u) => Boolean(u.id && u.username && !u.restricted));
      }
      if (res.status !== 400) {
        const errBody = await res.text().catch(() => `HTTP ${res.status}`);
        recordSupabaseSyncLog({
          level: 'error',
          category: 'fetch',
          httpStatus: res.status,
          summary: `Erro HTTP ${res.status} ao buscar usuários públicos no Supabase`,
          details: errBody,
        });
        break;
      }
    }
    return [];
  } catch (err) {
    recordSupabaseSyncLog({
      level: 'error',
      category: 'fetch',
      summary: 'Exceção de rede ao buscar usuários públicos no Supabase',
      details: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function fetchPublicUserByUsernameFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  rawIdentifier: string
): Promise<UserProfile | null> {
  const cleanHandle = rawIdentifier.trim().toLowerCase().replace(/^@/, '');
  const rawTrimmed = rawIdentifier.trim().replace(/^@/, '');
  if (!cleanHandle || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return null;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTrimmed);
    const filterClauses = [
      `username=ilike.${encodeURIComponent(cleanHandle)}`,
      `id=eq.${encodeURIComponent(rawTrimmed)}`,
      ...(isUuid ? [`auth_uid=eq.${encodeURIComponent(rawTrimmed)}`] : []),
    ];

    for (const filter of filterClauses) {
      for (const cols of [SELECT_USERS_EXTENDED, SELECT_USERS_CORE]) {
        const res = await fetch(
          `${origin}/rest/v1/lumina_users?select=${cols}&${filter}&limit=1`,
          {
            method: 'GET',
            headers: {
              ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
              'Accept-Profile': schema,
            },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (res.ok) {
          const rows = (await res.json()) as Array<Record<string, unknown>>;
          if (Array.isArray(rows) && rows.length > 0) {
            const mapped = mapBrowserSupabaseUserRow(rows[0]);
            if (mapped.id && mapped.username) return mapped;
          }
          break;
        }
        if (res.status !== 400) break;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateUserProfileInSupabaseBrowser(
  config: BrowserSupabaseConfig,
  userId: string,
  patch: Partial<
    Pick<
      UserProfile,
      'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl' | 'coverUrl' | 'followers' | 'following'
    >
  >
): Promise<boolean> {
  if (!userId || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return false;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);

    const fullBody: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof patch.displayName === 'string') {
      fullBody.display_name = patch.displayName.slice(0, 80);
    }
    if (typeof patch.username === 'string' && patch.username.trim().length >= 3) {
      fullBody.username = patch.username.trim().toLowerCase().slice(0, 32);
    }
    if (typeof patch.bio === 'string') {
      fullBody.bio = patch.bio.slice(0, 220);
    }
    if (typeof patch.website === 'string') {
      fullBody.website = patch.website.slice(0, 200);
    }
    if (typeof patch.avatarUrl === 'string') {
      const safe = compactBrowserMediaUrl(patch.avatarUrl, 220_000);
      if (safe) fullBody.avatar_url = safe;
    }
    if (typeof patch.coverUrl === 'string') {
      const safe = compactBrowserMediaUrl(patch.coverUrl, 220_000);
      if (safe) fullBody.cover_url = safe;
    }
    if (Array.isArray(patch.followers)) {
      fullBody.followers = patch.followers.slice(0, 2000);
    }
    if (Array.isArray(patch.following)) {
      fullBody.following = patch.following.slice(0, 2000);
    }

    const res = await fetch(
      `${origin}/rest/v1/lumina_users?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(fullBody),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) return true;

    // Retry without newer optional columns if SQL has not been upgraded yet
    if (res.status === 400) {
      const fallbackBody = { ...fullBody };
      delete fallbackBody.website;
      delete fallbackBody.followers;
      delete fallbackBody.following;
      if (Object.keys(fallbackBody).length > 1) {
        const retryRes = await fetch(
          `${origin}/rest/v1/lumina_users?id=eq.${encodeURIComponent(userId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...buildBrowserSupabaseHeaders(config.anonKey),
              'Content-Profile': schema,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(6000),
          }
        );
        return retryRes.ok;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function updateUserFlagsInSupabaseBrowser(
  config: BrowserSupabaseConfig,
  payload: {
    userId: string;
    username?: string;
    verified?: boolean;
    boosted?: boolean;
    restricted?: boolean;
  }
): Promise<boolean> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey) || !payload.userId) {
    return false;
  }
  const session = getBrowserSupabaseSession();
  if (
    !session?.accessToken ||
    session.email?.trim().toLowerCase() !== 'dadaniel14hiphop.com@gmail.com'
  ) {
    return false;
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(`${origin}/rest/v1/rpc/lumina_admin_set_user_flags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey, session.accessToken),
        'Content-Profile': schema,
      },
      body: JSON.stringify({
        p_user_id: payload.userId,
        p_username: payload.username ? payload.username.trim().toLowerCase().replace(/^@/, '') : null,
        p_verified: typeof payload.verified === 'boolean' ? payload.verified : null,
        p_boosted: typeof payload.boosted === 'boolean' ? payload.boosted : null,
        p_restricted: typeof payload.restricted === 'boolean' ? payload.restricted : null,
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function mapBrowserSupabasePostRow(r: Record<string, unknown>): Post | null {
  const id = String(r.id || '').trim();
  const authorId = String(r.author_id || '').trim();
  if (!id || !authorId) return null;

  const rawAssets = Array.isArray(r.media_assets) ? (r.media_assets as Array<Record<string, unknown>>) : [];
  const rawUrls = Array.isArray(r.media_urls) ? (r.media_urls as unknown[]) : [];
  const caption = String(r.caption || '');

  const media: MediaAsset[] =
    rawAssets.length > 0
      ? rawAssets
          .filter((m) => m && typeof m.url === 'string' && m.url.trim().length > 0)
          .map((m, idx) => ({
            id: typeof m.id === 'string' && m.id ? m.id : `m_${id}_${idx}`,
            url: String(m.url).trim(),
            alt: typeof m.alt === 'string' && m.alt ? m.alt : caption.slice(0, 80) || 'Publicação na Lumina',
            filterCss: typeof m.filterCss === 'string' ? m.filterCss : undefined,
            mediaType: m.mediaType === 'video' ? 'video' : 'image',
            durationSec: typeof m.durationSec === 'number' ? m.durationSec : undefined,
          }))
      : rawUrls
          .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
          .map((u, idx) => {
            const isVid =
              /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(u) || /^data:video\//i.test(u);
            return {
              id: `m_${id}_${idx}`,
              url: u.trim(),
              alt: caption.slice(0, 80) || 'Publicação na Lumina',
              mediaType: isVid ? 'video' : 'image',
            };
          });

  if (media.length === 0) return null;

  const createdMs =
    typeof r.created_at === 'string'
      ? Date.parse(r.created_at) || Date.now()
      : typeof r.created_at === 'number'
      ? r.created_at
      : Date.now();

  const rawComments = Array.isArray(r.comments) ? (r.comments as PostComment[]) : [];
  const validAspect =
    r.aspect_ratio === '1:1' ||
    r.aspect_ratio === '4:5' ||
    r.aspect_ratio === '16:9' ||
    r.aspect_ratio === '9:16'
      ? r.aspect_ratio
      : '4:5';

  return {
    id,
    authorId,
    authorUid: typeof r.author_uid === 'string' && r.author_uid ? r.author_uid : undefined,
    media,
    caption,
    location: typeof r.location === 'string' && r.location.trim() ? r.location.trim() : undefined,
    category: (typeof r.category === 'string' && r.category ? r.category : 'Fotografia') as PostCategory,
    aspectRatio: validAspect,
    isReel: Boolean(r.is_reel),
    audioTrack: typeof r.audio_track === 'string' && r.audio_track ? r.audio_track : undefined,
    likes: parseStringArray(r.likes),
    savedBy: parseStringArray(r.saved_by),
    comments: rawComments,
    createdAt: createdMs,
  };
}

export async function fetchPublicPostsFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  authorIdFilter?: string | string[]
): Promise<Post[]> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const ids = (
      Array.isArray(authorIdFilter)
        ? authorIdFilter
        : authorIdFilter
        ? [authorIdFilter]
        : []
    )
      .map((s) => s.trim())
      .filter(Boolean);
    const cleanIds = Array.from(new Set(ids));
    const quotedList = cleanIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    const extendedAuthorClause =
      cleanIds.length === 1
        ? `&or=(author_id.eq.${encodeURIComponent(cleanIds[0])},author_uid.eq.${encodeURIComponent(cleanIds[0])})`
        : cleanIds.length > 1
        ? `&or=(author_id.in.(${encodeURIComponent(quotedList)}),author_uid.in.(${encodeURIComponent(quotedList)}))`
        : '';
    const coreAuthorClause =
      cleanIds.length === 1
        ? `&author_id=eq.${encodeURIComponent(cleanIds[0])}`
        : cleanIds.length > 1
        ? `&author_id=in.(${encodeURIComponent(quotedList)})`
        : '';
    const urls = [
      `${origin}/rest/v1/lumina_posts?select=${SELECT_POSTS_EXTENDED}${extendedAuthorClause}&order=created_at.desc&limit=150`,
      `${origin}/rest/v1/lumina_posts?select=${SELECT_POSTS_EXTENDED}${coreAuthorClause}&order=created_at.desc&limit=150`,
      `${origin}/rest/v1/lumina_posts?select=${SELECT_POSTS_CORE}${coreAuthorClause}&order=created_at.desc&limit=150`,
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        return rows.map(mapBrowserSupabasePostRow).filter((p): p is Post => p !== null);
      }
      if (res.status !== 400) break;
    }
    return [];
  } catch {
    return [];
  }
}

export async function upsertPostToSupabaseBrowser(
  config: BrowserSupabaseConfig,
  post: Post
): Promise<boolean> {
  if (!post.id || !post.authorId || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return false;
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);

    const safeAssets = post.media
      .map((m) => {
        const url = compactBrowserMediaUrl(m.url, 260_000);
        if (!url) return null;
        return {
          id: m.id,
          url,
          alt: (m.alt || '').slice(0, 120),
          filterCss: m.filterCss,
          mediaType: m.mediaType || 'image',
          durationSec: m.durationSec,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 10);

    if (safeAssets.length === 0) return false;

    const fullRow = {
      id: post.id,
      author_id: post.authorId,
      author_uid: post.authorUid || null,
      caption: (post.caption || '').slice(0, 1200),
      location: post.location ? post.location.slice(0, 120) : null,
      category: post.category || 'Fotografia',
      aspect_ratio: post.aspectRatio || '4:5',
      is_reel: Boolean(post.isReel),
      media_urls: safeAssets.map((a) => a.url),
      media_assets: safeAssets,
      audio_track: post.audioTrack ? post.audioTrack.slice(0, 120) : null,
      likes: post.likes.slice(0, 2000),
      saved_by: post.savedBy.slice(0, 2000),
      comments: post.comments.slice(0, 200),
      created_at: new Date(post.createdAt || Date.now()).toISOString(),
    };

    const res = await fetch(`${origin}/rest/v1/lumina_posts?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey),
        'Content-Profile': schema,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(fullRow),
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) return true;

    if (res.status === 400) {
      const coreRow = {
        id: fullRow.id,
        author_id: fullRow.author_id,
        caption: fullRow.caption,
        location: fullRow.location,
        category: fullRow.category,
        aspect_ratio: fullRow.aspect_ratio,
        is_reel: fullRow.is_reel,
        media_urls: fullRow.media_urls,
        created_at: fullRow.created_at,
      };
      const retry = await fetch(`${origin}/rest/v1/lumina_posts?on_conflict=id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(coreRow),
        signal: AbortSignal.timeout(6000),
      });
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function deletePostFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  postId: string
): Promise<boolean> {
  if (!postId || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return false;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(
      `${origin}/rest/v1/lumina_posts?id=eq.${encodeURIComponent(postId)}`,
      {
        method: 'DELETE',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncPostsToSupabaseFromBrowser(
  config: BrowserSupabaseConfig,
  posts: Post[]
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const post of posts.slice(0, 80)) {
    const ok = await upsertPostToSupabaseBrowser(config, post);
    if (ok) synced += 1;
    else failed += 1;
  }
  return { synced, failed };
}

function mapBrowserSupabaseStoryRow(r: Record<string, unknown>): StoryItem | null {
  const id = String(r.id || '').trim();
  const authorId = String(r.author_id || '').trim();
  const mediaUrl = typeof r.media_url === 'string' ? r.media_url.trim() : '';
  if (!id || !authorId || !mediaUrl) return null;

  const createdMs =
    typeof r.created_at === 'string'
      ? Date.parse(r.created_at) || Date.now()
      : typeof r.created_at === 'number'
      ? r.created_at
      : Date.now();
  if (Date.now() - createdMs > 24 * 60 * 60 * 1000) return null;

  const rawReactions = Array.isArray(r.reactions) ? (r.reactions as Array<Record<string, unknown>>) : [];
  return {
    id,
    authorId,
    authorUid: typeof r.author_uid === 'string' && r.author_uid ? r.author_uid : undefined,
    mediaUrl,
    caption: typeof r.caption === 'string' && r.caption.trim() ? r.caption.trim() : undefined,
    location: typeof r.location === 'string' && r.location.trim() ? r.location.trim() : undefined,
    createdAt: createdMs,
    viewedBy: parseStringArray(r.viewed_by),
    reactions: rawReactions
      .filter((x) => x && typeof x.userId === 'string' && typeof x.emoji === 'string')
      .map((x) => ({ userId: String(x.userId), emoji: String(x.emoji) })),
  };
}

export async function fetchPublicStoriesFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  authorIdFilter?: string | string[]
): Promise<StoryItem[]> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ids = (
      Array.isArray(authorIdFilter)
        ? authorIdFilter
        : authorIdFilter
        ? [authorIdFilter]
        : []
    )
      .map((s) => s.trim())
      .filter(Boolean);
    const cleanIds = Array.from(new Set(ids));
    const quotedList = cleanIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    const extendedAuthorClause =
      cleanIds.length === 1
        ? `&or=(author_id.eq.${encodeURIComponent(cleanIds[0])},author_uid.eq.${encodeURIComponent(cleanIds[0])})`
        : cleanIds.length > 1
        ? `&or=(author_id.in.(${encodeURIComponent(quotedList)}),author_uid.in.(${encodeURIComponent(quotedList)}))`
        : '';
    const coreAuthorClause =
      cleanIds.length === 1
        ? `&author_id=eq.${encodeURIComponent(cleanIds[0])}`
        : cleanIds.length > 1
        ? `&author_id=in.(${encodeURIComponent(quotedList)})`
        : '';

    for (const clause of [extendedAuthorClause, coreAuthorClause]) {
      const res = await fetch(
        `${origin}/rest/v1/lumina_stories?select=${SELECT_STORIES}&created_at=gte.${encodeURIComponent(sinceIso)}${clause}&order=created_at.desc&limit=100`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(config.anonKey, undefined, true),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        return rows.map(mapBrowserSupabaseStoryRow).filter((s): s is StoryItem => s !== null);
      }
      if (res.status !== 400 || !clause) break;
    }
    return [];
  } catch {
    return [];
  }
}

export async function upsertStoryToSupabaseBrowser(
  config: BrowserSupabaseConfig,
  story: StoryItem
): Promise<boolean> {
  if (!story.id || !story.authorId || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return false;
  }
  const safeMedia = compactBrowserMediaUrl(story.mediaUrl, 260_000);
  if (!safeMedia) return false;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const createdAt = story.createdAt || Date.now();
    const fullBody = {
      id: story.id,
      author_id: story.authorId,
      author_uid: story.authorUid || null,
      media_url: safeMedia,
      caption: story.caption ? story.caption.slice(0, 300) : null,
      location: story.location ? story.location.slice(0, 120) : null,
      viewed_by: story.viewedBy.slice(0, 2000),
      reactions: story.reactions.slice(0, 500),
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(createdAt + 24 * 60 * 60 * 1000).toISOString(),
    };
    const res = await fetch(`${origin}/rest/v1/lumina_stories?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey),
        'Content-Profile': schema,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(fullBody),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) return true;
    if (res.status === 400) {
      const coreBody = {
        id: fullBody.id,
        author_id: fullBody.author_id,
        media_url: fullBody.media_url,
        caption: fullBody.caption,
        viewed_by: fullBody.viewed_by,
        reactions: fullBody.reactions,
        created_at: fullBody.created_at,
      };
      const retry = await fetch(`${origin}/rest/v1/lumina_stories?on_conflict=id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(coreBody),
        signal: AbortSignal.timeout(6000),
      });
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export function canonicalThreadIdForPair(idA: string, idB: string): string {
  const sorted = [idA.trim(), idB.trim()].sort();
  return `dm_${sorted[0]}__${sorted[1]}`;
}

export async function fetchDirectThreadsForUserFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  userIds: string[]
): Promise<DirectThread[]> {
  const cleanIds = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
  if (cleanIds.length === 0 || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return [];
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const inList = `(${cleanIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`;
    const orFilter = `or=(sender_id.in.${encodeURIComponent(inList)},recipient_id.in.${encodeURIComponent(inList)})`;

    let rows: Array<Record<string, unknown>> = [];
    for (const selectCols of [SELECT_MESSAGES_EXTENDED, SELECT_MESSAGES_CORE]) {
      const res = await fetch(
        `${origin}/rest/v1/lumina_messages?select=${selectCols}&${orFilter}&order=created_at.asc&limit=300`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(config.anonKey),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (res.ok) {
        const parsed = (await res.json()) as Array<Record<string, unknown>>;
        if (Array.isArray(parsed)) rows = parsed;
        break;
      }
      if (res.status !== 400) return [];
    }
    if (rows.length === 0) return [];

    const myIdSet = new Set(cleanIds);
    const threadMap = new Map<string, DirectThread>();

    for (const r of rows) {
      const id = String(r.id || '').trim();
      const senderId = String(r.sender_id || '').trim();
      const recipientId = String(r.recipient_id || '').trim();
      if (!id || !senderId || !recipientId) continue;

      const threadId =
        typeof r.thread_id === 'string' && r.thread_id.trim()
          ? r.thread_id.trim()
          : canonicalThreadIdForPair(senderId, recipientId);
      const createdAt =
        typeof r.created_at === 'string'
          ? Date.parse(r.created_at) || Date.now()
          : typeof r.created_at === 'number'
          ? r.created_at
          : Date.now();
      const readBy = parseStringArray(r.read_by);
      const rawReactions =
        r.reactions && typeof r.reactions === 'object' && !Array.isArray(r.reactions)
          ? (r.reactions as Record<string, string>)
          : undefined;
      const seenAt =
        typeof r.seen_at === 'string'
          ? Date.parse(r.seen_at) || undefined
          : typeof r.seen_at === 'number'
          ? r.seen_at
          : undefined;

      const msg: DirectMessage = {
        id,
        senderId,
        text: String(r.text || ''),
        sharedPostId: typeof r.shared_post_id === 'string' ? r.shared_post_id : undefined,
        storyReplyUrl: typeof r.story_reply_url === 'string' ? r.story_reply_url : undefined,
        audioUrl: typeof r.audio_url === 'string' ? r.audio_url : undefined,
        audioDurationSec:
          typeof r.audio_duration_sec === 'number' ? r.audio_duration_sec : undefined,
        videoUrl: typeof r.video_url === 'string' ? r.video_url : undefined,
        videoName: typeof r.video_name === 'string' ? r.video_name : undefined,
        fileUrl: typeof r.file_url === 'string' ? r.file_url : undefined,
        fileName: typeof r.file_name === 'string' ? r.file_name : undefined,
        fileMime: typeof r.file_mime === 'string' ? r.file_mime : undefined,
        fileSize: typeof r.file_size === 'number' ? r.file_size : undefined,
        replyToId: typeof r.reply_to_id === 'string' ? r.reply_to_id : undefined,
        replyToSenderId:
          typeof r.reply_to_sender_id === 'string' ? r.reply_to_sender_id : undefined,
        replyToText: typeof r.reply_to_text === 'string' ? r.reply_to_text : undefined,
        reaction: typeof r.reaction === 'string' ? r.reaction : undefined,
        reactions: rawReactions,
        readBy,
        seenAt,
        createdAt,
      };

      const existing = threadMap.get(threadId);
      const unreadForMe = !myIdSet.has(senderId) && !cleanIds.some((idVal) => readBy.includes(idVal));
      if (!existing) {
        threadMap.set(threadId, {
          id: threadId,
          participantIds: [senderId, recipientId].filter((v, i, arr) => arr.indexOf(v) === i),
          messages: [msg],
          unreadBy: unreadForMe ? [cleanIds[0]] : [],
          updatedAt: createdAt,
        });
      } else {
        existing.messages.push(msg);
        existing.updatedAt = Math.max(existing.updatedAt, createdAt);
        if (unreadForMe && !existing.unreadBy.includes(cleanIds[0])) {
          existing.unreadBy.push(cleanIds[0]);
        }
      }
    }

    return Array.from(threadMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function upsertDirectMessageToSupabaseBrowser(
  config: BrowserSupabaseConfig,
  payload: {
    threadId: string;
    senderId: string;
    recipientId: string;
    message: DirectMessage;
  }
): Promise<boolean> {
  if (
    !payload.senderId ||
    !payload.recipientId ||
    !config.anonKey ||
    isServiceRoleOrSecretKey(config.anonKey)
  ) {
    return false;
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const m = payload.message;
    const safeFileUrl = compactBrowserAttachmentUrl(m.fileUrl, 450_000);
    const fullBody = {
      id: m.id,
      thread_id: payload.threadId,
      sender_id: payload.senderId,
      recipient_id: payload.recipientId,
      text: (m.text || '').slice(0, 2000),
      shared_post_id: m.sharedPostId || null,
      story_reply_url: compactBrowserMediaUrl(m.storyReplyUrl, 160_000),
      audio_url: compactBrowserMediaUrl(m.audioUrl, 260_000),
      audio_duration_sec: m.audioDurationSec ?? null,
      video_url: compactBrowserMediaUrl(m.videoUrl, 260_000),
      video_name: m.videoName ? m.videoName.slice(0, 120) : null,
      file_url: safeFileUrl,
      file_name: m.fileName ? m.fileName.slice(0, 140) : null,
      file_mime: m.fileMime ? m.fileMime.slice(0, 100) : null,
      file_size: typeof m.fileSize === 'number' ? m.fileSize : null,
      reply_to_id: m.replyToId || null,
      reply_to_sender_id: m.replyToSenderId || null,
      reply_to_text: m.replyToText ? m.replyToText.slice(0, 240) : null,
      reaction: m.reaction || null,
      reactions: m.reactions || {},
      read_by: m.readBy && m.readBy.length > 0 ? m.readBy : [payload.senderId],
      seen_at: m.seenAt ? new Date(m.seenAt).toISOString() : null,
      created_at: new Date(m.createdAt || Date.now()).toISOString(),
    };
    const res = await fetch(`${origin}/rest/v1/lumina_messages?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey),
        'Content-Profile': schema,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(fullBody),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) return true;
    if (res.status === 400) {
      const coreBody = {
        id: fullBody.id,
        thread_id: fullBody.thread_id,
        sender_id: fullBody.sender_id,
        recipient_id: fullBody.recipient_id,
        text: fullBody.text,
        shared_post_id: fullBody.shared_post_id,
        story_reply_url: fullBody.story_reply_url,
        audio_url: fullBody.audio_url,
        audio_duration_sec: fullBody.audio_duration_sec,
        video_url: fullBody.video_url,
        video_name: fullBody.video_name,
        reaction: fullBody.reaction,
        read_by: fullBody.read_by,
        created_at: fullBody.created_at,
      };
      const retry = await fetch(`${origin}/rest/v1/lumina_messages?on_conflict=id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(coreBody),
        signal: AbortSignal.timeout(6000),
      });
      return retry.ok;
    }
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    recordSupabaseSyncLog({
      level: 'error',
      category: 'message',
      userId: payload.senderId,
      httpStatus: res.status,
      summary: `Erro HTTP ${res.status} ao enviar mensagem no Supabase`,
      details: errText,
    });
    return false;
  } catch (err) {
    recordSupabaseSyncLog({
      level: 'error',
      category: 'message',
      userId: payload.senderId,
      summary: 'Exceção ao enviar mensagem para o Supabase',
      details: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function markThreadMessagesReadInSupabaseBrowser(
  config: BrowserSupabaseConfig,
  threadId: string,
  readerIds: string[]
): Promise<boolean> {
  const cleanReaders = Array.from(new Set(readerIds.map((r) => r.trim()).filter(Boolean)));
  if (!threadId || cleanReaders.length === 0 || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return false;
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const fetchRes = await fetch(
      `${origin}/rest/v1/lumina_messages?select=id,sender_id,read_by&thread_id=eq.${encodeURIComponent(threadId)}&limit=150`,
      {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!fetchRes.ok) return false;
    const rows = (await fetchRes.json()) as Array<{
      id?: string;
      sender_id?: string;
      read_by?: unknown;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return true;

    const myIdSet = new Set(cleanReaders);
    const nowIso = new Date().toISOString();
    const toUpdate = rows.filter((r) => {
      if (!r.id || myIdSet.has(String(r.sender_id || ''))) return false;
      const currentReadBy = parseStringArray(r.read_by);
      return !cleanReaders.some((idVal) => currentReadBy.includes(idVal));
    });

    await Promise.all(
      toUpdate.slice(0, 50).map(async (r) => {
        const nextReadBy = Array.from(new Set([...parseStringArray(r.read_by), ...cleanReaders]));
        const patchRes = await fetch(
          `${origin}/rest/v1/lumina_messages?id=eq.${encodeURIComponent(String(r.id))}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...buildBrowserSupabaseHeaders(config.anonKey),
              'Content-Profile': schema,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ read_by: nextReadBy, seen_at: nowIso }),
            signal: AbortSignal.timeout(4000),
          }
        );
        if (patchRes.status === 400) {
          await fetch(
            `${origin}/rest/v1/lumina_messages?id=eq.${encodeURIComponent(String(r.id))}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...buildBrowserSupabaseHeaders(config.anonKey),
                'Content-Profile': schema,
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({ read_by: nextReadBy }),
              signal: AbortSignal.timeout(4000),
            }
          ).catch(() => {});
        }
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function reactToDirectMessageInSupabaseBrowser(
  config: BrowserSupabaseConfig,
  messageId: string,
  reaction: string | undefined,
  reactionsMap?: Record<string, string>
): Promise<boolean> {
  if (!messageId || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return false;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(
      `${origin}/rest/v1/lumina_messages?id=eq.${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          reaction: reaction || null,
          ...(reactionsMap ? { reactions: reactionsMap } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) return true;
    if (res.status === 400 && reactionsMap) {
      const retry = await fetch(
        `${origin}/rest/v1/lumina_messages?id=eq.${encodeURIComponent(messageId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...buildBrowserSupabaseHeaders(config.anonKey),
            'Content-Profile': schema,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ reaction: reaction || null }),
          signal: AbortSignal.timeout(5000),
        }
      );
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function sendSupabasePasswordResetFromBrowser(
  config: BrowserSupabaseConfig,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@')) {
    return { ok: false, error: 'Informe um e-mail válido para recuperação.' };
  }
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return { ok: false, error: 'Chave pública do Supabase não configurada neste navegador.' };
  }
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const res = await fetch(`${origin}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({ email: cleanEmail }),
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) return { ok: true };
    const errBody = (await res.json().catch(() => ({}))) as {
      msg?: string;
      error_description?: string;
      message?: string;
    };
    return {
      ok: false,
      error: errBody.msg || errBody.error_description || errBody.message || `HTTP ${res.status}`,
    };
  } catch {
    return { ok: false, error: 'Não foi possível contatar o servidor de recuperação.' };
  }
}
