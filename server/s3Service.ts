import crypto from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AwsS3Config {
  region: string;
  bucket: string;
  cloudFrontDomain: string;
  hasRealCloudFront: boolean;
}

export interface S3UploadResult {
  ok: boolean;
  status: number;
  key: string;
  bucket: string;
  region: string;
  etag?: string;
  message?: string;
}

export interface S3PresignedUploadResult {
  uploadUrl: string;
  method: 'PUT';
  key: string;
  contentType: string;
  expiresSec: number;
  requiredHeaders: Record<string, string>;
}

export interface S3BucketProbeResult {
  ok: boolean;
  status: number;
}

export interface S3ObjectHeadResult {
  exists: boolean;
  status: number;
  contentLength?: number;
  contentType?: string;
}

const DEFAULT_AWS_REGION = 'sa-east-1';
const DEFAULT_AWS_BUCKET = 'lumina-media-prod';

function awsEncodeRfc3986(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function getAwsSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = 's3'
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export function sanitizeAwsRegion(raw?: string, fallback = DEFAULT_AWS_REGION): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (/^[a-z]{2}(-[a-z0-9]+)+-\d+$/.test(clean)) {
    return clean;
  }
  return fallback;
}

export function sanitizeS3Bucket(raw?: string, fallback = DEFAULT_AWS_BUCKET): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (
    clean.length >= 3 &&
    clean.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(clean) &&
    !clean.includes('..')
  ) {
    return clean;
  }
  return fallback;
}

export function sanitizeCloudFrontDomain(raw?: string): string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (
    clean &&
    clean.length <= 160 &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) &&
    !clean.includes('..')
  ) {
    return clean;
  }
  return '';
}

export function encodeS3ObjectKey(key: string): string {
  const cleanSegments = key
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
  return cleanSegments.map(awsEncodeRfc3986).join('/');
}

export function isSafeS3ObjectKey(key: string): boolean {
  const clean = String(key || '').trim();
  if (!clean || clean.startsWith('/') || clean.includes('..') || clean.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9/_.-]{4,240}$/.test(clean);
}

export function buildReelObjectKey(
  ext: string,
  kind: 'video' | 'image' | 'audio' | 'file' = 'video'
): string {
  const safeExt = ext
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8) || (kind === 'video' ? 'mp4' : kind === 'audio' ? 'weba' : kind === 'file' ? 'bin' : 'jpg');
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const uniqueId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const folder = kind === 'video' ? 'reels' : 'media';
  return `${folder}/${ym}/${uniqueId}.${safeExt}`;
}

/**
 * Reads AWS credentials exclusively from server-side environment variables.
 */
