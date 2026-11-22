# Lumina Social — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Non-PII Public Profile Separation**: `profiles/{profileId}` never stores private PII (`email`, password hashes). Private user contact data (`email`) is strictly isolated in `users_private/{uid}` readable and writable only by the owner (`request.auth.uid == uid`) or an admin.
2. **Identity Integrity**: Every document created in `profiles`, `users_private`, `posts`, `stories`, `notifications`, and `threads` must bind its ownership UID field (`uid`, `authorUid`, `actorUid`, `createdByUid`) to `request.auth.uid`.
3. **Privilege & Moderation Lock**: Regular authenticated users cannot self-assign or modify `verified`, `boosted`, or `restricted` flags on `profiles`, nor write to `admins/{uid}`, `invites/{inviteId}` (except accepting a pending invite), or `site_meta/{docId}`. Only verified administrators (`admins/{uid}` or bootstrapped verified admin email) can mutate those controls.
4. **Immutable Ownership & Server Timestamps**: `createdAt` and ownership UIDs (`uid`, `authorUid`, `createdByUid`) are immutable after creation, and `createdAt` / `updatedAt` are strictly validated against `request.time`.
5. **Bounded Fields & Arrays**: Every string field has an explicit `.size()` limit, every document ID matches `^[a-zA-Z0-9_\-]+$` with length `<= 128`, and every array (`followers`, `following`, `likes`, `savedBy`, `comments`, `viewedBy`, `reactions`, `media`, `messages`, `participantIds`, `participantUids`, `unreadBy`) is strictly bounded in length.
6. **Participant-Scoped Messaging & Recipient-Scoped Notifications**: `threads/{threadId}` is readable/writable only by listed participants (`request.auth.uid in participantUids`) or admins. `notifications/{notifId}` is readable only by the `recipientUid` or admins.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Profile Create**: `request.auth == null` writing to `profiles/user_1` -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Post**: Authenticated user A (`uid_a`) creates `posts/post_1` with `authorUid: "uid_b"` -> `PERMISSION_DENIED`.
3. **Shadow Verification Escalation**: Authenticated user A updates `profiles/uid_a` adding `verified: true` -> `PERMISSION_DENIED`.
4. **Shadow Boost Escalation**: Authenticated user A creates `profiles/uid_a` with `boosted: true` -> `PERMISSION_DENIED`.
5. **PII Snooping**: Authenticated user A reads `users_private/uid_b` -> `PERMISSION_DENIED`.
6. **Blanket List Query Scraping on Private Info**: User A lists `users_private` without `where('uid', '==', uid_a)` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: Creating `posts/bad..id..with..1500..chars` -> `PERMISSION_DENIED`.
8. **Timestamp Forgery**: Creating `posts/post_2` with `createdAt: 1700000000` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Non-Participant Thread Hijack**: User C reads or updates `threads/thread_ab` where `participantUids: ["uid_a", "uid_b"]` -> `PERMISSION_DENIED`.
10. **Ghost Field Injection on Like Update**: User B updates `posts/post_1` changing `caption` alongside `likes` -> `PERMISSION_DENIED`.
11. **Invite Forgery**: Non-admin user creates `invites/inv_fake` -> `PERMISSION_DENIED`.
12. **Terminal Invite Replay**: Accepting an already `revoked` or `accepted` invite -> `PERMISSION_DENIED`.
