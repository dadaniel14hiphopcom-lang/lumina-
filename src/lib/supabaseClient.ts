export const DEFAULT_SUPABASE_URL = 'https://jpllpvfunpsqexnvjgdt.supabase.co';
const ADMIN_LOCAL_STATE_KEY = 'lumina_admin_local_state_v1';

export interface BrowserSupabaseConfig {
  projectUrl: string;
  schemaName: string;
  anonKey: string;
  autoSyncUsers: boolean;
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

function buildBrowserSupabaseHeaders(
  anonKey: string,
  bearerOverride?: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cleanKey = anonKey.trim();
  if (cleanKey) {
    headers.apikey = cleanKey;
    const effectiveBearer =
      (bearerOverride || '').trim() || (isJwtLike(cleanKey) ? cleanKey : '');
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
          // Auto-heal if the user accidentally pasted their publishable/anon key into Schema PostgreSQL
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

function compactBrowserMediaUrl(raw?: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 600);
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return trimmed.slice(0, 300);
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
  const safeAvatar = compactBrowserMediaUrl(payload.avatarUrl);
  const safeCover = compactBrowserMediaUrl(payload.coverUrl);

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
        ...(safeAvatar ? { avatar_url: safeAvatar } : {}),
        ...(safeCover ? { cover_url: safeCover } : {}),
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const signupData = (await signupRes.json().catch(() => ({}))) as {
    id?: string;
    access_token?: string;
    user?: { id?: string; identities?: unknown[] };
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
  let tableSynced = false;
  let lastRestError = '';

  // Always attempt inserting into lumina_users (works with JWT OR with validated anon insert policy)
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
          avatar_url: compactBrowserMediaUrl(u.avatarUrl),
          cover_url: compactBrowserMediaUrl(u.coverUrl),
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
): Promise<{ ok: boolean; userId?: string; username?: string; displayName?: string; email?: string }> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey) || !email.includes('@')) {
    return { ok: false };
  }

  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
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
      user?: {
        id?: string;
        email?: string;
        user_metadata?: { lumina_id?: string; username?: string; display_name?: string };
      };
    };
    const meta = data.user?.user_metadata;
    const cleanEmail = (data.user?.email || email).trim().toLowerCase();
    return {
      ok: true,
      userId: meta?.lumina_id || data.user?.id || `sb_${Date.now()}`,
      username:
        meta?.username ||
        cleanEmail.split('@')[0].replace(/[^a-z0-9._]/g, '').slice(0, 24),
      displayName: meta?.display_name || meta?.username,
      email: cleanEmail,
    };
  } catch {
    return { ok: false };
  }
}

function mapBrowserSupabaseUserRow(r: Record<string, unknown>): Record<string, unknown> {
  const username = String(r.username || '');
  return {
    id: String(r.id || ''),
    uid: typeof r.auth_uid === 'string' && r.auth_uid ? r.auth_uid : undefined,
    username,
    displayName: String(r.display_name || username || ''),
    bio: String(r.bio || 'Novo usuário real na Lumina.'),
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
    followers: [],
    following: [],
  };
}

export async function fetchPublicUsersFromSupabaseBrowser(
  config: BrowserSupabaseConfig
): Promise<Array<Record<string, unknown>>> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(
      `${origin}/rest/v1/lumina_users?select=id,auth_uid,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at&is_real_user=eq.true&order=created_at.desc&limit=200`,
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
    if (!Array.isArray(rows)) return [];
    return rows.map(mapBrowserSupabaseUserRow).filter((u) => Boolean(u.id && u.username));
  } catch {
    return [];
  }
}

export async function fetchPublicUserByUsernameFromSupabaseBrowser(
  config: BrowserSupabaseConfig,
  rawUsername: string
): Promise<Record<string, unknown> | null> {
  const cleanHandle = rawUsername.trim().toLowerCase().replace(/^@/, '');
  if (!cleanHandle || !config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return null;
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSupabaseSchemaName(config.schemaName);
    const res = await fetch(
      `${origin}/rest/v1/lumina_users?select=id,auth_uid,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
      {
        method: 'GET',
        headers: {
          ...buildBrowserSupabaseHeaders(config.anonKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const mapped = mapBrowserSupabaseUserRow(rows[0]);
    return mapped.id && mapped.username ? mapped : null;
  } catch {
    return null;
  }
}
