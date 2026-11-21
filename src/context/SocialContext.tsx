import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  DirectThread,
  NavSection,
  NotificationItem,
  Post,
  PostCategory,
  SiteMeta,
  StoryItem,
  UserProfile,
} from '../types';
import {
  SEED_NOTIFICATIONS,
  SEED_POSTS,
  SEED_STORIES,
  SEED_THREADS,
  SEED_USERS,
} from '../data/seed';

interface PersistedState {
  currentUserId: string;
  users: UserProfile[];
  posts: Post[];
  stories: StoryItem[];
  threads: DirectThread[];
  notifications: NotificationItem[];
  recentSearches: string[];
  theme: 'light' | 'dark';
}

const STORAGE_KEY = 'lumina_social_v1';

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.posts)) {
        return {
          ...parsed,
          users: parsed.users.map((u) => {
            if (u.isOnline !== undefined) return u;
            const seedMatch = SEED_USERS.find((s) => s.id === u.id);
            return { ...u, isOnline: seedMatch?.isOnline ?? true };
          }),
        };
      }
    }
  } catch {
    // Fallback to seed
  }
  return {
    currentUserId: 'user_daniel',
    users: SEED_USERS,
    posts: SEED_POSTS,
    stories: SEED_STORIES,
    threads: SEED_THREADS,
    notifications: SEED_NOTIFICATIONS,
    recentSearches: ['arquitetura', 'clara.lentes', '35mm'],
    theme: 'light',
  };
}

interface SocialContextValue {
  currentUser: UserProfile;
  users: UserProfile[];
  posts: Post[];
  stories: StoryItem[];
  threads: DirectThread[];
  notifications: NotificationItem[];
  recentSearches: string[];
  theme: 'light' | 'dark';
  activeNav: NavSection;
  viewingProfileId: string | null;
  exploreQuery: string;
  selectedPostId: string | null;
  activeStoryAuthorId: string | null;
  isCreateOpen: boolean;
  sharePostId: string | null;
  toastMessage: string | null;
  siteMeta: SiteMeta;
  setSiteMeta: (meta: SiteMeta) => void;
  refreshSiteMeta: () => Promise<void>;

  setActiveNav: (nav: NavSection) => void;
  openProfile: (userId: string) => void;
  openHashtagInExplore: (tag: string) => void;
  setExploreQuery: (q: string) => void;
  setSelectedPostId: (id: string | null) => void;
  setActiveStoryAuthorId: (id: string | null) => void;
  setIsCreateOpen: (open: boolean) => void;
  setSharePostId: (postId: string | null) => void;
  toggleTheme: () => void;
  showToast: (msg: string) => void;

