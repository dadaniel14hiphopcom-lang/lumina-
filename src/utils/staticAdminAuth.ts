import { ADMIN_EMAIL } from '../lib/firebase';

const STATIC_ADMIN_AUTH_KEY = 'lumina_static_admin_auth_v1';

interface StaticAdminAuthRecord {
  email: string;
  salt: string;
  hash: string;
  createdAt: number;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function constantTimeHexEqual(aHex: string, bHex: string): boolean {
  const a = fromHex(aHex);
  const b = fromHex(bHex);
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function deriveAdminHash(passcode: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(`lumina-static-admin:${ADMIN_EMAIL.toLowerCase()}:${saltHex}`),
      iterations: 120_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(derivedBits));
}

export function readStaticAdminRecord(): StaticAdminAuthRecord | null {
  try {
    const raw = localStorage.getItem(STATIC_ADMIN_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StaticAdminAuthRecord>;
    if (
      parsed &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string' &&
      parsed.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    ) {
      return {
        email: ADMIN_EMAIL,
        salt: parsed.salt,
        hash: parsed.hash,
        createdAt: Number(parsed.createdAt) || Date.now(),
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function hasStaticAdminPasscode(): boolean {
  return Boolean(readStaticAdminRecord());
}

export async function claimOrUpdateStaticAdminPasscode(
  passcode: string
): Promise<{ ok: boolean; error?: string }> {
  const clean = passcode.trim();
  if (clean.length < 6) {
    return { ok: false, error: 'A senha administrativa deve ter pelo menos 6 caracteres.' };
  }
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes);
  const hash = await deriveAdminHash(clean, salt);
  const record: StaticAdminAuthRecord = {
    email: ADMIN_EMAIL,
    salt,
    hash,
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(STATIC_ADMIN_AUTH_KEY, JSON.stringify(record));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível salvar a senha administrativa neste navegador.' };
  }
}

export async function verifyStaticAdminPasscode(passcode: string): Promise<boolean> {
  const record = readStaticAdminRecord();
  if (!record) return false;
  const candidate = await deriveAdminHash(passcode.trim(), record.salt);
  return constantTimeHexEqual(candidate, record.hash);
}
