import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  CallSignalPayload,
  DirectThread,
  InviteRecord,
  NotificationItem,
  Post,
  SiteMeta,
  StoryItem,
  UserProfile,
} from '../types';

function toValidFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

function toSafeUsername(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 40);
  return cleaned.length >= 2 ? cleaned : `user.${Date.now().toString(36)}`;
}

function toMillis(ts: unknown, fallback: number): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    const fn = (ts as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  return fallback;
}

function sanitizeAvatarForCloud(url: string): string {
  if (!url) return '';
  return url.length <= 440_000 ? url : url.slice(0, 440_000);
}

function sanitizeCoverForCloud(url?: string): string | undefined {
  if (!url) return undefined;
  return url.length <= 540_000 ? url : undefined;
}

export async function ensureAdminDocIfMatched(fbUser: FirebaseUser): Promise<void> {
  if (!fbUser.emailVerified || fbUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return;
  }
  const ref = doc(db, 'admins', fbUser.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: fbUser.uid,
        email: fbUser.email,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `admins/${fbUser.uid}`);
  }
}

export async function upsertOwnProfileInCloud(
  profile: UserProfile,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  const profileId = toValidFirestoreId(profile.id);
  const path = `profiles/${profileId}`;
  const ref = doc(db, 'profiles', profileId);

  try {
    const snap = await getDoc(ref);
    const baseCommon: Record<string, unknown> = {
      username: toSafeUsername(profile.username),
      displayName: (profile.displayName || profile.username || 'Usuário').slice(0, 80),
      avatarUrl: sanitizeAvatarForCloud(profile.avatarUrl),
      bio: (profile.bio || '').slice(0, 220),
      isOnline: Boolean(profile.isOnline),
      lastActiveAtMs: profile.lastActiveAtMs || Date.now(),
      following: (profile.following || []).slice(0, 500),
      updatedAt: serverTimestamp(),
    };
    const safeCover = sanitizeCoverForCloud(profile.coverUrl);
    if (safeCover) baseCommon.coverUrl = safeCover;
    if (profile.website) baseCommon.website = profile.website.slice(0, 200);

    if (!snap.exists()) {
      await setDoc(ref, {
        id: profileId,
        uid: fbUser.uid,
        ...baseCommon,
        verified: false,
        restricted: false,
        boosted: false,
        isDemoSeed: false,
        followers: (profile.followers || []).slice(0, 500),
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      if (existingData.uid === fbUser.uid || fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        await updateDoc(ref, baseCommon);
      }
    }

    // Store private PII (email) strictly in users_private/{uid}
    const privatePath = `users_private/${fbUser.uid}`;
    const privateRef = doc(db, 'users_private', fbUser.uid);
    const privateSnap = await getDoc(privateRef);
    const emailVal = (profile.email || fbUser.email || '').slice(0, 160);
    if (!privateSnap.exists()) {
      await setDoc(privateRef, {
        uid: fbUser.uid,
        profileId,
        email: emailVal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(privateRef, {
        profileId,
        email: emailVal,
        updatedAt: serverTimestamp(),
      });
    }
    void privatePath;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminUpdateProfileFlagsInCloud(
  profile: UserProfile,
  fbUser: FirebaseUser
): Promise<boolean> {
  if (!fbUser.emailVerified || fbUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return false;
  }

  const candidateIds = Array.from(
    new Set(
      [
        profile.id ? toValidFirestoreId(profile.id) : '',
        profile.uid ? toValidFirestoreId(profile.uid) : '',
      ].filter(Boolean)
    )
  );
  const cleanHandle = profile.username ? toSafeUsername(profile.username) : '';

  try {
    const matchedRefs = new Map<string, ReturnType<typeof doc>>();
    const matchedData = new Map<string, Record<string, unknown>>();

    for (const cid of candidateIds) {
      const ref = doc(db, 'profiles', cid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        matchedRefs.set(snap.id, ref);
        matchedData.set(snap.id, snap.data() as Record<string, unknown>);
      }
    }

    if (profile.uid) {
      const byUidSnap = await getDocs(
        query(collection(db, 'profiles'), where('uid', '==', profile.uid), limit(3))
      );
      for (const d of byUidSnap.docs) {
        matchedRefs.set(d.id, d.ref);
        matchedData.set(d.id, d.data() as Record<string, unknown>);
      }
    }

    if (cleanHandle) {
      const byHandleSnap = await getDocs(
        query(collection(db, 'profiles'), where('username', '==', cleanHandle), limit(3))
      );
      for (const d of byHandleSnap.docs) {
        const dData = d.data() as Record<string, unknown>;
        if (Boolean(dData.isDemoSeed) === Boolean(profile.isDemoSeed)) {
          matchedRefs.set(d.id, d.ref);
          matchedData.set(d.id, dData);
        }
      }
    }

    if (matchedRefs.size > 0) {
      for (const [docId, ref] of matchedRefs.entries()) {
        const existingData = matchedData.get(docId) || {};
        const patchPayload: Record<string, unknown> = {
          verified: Boolean(profile.verified),
          boosted: Boolean(profile.boosted),
          restricted: Boolean(profile.restricted),
          updatedAt: serverTimestamp(),
        };
        if (typeof existingData.displayName !== 'string' || !existingData.displayName.trim()) {
          patchPayload.displayName = (profile.displayName || cleanHandle || 'Usuário').slice(0, 80);
        }
        if (typeof existingData.avatarUrl !== 'string') {
          patchPayload.avatarUrl = sanitizeAvatarForCloud(profile.avatarUrl || '/og-preview.jpg');
        }
        if (typeof existingData.bio !== 'string') {
          patchPayload.bio = (profile.bio || '').slice(0, 220);
        }
        if (typeof existingData.isOnline !== 'boolean') {
          patchPayload.isOnline = Boolean(profile.isOnline);
        }
        if (typeof existingData.isDemoSeed !== 'boolean') {
          patchPayload.isDemoSeed = Boolean(profile.isDemoSeed);
        }
        if (!Array.isArray(existingData.followers)) {
          patchPayload.followers = (profile.followers || []).slice(0, 500);
        }
        if (!Array.isArray(existingData.following)) {
          patchPayload.following = (profile.following || []).slice(0, 500);
        }
        await updateDoc(ref, patchPayload);
      }
      return true;
    }

    // Create profile doc as admin if real user registered via email/Supabase before signing into Firebase
    const createDocId = toValidFirestoreId(profile.uid || profile.id);
    const createUid = toValidFirestoreId(profile.uid || profile.id);
    const now = Date.now();
    const createPayload: Record<string, unknown> = {
      id: createDocId,
      uid: createUid,
      username: cleanHandle || `user.${now.toString(36)}`,
      displayName: (profile.displayName || profile.username || 'Usuário').slice(0, 80),
      avatarUrl: sanitizeAvatarForCloud(profile.avatarUrl || '/og-preview.jpg'),
      bio: (profile.bio || '').slice(0, 220),
      verified: Boolean(profile.verified),
      isOnline: Boolean(profile.isOnline),
      lastActiveAtMs: profile.lastActiveAtMs || now,
      isDemoSeed: Boolean(profile.isDemoSeed),
      restricted: Boolean(profile.restricted),
      boosted: Boolean(profile.boosted),
      followers: (profile.followers || []).slice(0, 500),
      following: (profile.following || []).slice(0, 500),
      createdAtMs: now,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const safeCover = sanitizeCoverForCloud(profile.coverUrl);
    if (safeCover) createPayload.coverUrl = safeCover;
    if (profile.website) createPayload.website = profile.website.slice(0, 200);
    await setDoc(doc(db, 'profiles', createDocId), createPayload);
    return true;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `profiles/${toValidFirestoreId(profile.uid || profile.id)}`
    );
  }
}

export async function fetchAllProfilesFromCloud(
  fbUser: FirebaseUser | null
): Promise<UserProfile[]> {
  if (!fbUser || !fbUser.emailVerified) return [];
  const isBootAdmin = fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  try {
    const q = isBootAdmin
      ? query(collection(db, 'profiles'))
      : query(collection(db, 'profiles'), where('restricted', '==', false));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDocToProfile(d.id, d.data() as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function fetchProfileByUsernameFromCloud(
  username: string,
  fbUser: FirebaseUser | null
): Promise<UserProfile | null> {
  if (!fbUser || !fbUser.emailVerified) return null;
  const clean = toSafeUsername(username);
  if (!clean) return null;
  try {
    const q = query(
      collection(db, 'profiles'),
      where('restricted', '==', false),
      where('username', '==', clean),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data();
    return {
      id: String(data.id || d.id),
      uid: typeof data.uid === 'string' ? data.uid : undefined,
      username: String(data.username || clean),
      displayName: String(data.displayName || clean),
      avatarUrl: String(data.avatarUrl || '/og-preview.jpg'),
      coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
      bio: String(data.bio || ''),
      website: typeof data.website === 'string' ? data.website : undefined,
      verified: Boolean(data.verified),
      isOnline: Boolean(data.isOnline),
      lastActiveAtMs:
        typeof data.lastActiveAtMs === 'number'
          ? data.lastActiveAtMs
          : toMillis(data.updatedAt, 0) || undefined,
      isDemoSeed: Boolean(data.isDemoSeed),
      restricted: Boolean(data.restricted),
      boosted: Boolean(data.boosted),
      followers: Array.isArray(data.followers) ? data.followers : [],
      following: Array.isArray(data.following) ? data.following : [],
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'profiles');
    return null;
  }
}

export async function updateUserPresenceInCloud(
  profileIdRaw: string,
  isOnline: boolean,
  fbUser: FirebaseUser | null
): Promise<void> {
  if (!fbUser || !fbUser.emailVerified || !profileIdRaw) return;
  const profileId = toValidFirestoreId(profileIdRaw);
  const ref = doc(db, 'profiles', profileId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const isBootAdmin = fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (data.uid !== fbUser.uid && !isBootAdmin) return;
    await updateDoc(ref, {
      isOnline: Boolean(isOnline),
      lastActiveAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${profileId}`);
  }
}

function mapDocToProfile(idFallback: string, data: Record<string, unknown>): UserProfile {
  return {
    id: String(data.id || idFallback),
    uid: typeof data.uid === 'string' ? data.uid : undefined,
    username: String(data.username || ''),
    displayName: String(data.displayName || ''),
    avatarUrl: String(data.avatarUrl || '/og-preview.jpg'),
    coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
    bio: String(data.bio || ''),
    website: typeof data.website === 'string' ? data.website : undefined,
    verified: Boolean(data.verified),
    isOnline: Boolean(data.isOnline),
    lastActiveAtMs:
      typeof data.lastActiveAtMs === 'number'
        ? data.lastActiveAtMs
        : toMillis(data.updatedAt, 0) || undefined,
    isDemoSeed: Boolean(data.isDemoSeed),
    restricted: Boolean(data.restricted),
    boosted: Boolean(data.boosted),
    followers: Array.isArray(data.followers) ? (data.followers as string[]) : [],
    following: Array.isArray(data.following) ? (data.following as string[]) : [],
  };
}

function mapDocToPost(idFallback: string, data: Record<string, unknown>): Post {
  return {
    id: String(data.id || idFallback),
    authorId: String(data.authorId || ''),
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : undefined,
    media: Array.isArray(data.media) ? (data.media as Post['media']) : [],
    caption: String(data.caption || ''),
    location: typeof data.location === 'string' ? data.location : undefined,
    category: (data.category as Post['category']) || 'Fotografia',
    aspectRatio: (data.aspectRatio as Post['aspectRatio']) || '4:5',
    isReel: Boolean(data.isReel),
    audioTrack: typeof data.audioTrack === 'string' ? data.audioTrack : undefined,
    likes: Array.isArray(data.likes) ? (data.likes as string[]) : [],
    savedBy: Array.isArray(data.savedBy) ? (data.savedBy as string[]) : [],
    comments: Array.isArray(data.comments) ? (data.comments as Post['comments']) : [],
    createdAt:
      typeof data.createdAtMs === 'number'
        ? data.createdAtMs
        : toMillis(data.createdAt, Date.now()),
  };
}

function mapDocToStory(idFallback: string, data: Record<string, unknown>): StoryItem {
  return {
    id: String(data.id || idFallback),
    authorId: String(data.authorId || ''),
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : undefined,
    mediaUrl: String(data.mediaUrl || ''),
    caption: typeof data.caption === 'string' ? data.caption : undefined,
    location: typeof data.location === 'string' ? data.location : undefined,
    viewedBy: Array.isArray(data.viewedBy) ? (data.viewedBy as string[]) : [],
    reactions: Array.isArray(data.reactions)
      ? (data.reactions as StoryItem['reactions'])
      : [],
    createdAt:
      typeof data.createdAtMs === 'number'
        ? data.createdAtMs
        : toMillis(data.createdAt, Date.now()),
  };
}

export async function fetchUserProfileAndMediaFromCloud(
  identifier: string,
  fbUser: FirebaseUser | null
): Promise<{ user: UserProfile | null; posts: Post[]; stories: StoryItem[] }> {
  if (!fbUser || !fbUser.emailVerified || !identifier.trim()) {
    return { user: null, posts: [], stories: [] };
  }
  const cleanRaw = identifier.trim().replace(/^@/, '');
  const cleanHandle = cleanRaw.toLowerCase().replace(/[^a-z0-9._]/g, '');
  let foundUser: UserProfile | null = null;

  try {
    // 1. Try direct doc by profileId
    const directId = toValidFirestoreId(cleanRaw);
    try {
      const directSnap = await getDoc(doc(db, 'profiles', directId));
      if (directSnap.exists()) {
        foundUser = mapDocToProfile(directSnap.id, directSnap.data());
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `profiles/${directId}`);
    }

    // 2. Fallback query by username or uid
    if (!foundUser && cleanHandle.length >= 2) {
      const isBootAdmin = fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      const qByHandle = isBootAdmin
        ? query(collection(db, 'profiles'), where('username', '==', cleanHandle), limit(1))
        : query(
            collection(db, 'profiles'),
            where('restricted', '==', false),
            where('username', '==', cleanHandle),
            limit(1)
          );
      const snap = await getDocs(qByHandle);
      if (!snap.empty) {
        const d = snap.docs[0];
        foundUser = mapDocToProfile(d.id, d.data());
      }
    }

    if (!foundUser) {
      const isBootAdmin = fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      const qByUid = isBootAdmin
        ? query(collection(db, 'profiles'), where('uid', '==', cleanRaw), limit(1))
        : query(
            collection(db, 'profiles'),
            where('restricted', '==', false),
            where('uid', '==', cleanRaw),
            limit(1)
          );
      const snap = await getDocs(qByUid);
      if (!snap.empty) {
        const d = snap.docs[0];
        foundUser = mapDocToProfile(d.id, d.data());
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'profiles');
  }

  const authorKeys = Array.from(
    new Set([foundUser?.id, foundUser?.uid, cleanRaw].filter((v): v is string => Boolean(v)))
  );
  const postsMap = new Map<string, Post>();
  const storiesMap = new Map<string, StoryItem>();

  try {
    if (authorKeys.length > 0) {
      const [postsByAuthorId, postsByAuthorUid] = await Promise.all([
        getDocs(
          query(
            collection(db, 'posts'),
            where('visibility', '==', 'public'),
            where('authorId', 'in', authorKeys.slice(0, 10))
          )
        ),
        getDocs(
          query(
            collection(db, 'posts'),
            where('visibility', '==', 'public'),
            where('authorUid', 'in', authorKeys.slice(0, 10))
          )
        ),
      ]);
      for (const d of [...postsByAuthorId.docs, ...postsByAuthorUid.docs]) {
        const post = mapDocToPost(d.id, d.data());
        if (post.id && post.media.length > 0) postsMap.set(post.id, post);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }

  try {
    if (authorKeys.length > 0) {
      const [storiesByAuthorId, storiesByAuthorUid] = await Promise.all([
        getDocs(
          query(
            collection(db, 'stories'),
            where('active', '==', true),
            where('authorId', 'in', authorKeys.slice(0, 10))
          )
        ),
        getDocs(
          query(
            collection(db, 'stories'),
            where('active', '==', true),
            where('authorUid', '==', authorKeys.slice(0, 10))
          )
        ),
      ]);
      for (const d of [...storiesByAuthorId.docs, ...storiesByAuthorUid.docs]) {
        const st = mapDocToStory(d.id, d.data());
        if (st.id && st.mediaUrl) storiesMap.set(st.id, st);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'stories');
  }

  return {
    user: foundUser,
    posts: Array.from(postsMap.values()).sort((a, b) => b.createdAt - a.createdAt),
    stories: Array.from(storiesMap.values()).sort((a, b) => b.createdAt - a.createdAt),
  };
}

export async function migrateDemoDataToCloud(
  fbUser: FirebaseUser,
  demoUsers: UserProfile[],
  demoPosts: Post[],
  demoStories: StoryItem[]
): Promise<{
  profilesMigrated: number;
  postsMigrated: number;
  storiesMigrated: number;
  skipped: number;
}> {
  if (!fbUser.emailVerified || fbUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return { profilesMigrated: 0, postsMigrated: 0, storiesMigrated: 0, skipped: 0 };
  }

  await ensureAdminDocIfMatched(fbUser);

  let profilesMigrated = 0;
  let postsMigrated = 0;
  let storiesMigrated = 0;
  let skipped = 0;
  const now = Date.now();

  for (const u of demoUsers) {
    const profileId = toValidFirestoreId(u.id);
    const ref = doc(db, 'profiles', profileId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        skipped += 1;
        continue;
      }
      const payload: Record<string, unknown> = {
        id: profileId,
        uid: toValidFirestoreId(u.uid || `demo_${profileId}`),
        username: toSafeUsername(u.username),
        displayName: (u.displayName || u.username || 'Demo').slice(0, 80),
        avatarUrl: sanitizeAvatarForCloud(u.avatarUrl || '/og-preview.jpg'),
        bio: (u.bio || '').slice(0, 220),
        verified: Boolean(u.verified),
        isOnline: false,
        lastActiveAtMs: u.lastActiveAtMs || now,
        isDemoSeed: true,
        restricted: Boolean(u.restricted),
        boosted: Boolean(u.boosted),
        followers: (u.followers || []).slice(0, 500),
        following: (u.following || []).slice(0, 500),
        createdAtMs: now,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const safeCover = sanitizeCoverForCloud(u.coverUrl);
      if (safeCover) payload.coverUrl = safeCover;
      if (u.website) payload.website = u.website.slice(0, 200);
      await setDoc(ref, payload);
      profilesMigrated += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `profiles/${profileId}`);
    }
  }

  for (const p of demoPosts) {
    const postId = toValidFirestoreId(p.id);
    const ref = doc(db, 'posts', postId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        skipped += 1;
        continue;
      }
      const safeMedia = p.media
        .slice(0, 5)
        .map((m) => ({
          id: m.id,
          url: m.url.length <= 450_000 && !m.url.startsWith('blob:') ? m.url : '',
          alt: (m.alt || 'Publicação na Lumina').slice(0, 120),
          mediaType: m.mediaType || 'image',
          ...(m.filterCss ? { filterCss: m.filterCss.slice(0, 160) } : {}),
          ...(typeof m.durationSec === 'number' ? { durationSec: m.durationSec } : {}),
        }))
        .filter((m) => m.url.length > 0);
      if (safeMedia.length === 0) {
        skipped += 1;
        continue;
      }
      const payload: Record<string, unknown> = {
        id: postId,
        authorId: toValidFirestoreId(p.authorId),
        authorUid: fbUser.uid,
        visibility: 'public',
        media: safeMedia,
        caption: (p.caption || '').slice(0, 2200),
        category: p.category,
        aspectRatio: p.aspectRatio,
        likes: (p.likes || []).slice(0, 500),
        savedBy: (p.savedBy || []).slice(0, 500),
        comments: (p.comments || []).slice(0, 100),
        createdAtMs: p.createdAt || now,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (p.location) payload.location = p.location.slice(0, 120);
      if (typeof p.isReel === 'boolean') payload.isReel = p.isReel;
      if (p.audioTrack) payload.audioTrack = p.audioTrack.slice(0, 120);
      await setDoc(ref, payload);
      postsMigrated += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postId}`);
    }
  }

  for (const s of demoStories) {
    if (!s.mediaUrl || s.mediaUrl.length > 540_000) {
      skipped += 1;
      continue;
    }
    const storyId = toValidFirestoreId(s.id);
    const ref = doc(db, 'stories', storyId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        skipped += 1;
        continue;
      }
      const payload: Record<string, unknown> = {
        id: storyId,
        authorId: toValidFirestoreId(s.authorId),
        authorUid: fbUser.uid,
        active: true,
        mediaUrl: s.mediaUrl,
        viewedBy: (s.viewedBy || []).slice(0, 500),
        reactions: (s.reactions || []).slice(0, 200),
        createdAtMs: s.createdAt || now,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (s.caption) payload.caption = s.caption.slice(0, 300);
      if (s.location) payload.location = s.location.slice(0, 120);
      await setDoc(ref, payload);
      storiesMigrated += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `stories/${storyId}`);
    }
  }

  return { profilesMigrated, postsMigrated, storiesMigrated, skipped };
}

export async function updateProfileFollowersInCloud(
  targetProfileId: string,
  followers: string[]
): Promise<void> {
  const profileId = toValidFirestoreId(targetProfileId);
  const ref = doc(db, 'profiles', profileId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, {
      followers: followers.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${profileId}`);
  }
}

export async function createPostInCloud(
  post: Post,
  authorProfile: UserProfile,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  await upsertOwnProfileInCloud(authorProfile, fbUser);

  const postId = toValidFirestoreId(post.id);
  const path = `posts/${postId}`;
  const safeMedia = post.media
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      url: m.url.length <= 450_000 && !m.url.startsWith('blob:') ? m.url : '',
      alt: (m.alt || 'Publicação na Lumina').slice(0, 120),
      mediaType: m.mediaType || 'image',
      ...(m.filterCss ? { filterCss: m.filterCss.slice(0, 160) } : {}),
      ...(typeof m.durationSec === 'number' ? { durationSec: m.durationSec } : {}),
    }))
    .filter((m) => m.url.length > 0);

  if (safeMedia.length === 0) return;

  try {
    const payload: Record<string, unknown> = {
      id: postId,
      authorId: toValidFirestoreId(post.authorId),
      authorUid: fbUser.uid,
      visibility: 'public',
      media: safeMedia,
      caption: (post.caption || '').slice(0, 2200),
      category: post.category,
      aspectRatio: post.aspectRatio,
      likes: (post.likes || []).slice(0, 500),
      savedBy: (post.savedBy || []).slice(0, 500),
      comments: (post.comments || []).slice(0, 100),
      createdAtMs: post.createdAt || Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (post.location) payload.location = post.location.slice(0, 120);
    if (typeof post.isReel === 'boolean') payload.isReel = post.isReel;
    if (post.audioTrack) payload.audioTrack = post.audioTrack.slice(0, 120);

    await setDoc(doc(db, 'posts', postId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePostInteractionInCloud(
  post: Post
): Promise<void> {
  const postId = toValidFirestoreId(post.id);
  const ref = doc(db, 'posts', postId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, {
      likes: (post.likes || []).slice(0, 500),
      savedBy: (post.savedBy || []).slice(0, 500),
      comments: (post.comments || []).slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
  }
}

export async function deletePostInCloud(postIdRaw: string): Promise<void> {
  const postId = toValidFirestoreId(postIdRaw);
  const ref = doc(db, 'posts', postId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${postId}`);
  }
}

export async function createStoryInCloud(
  story: StoryItem,
  authorProfile: UserProfile,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  if (!story.mediaUrl || story.mediaUrl.length > 540_000) return;
  await upsertOwnProfileInCloud(authorProfile, fbUser);

  const storyId = toValidFirestoreId(story.id);
  const path = `stories/${storyId}`;
  try {
    const payload: Record<string, unknown> = {
      id: storyId,
      authorId: toValidFirestoreId(story.authorId),
      authorUid: fbUser.uid,
      active: true,
      mediaUrl: story.mediaUrl,
      viewedBy: (story.viewedBy || []).slice(0, 500),
      reactions: (story.reactions || []).slice(0, 200),
      createdAtMs: story.createdAt || Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (story.caption) payload.caption = story.caption.slice(0, 300);
    if (story.location) payload.location = story.location.slice(0, 120);

    await setDoc(doc(db, 'stories', storyId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStoryInteractionInCloud(
  story: StoryItem
): Promise<void> {
  const storyId = toValidFirestoreId(story.id);
  const ref = doc(db, 'stories', storyId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, {
      viewedBy: (story.viewedBy || []).slice(0, 500),
      reactions: (story.reactions || []).slice(0, 200),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `stories/${storyId}`);
  }
}

export async function upsertThreadInCloud(
  thread: DirectThread,
  participantUids: string[],
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  const threadId = toValidFirestoreId(thread.id);
  const ref = doc(db, 'threads', threadId);
  const safeUids = Array.from(new Set([fbUser.uid, ...participantUids.filter(Boolean)])).slice(0, 10);
  const safeMessages = thread.messages.slice(-150).map((m) => {
    const cleanMsg: Record<string, unknown> = {
      id: m.id,
      senderId: m.senderId,
      text: (m.text || '').slice(0, 2000),
      createdAt: m.createdAt || Date.now(),
    };
    if (m.sharedPostId) cleanMsg.sharedPostId = m.sharedPostId;
    if (m.storyReplyUrl && m.storyReplyUrl.length <= 160_000) cleanMsg.storyReplyUrl = m.storyReplyUrl;
    if (m.audioUrl && m.audioUrl.length <= 220_000) cleanMsg.audioUrl = m.audioUrl;
    if (typeof m.audioDurationSec === 'number') cleanMsg.audioDurationSec = m.audioDurationSec;
    if (m.videoUrl && m.videoUrl.length <= 220_000) cleanMsg.videoUrl = m.videoUrl;
    if (m.videoName) cleanMsg.videoName = m.videoName.slice(0, 120);
    if (m.fileUrl && m.fileUrl.length <= 220_000) cleanMsg.fileUrl = m.fileUrl;
    if (m.fileName) cleanMsg.fileName = m.fileName.slice(0, 140);
    if (m.fileMime) cleanMsg.fileMime = m.fileMime.slice(0, 100);
    if (typeof m.fileSize === 'number') cleanMsg.fileSize = m.fileSize;
    if (m.replyToId) cleanMsg.replyToId = m.replyToId;
    if (m.replyToSenderId) cleanMsg.replyToSenderId = m.replyToSenderId;
    if (m.replyToText) cleanMsg.replyToText = m.replyToText.slice(0, 240);
    if (m.reaction) cleanMsg.reaction = m.reaction;
    if (m.reactions && Object.keys(m.reactions).length > 0) cleanMsg.reactions = m.reactions;
    if (Array.isArray(m.readBy) && m.readBy.length > 0) cleanMsg.readBy = m.readBy.slice(0, 12);
    if (typeof m.seenAt === 'number') cleanMsg.seenAt = m.seenAt;
    if (typeof m.isCallLog === 'boolean') cleanMsg.isCallLog = m.isCallLog;
    if (m.callType) cleanMsg.callType = m.callType;
    if (m.callStatus) cleanMsg.callStatus = m.callStatus;
    if (typeof m.callDurationSec === 'number') cleanMsg.callDurationSec = m.callDurationSec;
    return cleanMsg;
  });

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: threadId,
        createdByUid: fbUser.uid,
        participantIds: thread.participantIds.slice(0, 10),
        participantUids: safeUids,
        messages: safeMessages,
        unreadBy: (thread.unreadBy || []).slice(0, 10),
        updatedAtMs: thread.updatedAt || Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        messages: safeMessages,
        unreadBy: (thread.unreadBy || []).slice(0, 10),
        updatedAtMs: thread.updatedAt || Date.now(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `threads/${threadId}`);
  }
}

export async function createNotificationInCloud(
  notif: NotificationItem,
  recipientUid: string | undefined,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified || !recipientUid) return;
  const cleanRecipientUid = toValidFirestoreId(recipientUid);
  const notifId = toValidFirestoreId(notif.id);
  const payload: Record<string, unknown> = {
    id: notifId,
    recipientId: toValidFirestoreId(notif.recipientId),
    recipientUid: cleanRecipientUid,
    actorId: toValidFirestoreId(notif.actorId),
    actorUid: fbUser.uid,
    type: notif.type,
    read: Boolean(notif.read),
    createdAtMs: notif.createdAt || Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (notif.postId) payload.postId = toValidFirestoreId(notif.postId).slice(0, 128);
  if (notif.text) payload.text = notif.text.slice(0, 400);

  try {
    await setDoc(doc(db, 'notifications', notifId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `notifications/${notifId}`);
  }
}

export async function markNotificationsReadInCloud(
  notificationIds: string[],
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified || notificationIds.length === 0) return;
  await Promise.all(
    notificationIds.slice(0, 40).map(async (rawId) => {
      const notifId = toValidFirestoreId(rawId);
      const ref = doc(db, 'notifications', notifId);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        if (data?.recipientUid !== fbUser.uid || data?.read === true) return;
        await updateDoc(ref, {
          read: true,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-fatal for local-only notification IDs
      }
    })
  );
}

export async function createInviteInCloud(
  invite: InviteRecord,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  const inviteId = toValidFirestoreId(invite.id);
  try {
    const payload: Record<string, unknown> = {
      id: inviteId,
      code: invite.code.slice(0, 32),
      email: invite.email.slice(0, 160),
      grantVerified: Boolean(invite.grantVerified),
      status: invite.status,
      expiresAt: invite.expiresAt,
      createdAtMs: invite.createdAt,
      createdByUid: fbUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (invite.invitedName) payload.invitedName = invite.invitedName.slice(0, 80);
    await setDoc(doc(db, 'invites', inviteId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `invites/${inviteId}`);
  }
}

export async function syncSiteMetaToCloud(
  meta: SiteMeta,
  fbUser: FirebaseUser
): Promise<void> {
  if (!fbUser.emailVerified) return;
  const ref = doc(db, 'site_meta', 'config');
  try {
    const snap = await getDoc(ref);
    const payload = {
      scope: 'public',
      version: meta.version.slice(0, 32),
      announcementBanner: meta.announcementBanner.slice(0, 240),
      maintenanceMode: Boolean(meta.maintenanceMode),
      realUsersOnly: Boolean(meta.realUsersOnly),
      maxVideoSizeMB: meta.videoRules.maxVideoSizeMB,
      maxReelDurationSec: meta.videoRules.maxReelDurationSec,
      allowVideoReels: Boolean(meta.videoRules.allowVideoReels),
      updatedByUid: fbUser.uid,
      updatedAt: serverTimestamp(),
    };
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'site_meta/config');
  }
}

export interface CloudListenersCallbacks {
  onProfiles: (profiles: UserProfile[]) => void;
  onPosts: (posts: Post[]) => void;
  onStories: (stories: StoryItem[]) => void;
  onThreads: (threads: DirectThread[]) => void;
  onNotifications: (notifications: NotificationItem[]) => void;
  onSiteMeta: (meta: SiteMeta) => void;
}

export function subscribeToCloudState(
  fbUser: FirebaseUser,
  callbacks: CloudListenersCallbacks
): () => void {
  const unsubscribers: (() => void)[] = [];

  const isBootAdmin = fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // 1. Public Profiles
  const profilesQuery = isBootAdmin
    ? query(collection(db, 'profiles'))
    : query(collection(db, 'profiles'), where('restricted', '==', false));
  unsubscribers.push(
    onSnapshot(
      profilesQuery,
      (snapshot) => {
        const list: UserProfile[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            uid: typeof data.uid === 'string' ? data.uid : undefined,
            username: String(data.username || ''),
            displayName: String(data.displayName || ''),
            avatarUrl: String(data.avatarUrl || ''),
            coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
            bio: String(data.bio || ''),
            website: typeof data.website === 'string' ? data.website : undefined,
            verified: Boolean(data.verified),
            isOnline: Boolean(data.isOnline),
            lastActiveAtMs:
              typeof data.lastActiveAtMs === 'number'
                ? data.lastActiveAtMs
                : toMillis(data.updatedAt, 0) || undefined,
            isDemoSeed: Boolean(data.isDemoSeed),
            restricted: Boolean(data.restricted),
            boosted: Boolean(data.boosted),
            followers: Array.isArray(data.followers) ? data.followers : [],
            following: Array.isArray(data.following) ? data.following : [],
          };
        });
        callbacks.onProfiles(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'profiles')
    )
  );

  // 2. Public Posts & Reels
  const postsQuery = query(collection(db, 'posts'), where('visibility', '==', 'public'));
  unsubscribers.push(
    onSnapshot(
      postsQuery,
      (snapshot) => {
        const list: Post[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              authorId: String(data.authorId || ''),
              authorUid: typeof data.authorUid === 'string' ? data.authorUid : undefined,
              media: Array.isArray(data.media) ? data.media : [],
              caption: String(data.caption || ''),
              location: typeof data.location === 'string' ? data.location : undefined,
              category: data.category || 'Fotografia',
              aspectRatio: data.aspectRatio || '4:5',
              isReel: Boolean(data.isReel),
              audioTrack: typeof data.audioTrack === 'string' ? data.audioTrack : undefined,
              likes: Array.isArray(data.likes) ? data.likes : [],
              savedBy: Array.isArray(data.savedBy) ? data.savedBy : [],
              comments: Array.isArray(data.comments) ? data.comments : [],
              createdAt:
                typeof data.createdAtMs === 'number'
                  ? data.createdAtMs
                  : toMillis(data.createdAt, Date.now()),
            } as Post;
          })
          .sort((a, b) => b.createdAt - a.createdAt);
        callbacks.onPosts(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'posts')
    )
  );

  // 3. Active Stories
  const storiesQuery = query(collection(db, 'stories'), where('active', '==', true));
  unsubscribers.push(
    onSnapshot(
      storiesQuery,
      (snapshot) => {
        const list: StoryItem[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              authorId: String(data.authorId || ''),
              authorUid: typeof data.authorUid === 'string' ? data.authorUid : undefined,
              mediaUrl: String(data.mediaUrl || ''),
              caption: typeof data.caption === 'string' ? data.caption : undefined,
              location: typeof data.location === 'string' ? data.location : undefined,
              viewedBy: Array.isArray(data.viewedBy) ? data.viewedBy : [],
              reactions: Array.isArray(data.reactions) ? data.reactions : [],
              createdAt:
                typeof data.createdAtMs === 'number'
                  ? data.createdAtMs
                  : toMillis(data.createdAt, Date.now()),
            } as StoryItem;
          })
          .sort((a, b) => b.createdAt - a.createdAt);
        callbacks.onStories(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'stories')
    )
  );

  // 4. Participant-scoped Direct Message Threads
  const threadsQuery = query(
    collection(db, 'threads'),
    where('participantUids', 'array-contains', fbUser.uid)
  );
  unsubscribers.push(
    onSnapshot(
      threadsQuery,
      (snapshot) => {
        const list: DirectThread[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              participantIds: Array.isArray(data.participantIds) ? data.participantIds : [],
              messages: Array.isArray(data.messages) ? data.messages : [],
              unreadBy: Array.isArray(data.unreadBy) ? data.unreadBy : [],
              updatedAt:
                typeof data.updatedAtMs === 'number'
                  ? data.updatedAtMs
                  : toMillis(data.updatedAt, Date.now()),
            } as DirectThread;
          })
          .sort((a, b) => b.updatedAt - a.updatedAt);
        callbacks.onThreads(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'threads')
    )
  );

  // 5. Recipient-scoped Notifications
  const notifsQuery = query(
    collection(db, 'notifications'),
    where('recipientUid', '==', fbUser.uid)
  );
  unsubscribers.push(
    onSnapshot(
      notifsQuery,
      (snapshot) => {
        const list: NotificationItem[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              recipientId: String(data.recipientId || ''),
              actorId: String(data.actorId || ''),
              type: data.type || 'like',
              postId: typeof data.postId === 'string' ? data.postId : undefined,
              text: typeof data.text === 'string' ? data.text : undefined,
              read: Boolean(data.read),
              createdAt:
                typeof data.createdAtMs === 'number'
                  ? data.createdAtMs
                  : toMillis(data.createdAt, Date.now()),
            } as NotificationItem;
          })
          .sort((a, b) => b.createdAt - a.createdAt);
        callbacks.onNotifications(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'notifications')
    )
  );

  // 6. Global Site Meta
  unsubscribers.push(
    onSnapshot(
      doc(db, 'site_meta', 'config'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        callbacks.onSiteMeta({
          version: String(data.version || '2.4.0'),
          announcementBanner: String(data.announcementBanner || ''),
          maintenanceMode: Boolean(data.maintenanceMode),
          realUsersOnly: Boolean(data.realUsersOnly),
          videoRules: {
            maxVideoSizeMB: Number(data.maxVideoSizeMB || 25),
            maxReelDurationSec: Number(data.maxReelDurationSec || 60),
            allowVideoReels:
              typeof data.allowVideoReels === 'boolean' ? data.allowVideoReels : true,
          },
        });
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'site_meta/config')
    )
  );

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

function stripUndefinedEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean;
}

export async function sendCallSignalInCloud(
  signal: CallSignalPayload,
  participantUids: string[],
  fbUser: FirebaseUser | null
): Promise<void> {
  if (!fbUser || !fbUser.emailVerified) return;
  const signalId = toValidFirestoreId(
    `cs_${signal.callId}_${signal.type.replace(':', '_')}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`
  );
  const toUidSafe = toValidFirestoreId(signal.toUid || signal.toUserId);
  const safeParticipantUids = Array.from(
    new Set([fbUser.uid, toUidSafe, ...participantUids.map((u) => toValidFirestoreId(u))].filter(Boolean))
  ).slice(0, 6);

  const payload: Record<string, unknown> = {
    id: signalId,
    callId: signal.callId.slice(0, 128),
    type: signal.type,
    fromUserId: toValidFirestoreId(signal.fromUserId),
    fromUid: fbUser.uid,
    toUserId: toValidFirestoreId(signal.toUserId),
    toUid: toUidSafe,
    participantUids: safeParticipantUids,
    consumed: false,
    createdAtMs: signal.createdAt || Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (signal.fromUsername) payload.fromUsername = signal.fromUsername.slice(0, 40);
  if (signal.fromDisplayName) payload.fromDisplayName = signal.fromDisplayName.slice(0, 80);
  if (signal.fromAvatarUrl && signal.fromAvatarUrl.length <= 440_000) {
    payload.fromAvatarUrl = signal.fromAvatarUrl;
  }
  if (signal.callType) payload.callType = signal.callType;
  if (signal.threadId) payload.threadId = signal.threadId.slice(0, 128);
  if (signal.sdp && typeof signal.sdp === 'object') {
    payload.sdp = stripUndefinedEntries({
      type: signal.sdp.type,
      sdp: signal.sdp.sdp,
    });
  }
  if (signal.candidate && typeof signal.candidate === 'object') {
    payload.candidate = stripUndefinedEntries({
      candidate: signal.candidate.candidate,
      sdpMid: signal.candidate.sdpMid ?? undefined,
      sdpMLineIndex: signal.candidate.sdpMLineIndex ?? undefined,
      usernameFragment: signal.candidate.usernameFragment ?? undefined,
    });
  }
  if (signal.reason) payload.reason = signal.reason.slice(0, 120);
  if (typeof signal.micMuted === 'boolean') payload.micMuted = signal.micMuted;
  if (typeof signal.camOff === 'boolean') payload.camOff = signal.camOff;

  try {
    await setDoc(doc(db, 'call_signals', signalId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `call_signals/${signalId}`);
  }
}

export function subscribeToCallSignalsInCloud(
  fbUser: FirebaseUser,
  onSignal: (signal: CallSignalPayload) => void
): () => void {
  if (!fbUser.emailVerified) return () => {};
  const seenIds = new Set<string>();
  const q = query(
    collection(db, 'call_signals'),
    where('participantUids', 'array-contains', fbUser.uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      const sorted = snapshot.docs
        .map((d) => ({ docId: d.id, data: d.data() }))
        .filter(({ docId, data }) => {
          if (seenIds.has(docId)) return false;
          if (data.consumed === true) return false;
          if (data.fromUid === fbUser.uid) return false;
          const createdMs =
            typeof data.createdAtMs === 'number'
              ? data.createdAtMs
              : toMillis(data.createdAt, now);
          return now - createdMs <= 90_000;
        })
        .sort(
          (a, b) =>
            (typeof a.data.createdAtMs === 'number' ? a.data.createdAtMs : 0) -
            (typeof b.data.createdAtMs === 'number' ? b.data.createdAtMs : 0)
        );

      for (const item of sorted) {
        seenIds.add(item.docId);
        const d = item.data;
        const sig: CallSignalPayload = {
          callId: String(d.callId || ''),
          type: d.type as CallSignalPayload['type'],
          fromUserId: String(d.fromUserId || ''),
          fromUid: typeof d.fromUid === 'string' ? d.fromUid : undefined,
          fromUsername: typeof d.fromUsername === 'string' ? d.fromUsername : undefined,
          fromDisplayName: typeof d.fromDisplayName === 'string' ? d.fromDisplayName : undefined,
          fromAvatarUrl: typeof d.fromAvatarUrl === 'string' ? d.fromAvatarUrl : undefined,
          toUserId: String(d.toUserId || ''),
          toUid: typeof d.toUid === 'string' ? d.toUid : undefined,
          callType: d.callType === 'audio' || d.callType === 'video' ? d.callType : undefined,
          threadId: typeof d.threadId === 'string' ? d.threadId : undefined,
          sdp: d.sdp as RTCSessionDescriptionInit | undefined,
          candidate: d.candidate as RTCIceCandidateInit | undefined,
          reason: typeof d.reason === 'string' ? d.reason : undefined,
          micMuted: typeof d.micMuted === 'boolean' ? d.micMuted : undefined,
          camOff: typeof d.camOff === 'boolean' ? d.camOff : undefined,
          createdAt:
            typeof d.createdAtMs === 'number'
              ? d.createdAtMs
              : toMillis(d.createdAt, now),
        };
        if (sig.callId && sig.type) {
          onSignal(sig);
        }
        updateDoc(doc(db, 'call_signals', item.docId), {
          consumed: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'call_signals')
  );
}
