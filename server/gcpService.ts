import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FirebaseAppletDefaults {
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  authDomain: string;
  hostingDomain: string;
}

export interface GcpServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

export interface GcpRuntimeInfo {
  cloudRunDetected: boolean;
  serviceName: string | null;
  revision: string | null;
  projectEnv: string | null;
  appEngineDetected: boolean;
}

export interface GcsBucketProbeResult {
  reachable: boolean;
  authenticated: boolean;
  status: number;
  location?: string;
  storageClass?: string;
  message?: string;
}

export interface GcsUploadResult {
  ok: boolean;
  status: number;
  key: string;
  bucket: string;
  message?: string;
}

const DEFAULT_GCP_PROJECT_ID = 'gen-lang-client-0008718661';
const DEFAULT_FIRESTORE_DB_ID = 'ai-studio-lumina-3b56ca74-7dae-48b1-8553-15277d2b38a1';
const DEFAULT_GCS_BUCKET = 'gen-lang-client-0008718661.firebasestorage.app';
const DEFAULT_GCP_REGION = 'us-east1';

let cachedAccessToken: { token: string; clientEmail: string; expiresAtMs: number } | null = null;

export function readFirebaseAppletConfig(): FirebaseAppletDefaults {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
        storageBucket?: string;
        authDomain?: string;
      };
      const projectId = sanitizeGcpProjectId(parsed.projectId, DEFAULT_GCP_PROJECT_ID);
      const firestoreDatabaseId =
        typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
          ? parsed.firestoreDatabaseId.trim().slice(0, 120)
          : DEFAULT_FIRESTORE_DB_ID;
      const storageBucket = sanitizeGcsBucket(parsed.storageBucket, `${projectId}.firebasestorage.app`);
      const authDomain =
        typeof parsed.authDomain === 'string' && parsed.authDomain.trim()
          ? parsed.authDomain.trim().slice(0, 140)
          : `${projectId}.firebaseapp.com`;
      return {
        projectId,
        firestoreDatabaseId,
        storageBucket,
        authDomain,
        hostingDomain: `${projectId}.web.app`,
      };
    }
  } catch {
    // Fall back to defaults below
  }
  return {
    projectId: DEFAULT_GCP_PROJECT_ID,
    firestoreDatabaseId: DEFAULT_FIRESTORE_DB_ID,
    storageBucket: DEFAULT_GCS_BUCKET,
    authDomain: `${DEFAULT_GCP_PROJECT_ID}.firebaseapp.com`,
    hostingDomain: `${DEFAULT_GCP_PROJECT_ID}.web.app`,
  };
}

export function sanitizeGcpProjectId(raw?: string, fallback = DEFAULT_GCP_PROJECT_ID): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (/^[a-z][a-z0-9-]{4,29}$/.test(clean) && !clean.endsWith('-')) {
    return clean;
  }
  return fallback;
}

export function sanitizeGcpRegion(raw?: string, fallback = DEFAULT_GCP_REGION): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (/^[a-z]+-[a-z0-9-]+\d+$/.test(clean) && clean.length <= 40) {
    return clean;
  }
  return fallback;
}

export function sanitizeGcsBucket(raw?: string, fallback = DEFAULT_GCS_BUCKET): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^gs:\/\//, '')
    .replace(/\/+$/, '');
  if (
    clean.length >= 3 &&
    clean.length <= 222 &&
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(clean) &&
    !clean.includes('..')
  ) {
    return clean;
  }
  return fallback;
}

export function sanitizeGcpHostingDomain(raw?: string, fallback = ''): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .split(':')[0];
  if (
    clean &&
    clean.length <= 160 &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) &&
    !clean.includes('..') &&
    clean !== 'localhost' &&
    !clean.endsWith('.local') &&
    !clean.endsWith('.internal')
  ) {
    return clean;
  }
  return fallback;
}

export function isSafeGcsObjectKey(key: string): boolean {
  if (!key || key.length > 260) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  return /^[a-zA-Z0-9._/-]+$/.test(key) && /^(reels|media)\//.test(key);
}

export function detectGoogleCloudRuntime(): GcpRuntimeInfo {
  const serviceName = process.env.K_SERVICE?.trim() || null;
  const revision = process.env.K_REVISION?.trim() || null;
  const projectEnv =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT_ID?.trim() ||
    null;
  const appEngineDetected = Boolean(process.env.GAE_APPLICATION?.trim());
  const cloudRunDetected = Boolean(serviceName || process.env.CLOUD_RUN_JOB?.trim());
  return {
    cloudRunDetected,
    serviceName,
    revision,
    projectEnv,
    appEngineDetected,
  };
}

