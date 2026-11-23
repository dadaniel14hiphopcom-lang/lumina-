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
  'id,auth_uid,username,display_name,bio,website,avatar_url,cover_url,verified,boosted,restricted,followers,following,created_at';
const SELECT_USERS_CORE =
  'id,auth_uid,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at';

const SELECT_POSTS_EXTENDED =
  'id,author_id,author_uid,caption,location,category,aspect_ratio,is_reel,media_urls,media_assets,audio_track,likes,saved_by,comments,created_at';
const SELECT_POSTS_CORE =
  'id,author_id,caption,location,category,aspect_ratio,is_reel,media_urls,created_at';

const SELECT_STORIES =
  'id,author_id,author_uid,media_url,caption,location,viewed_by,reactions,created_at,expires_at';

const SELECT_MESSAGES =
  'id,thread_id,sender_id,recipient_id,text,shared_post_id,story_reply_url,audio_url,audio_duration_sec,video_url,video_name,reaction,read_by,created_at';

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

export function getBrowserSupabaseSession(): BrowserSupabaseSession | null {
  try {
    const raw = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowserSupabaseSession;
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
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
  bearerOverride?: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cleanKey = anonKey.trim();
  if (cleanKey) {
    headers.apikey = cleanKey;
    const storedToken = getBrowserSupabaseSession()?.accessToken?.trim() || '';
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
      ...buildBrowserSupabaseHeaders(anonKey),
      'Accept-Profile': schema,
    },
    signal: AbortSignal.timeout(6000),
  });

  if (tableRes.ok) {
    return {
      reachable: true,
      hasKey: true,
      tablesReady: true,
      httpStatus: tableRes.status,
      origin,
      statusLabel: `Conectado direto ao Supabase (${host})! Tabela ${schema}.lumina_users pronta para receber usuários reais.`,
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
  if (/^data:image\//i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  if (/^data:audio\//i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
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
  const cleanHandle = payload.username.trim().toLowerCase();
  const safeAvatar = compactBrowserMediaUrl(payload.avatarUrl, 220_000);
  const safeCover = compactBrowserMediaUrl(payload.coverUrl, 220_000);

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
    return {
      ok: false,
      error: rawMsg || `Supabase Auth retornou HTTP ${signupRes.status}.`,
    };
  }

  const authUid = signupData.user?.id || signupData.id;
  if (signupData.access_token) {
    setBrowserSupabaseSession({
      accessToken: signupData.access_token,
      authUid,
      email: payload.email.trim().toLowerCase(),
      luminaId: payload.id,
      savedAt: Date.now(),
    });
  }

  let tableSynced = false;
  let lastRestError = '';

  try {
    const hasSessionToken = Boolean(signupData.access_token && authUid);
    const restUrl = hasSessionToken
      ? `${origin}/rest/v1/lumina_users?on_conflict=id`
      : `${origin}/rest/v1/lumina_users`;

    const restRes = await fetch(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey, signupData.access_token),
        'Content-Profile': schema,
        Prefer: hasSessionToken
          ? 'resolution=merge-duplicates,return=representation'
          : 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({
        id: payload.id,
        auth_uid: authUid || null,
        username: cleanHandle,
        display_name: payload.displayName.slice(0, 60),
        email: payload.email.trim().toLowerCase(),
        bio: (payload.bio || '').slice(0, 160),
        avatar_url: safeAvatar,
        cover_url: safeCover,
        verified: false,
        boosted: false,
        restricted: false,
        is_real_user: true,
        auth_source: 'register',
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (restRes.ok) {
      tableSynced = true;
    } else {
      lastRestError = await restRes.text().catch(() => `HTTP ${restRes.status}`);
    }
  } catch {
    // Check below whether auth trigger inserted the row
  }

  if (!tableSynced) {
    try {
      const verifyRes = await fetch(
        `${origin}/rest/v1/lumina_users?select=id,username&username=eq.${encodeURIComponent(cleanHandle)}&limit=1`,
        {
          method: 'GET',
          headers: {
            ...buildBrowserSupabaseHeaders(config.anonKey),
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

  if (!tableSynced && Array.isArray(signupData.user?.identities) && signupData.user.identities.length === 0) {
    return {
      ok: false,
      error: 'Este e-mail já existe no Supabase Auth ou não pôde ser gravado em lumina_users.',
    };
  }

  return {
    ok: true,
    authUid,
    tableSynced,
    needsEmailConfirm: !signupData.access_token,
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
    isDemoSeed?: boolean;
  }>
): Promise<{ attempted: number; inserted: number; failed: number; lastError?: string }> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return { attempted: 0, inserted: 0, failed: 0, lastError: 'Chave pública anon não configurada.' };
  }
  const realUsers = users.filter((u) => !u.isDemoSeed && u.id && u.username);
  if (realUsers.length === 0) {
    return { attempted: 0, inserted: 0, failed: 0 };
  }

  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return {
      attempted: realUsers.length,
      inserted: 0,
      failed: realUsers.length,
      lastError: err instanceof Error ? err.message : 'URL do Supabase inválida.',
    };
  }

  const schema = sanitizeSupabaseSchemaName(config.schemaName);
  let inserted = 0;
  let failed = 0;
  let lastError = '';

  for (const u of realUsers) {
    try {
      const res = await fetch(`${origin}/rest/v1/lumina_users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Content-Profile': schema,
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: u.id,
          auth_uid: u.uid || null,
          username: u.username.trim().toLowerCase(),
          display_name: (u.displayName || u.username).slice(0, 80),
          email: u.email ? u.email.trim().toLowerCase().slice(0, 140) : null,
          bio: (u.bio || 'Novo usuário real na Lumina.').slice(0, 160),
          avatar_url: compactBrowserMediaUrl(u.avatarUrl, 220_000),
          cover_url: compactBrowserMediaUrl(u.coverUrl, 220_000),
          verified: false,
          boosted: false,
          restricted: false,
          is_real_user: true,
          auth_source: 'admin-sync',
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        inserted += 1;
      } else {
        failed += 1;
        lastError = await res.text().catch(() => `HTTP ${res.status}`);
      }
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : 'Erro de rede';
    }
  }

  return {
    attempted: realUsers.length,
    inserted,
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
    if (!res.ok) return { ok: false };
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

    // Look up canonical lumina_users row by auth_uid or lumina_id
    let rowProfile: UserProfile | null = null;
    if (authUid) {
      const queries = [
        `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_EXTENDED}&auth_uid=eq.${encodeURIComponent(authUid)}&limit=1`,
        `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&auth_uid=eq.${encodeURIComponent(authUid)}&limit=1`,
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

    const resolvedId = rowProfile?.id || meta?.lumina_id || authUid || `sb_${Date.now()}`;
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
      username:
        rowProfile?.username ||
        meta?.username ||
        cleanEmail.split('@')[0].replace(/[^a-z0-9._]/g, '').slice(0, 24),
      displayName: rowProfile?.displayName || meta?.display_name || meta?.username,
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
    isOnline: false,
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
      `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_EXTENDED}&is_real_user=eq.true&order=created_at.desc&limit=250`,
      `${origin}/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&is_real_user=eq.true&order=created_at.desc&limit=250`,
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        return rows.map(mapBrowserSupabaseUserRow).filter((u) => Boolean(u.id && u.username));
      }
      if (res.status !== 400) break;
    }
    return [];
  } catch {
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
              ...buildBrowserSupabaseHeaders(config.anonKey),
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
  authorIdFilter?: string
): Promise<Post[]> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const authorClause = authorIdFilter
      ? `&author_id=eq.${encodeURIComponent(authorIdFilter)}`
      : '';
    const urls = [
      `${origin}/rest/v1/lumina_posts?select=${SELECT_POSTS_EXTENDED}${authorClause}&order=created_at.desc&limit=150`,
      `${origin}/rest/v1/lumina_posts?select=${SELECT_POSTS_CORE}${authorClause}&order=created_at.desc&limit=150`,
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
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
  authorIdFilter?: string
): Promise<StoryItem[]> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const authorClause = authorIdFilter
      ? `&author_id=eq.${encodeURIComponent(authorIdFilter)}`
      : '';
    const res = await fetch(
      `${origin}/rest/v1/lumina_stories?select=${SELECT_STORIES}&created_at=gte.${encodeURIComponent(sinceIso)}${authorClause}&order=created_at.desc&limit=100`,
      {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.map(mapBrowserSupabaseStoryRow).filter((s): s is StoryItem => s !== null);
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
    const res = await fetch(`${origin}/rest/v1/lumina_stories?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey),
        'Content-Profile': schema,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
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
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
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
    const res = await fetch(
      `${origin}/rest/v1/lumina_messages?select=${SELECT_MESSAGES}&${orFilter}&order=created_at.asc&limit=300`,
      {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return [];

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
        reaction: typeof r.reaction === 'string' ? r.reaction : undefined,
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
    const res = await fetch(`${origin}/rest/v1/lumina_messages?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBrowserSupabaseHeaders(config.anonKey),
        'Content-Profile': schema,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
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
        reaction: m.reaction || null,
        read_by: [payload.senderId],
        created_at: new Date(m.createdAt || Date.now()).toISOString(),
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function reactToDirectMessageInSupabaseBrowser(
  config: BrowserSupabaseConfig,
  messageId: string,
  reaction: string | undefined
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
        body: JSON.stringify({ reaction: reaction || null }),
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
