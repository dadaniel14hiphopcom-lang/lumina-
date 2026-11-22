// Phase 0 Specification Tests — Dirty Dozen Verification Matrix
// Run against Firebase Emulator Suite (@firebase/rules-unit-testing) when testing locally.

export interface DirtyDozenCase {
  id: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  actorUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 'DD-01-unauthenticated-profile-create',
    collection: 'profiles/user_1',
    operation: 'create',
    actorUid: null,
    emailVerified: false,
    payload: { uid: 'user_1', username: 'anon', displayName: 'Anon' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-02-post-identity-spoofing',
    collection: 'posts/post_1',
    operation: 'create',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { authorUid: 'uid_b', authorId: 'uid_b', caption: 'Spoofed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-03-shadow-verified-escalation',
    collection: 'profiles/uid_a',
    operation: 'update',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-04-shadow-boosted-create',
    collection: 'profiles/uid_a',
    operation: 'create',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { uid: 'uid_a', boosted: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-05-pii-snooping',
    collection: 'users_private/uid_b',
    operation: 'get',
    actorUid: 'uid_a',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-06-pii-list-scraping',
    collection: 'users_private',
    operation: 'list',
    actorUid: 'uid_a',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-07-id-poisoning',
    collection: `posts/${'x'.repeat(200)}`,
    operation: 'create',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { authorUid: 'uid_a' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-08-timestamp-forgery',
    collection: 'posts/post_2',
    operation: 'create',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { authorUid: 'uid_a', createdAt: 1700000000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-09-thread-hijack',
    collection: 'threads/thread_ab',
    operation: 'update',
    actorUid: 'uid_c',
    emailVerified: true,
    payload: { messages: [] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-10-ghost-field-update-on-like',
    collection: 'posts/post_1',
    operation: 'update',
    actorUid: 'uid_b',
    emailVerified: true,
    payload: { likes: ['uid_b'], caption: 'Hacked caption' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-11-non-admin-invite-create',
    collection: 'invites/inv_fake',
    operation: 'create',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { code: 'LUM-HACK1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-12-terminal-invite-replay',
    collection: 'invites/inv_revoked',
    operation: 'update',
    actorUid: 'uid_a',
    emailVerified: true,
    payload: { status: 'accepted', acceptedByUid: 'uid_a' },
    expected: 'PERMISSION_DENIED',
  },
];
