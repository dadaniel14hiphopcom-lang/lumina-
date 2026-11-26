import type { UserProfile } from '../types';

const IDB_NAME = 'lumina_profile_cache_db';
const IDB_VERSION = 1;
const IDB_STORE = 'profiles';
const LS_PROFILE_CACHE_KEY = 'lumina_real_users_cache_v1';
const MAX_LS_CACHED_PROFILES = 250;
const MAX_IDB_CACHED_PROFILES = 600;

interface CachedProfileRecord extends UserProfile {
  usernameLower: string;
  cachedAt: number;
}

const memoryProfileIndex = new Map<string, UserProfile>();
let idbOpenPromise: Promise<IDBDatabase | null> | null = null;

function sanitizeProfileForLocalCache(user: UserProfile): CachedProfileRecord | null {
  if (!user || !user.id || !user.username || user.isDemoSeed) return null;
  const cleanHandle = user.username.trim().toLowerCase();
  if (!cleanHandle) return null;

  // Never persist private PII (email) in the public lookup cache
  const { email: _omittedEmail, ...publicFields } = user;
  void _omittedEmail;

  const safeAvatar =
    publicFields.avatarUrl && publicFields.avatarUrl.length <= 220_000
      ? publicFields.avatarUrl
      : '/og-preview.jpg';
  const safeCover =
    publicFields.coverUrl && publicFields.coverUrl.length <= 160_000
      ? publicFields.coverUrl
      : undefined;

  return {
    ...publicFields,
    avatarUrl: safeAvatar,
    coverUrl: safeCover,
    isDemoSeed: false,
    followers: Array.isArray(publicFields.followers) ? publicFields.followers.slice(0, 500) : [],
    following: Array.isArray(publicFields.following) ? publicFields.following.slice(0, 500) : [],
    usernameLower: cleanHandle,
    cachedAt: Date.now(),
  };
}

function sanitizeForCompactLocalStorage(rec: CachedProfileRecord): CachedProfileRecord {
  return {
    ...rec,
    avatarUrl:
      rec.avatarUrl && rec.avatarUrl.length <= 45_000 ? rec.avatarUrl : '/og-preview.jpg',
    coverUrl: rec.coverUrl && rec.coverUrl.length <= 25_000 ? rec.coverUrl : undefined,
  };
}

function indexInMemory(user: UserProfile): void {
  if (!user || !user.id || !user.username || user.isDemoSeed) return;
  memoryProfileIndex.set(`id:${user.id}`, user);
  if (user.uid) memoryProfileIndex.set(`uid:${user.uid}`, user);
  memoryProfileIndex.set(`u:${user.username.trim().toLowerCase()}`, user);
}

function openProfileIDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (idbOpenPromise) return idbOpenPromise;

  idbOpenPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('usernameLower', 'usernameLower', { unique: false });
          store.createIndex('uid', 'uid', { unique: false });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          idbOpenPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        idbOpenPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch {
      idbOpenPromise = null;
      resolve(null);
    }
  });
  return idbOpenPromise;
}

/**
 * Synchronous frame-0 read from compact localStorage profile mirror.
 * Guarantees instant real-user lookup even if lumina_social_v1 overflowed or was cleared.
 */
export function readCachedProfilesSync(): UserProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_PROFILE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: UserProfile[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Partial<CachedProfileRecord>;
      if (typeof rec.id !== 'string' || !rec.id || typeof rec.username !== 'string' || !rec.username) {
        continue;
      }
      const normalized: UserProfile = {
        id: rec.id,
        uid: typeof rec.uid === 'string' ? rec.uid : undefined,
        username: rec.username,
        displayName: typeof rec.displayName === 'string' && rec.displayName ? rec.displayName : rec.username,
        avatarUrl: typeof rec.avatarUrl === 'string' && rec.avatarUrl ? rec.avatarUrl : '/og-preview.jpg',
        coverUrl: typeof rec.coverUrl === 'string' ? rec.coverUrl : undefined,
        bio: typeof rec.bio === 'string' ? rec.bio : '',
        website: typeof rec.website === 'string' ? rec.website : undefined,
        verified: Boolean(rec.verified),
        boosted: Boolean(rec.boosted),
        restricted: Boolean(rec.restricted),
        isOnline: rec.isOnline !== undefined ? Boolean(rec.isOnline) : false,
        lastActiveAtMs: typeof rec.lastActiveAtMs === 'number' ? rec.lastActiveAtMs : undefined,
        isDemoSeed: false,
        followers: Array.isArray(rec.followers) ? rec.followers : [],
        following: Array.isArray(rec.following) ? rec.following : [],
      };
      indexInMemory(normalized);
      out.push(normalized);
    }
    return out;
  } catch {
    return [];
  }
}

