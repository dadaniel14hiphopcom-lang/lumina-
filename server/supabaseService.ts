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
  website?: string;
  avatarUrl?: string;
  coverUrl?: string;
  verified?: boolean;
  boosted?: boolean;
  restricted?: boolean;
  followers?: string[];
  following?: string[];
  source: 'register' | 'invite' | 'google' | 'admin-sync';
}

export interface SupabasePostSyncPayload {
  id: string;
  authorId: string;
  authorUid?: string;
  caption?: string;
  location?: string;
  category: string;
  aspectRatio?: string;
  isReel?: boolean;
  audioTrack?: string;
  mediaUrls: string[];
  mediaAssets?: Array<{
    id?: string;
    url: string;
    alt?: string;
    filterCss?: string;
    mediaType?: 'image' | 'video';
    durationSec?: number;
  }>;
  likes?: string[];
  savedBy?: string[];
  comments?: unknown[];
  createdAt: number;
}

export interface SupabaseStorySyncPayload {
  id: string;
  authorId: string;
  authorUid?: string;
  mediaUrl: string;
  caption?: string;
  location?: string;
  viewedBy?: string[];
  reactions?: Array<{ userId: string; emoji: string }>;
  createdAt: number;
}

export interface SupabaseMessageSyncPayload {
  id: string;
  threadId: string;
  senderId: string;
  recipientId: string;
  text: string;
  sharedPostId?: string;
  storyReplyUrl?: string;
  audioUrl?: string;
  audioDurationSec?: number;
  videoUrl?: string;
  videoName?: string;
  reaction?: string;
  readBy?: string[];
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

function compactAssetForDb(url?: string, maxDataLen = 280_000): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 1000);
  if (/^\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/.test(trimmed)) return trimmed.slice(0, 300);
  if (/^data:image\//i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  if (/^data:audio\//i.test(trimmed) && trimmed.length <= maxDataLen) return trimmed;
  return null;
}

function parseStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
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
  let schemaOutdated = false;
  if (tablesReady) {
    try {
      const schemaProbe = await fetch(
        new URL('/rest/v1/lumina_users?select=id,is_real_user,followers,following,website&limit=1', origin).toString(),
        {
          method: 'GET',
          headers: {
            ...headers,
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (schemaProbe.status === 400) {
        schemaOutdated = true;
      }
    } catch {
      // Non-fatal schema probe
    }
  }

  let statusLabel = '';
  if (tablesReady && schemaOutdated) {
    statusLabel = `Conectado ao Supabase (${new URL(origin).hostname}), mas a tabela ${schema}.lumina_users está com colunas antigas — clique em "Copiar SQL" e execute novamente no SQL Editor.`;
  } else if (tablesReady) {
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

  const safeMetaAvatar = compactAssetForDb(user.avatarUrl, 220_000);
  const safeMetaCover = compactAssetForDb(user.coverUrl, 220_000);

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
              username: user.username.toLowerCase(),
              display_name: user.displayName,
              bio: (user.bio || '').slice(0, 160),
              ...(safeMetaAvatar && safeMetaAvatar.length <= 2048 ? { avatar_url: safeMetaAvatar } : {}),
              ...(safeMetaCover && safeMetaCover.length <= 2048 ? { cover_url: safeMetaCover } : {}),
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
              username: user.username.toLowerCase(),
              display_name: user.displayName,
              bio: (user.bio || '').slice(0, 160),
              ...(safeMetaAvatar && safeMetaAvatar.length <= 2048 ? { avatar_url: safeMetaAvatar } : {}),
              ...(safeMetaCover && safeMetaCover.length <= 2048 ? { cover_url: safeMetaCover } : {}),
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

  const cleanHandle = user.username.trim().toLowerCase().replace(/^@/, '');
  const nowIso = new Date().toISOString();
  const baseAnonRow: Record<string, unknown> = {
    id: user.id,
    auth_uid: resolvedAuthUid,
    username: cleanHandle,
    display_name: (user.displayName || cleanHandle).slice(0, 80),
    email: user.email ? user.email.toLowerCase().slice(0, 140) : null,
    bio: (user.bio || '').slice(0, 220),
    avatar_url: safeMetaAvatar,
    cover_url: safeMetaCover,
    is_real_user: true,
    auth_source: user.source,
    updated_at: nowIso,
  };

  const extendedAnonRow: Record<string, unknown> = {
    ...baseAnonRow,
    ...(typeof user.website === 'string' ? { website: user.website.slice(0, 200) } : {}),
    ...(Array.isArray(user.followers) ? { followers: user.followers.slice(0, 2000) } : {}),
    ...(Array.isArray(user.following) ? { following: user.following.slice(0, 2000) } : {}),
  };

  const canServiceMerge = Boolean(keys.serviceRoleKey);
  const effectiveKey = keys.serviceRoleKey || keys.activeKey;

  const tryPostRow = async (rowBody: Record<string, unknown>) => {
    const bodyToSend = canServiceMerge
      ? {
          ...rowBody,
          verified: Boolean(user.verified),
          boosted: Boolean(user.boosted),
          restricted: Boolean(user.restricted),
        }
      : rowBody;
    const restUrl = canServiceMerge
      ? new URL('/rest/v1/lumina_users?on_conflict=id', origin).toString()
      : new URL('/rest/v1/lumina_users', origin).toString();
    return fetch(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildSupabaseHeaders(effectiveKey, authJwtForPostgrest),
        'Content-Profile': schema,
        Prefer: canServiceMerge
          ? 'resolution=merge-duplicates,return=representation'
          : 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(bodyToSend),
      signal: AbortSignal.timeout(7000),
    });
  };

  const patchExistingAnonRow = async (filterQuery: string): Promise<boolean> => {
    const patchFull: Record<string, unknown> = {
      display_name: (user.displayName || cleanHandle).slice(0, 80),
      bio: (user.bio || '').slice(0, 220),
      avatar_url: safeMetaAvatar,
      cover_url: safeMetaCover,
      updated_at: nowIso,
    };
    if (typeof user.website === 'string') patchFull.website = user.website.slice(0, 200);
    if (Array.isArray(user.followers)) patchFull.followers = user.followers.slice(0, 2000);
    if (Array.isArray(user.following)) patchFull.following = user.following.slice(0, 2000);

    let pRes = await fetch(new URL(`/rest/v1/lumina_users?${filterQuery}`, origin).toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...buildSupabaseHeaders(effectiveKey, authJwtForPostgrest),
        'Content-Profile': schema,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patchFull),
      signal: AbortSignal.timeout(6000),
    });
    if (pRes.status === 400) {
      const pCore = { ...patchFull };
      delete pCore.website;
      delete pCore.followers;
      delete pCore.following;
      pRes = await fetch(new URL(`/rest/v1/lumina_users?${filterQuery}`, origin).toString(), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(effectiveKey, authJwtForPostgrest),
          'Content-Profile': schema,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(pCore),
        signal: AbortSignal.timeout(6000),
      });
    }
    return pRes.ok;
  };

  try {
    let restRes = await tryPostRow(extendedAnonRow);
    if (restRes.status === 400) {
      restRes = await tryPostRow(baseAnonRow);
    }

    if (restRes.ok) {
      const createdRows = (await restRes.json().catch(() => [])) as Array<{ id?: string }>;
      if (Array.isArray(createdRows) && createdRows.length === 0 && !canServiceMerge) {
        await patchExistingAnonRow(`id=eq.${encodeURIComponent(user.id)}`).catch(() => false);
      }
      return {
        synced: true,
        authCreated,
        httpStatus: restRes.status,
        message: `Usuário @${cleanHandle} gravado no Supabase (${schema}.lumina_users).`,
      };
    }

    const errText = await restRes.text().catch(() => '');

    try {
      const checkRes = await fetch(
        new URL(
          `/rest/v1/lumina_users?select=id,username&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
          origin
        ).toString(),
        {
          method: 'GET',
          headers: {
            ...buildSupabaseHeaders(effectiveKey),
            'Accept-Profile': schema,
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (checkRes.ok) {
        const rows = (await checkRes.json()) as Array<{ id?: string; username?: string }>;
        if (Array.isArray(rows) && rows.length > 0 && rows[0].id) {
          await patchExistingAnonRow(`id=eq.${encodeURIComponent(rows[0].id)}`).catch(() => false);
          return {
            synced: true,
            authCreated,
            httpStatus: checkRes.status,
            message: `Usuário @${cleanHandle} sincronizado no Supabase (${schema}.lumina_users).`,
          };
        }
      }
    } catch {
      // Fall through to error return
    }

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
        : `Supabase retornou HTTP ${restRes.status} ao gravar usuário${errText ? `: ${errText.slice(0, 140)}` : '.'}`,
    };
  } catch (err) {
    return {
      synced: false,
      authCreated,
      message: err instanceof Error ? err.message : 'Falha de rede ao sincronizar com Supabase.',
    };
  }
}

export async function updateUserInSupabase(
  config: SupabaseRuntimeConfig,
  userId: string,
  patch: Partial<{
    displayName: string;
    username: string;
    bio: string;
    website: string;
    avatarUrl: string;
    coverUrl: string;
    verified: boolean;
    boosted: boolean;
    restricted: boolean;
    followers: string[];
    following: string[];
  }>
): Promise<boolean> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys || !userId) return false;
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const fullBody: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof patch.displayName === 'string') fullBody.display_name = patch.displayName.slice(0, 80);
    if (typeof patch.username === 'string' && patch.username.trim().length >= 3) {
      fullBody.username = patch.username.trim().toLowerCase().slice(0, 32);
    }
    if (typeof patch.bio === 'string') fullBody.bio = patch.bio.slice(0, 220);
    if (typeof patch.website === 'string') fullBody.website = patch.website.slice(0, 200);
    if (typeof patch.avatarUrl === 'string') {
      const safe = compactAssetForDb(patch.avatarUrl, 220_000);
      if (safe) fullBody.avatar_url = safe;
    }
    if (typeof patch.coverUrl === 'string') {
      const safe = compactAssetForDb(patch.coverUrl, 220_000);
      if (safe) fullBody.cover_url = safe;
    }
    // Only send admin/moderation flags if server holds service_role key
    if (keys.hasServiceRole) {
      if (typeof patch.verified === 'boolean') fullBody.verified = patch.verified;
      if (typeof patch.boosted === 'boolean') fullBody.boosted = patch.boosted;
      if (typeof patch.restricted === 'boolean') fullBody.restricted = patch.restricted;
    }
    if (Array.isArray(patch.followers)) fullBody.followers = patch.followers.slice(0, 2000);
    if (Array.isArray(patch.following)) fullBody.following = patch.following.slice(0, 2000);

    const res = await fetch(
      new URL(`/rest/v1/lumina_users?id=eq.${encodeURIComponent(userId)}`, origin).toString(),
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey),
          'Content-Profile': schema,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(fullBody),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) return true;
    if (res.status === 400) {
      const coreBody = { ...fullBody };
      delete coreBody.website;
      delete coreBody.followers;
      delete coreBody.following;
      const retry = await fetch(
        new URL(`/rest/v1/lumina_users?id=eq.${encodeURIComponent(userId)}`, origin).toString(),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...buildSupabaseHeaders(keys.activeKey),
            'Content-Profile': schema,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(coreBody),
          signal: AbortSignal.timeout(6000),
        }
      );
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function resolveSupabaseEmailByUsername(
  config: SupabaseRuntimeConfig,
  rawUsername: string
): Promise<string | null> {
  const cleanHandle = rawUsername.trim().toLowerCase().replace(/^@/, '');
  if (!cleanHandle) return null;
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.serviceRoleKey) return null;
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const res = await fetch(
      new URL(
        `/rest/v1/lumina_users?select=email&username=ilike.${encodeURIComponent(cleanHandle)}&limit=1`,
        origin
      ).toString(),
      {
        method: 'GET',
        headers: {
          ...buildSupabaseHeaders(keys.serviceRoleKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ email?: string }>;
    const email = rows?.[0]?.email;
    return typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function verifySupabasePasswordLogin(
  rawProjectUrl: string,
  email: string,
  password: string,
  fallbackPublicAnonKey?: string,
  rawSchemaName = 'public'
): Promise<{
  ok: boolean;
  authUid?: string;
  userId?: string;
  username?: string;
  displayName?: string;
  user?: Record<string, unknown>;
}> {
  const keys = getSupabaseKeys(fallbackPublicAnonKey);
  const apiKey = keys.anonKey || keys.serviceRoleKey;
  if (!apiKey || !email.includes('@')) return { ok: false };

  let origin: string;
  try {
    origin = await resolveValidatedSupabaseOrigin(rawProjectUrl);
  } catch {
    return { ok: false };
  }

  const schema = sanitizeSchemaName(rawSchemaName);

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
      access_token?: string;
      user?: {
        id?: string;
        user_metadata?: { lumina_id?: string; username?: string; display_name?: string };
      };
    };
    const authUid = data.user?.id;
    let mappedUser: Record<string, unknown> | undefined;

    if (authUid) {
      for (const cols of [SELECT_USERS_EXTENDED, SELECT_USERS_CORE]) {
        const rowRes = await fetch(
          new URL(
            `/rest/v1/lumina_users?select=${cols}&auth_uid=eq.${encodeURIComponent(authUid)}&limit=1`,
            origin
          ).toString(),
          {
            method: 'GET',
            headers: {
              ...buildSupabaseHeaders(keys.serviceRoleKey || apiKey, data.access_token),
              'Accept-Profile': schema,
            },
            signal: AbortSignal.timeout(5000),
          }
        ).catch(() => null);
        if (rowRes?.ok) {
          const rows = (await rowRes.json()) as Array<Record<string, unknown>>;
          if (Array.isArray(rows) && rows.length > 0) {
            mappedUser = mapSupabaseUserRow(rows[0]);
            break;
          }
        } else if (rowRes && rowRes.status !== 400) {
          break;
        }
      }
    }

    return {
      ok: true,
      authUid,
      userId: mappedUser ? String(mappedUser.id) : data.user?.user_metadata?.lumina_id || authUid,
      username: mappedUser ? String(mappedUser.username) : data.user?.user_metadata?.username,
      displayName: mappedUser ? String(mappedUser.displayName) : data.user?.user_metadata?.display_name,
      user: mappedUser,
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
  const cleanUrls = post.mediaUrls
    .map((u) => compactAssetForDb(u, 260_000))
    .filter((u): u is string => Boolean(u))
    .slice(0, 10);

  const cleanAssets = (post.mediaAssets || [])
    .map((m) => {
      const url = compactAssetForDb(m.url, 260_000);
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
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 10);

  const coreRow = {
    id: post.id,
    author_id: post.authorId,
    caption: (post.caption || '').slice(0, 1200),
    location: post.location ? post.location.slice(0, 120) : null,
    category: post.category || 'Fotografia',
    aspect_ratio: post.aspectRatio || '4:5',
    is_reel: Boolean(post.isReel),
    media_urls: cleanUrls.length > 0 ? cleanUrls : cleanAssets.map((a) => a.url),
    created_at: new Date(post.createdAt || Date.now()).toISOString(),
  };

  const fullRow = {
    ...coreRow,
    author_uid: post.authorUid || null,
    media_assets: cleanAssets,
    audio_track: post.audioTrack ? post.audioTrack.slice(0, 120) : null,
    likes: Array.isArray(post.likes) ? post.likes.slice(0, 2000) : [],
    saved_by: Array.isArray(post.savedBy) ? post.savedBy.slice(0, 2000) : [],
    comments: Array.isArray(post.comments) ? post.comments.slice(0, 200) : [],
  };

  try {
    let restRes = await fetch(
      new URL('/rest/v1/lumina_posts?on_conflict=id', origin).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(fullRow),
        signal: AbortSignal.timeout(7000),
      }
    );

    if (restRes.status === 400) {
      restRes = await fetch(
        new URL('/rest/v1/lumina_posts?on_conflict=id', origin).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildSupabaseHeaders(keys.activeKey),
            'Content-Profile': schema,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(coreRow),
          signal: AbortSignal.timeout(6000),
        }
      );
    }

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

export async function deletePostFromSupabase(
  config: SupabaseRuntimeConfig,
  postId: string
): Promise<boolean> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys || !postId) return false;
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const res = await fetch(
      new URL(`/rest/v1/lumina_posts?id=eq.${encodeURIComponent(postId)}`, origin).toString(),
      {
        method: 'DELETE',
        headers: {
          ...buildSupabaseHeaders(keys.activeKey),
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

function mapSupabaseUserRow(r: Record<string, unknown>): Record<string, unknown> {
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

function mapSupabasePostRow(r: Record<string, unknown>): Record<string, unknown> | null {
  const id = String(r.id || '').trim();
  const authorId = String(r.author_id || '').trim();
  if (!id || !authorId) return null;

  const rawAssets = Array.isArray(r.media_assets) ? (r.media_assets as Array<Record<string, unknown>>) : [];
  const rawUrls = Array.isArray(r.media_urls) ? (r.media_urls as unknown[]) : [];
  const caption = String(r.caption || '');

  const media =
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
          .map((u, idx) => ({
            id: `m_${id}_${idx}`,
            url: u.trim(),
            alt: caption.slice(0, 80) || 'Publicação na Lumina',
            mediaType:
              /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(u) || /^data:video\//i.test(u)
                ? 'video'
                : 'image',
          }));

  if (media.length === 0) return null;

  const createdAt =
    typeof r.created_at === 'string'
      ? Date.parse(r.created_at) || Date.now()
      : typeof r.created_at === 'number'
      ? r.created_at
      : Date.now();

  return {
    id,
    authorId,
    authorUid: typeof r.author_uid === 'string' && r.author_uid ? r.author_uid : undefined,
    media,
    caption,
    location: typeof r.location === 'string' && r.location.trim() ? r.location.trim() : undefined,
    category: typeof r.category === 'string' && r.category ? r.category : 'Fotografia',
    aspectRatio: typeof r.aspect_ratio === 'string' && r.aspect_ratio ? r.aspect_ratio : '4:5',
    isReel: Boolean(r.is_reel),
    audioTrack: typeof r.audio_track === 'string' && r.audio_track ? r.audio_track : undefined,
    likes: parseStringArray(r.likes),
    savedBy: parseStringArray(r.saved_by),
    comments: Array.isArray(r.comments) ? r.comments : [],
    createdAt,
  };
}

export async function fetchPublicRealUsersFromSupabase(
  config: SupabaseRuntimeConfig
): Promise<Array<Record<string, unknown>>> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) return [];

  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const queries = [
      `/rest/v1/lumina_users?select=${SELECT_USERS_EXTENDED}&or=(is_real_user.eq.true,is_real_user.is.null)&or=(restricted.eq.false,restricted.is.null)&order=created_at.desc&limit=250`,
      `/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&or=(is_real_user.eq.true,is_real_user.is.null)&or=(restricted.eq.false,restricted.is.null)&order=created_at.desc&limit=250`,
      `/rest/v1/lumina_users?select=${SELECT_USERS_CORE}&order=created_at.desc&limit=250`,
    ];
    for (const qPath of queries) {
      const res = await fetch(new URL(qPath, origin).toString(), {
        method: 'GET',
        headers: {
          ...buildSupabaseHeaders(keys.activeKey),
          'Accept-Profile': schema,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        return rows
          .map(mapSupabaseUserRow)
          .filter((u) => Boolean(u.id && u.username && u.restricted !== true));
      }
      if (res.status !== 400) break;
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchPublicUserByUsernameFromSupabase(
  config: SupabaseRuntimeConfig,
  rawUsername: string
): Promise<Record<string, unknown> | null> {
  const cleanHandle = rawUsername.trim().toLowerCase().replace(/^@/, '');
  const rawTrimmed = rawUsername.trim().replace(/^@/, '');
  if (!cleanHandle) return null;
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) return null;

  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTrimmed);
    const filterClauses = [
      `username=ilike.${encodeURIComponent(cleanHandle)}`,
      `id=eq.${encodeURIComponent(rawTrimmed)}`,
      ...(isUuid ? [`auth_uid=eq.${encodeURIComponent(rawTrimmed)}`] : []),
    ];

    for (const filter of filterClauses) {
      for (const cols of [SELECT_USERS_EXTENDED, SELECT_USERS_CORE]) {
        const res = await fetch(
          new URL(`/rest/v1/lumina_users?select=${cols}&${filter}&limit=1`, origin).toString(),
          {
            method: 'GET',
            headers: {
              ...buildSupabaseHeaders(keys.activeKey),
              'Accept-Profile': schema,
            },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (res.ok) {
          const rows = (await res.json()) as Array<Record<string, unknown>>;
          if (Array.isArray(rows) && rows.length > 0) {
            const mapped = mapSupabaseUserRow(rows[0]);
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

export async function fetchPublicPostsFromSupabase(
  config: SupabaseRuntimeConfig,
  authorIdFilter?: string
): Promise<Array<Record<string, unknown>>> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) return [];
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const authorClause = authorIdFilter
      ? `&author_id=eq.${encodeURIComponent(authorIdFilter)}`
      : '';
    for (const cols of [SELECT_POSTS_EXTENDED, SELECT_POSTS_CORE]) {
      const res = await fetch(
        new URL(
          `/rest/v1/lumina_posts?select=${cols}${authorClause}&order=created_at.desc&limit=150`,
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
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return [];
        return rows
          .map(mapSupabasePostRow)
          .filter((p): p is Record<string, unknown> => p !== null);
      }
      if (res.status !== 400) break;
    }
    return [];
  } catch {
    return [];
  }
}

export async function upsertStoryToSupabase(
  config: SupabaseRuntimeConfig,
  story: SupabaseStorySyncPayload
): Promise<boolean> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys || !story.id || !story.authorId) return false;
  const safeMedia = compactAssetForDb(story.mediaUrl, 260_000);
  if (!safeMedia) return false;
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const createdAt = story.createdAt || Date.now();
    const fullBody = {
      id: story.id,
      author_id: story.authorId,
      author_uid: story.authorUid || null,
      media_url: safeMedia,
      caption: story.caption ? story.caption.slice(0, 300) : null,
      location: story.location ? story.location.slice(0, 120) : null,
      viewed_by: Array.isArray(story.viewedBy) ? story.viewedBy.slice(0, 2000) : [],
      reactions: Array.isArray(story.reactions) ? story.reactions.slice(0, 500) : [],
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(createdAt + 24 * 60 * 60 * 1000).toISOString(),
    };
    const res = await fetch(
      new URL('/rest/v1/lumina_stories?on_conflict=id', origin).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(fullBody),
        signal: AbortSignal.timeout(6000),
      }
    );
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
      const retry = await fetch(
        new URL('/rest/v1/lumina_stories?on_conflict=id', origin).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildSupabaseHeaders(keys.activeKey),
            'Content-Profile': schema,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(coreBody),
          signal: AbortSignal.timeout(6000),
        }
      );
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function fetchPublicStoriesFromSupabase(
  config: SupabaseRuntimeConfig,
  authorIdFilter?: string
): Promise<Array<Record<string, unknown>>> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys) return [];
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const authorClause = authorIdFilter
      ? `&author_id=eq.${encodeURIComponent(authorIdFilter)}`
      : '';
    const res = await fetch(
      new URL(
        `/rest/v1/lumina_stories?select=${SELECT_STORIES}&created_at=gte.${encodeURIComponent(sinceIso)}${authorClause}&order=created_at.desc&limit=100`,
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
    return rows
      .map((r) => {
        const id = String(r.id || '').trim();
        const authorId = String(r.author_id || '').trim();
        const mediaUrl = typeof r.media_url === 'string' ? r.media_url.trim() : '';
        if (!id || !authorId || !mediaUrl) return null;
        const createdAt =
          typeof r.created_at === 'string'
            ? Date.parse(r.created_at) || Date.now()
            : typeof r.created_at === 'number'
            ? r.created_at
            : Date.now();
        if (Date.now() - createdAt > 24 * 60 * 60 * 1000) return null;
        return {
          id,
          authorId,
          authorUid: typeof r.author_uid === 'string' && r.author_uid ? r.author_uid : undefined,
          mediaUrl,
          caption: typeof r.caption === 'string' && r.caption.trim() ? r.caption.trim() : undefined,
          location: typeof r.location === 'string' && r.location.trim() ? r.location.trim() : undefined,
          createdAt,
          viewedBy: parseStringArray(r.viewed_by),
          reactions: Array.isArray(r.reactions) ? r.reactions : [],
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  } catch {
    return [];
  }
}

export async function upsertMessageToSupabase(
  config: SupabaseRuntimeConfig,
  msg: SupabaseMessageSyncPayload
): Promise<boolean> {
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys || !msg.id || !msg.senderId || !msg.recipientId) return false;
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const fullBody = {
      id: msg.id,
      thread_id: msg.threadId,
      sender_id: msg.senderId,
      recipient_id: msg.recipientId,
      text: (msg.text || '').slice(0, 2000),
      shared_post_id: msg.sharedPostId || null,
      story_reply_url: compactAssetForDb(msg.storyReplyUrl, 160_000),
      audio_url: compactAssetForDb(msg.audioUrl, 260_000),
      audio_duration_sec: msg.audioDurationSec ?? null,
      video_url: compactAssetForDb(msg.videoUrl, 260_000),
      video_name: msg.videoName ? msg.videoName.slice(0, 120) : null,
      reaction: msg.reaction || null,
      read_by: Array.isArray(msg.readBy) ? msg.readBy.slice(0, 20) : [msg.senderId],
      created_at: new Date(msg.createdAt || Date.now()).toISOString(),
    };
    const res = await fetch(
      new URL('/rest/v1/lumina_messages?on_conflict=id', origin).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildSupabaseHeaders(keys.activeKey),
          'Content-Profile': schema,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(fullBody),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) return true;
    if (res.status === 400) {
      const coreBody = {
        id: fullBody.id,
        thread_id: fullBody.thread_id,
        sender_id: fullBody.sender_id,
        recipient_id: fullBody.recipient_id,
        text: fullBody.text,
        shared_post_id: fullBody.shared_post_id,
        created_at: fullBody.created_at,
      };
      const retry = await fetch(
        new URL('/rest/v1/lumina_messages?on_conflict=id', origin).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildSupabaseHeaders(keys.activeKey),
            'Content-Profile': schema,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(coreBody),
          signal: AbortSignal.timeout(6000),
        }
      );
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function fetchDirectThreadsForUserFromSupabase(
  config: SupabaseRuntimeConfig,
  userIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const cleanIds = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
  const keys = getSupabaseKeys(config.anonKey);
  if (!keys.hasKeys || cleanIds.length === 0) return [];
  try {
    const origin = await resolveValidatedSupabaseOrigin(config.projectUrl);
    const schema = sanitizeSchemaName(config.schemaName);
    const inList = `(${cleanIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`;
    const orFilter = `or=(sender_id.in.${encodeURIComponent(inList)},recipient_id.in.${encodeURIComponent(inList)})`;
    const res = await fetch(
      new URL(
        `/rest/v1/lumina_messages?select=${SELECT_MESSAGES}&${orFilter}&order=created_at.asc&limit=300`,
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
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const myIdSet = new Set(cleanIds);
    const threadMap = new Map<string, Record<string, unknown>>();

    for (const r of rows) {
      const id = String(r.id || '').trim();
      const senderId = String(r.sender_id || '').trim();
      const recipientId = String(r.recipient_id || '').trim();
      if (!id || !senderId || !recipientId) continue;

      const sortedPair = [senderId, recipientId].sort();
      const threadId =
        typeof r.thread_id === 'string' && r.thread_id.trim()
          ? r.thread_id.trim()
          : `dm_${sortedPair[0]}__${sortedPair[1]}`;
      const createdAt =
        typeof r.created_at === 'string'
          ? Date.parse(r.created_at) || Date.now()
          : typeof r.created_at === 'number'
          ? r.created_at
          : Date.now();
      const readBy = parseStringArray(r.read_by);

      const messageObj = {
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

      const unreadForMe = !myIdSet.has(senderId) && !cleanIds.some((idVal) => readBy.includes(idVal));
      const existing = threadMap.get(threadId) as
        | {
            id: string;
            participantIds: string[];
            messages: unknown[];
            unreadBy: string[];
            updatedAt: number;
          }
        | undefined;

      if (!existing) {
        threadMap.set(threadId, {
          id: threadId,
          participantIds: [senderId, recipientId].filter((v, i, arr) => arr.indexOf(v) === i),
          messages: [messageObj],
          unreadBy: unreadForMe ? [cleanIds[0]] : [],
          updatedAt: createdAt,
        });
      } else {
        existing.messages.push(messageObj);
        existing.updatedAt = Math.max(existing.updatedAt, createdAt);
        if (unreadForMe && !existing.unreadBy.includes(cleanIds[0])) {
          existing.unreadBy.push(cleanIds[0]);
        }
      }
    }

    return Array.from(threadMap.values()).sort(
      (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    );
  } catch {
    return [];
  }
}