  switchUser: (userId: string) => void;
  createAccount: (data: { username: string; displayName: string; bio: string }) => void;
  updateProfile: (updates: Partial<Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl'>>) => void;

  toggleFollow: (targetUserId: string) => void;
  toggleLikePost: (postId: string) => void;
  toggleSavePost: (postId: string) => void;
  addComment: (postId: string, text: string, parentCommentId?: string) => void;
  toggleLikeComment: (postId: string, commentId: string) => void;
  deletePost: (postId: string) => void;

  publishPost: (payload: {
    mediaUrls: string[];
    caption: string;
    location?: string;
    category: PostCategory;
    aspectRatio: '1:1' | '4:5' | '16:9' | '9:16';
    isReel?: boolean;
    audioTrack?: string;
  }) => void;

  publishStory: (payload: { mediaUrl: string; caption?: string; location?: string }) => void;
  markStoryViewed: (storyId: string) => void;
  reactToStory: (storyId: string, emoji: string) => void;

  sendMessage: (
    recipientId: string,
    text: string,
    options?: {
      sharedPostId?: string;
      storyReplyUrl?: string;
      audioUrl?: string;
      audioDurationSec?: number;
      videoUrl?: string;
      videoName?: string;
    }
  ) => void;
  markThreadRead: (threadId: string) => void;
  reactToMessage: (threadId: string, messageId: string, emoji: string) => void;

  markNotificationsRead: () => void;
  addRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;
  resetDemoData: () => void;

  toggleRestrictUser: (userId: string) => void;
  toggleBoostUser: (userId: string) => void;
  toggleVerifyUser: (userId: string) => void;

  getUserById: (id: string) => UserProfile | undefined;
}

const SocialContext = createContext<SocialContextValue | null>(null);

const AUTO_REPLIES = [
  'Que legal! Adorei isso.',
  'Acabei de ver aqui — ficou excelente!',
  'Vamos combinar sim, essa semana estou livre.',
  'Boa! Manda mais detalhes quando puder.',
];

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadInitialState);
  const [activeNav, setActiveNav] = useState<NavSection>('feed');
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [activeStoryAuthorId, setActiveStoryAuthorId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [siteMeta, setSiteMeta] = useState<SiteMeta>({
    version: '2.4.0',
    announcementBanner: '',
    maintenanceMode: false,
  });

  const refreshSiteMeta = async () => {
    try {
      const res = await fetch('/api/site/meta');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as SiteMeta;
        if (data && typeof data.version === 'string') {
          setSiteMeta(data);
          return;
        }
      }
    } catch {
      // Fallback to local admin state on static hosting
    }
    try {
      const raw = localStorage.getItem('lumina_admin_local_state_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as { site?: Partial<SiteMeta> };
        if (parsed?.site) {
          setSiteMeta((prev) => ({
            version: typeof parsed.site?.version === 'string' ? parsed.site.version : prev.version,
            announcementBanner:
              typeof parsed.site?.announcementBanner === 'string'
                ? parsed.site.announcementBanner
                : prev.announcementBanner,
            maintenanceMode:
              typeof parsed.site?.maintenanceMode === 'boolean'
                ? parsed.site.maintenanceMode
                : prev.maintenanceMode,
          }));
        }
      }
    } catch {
      // Ignore storage error
    }
  };

  useEffect(() => {
    refreshSiteMeta();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state.theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      try {
        const compactState: PersistedState = {
          ...state,
          threads: state.threads.map((t) => ({
            ...t,
            messages: t.messages.map((m) => ({
              ...m,
              videoUrl: m.videoUrl && m.videoUrl.length > 500_000 ? undefined : m.videoUrl,
              audioUrl: m.audioUrl && m.audioUrl.length > 500_000 ? undefined : m.audioUrl,
            })),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
      } catch {
        // Keep running smoothly in memory
      }
    }
  }, [state]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2800);
  };

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === state.currentUserId) || state.users[0],
    [state.users, state.currentUserId]
  );

  const getUserById = (id: string) => state.users.find((u) => u.id === id);

  const openProfile = (userId: string) => {
    setViewingProfileId(userId);
    setActiveNav('profile');
  };

  const openHashtagInExplore = (tag: string) => {
    setExploreQuery(tag);
    setSelectedPostId(null);
    setActiveNav('explore');
  };

  const toggleTheme = () => {
    setState((prev) => {
      const nextTheme = prev.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', nextTheme === 'dark');
      return {
        ...prev,
        theme: nextTheme,
      };
    });
  };

  const switchUser = (userId: string) => {
    setState((prev) => ({ ...prev, currentUserId: userId }));
    setViewingProfileId(null);
    const u = state.users.find((item) => item.id === userId);
    if (u) showToast(`Conectado como @${u.username}`);
  };

  const createAccount = (data: { username: string; displayName: string; bio: string }) => {
    const cleanHandle = data.username.toLowerCase().replace(/[^a-z0-9._]/g, '') || `usuario.${Date.now()}`;
    const newId = `user_${Date.now()}`;
    const newUser: UserProfile = {
      id: newId,
      username: cleanHandle,
      displayName: data.displayName.trim() || cleanHandle,
      avatarUrl: SEED_USERS[0].avatarUrl,
      bio: data.bio.trim() || 'Novo perfil na Lumina.',
      verified: false,
      followers: [],
      following: ['user_clara', 'user_lucas'],
    };
    setState((prev) => ({
      ...prev,
      users: [newUser, ...prev.users],
      currentUserId: newId,
    }));
    setViewingProfileId(null);
    showToast(`Conta @${cleanHandle} criada com sucesso`);
  };

  const updateProfile = (
    updates: Partial<Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'website' | 'avatarUrl'>>
  ) => {
    setState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === prev.currentUserId ? { ...u, ...updates } : u
      ),
    }));
    showToast('Perfil atualizado');
  };

  const toggleFollow = (targetUserId: string) => {
    if (targetUserId === currentUser.id) return;
    setState((prev) => {
      const me = prev.users.find((u) => u.id === prev.currentUserId);
      if (!me) return prev;
      const isFollowing = me.following.includes(targetUserId);

      const updatedUsers = prev.users.map((u) => {
        if (u.id === prev.currentUserId) {
          return {
            ...u,
            following: isFollowing
              ? u.following.filter((id) => id !== targetUserId)
              : [...u.following, targetUserId],
          };
        }
        if (u.id === targetUserId) {
          return {
            ...u,
            followers: isFollowing
              ? u.followers.filter((id) => id !== prev.currentUserId)
              : [...u.followers, prev.currentUserId],
          };
        }
        return u;
      });

      const newNotifs = !isFollowing
        ? [
            {
              id: `notif_${Date.now()}`,
              recipientId: targetUserId,
              actorId: prev.currentUserId,
              type: 'follow' as const,
              createdAt: Date.now(),
              read: false,
            },
            ...prev.notifications,
          ]
        : prev.notifications;

      return { ...prev, users: updatedUsers, notifications: newNotifs };
    });
  };

  const toggleLikePost = (postId: string) => {
    setState((prev) => {
      const targetPost = prev.posts.find((p) => p.id === postId);
      const alreadyLiked = targetPost?.likes.includes(prev.currentUserId);

      const posts = prev.posts.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          likes: alreadyLiked
            ? p.likes.filter((id) => id !== prev.currentUserId)
            : [...p.likes, prev.currentUserId],
        };
      });

      const notifications =
        !alreadyLiked && targetPost && targetPost.authorId !== prev.currentUserId
          ? [
              {
                id: `notif_${Date.now()}`,
                recipientId: targetPost.authorId,
                actorId: prev.currentUserId,
                type: 'like' as const,
                postId,
                createdAt: Date.now(),
                read: false,
              },
              ...prev.notifications,
            ]
          : prev.notifications;

      return { ...prev, posts, notifications };
    });
  };

  const toggleSavePost = (postId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => {
        if (p.id !== postId) return p;
        const saved = p.savedBy.includes(prev.currentUserId);
        return {
          ...p,
          savedBy: saved
            ? p.savedBy.filter((id) => id !== prev.currentUserId)
            : [...p.savedBy, prev.currentUserId],
        };
      }),
    }));
  };

  const addComment = (postId: string, text: string, parentCommentId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((prev) => {
      const targetPost = prev.posts.find((p) => p.id === postId);
      const posts = prev.posts.map((p) => {
        if (p.id !== postId) return p;
        if (parentCommentId) {
          return {
            ...p,
            comments: p.comments.map((c) =>
              c.id === parentCommentId
                ? {
                    ...c,
                    replies: [
                      ...c.replies,
                      {
                        id: `rep_${Date.now()}`,
                        userId: prev.currentUserId,
                        text: trimmed,
                        createdAt: Date.now(),
                        likes: [],
                      },
                    ],
                  }
                : c
            ),
          };
        }
        return {
          ...p,
          comments: [
            ...p.comments,
            {
              id: `com_${Date.now()}`,
              userId: prev.currentUserId,
              text: trimmed,
              createdAt: Date.now(),
              likes: [],
              replies: [],
            },
          ],
        };
      });

      const notifications =
        targetPost && targetPost.authorId !== prev.currentUserId
          ? [
              {
                id: `notif_${Date.now()}`,
                recipientId: targetPost.authorId,
                actorId: prev.currentUserId,
                type: 'comment' as const,
                postId,
                text: trimmed,
                createdAt: Date.now(),
                read: false,
              },
              ...prev.notifications,
            ]
          : prev.notifications;

      return { ...prev, posts, notifications };
    });
  };

  const toggleLikeComment = (postId: string, commentId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: p.comments.map((c) => {
            if (c.id !== commentId) return c;
            const liked = c.likes.includes(prev.currentUserId);
            return {
              ...c,
              likes: liked
                ? c.likes.filter((id) => id !== prev.currentUserId)
                : [...c.likes, prev.currentUserId],
            };
          }),
        };
      }),
    }));
  };

  const deletePost = (postId: string) => {
    setState((prev) => ({
      ...prev,
      posts: prev.posts.filter((p) => p.id !== postId),
    }));
    if (selectedPostId === postId) setSelectedPostId(null);
    showToast('Publicação removida');
  };

  const publishPost = (payload: {
    mediaUrls: string[];
    caption: string;
    location?: string;
    category: PostCategory;
    aspectRatio: '1:1' | '4:5' | '16:9' | '9:16';
    isReel?: boolean;
    audioTrack?: string;
  }) => {
    if (currentUser.restricted) {
      showToast('Conta restrita pela administração — publicação bloqueada');
      return;
    }
    const newPost: Post = {
      id: `post_${Date.now()}`,
      authorId: currentUser.id,
      media: payload.mediaUrls.map((url, idx) => ({
        id: `m_${Date.now()}_${idx}`,
        url,
        alt: payload.caption.slice(0, 80) || 'Foto publicada na Lumina',
      })),
      caption: payload.caption.trim(),
      location: payload.location?.trim() || undefined,
      category: payload.category,
      aspectRatio: payload.aspectRatio,
      isReel: payload.isReel,
      audioTrack: payload.audioTrack,
      likes: [],
      savedBy: [],
      comments: [],
      createdAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      posts: [newPost, ...prev.posts],
    }));
    setActiveNav(payload.isReel ? 'reels' : 'feed');
    showToast(payload.isReel ? 'Reel publicado no feed' : 'Publicação compartilhada');
  };

  const publishStory = (payload: { mediaUrl: string; caption?: string; location?: string }) => {
    const newStory: StoryItem = {
      id: `story_${Date.now()}`,
      authorId: currentUser.id,
      mediaUrl: payload.mediaUrl,
      caption: payload.caption?.trim() || undefined,
      location: payload.location?.trim() || undefined,
      createdAt: Date.now(),
      viewedBy: [],
      reactions: [],
    };
    setState((prev) => ({
      ...prev,
      stories: [newStory, ...prev.stories],
    }));
    setActiveNav('feed');
    showToast('Story publicado por 24 horas');
  };

  const markStoryViewed = (storyId: string) => {
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId && !s.viewedBy.includes(prev.currentUserId)
          ? { ...s, viewedBy: [...s.viewedBy, prev.currentUserId] }
          : s
      ),
    }));
  };

  const reactToStory = (storyId: string, emoji: string) => {
    setState((prev) => ({
      ...prev,
      stories: prev.stories.map((s) =>
        s.id === storyId
          ? {
              ...s,
              reactions: [...s.reactions, { userId: prev.currentUserId, emoji }],
            }
          : s
      ),
    }));
    showToast(`Reação ${emoji} enviada`);
  };

  const sendMessage = (
    recipientId: string,
    text: string,
    options?: {
      sharedPostId?: string;
      storyReplyUrl?: string;
      audioUrl?: string;
      audioDurationSec?: number;
      videoUrl?: string;
      videoName?: string;
    }
  ) => {
    const trimmed = text.trim();
    if (!trimmed && !options?.sharedPostId && !options?.audioUrl && !options?.videoUrl) {
      return;
    }

    const msgId = `dm_${Date.now()}`;
    setState((prev) => {
      const existing = prev.threads.find(
        (t) =>
          t.participantIds.includes(prev.currentUserId) &&
          t.participantIds.includes(recipientId)
      );

      const fallbackLabel = options?.audioUrl
        ? 'Mensagem de voz'
        : options?.videoUrl
        ? 'Vídeo'
        : options?.sharedPostId
        ? 'Compartilhou uma publicação'
        : '';

      const newMsg = {
        id: msgId,
        senderId: prev.currentUserId,
        text: trimmed || fallbackLabel,
        sharedPostId: options?.sharedPostId,
        storyReplyUrl: options?.storyReplyUrl,
        audioUrl: options?.audioUrl,
        audioDurationSec: options?.audioDurationSec,
        videoUrl: options?.videoUrl,
        videoName: options?.videoName,
        createdAt: Date.now(),
      };

      if (existing) {
        return {
          ...prev,
          threads: prev.threads
            .map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    messages: [...t.messages, newMsg],
                    unreadBy: [recipientId],
                    updatedAt: Date.now(),
                  }
                : t
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        };
      }

      const newThread: DirectThread = {
        id: `thread_${Date.now()}`,
        participantIds: [prev.currentUserId, recipientId],
        messages: [newMsg],
        unreadBy: [recipientId],
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        threads: [newThread, ...prev.threads],
      };
    });

    // Contextual simulated response from non-current creator
    if (recipientId !== currentUser.id) {
      const senderAtSend = currentUser.id;
      window.setTimeout(() => {
        const replyText = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
        setState((prev) => ({
          ...prev,
          threads: prev.threads
            .map((t) => {
              if (
                t.participantIds.includes(senderAtSend) &&
                t.participantIds.includes(recipientId)
              ) {
                return {
                  ...t,
                  messages: [
                    ...t.messages,
                    {
                      id: `dm_auto_${Date.now()}`,
                      senderId: recipientId,
                      text: replyText,
                      createdAt: Date.now(),
                    },
                  ],
                  unreadBy: prev.currentUserId === senderAtSend ? [senderAtSend] : [],
                  updatedAt: Date.now(),
                };
              }
              return t;
            })
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));
      }, 1100);
    }
  };

  const markThreadRead = (threadId: string) => {
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === threadId
          ? { ...t, unreadBy: t.unreadBy.filter((id) => id !== prev.currentUserId) }
          : t
      ),
    }));
  };

  const reactToMessage = (threadId: string, messageId: string, emoji: string) => {
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId
                  ? { ...m, reaction: m.reaction === emoji ? undefined : emoji }
                  : m
              ),
            }
          : t
      ),
    }));
  };

  const markNotificationsRead = () => {
    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.recipientId === prev.currentUserId ? { ...n, read: true } : n
      ),
    }));
  };

  const addRecentSearch = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setState((prev) => ({
      ...prev,
      recentSearches: [
        clean,
        ...prev.recentSearches.filter((t) => t.toLowerCase() !== clean.toLowerCase()),
      ].slice(0, 6),
    }));
  };

  const clearRecentSearches = () => {
    setState((prev) => ({ ...prev, recentSearches: [] }));
  };

  const resetDemoData = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      currentUserId: 'user_daniel',
      users: SEED_USERS,
      posts: SEED_POSTS,
      stories: SEED_STORIES,
      threads: SEED_THREADS,
      notifications: SEED_NOTIFICATIONS,
      recentSearches: ['arquitetura', 'clara.lentes', '35mm'],
      theme: state.theme,
    });
    showToast('Feed restaurado para os dados originais');
  };

  const toggleRestrictUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.restricted;
      showToast(
        nextVal
          ? `@${target?.username || 'usuário'} foi restringido`
          : `Restrição removida de @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, restricted: nextVal } : u
        ),
      };
    });
  };

  const toggleBoostUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.boosted;
      showToast(
        nextVal
          ? `Perfil @${target?.username || 'usuário'} impulsionado no feed`
          : `Impulsionamento desativado para @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, boosted: nextVal } : u
        ),
      };
    });
  };

  const toggleVerifyUser = (userId: string) => {
    setState((prev) => {
      const target = prev.users.find((u) => u.id === userId);
      const nextVal = !target?.verified;
      showToast(
        nextVal
          ? `Selo de verificação concedido a @${target?.username || 'usuário'}`
          : `Selo de verificação removido de @${target?.username || 'usuário'}`
      );
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, verified: nextVal } : u
        ),
      };
    });
  };

  return (
    <SocialContext.Provider
      value={{
        currentUser,
        users: state.users,
        posts: state.posts,
        stories: state.stories,
        threads: state.threads,
        notifications: state.notifications,
        recentSearches: state.recentSearches,
        theme: state.theme,
        activeNav,
        viewingProfileId,
        exploreQuery,
        selectedPostId,
        activeStoryAuthorId,
        isCreateOpen,
        sharePostId,
        toastMessage,
        siteMeta,
        setSiteMeta,
        refreshSiteMeta,
        setActiveNav: (nav) => {
          if (nav === 'profile') setViewingProfileId(currentUser.id);
          setActiveNav(nav);
        },
        openProfile,
        openHashtagInExplore,
        setExploreQuery,
        setSelectedPostId,
        setActiveStoryAuthorId,
        setIsCreateOpen,
        setSharePostId,
        toggleTheme,
        showToast,
        switchUser,
        createAccount,
        updateProfile,
        toggleFollow,
        toggleLikePost,
        toggleSavePost,
        addComment,
        toggleLikeComment,
        deletePost,
        publishPost,
        publishStory,
        markStoryViewed,
        reactToStory,
        sendMessage,
        markThreadRead,
        reactToMessage,
        markNotificationsRead,
        addRecentSearch,
        clearRecentSearches,
        resetDemoData,
        toggleRestrictUser,
        toggleBoostUser,
        toggleVerifyUser,
        getUserById,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used within SocialProvider');
  return ctx;
}
