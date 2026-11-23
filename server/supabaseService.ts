import dns from 'node:dns/promises';
import net from 'node:net';

export const DEFAULT_SUPABASE_URL = 'https://jpllpvfunpsqexnvjgdt.supabase.co';

export interface SupabaseRuntimeConfig {
  projectUrl: string;
  schemaName: string;
  anonKey?: string;
  autoSyncUsers: boolean;
  autoSyncPosts: boolean;
  rlsEnforced: boolean;
}

export function isSecretSupabaseKey(rawKey?: string): boolean {
  const key = (rawKey || '').trim();
  if (!key) return false;
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        role?: string;
      };
      if (payload?.role && payload.role.toLowerCase() === 'service_role') {
        return true;
      }
    } catch {
      // Ignore malformed JWT inspection
    }
  }
  return false;
}

export interface SupabaseUserSyncPayload {
  id: string;
  authUid?: string;
  username: string;
  displayName: string;
  email?: string;
  password?: string;
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string;
  verified?: boolean;
  boosted?: boolean;
  restricted?: boolean;
  source: 'register' | 'invite' | 'google' | 'admin-sync';
}

export interface SupabasePostSyncPayload {
  id: string;
  authorId: string;
  caption?: string;
  location?: string;
  category: string;
  aspectRatio?: string;
  isReel?: boolean;
  mediaUrls: string[];
  createdAt: number;
}

export interface SupabaseSyncResult {
  synced: boolean;
  authCreated?: boolean;
  missingKeys?: boolean;
  tableMissing?: boolean;
  httpStatus?: number;
  message: string;
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

export async function resolveValidatedSupabaseOrigin(rawUrl?: string): Promise<string> {
  const candidate = (rawUrl || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('URL do projeto Supabase inválida.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('A URL do Supabase deve usar HTTPS.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Hosts internos não são permitidos para conexão Supabase.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrBlockedIp(host)) {
      throw new Error('Endereços IP privados não são permitidos.');
    }
  } else {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0 || records.some((r) => isPrivateOrBlockedIp(r.address))) {
      throw new Error('Domínio Supabase inválido ou resolvido para rede privada.');
    }
  }

  return parsed.origin;
}

function getSupabaseKeys(fallbackPublicAnonKey?: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const envAnonKey = process.env.SUPABASE_ANON_KEY?.trim() || '';
  const safeFallbackAnon =
    fallbackPublicAnonKey && !isSecretSupabaseKey(fallbackPublicAnonKey)
      ? fallbackPublicAnonKey.trim()
      : '';
  const anonKey = envAnonKey || safeFallbackAnon;
  const activeKey = serviceRoleKey || anonKey;
  return {
    serviceRoleKey,
    anonKey,
    activeKey,
    hasKeys: Boolean(activeKey),
    hasServiceRole: Boolean(serviceRoleKey),
  };
}

