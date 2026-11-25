export type NavSection =
  | 'feed'
  | 'explore'
  | 'reels'
  | 'messages'
  | 'notifications'
  | 'profile'
  | 'admin';

export type PostCategory =
  | 'Fotografia'
  | 'Arquitetura'
  | 'Gastronomia'
  | 'Viagem'
  | 'Design'
  | 'Arte';

export interface UserProfile {
  id: string;
  uid?: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  coverUrl?: string;
  bio: string;
  email?: string;
  website?: string;
  verified?: boolean;
  isOnline?: boolean;
  isDemoSeed?: boolean;
  restricted?: boolean;
  boosted?: boolean;
  followers: string[];
  following: string[];
}

export interface VideoRulesConfig {
  maxVideoSizeMB: number;
  maxReelDurationSec: number;
  allowVideoReels: boolean;
}

export interface InviteRecord {
  id: string;
  code: string;
  email: string;
  invitedName?: string;
  grantVerified: boolean;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: number;
  expiresAt: number;
  acceptedByUserId?: string;
}

export interface SiteMeta {
  version: string;
  announcementBanner: string;
  maintenanceMode: boolean;
  realUsersOnly: boolean;
  videoRules: VideoRulesConfig;
}

export interface CommentReply {
  id: string;
  userId: string;
  text: string;
  createdAt: number;
  likes: string[];
}

export interface PostComment {
  id: string;
  userId: string;
  text: string;
  createdAt: number;
  likes: string[];
  replies: CommentReply[];
}

export interface MediaAsset {
  id: string;
  url: string;
  alt: string;
  filterCss?: string;
  mediaType?: 'image' | 'video';
  durationSec?: number;
}

export interface Post {
  id: string;
  authorId: string;
  authorUid?: string;
  media: MediaAsset[];
  caption: string;
  location?: string;
  category: PostCategory;
  aspectRatio: '1:1' | '4:5' | '16:9' | '9:16';
  isReel?: boolean;
  audioTrack?: string;
  likes: string[];
  savedBy: string[];
  comments: PostComment[];
  createdAt: number;
}

export interface StoryItem {
  id: string;
  authorId: string;
  authorUid?: string;
  mediaUrl: string;
  caption?: string;
  location?: string;
  createdAt: number;
  viewedBy: string[];
  reactions: { userId: string; emoji: string }[];
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  sharedPostId?: string;
  storyReplyUrl?: string;
  audioUrl?: string;
  audioDurationSec?: number;
  videoUrl?: string;
  videoName?: string;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  replyToId?: string;
  replyToSenderId?: string;
  replyToText?: string;
  reaction?: string;
  reactions?: Record<string, string>;
  readBy?: string[];
  seenAt?: number;
  createdAt: number;
}

export interface DirectThread {
  id: string;
  participantIds: string[];
  messages: DirectMessage[];
  unreadBy: string[];
  lastReadBy?: Record<string, number>;
  updatedAt: number;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string;
  type: 'like' | 'comment' | 'follow' | 'mention';
  postId?: string;
  text?: string;
  createdAt: number;
  read: boolean;
}

export type FilterPresetId =
  | 'normal'
  | 'clarendon'
  | 'gingham'
  | 'moon'
  | 'lark'
  | 'reyes'
  | 'juno'
  | 'aden';

export interface StudioAdjustments {
  preset: FilterPresetId;
  brightness: number; // 50..150, default 100
  contrast: number; // 50..150, default 100
  saturate: number; // 0..200, default 100
  warmth: number; // -30..30 sepia/hue, default 0
}
