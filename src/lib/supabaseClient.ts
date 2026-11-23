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
        storedSchema = (parsed.supabase.schemaName || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
        const candidateKey = (parsed.supabase.anonKey || '').trim();
        if (candidateKey && !isServiceRoleOrSecretKey(candidateKey)) {
          storedAnonKey = candidateKey;
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

  return {
    projectUrl: storedUrl || envUrl || DEFAULT_SUPABASE_URL,
    schemaName: storedSchema || 'public',
    anonKey: storedAnonKey || safeEnvAnon,
    autoSyncUsers,
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
  const schema = (params.schemaName || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
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
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
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
): Promise<{ ok: boolean; authUid?: string; tableSynced?: boolean; error?: string }> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) {
    return { ok: false, error: 'Chave pública anon do Supabase não configurada.' };
  }

  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'URL do Supabase inválida.' };
  }

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
        username: payload.username.toLowerCase(),
        display_name: payload.displayName.slice(0, 60),
        bio: (payload.bio || '').slice(0, 160),
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const signupData = (await signupRes.json().catch(() => ({}))) as {
    id?: string;
    access_token?: string;
    user?: { id?: string };
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

  if (signupData.access_token && authUid) {
    try {
      const schema = config.schemaName.replace(/[^a-zA-Z0-9_]/g, '') || 'public';
      const safeAvatar =
        payload.avatarUrl && /^https?:\/\//i.test(payload.avatarUrl) ? payload.avatarUrl : null;
      const safeCover =
        payload.coverUrl && /^https?:\/\//i.test(payload.coverUrl) ? payload.coverUrl : null;

      const restRes = await fetch(`${origin}/rest/v1/lumina_users?on_conflict=id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.anonKey,
          Authorization: `Bearer ${signupData.access_token}`,
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: payload.id,
          auth_uid: authUid,
          username: payload.username.toLowerCase(),
          display_name: payload.displayName.slice(0, 60),
          email: payload.email.trim().toLowerCase(),
          bio: (payload.bio || '').slice(0, 160),
          avatar_url: safeAvatar,
          cover_url: safeCover,
          is_real_user: true,
          auth_source: 'register',
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(6000),
      });
      tableSynced = restRes.ok;
    } catch {
      // Trigger on auth.users handles fallback insert if direct REST fails
    }
  }

  return { ok: true, authUid, tableSynced };
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

export async function fetchPublicUsersFromSupabaseBrowser(
  config: BrowserSupabaseConfig
): Promise<Array<Record<string, unknown>>> {
  if (!config.anonKey || isServiceRoleOrSecretKey(config.anonKey)) return [];
  try {
    const origin = normalizeSupabaseOrigin(config.projectUrl);
    const schema = config.schemaName.replace(/[^a-zA-Z0-9_]/g, '') || 'public';
    const res = await fetch(
      `${origin}/rest/v1/lumina_users?select=id,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at&is_real_user=eq.true&order=created_at.desc&limit=200`,
      {
        method: 'GET',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      id: String(r.id || ''),
      username: String(r.username || ''),
      displayName: String(r.display_name || r.username || ''),
      bio: String(r.bio || ''),
      avatarUrl: typeof r.avatar_url === 'string' && r.avatar_url ? r.avatar_url : undefined,
      coverUrl: typeof r.cover_url === 'string' && r.cover_url ? r.cover_url : undefined,
      verified: Boolean(r.verified),
      boosted: Boolean(r.boosted),
      restricted: Boolean(r.restricted),
      isOnline: false,
      isDemoSeed: false,
      followers: [],
      following: [],
    }));
  } catch {
    return [];
  }
}