function isJwtLike(token?: string): boolean {
  const parts = (token || '').trim().split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function buildSupabaseHeaders(
  apiKey?: string,
  bearerOverride?: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cleanKey = (apiKey || '').trim();
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

function sanitizeSchemaName(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (
    !trimmed ||
    /^sb_(publishable|secret)_/i.test(trimmed) ||
    /^eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/.test(trimmed) ||
    trimmed.length > 32
  ) {
    return 'public';
  }
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  if (!cleaned || !/^[a-z_][a-z0-9_]*$/.test(cleaned)) {
    return 'public';
  }
  return cleaned;
}

function compactAssetForDb(url?: string): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 600);
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return trimmed.slice(0, 300);
  if (/^data:image\//i.test(trimmed) && trimmed.length <= 250_000) return trimmed;
  return null;
}

export async function testSupabaseConnection(
  rawProjectUrl?: string,
  rawSchemaName?: string,
  fallbackPublicAnonKey?: string
): Promise<{
  reachable: boolean;
  httpStatus: number;
  tablesReady: boolean;
  hasKeys: boolean;
  hasServiceRole: boolean;
  origin: string;
  statusLabel: string;
}> {
  const origin = await resolveValidatedSupabaseOrigin(rawProjectUrl);
  const schema = sanitizeSchemaName(rawSchemaName);
  const keys = getSupabaseKeys(fallbackPublicAnonKey);

  const headers = buildSupabaseHeaders(keys.activeKey);

  const rootRes = await fetch(new URL('/rest/v1/', origin).toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(6000),
  });

  if (!keys.hasKeys) {
    return {
      reachable: rootRes.status < 500,
      httpStatus: rootRes.status,
      tablesReady: false,
      hasKeys: false,
      hasServiceRole: false,
      origin,
      statusLabel: `Supabase alcançado em ${new URL(origin).hostname} (HTTP ${rootRes.status}). Cole sua Chave Pública (anon / publishable) ou configure SUPABASE_SERVICE_ROLE_KEY para gravar usuários reais.`,
    };
  }

  const tableRes = await fetch(
    new URL('/rest/v1/lumina_users?select=id&limit=1', origin).toString(),
    {
      method: 'GET',
      headers: {
        ...headers,
        'Accept-Profile': schema,
      },
      signal: AbortSignal.timeout(6000),
    }
  );

  const tablesReady = tableRes.ok;
  let statusLabel = '';
  if (tablesReady) {
    statusLabel = `Conectado ao banco ${new URL(origin).hostname} (tabela ${schema}.lumina_users pronta para usuários reais)`;
  } else if (tableRes.status === 404 || tableRes.status === 400) {
    statusLabel = `Conectado ao Supabase (${new URL(origin).hostname}), mas a tabela ${schema}.lumina_users ainda não existe — baixe e execute o SQL no SQL Editor do Supabase.`;
  } else if (tableRes.status === 401 || tableRes.status === 403) {
    statusLabel = `Supabase respondeu HTTP ${tableRes.status} — verifique SUPABASE_SERVICE_ROLE_KEY ou as políticas RLS de ${schema}.lumina_users.`;
  } else {
    statusLabel = `Supabase respondeu HTTP ${tableRes.status} em ${new URL(origin).hostname}`;
  }

  return {
    reachable: rootRes.status < 500,
    httpStatus: tableRes.status,
    tablesReady,
    hasKeys: keys.hasKeys,
    hasServiceRole: keys.hasServiceRole,
    origin,
    statusLabel,
  };
}

export async function registerOrSyncUserToSupabase(
  config: SupabaseRuntimeConfig,
  user: SupabaseUserSyncPayload
): Promise<SupabaseSyncResult> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) {
    return {
      synced: false,
      missingKeys: true,
      message:
        'Projeto Supabase configurado, mas SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY ainda não está definida nos Segredos do servidor.',
    };
  }

  let origin: string;
  try {
    origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return {
      synced: false,
      message: err instanceof Error ? err.message : 'URL do Supabase inválida.',
    };
  }

  const schema = sanitizeSchemaName(config.schemaName);
  let resolvedAuthUid = user.authUid || null;
  let authCreated = false;
  let authJwtForPostgrest = isJwtLike(keys.activeKey) ? keys.activeKey : '';

  // 1. Create / register credential in Supabase Auth when email + password are present
  if (user.email && user.password) {
    try {
      if (keys.serviceRoleKey) {
        const authRes = await fetch(new URL('/auth/v1/admin/users', origin).toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildSupabaseHeaders(keys.serviceRoleKey),
          },
          body: JSON.stringify({
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: {
              lumina_id: user.id,
              username: user.username,
              display_name: user.displayName,
            },
          }),
          signal: AbortSignal.timeout(7000),
        });
        if (authRes.ok) {
          const authData = (await authRes.json()) as { id?: string; user?: { id?: string } };
          resolvedAuthUid = authData.id || authData.user?.id || resolvedAuthUid;
          authCreated = true;
        }
      } else if (keys.anonKey) {
        const signupRes = await fetch(new URL('/auth/v1/signup', origin).toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: keys.anonKey,
          },
          body: JSON.stringify({
            email: user.email,
            password: user.password,
            data: {
              lumina_id: user.id,
              username: user.username,
              display_name: user.displayName,
            },
          }),
          signal: AbortSignal.timeout(7000),
        });
        if (signupRes.ok) {
          const signupData = (await signupRes.json()) as {
            access_token?: string;
            id?: string;
            user?: { id?: string };
          };
          resolvedAuthUid = signupData.user?.id || signupData.id || resolvedAuthUid;
          if (signupData.access_token) {
            authJwtForPostgrest = signupData.access_token;
          }
          authCreated = true;
        }
      }
    } catch {
      // Non-fatal: continue to lumina_users table upsert
    }
  }

  // 2. Upsert user profile record into lumina_users table via PostgREST
  const row = {
    id: user.id,
    auth_uid: resolvedAuthUid,
    username: user.username.toLowerCase(),
    display_name: user.displayName.slice(0, 80),
    email: user.email ? user.email.toLowerCase().slice(0, 140) : null,
    bio: (user.bio || '').slice(0, 160),
    avatar_url: compactAssetForDb(user.avatarUrl),
    cover_url: compactAssetForDb(user.coverUrl),
    verified: Boolean(user.verified),
    boosted: Boolean(user.boosted),
    restricted: Boolean(user.restricted),
    is_real_user: true,
    auth_source: user.source,
    updated_at: new Date().toISOString(),
  };

  try {
    const restRes = await fetch(
      new URL('/rest/v1/lumina_users?on_conflict=id', origin).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey, authJwtForPostgrest),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(7000),
      }
    );

    if (restRes.ok) {
      return {
        synced: true,
        authCreated,
        httpStatus: restRes.status,
        message: `Usuário @${user.username} gravado no Supabase (${schema}.lumina_users).`,
      };
    }

    const errText = await restRes.text().catch(() => '');
    const tableMissing =
      restRes.status === 404 ||
      /relation .*lumina_users.* does not exist|PGRST205|Could not find the table/i.test(errText);

    return {
      synced: false,
      authCreated,
      tableMissing,
      httpStatus: restRes.status,
      message: tableMissing
        ? `Execute o script SQL no SQL Editor do Supabase para criar a tabela ${schema}.lumina_users.`
        : `Supabase retornou HTTP ${restRes.status} ao gravar usuário.`,
    };
  } catch (err) {
    return {
      synced: false,
      authCreated,
      message: err instanceof Error ? err.message : 'Falha de rede ao sincronizar com Supabase.',
    };
  }
}