export function getAwsCredentialsFromEnv(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim() || undefined;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

/**
 * Resolves non-secret AWS S3 & CloudFront target parameters, prioritizing
 * server environment variables over optional admin-panel settings.
 */
export function resolveAwsS3Config(overrides?: {
  region?: string;
  bucket?: string;
  cloudFrontDomain?: string;
  cloudFrontEnabled?: boolean;
}): AwsS3Config {
  const region = sanitizeAwsRegion(
    process.env.AWS_REGION?.trim() || overrides?.region,
    DEFAULT_AWS_REGION
  );
  const bucket = sanitizeS3Bucket(
    process.env.AWS_S3_BUCKET?.trim() || overrides?.bucket,
    DEFAULT_AWS_BUCKET
  );
  const cloudFrontDomain = sanitizeCloudFrontDomain(
    process.env.AWS_CLOUDFRONT_DOMAIN?.trim() || overrides?.cloudFrontDomain
  );
  const cloudFrontEnabled = overrides?.cloudFrontEnabled ?? Boolean(process.env.AWS_CLOUDFRONT_DOMAIN?.trim());
  const hasRealCloudFront =
    cloudFrontEnabled &&
    Boolean(cloudFrontDomain) &&
    (Boolean(process.env.AWS_CLOUDFRONT_DOMAIN?.trim()) ||
      cloudFrontDomain !== 'cdn.lumina.social');

  return {
    region,
    bucket,
    cloudFrontDomain,
    hasRealCloudFront,
  };
}

export function isAwsS3Configured(): boolean {
  return Boolean(getAwsCredentialsFromEnv());
}

function buildS3EndpointHost(bucket: string, region: string): string {
  return `${sanitizeS3Bucket(bucket)}.s3.${sanitizeAwsRegion(region)}.amazonaws.com`;
}

function signS3RequestHeaders(params: {
  method: 'PUT' | 'HEAD' | 'DELETE' | 'GET';
  host: string;
  canonicalUri: string;
  region: string;
  payloadHash: string;
  credentials: AwsCredentials;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeadersList: [string, string][] = [
    ['host', params.host],
    ['x-amz-content-sha256', params.payloadHash],
    ['x-amz-date', amzDate],
  ];
  if (params.credentials.sessionToken) {
    canonicalHeadersList.push(['x-amz-security-token', params.credentials.sessionToken]);
  }
  canonicalHeadersList.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = canonicalHeadersList.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = canonicalHeadersList.map(([k]) => k).join(';');
  const canonicalRequest = [
    params.method,
    params.canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getAwsSigningKey(
    params.credentials.secretAccessKey,
    dateStamp,
    params.region,
    's3'
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const headers: Record<string, string> = {
    ...(params.extraHeaders || {}),
    'x-amz-content-sha256': params.payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.credentials.sessionToken) {
    headers['x-amz-security-token'] = params.credentials.sessionToken;
  }
  return headers;
}

/**
 * Uploads a Reel video (or media buffer) directly to Amazon S3 using SigV4.
 */
export async function uploadReelToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
  config?: AwsS3Config;
}): Promise<S3UploadResult> {
  if (!isSafeS3ObjectKey(params.key)) {
    throw new Error('Chave S3 inválida para upload.');
  }
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Credenciais AWS não configuradas nas variáveis de ambiente.');
  }
  const cfg = params.config || resolveAwsS3Config();
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const canonicalUri = `/${encodeS3ObjectKey(params.key)}`;
  const payloadHash = sha256Hex(params.body);

  const headers = signS3RequestHeaders({
    method: 'PUT',
    host,
    canonicalUri,
    region: cfg.region,
    payloadHash,
    credentials,
    extraHeaders: {
      'Content-Type': params.contentType,
      'Content-Length': String(params.body.length),
      'Cache-Control': params.cacheControl || 'public, max-age=31536000, immutable',
    },
  });

  const resp = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers,
    body: new Uint8Array(params.body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      key: params.key,
      bucket: cfg.bucket,
      region: cfg.region,
      message: errText.slice(0, 240) || `HTTP ${resp.status}`,
    };
  }

  return {
    ok: true,
    status: resp.status,
    key: params.key,
    bucket: cfg.bucket,
    region: cfg.region,
    etag: resp.headers.get('etag')?.replace(/"/g, '') || undefined,
  };
}

/**
 * Generates an AWS Signature Version 4 pre-signed GET URL for streaming
 * private S3 Reel videos (supports native browser HTTP Range seeking).
 */
export function getSignedReelDownloadUrl(params: {
  key: string;
  expiresSec?: number;
  responseContentType?: string;
  config?: AwsS3Config;
}): string {
  if (!isSafeS3ObjectKey(params.key)) {
    throw new Error('Chave S3 inválida para geração de URL assinada.');
  }
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Credenciais AWS não configuradas nas variáveis de ambiente.');
  }
  const cfg = params.config || resolveAwsS3Config();
  const expiresSec = Math.min(604800, Math.max(60, Math.round(params.expiresSec ?? 3600)));
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const canonicalUri = `/${encodeS3ObjectKey(params.key)}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const queryEntries: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSec)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (params.responseContentType) {
    queryEntries.push(['response-content-type', params.responseContentType]);
  }
  if (credentials.sessionToken) {
    queryEntries.push(['X-Amz-Security-Token', credentials.sessionToken]);
  }
  queryEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQuery = queryEntries
    .map(([k, v]) => `${awsEncodeRfc3986(k)}=${awsEncodeRfc3986(v)}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = getAwsSigningKey(credentials.secretAccessKey, dateStamp, cfg.region, 's3');
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Generates an AWS Signature Version 4 pre-signed PUT URL so authorized
 * requests can upload a Reel video directly to Amazon S3 with a strict Content-Type.
 */
export function getSignedReelUploadUrl(params: {
  key: string;
  contentType: string;
  expiresSec?: number;
  config?: AwsS3Config;
}): S3PresignedUploadResult {
  if (!isSafeS3ObjectKey(params.key)) {
    throw new Error('Chave S3 inválida para geração de URL de upload.');
  }
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Credenciais AWS não configuradas nas variáveis de ambiente.');
  }
  const cfg = params.config || resolveAwsS3Config();
  const expiresSec = Math.min(900, Math.max(60, Math.round(params.expiresSec ?? 300)));
  const cleanContentType = params.contentType.split(';')[0].trim().toLowerCase();
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const canonicalUri = `/${encodeS3ObjectKey(params.key)}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const queryEntries: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSec)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ];
  if (credentials.sessionToken) {
    queryEntries.push(['X-Amz-Security-Token', credentials.sessionToken]);
  }
  queryEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQuery = queryEntries
    .map(([k, v]) => `${awsEncodeRfc3986(k)}=${awsEncodeRfc3986(v)}`)
    .join('&');
  const canonicalHeaders = `content-type:${cleanContentType}\nhost:${host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = getAwsSigningKey(credentials.secretAccessKey, dateStamp, cfg.region, 's3');
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    uploadUrl: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    method: 'PUT',
    key: params.key,
    contentType: cleanContentType,
    expiresSec,
    requiredHeaders: {
      'Content-Type': cleanContentType,
    },
  };
}