function writeCachedProfilesToLocalStorage(records: CachedProfileRecord[]): void {
  if (typeof window === 'undefined' || records.length === 0) return;
  try {
    const existing = readCachedProfilesSync();
    const map = new Map<string, CachedProfileRecord>();
    for (const u of existing) {
      const sanitized = sanitizeProfileForLocalCache(u);
      if (sanitized) map.set(sanitized.id, sanitizeForCompactLocalStorage(sanitized));
    }
    for (const rec of records) {
      map.set(rec.id, sanitizeForCompactLocalStorage(rec));
    }
    const merged = Array.from(map.values())
      .sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
      .slice(0, MAX_LS_CACHED_PROFILES);

    try {
      localStorage.setItem(LS_PROFILE_CACHE_KEY, JSON.stringify(merged));
    } catch {
      // Aggressive compaction fallback if localStorage quota is tight
      const ultraCompact = merged.map((r) => ({
        ...r,
        avatarUrl: r.avatarUrl.startsWith('http') ? r.avatarUrl : '/og-preview.jpg',
        coverUrl: undefined,
        followers: r.followers.slice(0, 50),
        following: r.following.slice(0, 50),
      }));
      try {
        localStorage.setItem(LS_PROFILE_CACHE_KEY, JSON.stringify(ultraCompact));
      } catch {
        // Ignore if storage completely blocked; IndexedDB still holds full records
      }
    }
  } catch {
    // Ignore localStorage error
  }
}

export async function upsertCachedProfiles(users: UserProfile[]): Promise<void> {
  const sanitized = users
    .map(sanitizeProfileForLocalCache)
    .filter((r): r is CachedProfileRecord => Boolean(r))
    .slice(0, MAX_IDB_CACHED_PROFILES);

  if (sanitized.length === 0) return;

  for (const rec of sanitized) {
    indexInMemory(rec);
  }
  writeCachedProfilesToLocalStorage(sanitized);

  const db = await openProfileIDB();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const rec of sanitized) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function readAllCachedProfilesIDB(): Promise<UserProfile[]> {
  const db = await openProfileIDB();
  if (!db) return readCachedProfilesSync();

  return new Promise<UserProfile[]>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as CachedProfileRecord[]) : [];
        const profiles: UserProfile[] = rows
          .filter((r) => r && r.id && r.username && !r.isDemoSeed)
          .sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
          .slice(0, MAX_IDB_CACHED_PROFILES)
          .map(({ usernameLower: _u, cachedAt: _c, ...rest }) => {
            void _u;
            void _c;
            const user: UserProfile = { ...rest, isDemoSeed: false };
            indexInMemory(user);
            return user;
          });
        resolve(profiles.length > 0 ? profiles : readCachedProfilesSync());
      };
      req.onerror = () => resolve(readCachedProfilesSync());
    } catch {
      resolve(readCachedProfilesSync());
    }
  });
}

export async function lookupCachedProfileInstant(slugOrId: string): Promise<UserProfile | null> {
  const clean = slugOrId.trim().replace(/^@/, '');
  if (!clean) return null;
  const cleanLower = clean.toLowerCase();

  // 1. O(1) memory index check
  const fromMem =
    memoryProfileIndex.get(`u:${cleanLower}`) ||
    memoryProfileIndex.get(`id:${clean}`) ||
    memoryProfileIndex.get(`uid:${clean}`);
  if (fromMem) return fromMem;

  // 2. Synchronous localStorage mirror check
  const lsProfiles = readCachedProfilesSync();
  const fromLs = lsProfiles.find(
    (u) =>
      u.username.toLowerCase() === cleanLower ||
      u.id === clean ||
      u.uid === clean
  );
  if (fromLs) return fromLs;

  // 3. IndexedDB indexed lookup
  const db = await openProfileIDB();
  if (!db) return null;

  return new Promise<UserProfile | null>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const handleIdx = store.index('usernameLower');
      const byHandleReq = handleIdx.get(cleanLower);

      const finish = (rec: CachedProfileRecord | undefined) => {
        if (!rec || !rec.id || rec.isDemoSeed) return null;
        const { usernameLower: _u, cachedAt: _c, ...rest } = rec;
        void _u;
        void _c;
        const user: UserProfile = { ...rest, isDemoSeed: false };
        indexInMemory(user);
        return user;
      };

      byHandleReq.onsuccess = () => {
        const hit = finish(byHandleReq.result as CachedProfileRecord | undefined);
        if (hit) {
          resolve(hit);
          return;
        }
        const byIdReq = store.get(clean);
        byIdReq.onsuccess = () => {
          const hitId = finish(byIdReq.result as CachedProfileRecord | undefined);
          if (hitId) {
            resolve(hitId);
            return;
          }
          const uidIdx = store.index('uid');
          const byUidReq = uidIdx.get(clean);
          byUidReq.onsuccess = () => {
            resolve(finish(byUidReq.result as CachedProfileRecord | undefined));
          };
          byUidReq.onerror = () => resolve(null);
        };
        byIdReq.onerror = () => resolve(null);
      };
      byHandleReq.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