export async function verifySupabasePasswordLogin(
  rawProjectUrl: string,
  email: string,
  password: string,
  fallbackPublicAnonKey?: string
): Promise<{ ok: boolean; authUid?: string; username?: string; displayName?: string }> {
  const keys = getSupabaseKeys(fallbackPublicAnonKey);
  const apiKey = keys.anonKey || keys.serviceRoleKey;
  if (!apiKey || !email.includes('@')) return { ok: false };

  let origin: string;
  try {
    origin = await resolveValidatedSupabaseOrigin(rawProjectUrl);
  } catch {
    return { ok: false };
  }

  try {
    const res = await fetch(new URL('/auth/v1/token?grant_type=password', origin).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      user?: {
        id?: string;
        user_metadata?: { username?: string; display_name?: string };
      };
    };
    return {
      ok: true,
      authUid: data.user?.id,
      username: data.user?.user_metadata?.username,
      displayName: data.user?.user_metadata?.display_name,
    };
  } catch {
    return { ok: false };
  }
}

export async function upsertPostToSupabase(
  config: SupabaseRuntimeConfig,
  post: SupabasePostSyncPayload
): Promise<SupabaseSyncResult> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) {
    return {
      synced: false,
      missingKeys: true,
      message: 'Chaves Supabase não configuradas no servidor.',
    };
  }

  let origin: string;
  try {
    origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
  } catch (err) {
    return {
      synced: false,
      message: err instanceof Error ? err.message : 'URL do Supabase inválida.',
    };
  }

  const schema = sanitizeSchemaName(config.schemaName);
  const row = {
    id: post.id,
    author_id: post.authorId,
    caption: (post.caption || '').slice(0, 1200),
    location: post.location ? post.location.slice(0, 120) : null,
    category: post.category || 'Fotografia',
    aspect_ratio: post.aspectRatio || '4:5',
    is_reel: Boolean(post.isReel),
    media_urls: post.mediaUrls.filter((u) => /^https?:\/\//i.test(u) || u.startsWith('/')).slice(0, 10),
    created_at: new Date(post.createdAt || Date.now()).toISOString(),
  };

  try {
    const restRes = await fetch(
      new URL('/rest/v1/lumina_posts?on_conflict=id', origin).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (restRes.ok) {
      return {
        synced: true,
        httpStatus: restRes.status,
        message: 'Publicação sincronizada no Supabase.',
      };
    }
    return {
      synced: false,
      httpStatus: restRes.status,
      message: `HTTP ${restRes.status} ao sincronizar post no Supabase.`,
    };
  } catch (err) {
    return {
      synced: false,
      message: err instanceof Error ? err.message : 'Erro ao sincronizar post no Supabase.',
    };
  }
}

export async function fetchPublicRealUsersFromSupabase(
  config: SupabaseRuntimeConfig
): Promise<Array<Record<string, unknown>>> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) return [];

  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const res = await fetch(
      new URL(
        '/rest/v1/lumina_users?select=id,username,display_name,bio,avatar_url,cover_url,verified,boosted,restricted,created_at&is_real_user=eq.true&order=created_at.desc&limit=200',
        origin
      ).toString(),
      {
        method: 'GET',
        headers: {
          ...buildSupabaseHeaders(keys.activeKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
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