export function getGcpServiceAccountFromEnv(): GcpServiceAccountCredentials | null {
  const jsonRaw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as {
        client_email?: string;
        private_key?: string;
        project_id?: string;
      };
      const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
      const privateKey =
        typeof parsed.private_key === 'string'
          ? parsed.private_key.replace(/\\n/g, '\n').trim()
          : '';
      if (clientEmail && privateKey.includes('BEGIN') && privateKey.includes('PRIVATE KEY')) {
        return {
          clientEmail,
          privateKey,
          projectId: typeof parsed.project_id === 'string' ? parsed.project_id.trim() : undefined,
        };
      }
    } catch {
      // Ignore malformed JSON and check individual vars
    }
  }

  const clientEmail = process.env.GCP_CLIENT_EMAIL?.trim() || '';
  const privateKey = (process.env.GCP_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (clientEmail && privateKey.includes('BEGIN') && privateKey.includes('PRIVATE KEY')) {
    return {
      clientEmail,
      privateKey,
      projectId: process.env.GCP_PROJECT_ID?.trim() || undefined,
    };
  }

  return null;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function getGcpAccessToken(
  creds: GcpServiceAccountCredentials
): Promise<string | null> {
  if (
    cachedAccessToken &&
    cachedAccessToken.clientEmail === creds.clientEmail &&
    cachedAccessToken.expiresAtMs > Date.now() + 60_000
  ) {
    return cachedAccessToken.token;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/devstorage.read_write',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );

  const signingInput = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(creds.privateKey));
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(7000),
  });

  if (!resp.ok) {
    return null;
  }

  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  const expiresInMs = Math.max(120, Number(data.expires_in || 3600)) * 1000;
  cachedAccessToken = {
    token: data.access_token,
    clientEmail: creds.clientEmail,
    expiresAtMs: Date.now() + expiresInMs,
  };
  return data.access_token;
}

export async function probeGcsBucket(
  bucketInput: string,
  creds: GcpServiceAccountCredentials | null
): Promise<GcsBucketProbeResult> {
  const bucket = sanitizeGcsBucket(bucketInput);
  const endpoint = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  let authenticated = false;

  if (creds) {
    try {
      const token = await getGcpAccessToken(creds);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        authenticated = true;
      }
    } catch {
      authenticated = false;
    }
  }

  const resp = await fetch(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(7000),
  });

  if (resp.ok) {
    const payload = (await resp.json().catch(() => ({}))) as {
      location?: string;
      storageClass?: string;
    };
    return {
      reachable: true,
      authenticated,
      status: resp.status,
      location: payload.location,
      storageClass: payload.storageClass,
    };
  }

  const text = await resp.text().catch(() => '');
  return {
    reachable: resp.status === 401 || resp.status === 403,
    authenticated,
    status: resp.status,
    message: text.slice(0, 240),
  };
}

export async function uploadMediaToGcs(params: {
  key: string;
  body: Buffer;
  contentType: string;
  bucket: string;
  creds: GcpServiceAccountCredentials;
}): Promise<GcsUploadResult> {
  const bucket = sanitizeGcsBucket(params.bucket);
  const token = await getGcpAccessToken(params.creds);
  if (!token) {
    return {
      ok: false,
      status: 401,
      key: params.key,
      bucket,
      message: 'Não foi possível obter token OAuth2 para a conta de serviço Google Cloud.',
    };
  }

  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
    bucket
  )}/o?uploadType=media&name=${encodeURIComponent(params.key)}`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': params.contentType,
      'Content-Length': String(params.body.length),
    },
    body: new Uint8Array(params.body),
    signal: AbortSignal.timeout(30_000),
  });

  if (resp.ok) {
    return {
      ok: true,
      status: resp.status,
      key: params.key,
      bucket,
    };
  }

  const msg = await resp.text().catch(() => '');
  return {
    ok: false,
    status: resp.status,
    key: params.key,
    bucket,
    message: msg.slice(0, 240),
  };
}

function gcsEncodeRfc3986(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeGcsPath(bucket: string, key: string): string {
  const cleanKey = key
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => gcsEncodeRfc3986(s))
    .join('/');
  return `/${gcsEncodeRfc3986(bucket)}/${cleanKey}`;
}

export function getSignedGcsDownloadUrl(params: {
  key: string;
  bucket: string;
  expiresSec?: number;
  creds: GcpServiceAccountCredentials;
}): string {
  const bucket = sanitizeGcsBucket(params.bucket);
  const expiresSec = Math.min(604800, Math.max(60, Math.round(params.expiresSec || 3600)));
  const now = new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = iso.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;
  const canonicalResource = encodeGcsPath(bucket, params.key);

  const queryParams: [string, string][] = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', `${params.creds.clientEmail}/${credentialScope}`],
    ['X-Goog-Date', iso],
    ['X-Goog-Expires', String(expiresSec)],
    ['X-Goog-SignedHeaders', 'host'],
  ];
  queryParams.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQuery = queryParams
    .map(([k, v]) => `${gcsEncodeRfc3986(k)}=${gcsEncodeRfc3986(v)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalResource,
    canonicalQuery,
    'host:storage.googleapis.com\n',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const hashedCanonicalRequest = crypto
    .createHash('sha256')
    .update(canonicalRequest, 'utf8')
    .digest('hex');

  const stringToSign = ['GOOG4-RSA-SHA256', iso, credentialScope, hashedCanonicalRequest].join('\n');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign, 'utf8');
  signer.end();
  const signatureHex = signer.sign(params.creds.privateKey).toString('hex');

  return `https://storage.googleapis.com${canonicalResource}?${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
}

export function resolveGcsPlaybackUrl(key: string): string {
  const cleanKey = key
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  return `/api/media/gcs/${cleanKey}`;
}