/**
 * Resolves the canonical playback URL stored with the Reel (CloudFront CDN if configured,
 * or our same-origin signed-URL redirect endpoint for private buckets).
 */
export function resolveReelPlaybackUrl(key: string, config: AwsS3Config): string {
  if (!isSafeS3ObjectKey(key)) {
    throw new Error('Chave S3 inválida.');
  }
  if (config.hasRealCloudFront && config.cloudFrontDomain) {
    return `https://${config.cloudFrontDomain}/${encodeS3ObjectKey(key)}`;
  }
  return `/api/media/s3/${key}`;
}

export async function deleteReelFromS3(params: {
  key: string;
  config?: AwsS3Config;
}): Promise<{ ok: boolean; status: number }> {
  if (!isSafeS3ObjectKey(params.key)) {
    throw new Error('Chave S3 inválida.');
  }
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Credenciais AWS não configuradas nas variáveis de ambiente.');
  }
  const cfg = params.config || resolveAwsS3Config();
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const canonicalUri = `/${encodeS3ObjectKey(params.key)}`;
  const headers = signS3RequestHeaders({
    method: 'DELETE',
    host,
    canonicalUri,
    region: cfg.region,
    payloadHash: sha256Hex(''),
    credentials,
  });

  const resp = await fetch(`https://${host}${canonicalUri}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: resp.ok, status: resp.status };
}

export async function headS3Object(params: {
  key: string;
  config?: AwsS3Config;
}): Promise<S3ObjectHeadResult> {
  if (!isSafeS3ObjectKey(params.key)) {
    throw new Error('Chave S3 inválida.');
  }
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Credenciais AWS não configuradas nas variáveis de ambiente.');
  }
  const cfg = params.config || resolveAwsS3Config();
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const canonicalUri = `/${encodeS3ObjectKey(params.key)}`;
  const headers = signS3RequestHeaders({
    method: 'HEAD',
    host,
    canonicalUri,
    region: cfg.region,
    payloadHash: sha256Hex(''),
    credentials,
  });

  const resp = await fetch(`https://${host}${canonicalUri}`, {
    method: 'HEAD',
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  const lenRaw = resp.headers.get('content-length');
  return {
    exists: resp.ok,
    status: resp.status,
    contentLength: lenRaw ? Number.parseInt(lenRaw, 10) : undefined,
    contentType: resp.headers.get('content-type') || undefined,
  };
}

export async function headS3Bucket(config?: AwsS3Config): Promise<S3BucketProbeResult> {
  const credentials = getAwsCredentialsFromEnv();
  if (!credentials) {
    return { ok: false, status: 401 };
  }
  const cfg = config || resolveAwsS3Config();
  const host = buildS3EndpointHost(cfg.bucket, cfg.region);
  const headers = signS3RequestHeaders({
    method: 'HEAD',
    host,
    canonicalUri: '/',
    region: cfg.region,
    payloadHash: sha256Hex(''),
    credentials,
  });

  const resp = await fetch(`https://${host}/`, {
    method: 'HEAD',
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  return { ok: resp.ok, status: resp.status };
}
