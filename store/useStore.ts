import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionResult,
  AppView,
  Group,
  GroupMember,
  GroupPatch,
  GroupPayload,
  GroupPost,
  GroupPostComment,
  LoginPayload,
  MediaType,
  Message,
  NotificationItem,
  Post,
  PostComment,
  PostPayload,
  ProfilePatch,
  RegisterPayload,
  SocialDb,
  Story,
  StoryComment,
  StoryPayload,
  ThemeMode,
  User,
  UserRole,
} from '../types';
import { apiUrl } from '../services/api';

const TOKEN_KEY = 'aura-token';
const THEME_KEY = 'aura-theme';
const PENDING_VERIFY_USER_KEY = 'aura-pending-verify-user';

const nowIso = () => new Date().toISOString();

const cleanDbState = (theme: ThemeMode = 'dark'): SocialDb => ({
  users: [],
  follows: [],
  posts: [],
  postComments: [],
  stories: [],
  storyComments: [],
  messages: [],
  groups: [],
  groupMembers: [],
  groupPosts: [],
  groupPostComments: [],
  notifications: [],
  theme,
  session: {
    userId: null,
    currentView: 'feed',
    activeChatUserId: null,
    activeGroupId: null,
  },
});

type UseStore = {
  db: SocialDb;
  user: User | null;
  users: User[];
  posts: Post[];
  postComments: PostComment[];
  stories: Story[];
  storyComments: StoryComment[];
  messages: Message[];
  groups: Group[];
  groupMembers: GroupMember[];
  groupPosts: GroupPost[];
  groupPostComments: GroupPostComment[];
  notifications: NotificationItem[];
  unreadMessagesCount: number;
  isAuthenticated: boolean;
  darkMode: boolean;
  currentView: AppView;
  activeChatUserId: string | null;
  activeGroupId: string | null;
  register: (payload: RegisterPayload) => Promise<ActionResult>;
  verifyPending: (code: string) => Promise<ActionResult>;
  login: (payload: LoginPayload) => Promise<ActionResult>;
  logout: () => void;
  setTheme: (theme: ThemeMode) => void;
  setCurrentView: (view: AppView) => void;
  setActiveChatUser: (userId: string | null) => void;
  setActiveGroup: (groupId: string | null) => void;
  createPost: (payload: PostPayload) => ActionResult;
  deletePost: (postId: string) => ActionResult;
  togglePostLike: (postId: string) => ActionResult;
  togglePostRepost: (postId: string) => ActionResult;
  addPostComment: (postId: string, text: string) => ActionResult;
  editPostComment: (commentId: string, text: string) => ActionResult;
  deletePostComment: (commentId: string) => ActionResult;
  togglePostCommentLike: (commentId: string) => ActionResult;
  createStory: (payload: StoryPayload) => ActionResult;
  deleteStory: (storyId: string) => ActionResult;
  addStoryComment: (storyId: string, text: string) => ActionResult;
  followUser: (targetUserId: string) => ActionResult;
  sendMessage: (
    toUserId: string,
    payload: { text?: string; mediaType?: 'image' | 'voice'; mediaUrl?: string; expiresAt?: string }
  ) => ActionResult;
  editMessage: (messageId: string, text: string) => ActionResult;
  deleteMessage: (messageId: string) => ActionResult;
  markChatRead: (chatUserId: string) => void;
  markNotificationsRead: () => void;
  updateProfile: (patch: ProfilePatch) => ActionResult;
  createGroup: (payload: GroupPayload) => ActionResult;
  updateGroup: (groupId: string, patch: GroupPatch) => ActionResult;
  toggleGroupSubscription: (groupId: string) => ActionResult;
  setGroupAllowMemberPosts: (groupId: string, allow: boolean) => ActionResult;
  createGroupPost: (
    groupId: string,
    text: string,
    mediaType?: MediaType,
    mediaUrl?: string
  ) => ActionResult;
  toggleGroupPostLike: (groupPostId: string) => ActionResult;
  repostGroupPost: (groupPostId: string, targetGroupId: string) => ActionResult;
  repostGroupPostToProfile: (groupPostId: string) => ActionResult;
  publishGroupPostToFeed: (groupPostId: string) => ActionResult;
  editGroupPost: (groupPostId: string, text: string) => ActionResult;
  deleteGroupPost: (groupPostId: string) => ActionResult;
  addGroupPostComment: (groupPostId: string, text: string) => ActionResult;
  editGroupPostComment: (commentId: string, text: string) => ActionResult;
  deleteGroupPostComment: (commentId: string) => ActionResult;
  toggleGroupPostCommentLike: (commentId: string) => ActionResult;
  setUserRole: (userId: string, role: UserRole) => ActionResult;
  setUserBan: (userId: string, banned: boolean) => ActionResult;
  setUserRestricted: (userId: string, restricted: boolean) => ActionResult;
  setUserVerified: (userId: string, verified: boolean) => ActionResult;
  clearNetworkData: () => ActionResult;
  resetAllData: () => ActionResult;
  exportSqlBackup: () => Promise<ActionResult>;
  importSqlBackup: (file: File) => Promise<ActionResult>;
};

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });

const toUser = (raw: any): User => {
  const createdAt = raw?.createdAt || raw?.created_at || nowIso();
  const updatedAt = raw?.updatedAt || raw?.updated_at || createdAt;
  const displayName = raw?.displayName || raw?.display_name || raw?.username || 'User';
  const avatar = raw?.avatarUrl || raw?.avatar_url || '';
  const rawRole = String(raw?.role || 'user');
  const role: UserRole = ['user', 'moderator', 'curator', 'admin'].includes(rawRole)
    ? (rawRole as UserRole)
    : 'user';

  return {
    id: String(raw?.id || ''),
    username: String(raw?.username || ''),
    password: '',
    displayName: String(displayName),
    bio: String(raw?.bio || ''),
    status: String(raw?.status || ''),
    avatar,
    coverImage: String(raw?.coverImage || ''),
    role,
    banned: Boolean(raw?.banned),
    restricted: Boolean(raw?.restricted),
    verified: Boolean(raw?.isVerified || raw?.verified),
    hiddenFromFriends: Boolean(raw?.hiddenFromFriends),
    createdAt,
    updatedAt,
    lastSeenAt: String(raw?.lastSeenAt || nowIso()),
  };
};

const toPost = (raw: any): Post => ({
  id: String(raw?.id || ''),
  authorId: String(raw?.userId || raw?.author?.id || ''),
  text: String(raw?.content || raw?.text || ''),
  mediaType: undefined,
  mediaUrl: undefined,
  createdAt: String(raw?.createdAt || nowIso()),
  likedBy: Array.isArray(raw?.likedBy) ? raw.likedBy : [],
  repostedBy: Array.isArray(raw?.repostedBy) ? raw.repostedBy : [],
  repostOfPostId: raw?.repostOfPostId,
  repostOfGroupPostId: raw?.repostOfGroupPostId,
  repostSourceGroupId: raw?.repostSourceGroupId,
});

const toMessage = (raw: any, me: string): Message => {
  const senderId = String(raw?.senderId || raw?.fromId || '');
  const receiverId = String(raw?.receiverId || raw?.toId || '');
  const createdAt = String(raw?.createdAt || nowIso());
  const readBy = [senderId];
  if (raw?.readAt) {
    readBy.push(receiverId);
  } else if (senderId === me) {
    readBy.push(me);
  }

  return {
    id: String(raw?.id || ''),
    fromId: senderId,
    toId: receiverId,
    text: String(raw?.content || raw?.text || ''),
    mediaType: raw?.mediaType,
    mediaUrl: raw?.mediaUrl,
    expiresAt: raw?.expiresAt,
    editedAt: raw?.editedAt,
    readBy: Array.from(new Set(readBy.filter(Boolean))),
    createdAt,
  };
};

const isWsOpen = (ws: WebSocket | null) => ws?.readyState === WebSocket.OPEN;

export function useStore(): UseStore {
  const initialTheme = (typeof window !== 'undefined' && localStorage.getItem(THEME_KEY) === 'light')
    ? 'light'
    : 'dark';

  const [db, setDb] = useState<SocialDb>(() => cleanDbState(initialTheme));
  const [token, setToken] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(TOKEN_KEY) || '';
  });
  const [pendingVerificationUserId, setPendingVerificationUserId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(PENDING_VERIFY_USER_KEY) || '';
  });

  const wsRef = useRef<WebSocket | null>(null);
  const wsTimerRef = useRef<number | null>(null);

  const user = useMemo(
    () => db.users.find((candidate) => candidate.id === db.session.userId) ?? null,
    [db.users, db.session.userId]
  );

  const users = useMemo(
    () => db.users.filter((candidate) => candidate.id !== user?.id),
    [db.users, user?.id]
  );

  const posts = useMemo(
    () => [...db.posts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [db.posts]
  );

  const postComments = useMemo(
    () => [...db.postComments].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [db.postComments]
  );

  const stories = useMemo(
    () => [...db.stories].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [db.stories]
  );

  const storyComments = useMemo(
    () => [...db.storyComments].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [db.storyComments]
  );

  const messages = useMemo(
    () => [...db.messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [db.messages]
  );

  const groups = useMemo(() => db.groups, [db.groups]);
  const groupMembers = useMemo(() => db.groupMembers, [db.groupMembers]);
  const groupPosts = useMemo(() => db.groupPosts, [db.groupPosts]);
  const groupPostComments = useMemo(() => db.groupPostComments, [db.groupPostComments]);
  const notifications = useMemo(() => db.notifications, [db.notifications]);

  const unreadMessagesCount = useMemo(() => {
    if (!user) return 0;
    return db.messages.filter((message) => message.toId === user.id && !message.readBy.includes(user.id)).length;
  }, [db.messages, user]);

  const isAuthenticated = Boolean(token && db.session.userId);
  const darkMode = db.theme === 'dark';
  const currentView = db.session.currentView;
  const activeChatUserId = db.session.activeChatUserId;
  const activeGroupId = db.session.activeGroupId;

  const apiRequest = useCallback(
    async (path: string, options: RequestInit = {}, requiresAuth = false) => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
      if (requiresAuth && token) headers.set('Authorization', `Bearer ${token}`);

      const response = await fetch(apiUrl(path), {
        ...options,
        headers,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || `Request failed (${response.status})`));
      }

      return data;
    },
    [token]
  );

  const mergeUsers = useCallback((incoming: User[]) => {
    if (!incoming.length) return;
    setDb((prev) => {
      const map = new Map<string, User>(prev.users.map((item) => [item.id, item]));
      incoming.forEach((item) => {
        if (!item.id) return;
        const current = map.get(item.id);
        map.set(item.id, current ? { ...current, ...item } : item);
      });
      return { ...prev, users: Array.from(map.values()) };
    });
  }, []);

  const hydrateMe = useCallback(async () => {
    if (!token) return;
    try {
      const meData = await apiRequest('/api/users/me', { method: 'GET' }, true);
      const me = toUser(meData.user);
      setDb((prev) => {
        const others = prev.users.filter((item) => item.id !== me.id);
        return {
          ...prev,
          users: [me, ...others],
          session: {
            ...prev.session,
            userId: me.id,
          },
        };
      });
    } catch {
      // fallback: keep token if me endpoint unavailable, will rely on login payload
    }
  }, [apiRequest, token]);

  const fetchFeed = useCallback(async () => {
    try {
      const payload = await apiRequest('/api/posts/feed?limit=50&offset=0', {}, false);
      const nextPosts = (payload.items || []).map(toPost);
      const authorUsers = (payload.items || [])
        .map((item: any) => item.author)
        .filter(Boolean)
        .map((raw: any) => toUser({ ...raw, isVerified: Boolean(raw?.isVerified || raw?.verified) }));

      mergeUsers(authorUsers);
      setDb((prev) => ({ ...prev, posts: nextPosts }));
    } catch {
      // keep current data
    }
  }, [apiRequest, mergeUsers]);

  const fetchUsers = useCallback(async () => {
    try {
      const payload = await apiRequest('/api/users?limit=50&offset=0', {}, false);
      const nextUsers = (payload.items || []).map((item: any) => toUser(item));
      mergeUsers(nextUsers);
    } catch {
      // keep current data
    }
  }, [apiRequest, mergeUsers]);

  const fetchFollows = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await apiRequest('/api/follows/me', {}, true);
      setDb((prev) => ({ ...prev, follows: payload.items || [] }));
    } catch {
      // keep current follows
    }
  }, [apiRequest, token]);

  const fetchMessagesWith = useCallback(
    async (otherUserId: string) => {
      if (!token || !db.session.userId || !otherUserId) return;
      try {
        const payload = await apiRequest(`/api/messages/${otherUserId}?limit=100&offset=0`, {}, true);
        const mapped = (payload.items || []).map((item: any) => toMessage(item, db.session.userId || ''));
        setDb((prev) => {
          const keep = prev.messages.filter(
            (message) =>
              !(
                (message.fromId === otherUserId && message.toId === prev.session.userId) ||
                (message.fromId === prev.session.userId && message.toId === otherUserId)
              )
          );
          return { ...prev, messages: [...keep, ...mapped] };
        });
      } catch {
        // keep current messages
      }
    },
    [apiRequest, token, db.session.userId]
  );

  const closeSocket = useCallback(() => {
    if (wsTimerRef.current) {
      window.clearTimeout(wsTimerRef.current);
      wsTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const openSocket = useCallback(() => {
    if (!token || typeof window === 'undefined') return;
    closeSocket();

    const endpoint = apiUrl('/ws');
    const wsUrl = endpoint.startsWith('https://')
      ? endpoint.replace('https://', 'wss://')
      : endpoint.startsWith('http://')
        ? endpoint.replace('http://', 'ws://')
        : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

    const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.type !== 'message:new') return;
        const me = db.session.userId;
        if (!me) return;
        const message = toMessage(payload.message, me);
        setDb((prev) => {
          if (prev.messages.some((item) => item.id === message.id)) return prev;
          return { ...prev, messages: [...prev.messages, message] };
        });
      } catch {
        // ignore malformed ws payload
      }
    };

    socket.onclose = () => {
      wsRef.current = null;
      if (!token) return;
      wsTimerRef.current = window.setTimeout(() => {
        openSocket();
      }, 1500);
    };
  }, [closeSocket, db.session.userId, token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!token) {
      closeSocket();
      return;
    }
    openSocket();
    return () => {
      closeSocket();
    };
  }, [token, openSocket, closeSocket]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(THEME_KEY, db.theme);
  }, [db.theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pendingVerificationUserId) {
      localStorage.setItem(PENDING_VERIFY_USER_KEY, pendingVerificationUserId);
    } else {
      localStorage.removeItem(PENDING_VERIFY_USER_KEY);
    }
  }, [pendingVerificationUserId]);

  useEffect(() => {
    if (!token) return;
    void hydrateMe();
    void fetchFeed();
    void fetchUsers();
    void fetchFollows();
  }, [token, hydrateMe, fetchFeed, fetchUsers, fetchFollows]);

  useEffect(() => {
    if (!activeChatUserId) return;
    void fetchMessagesWith(activeChatUserId);
  }, [activeChatUserId, fetchMessagesWith]);

  const register = async (payload: RegisterPayload): Promise<ActionResult> => {
    const username = String(payload.username || '').trim().toLowerCase();
    const displayName = String(payload.displayName || username).trim();
    const email = String(payload.email || `${username}@aura.local`).trim().toLowerCase();
    const password = String(payload.password || '');

    if (!username || !password) return fail('Username and password are required.');

    try {
      const data = await apiRequest(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ username, displayName, email, password }),
        },
        false
      );

      if (data.requiresVerification && data.userId) {
        setPendingVerificationUserId(String(data.userId));
        return ok('Account created. Enter the code from your email.');
      }

      if (data.token && data.user) {
        const mapped = toUser(data.user);
        setToken(String(data.token));
        setDb((prev) => ({
          ...prev,
          users: [mapped, ...prev.users.filter((item) => item.id !== mapped.id)],
          session: { ...prev.session, userId: mapped.id },
        }));
        await fetchFeed();
        await fetchUsers();
        await fetchFollows();
        return ok('Account created and signed in.');
      }

      return fail('Registration completed, but response is incomplete.');
    } catch (error: any) {
      return fail(String(error?.message || 'Registration failed.'));
    }
  };

  const verifyPending = async (code: string): Promise<ActionResult> => {
    const trimmed = String(code || '').trim();
    if (!pendingVerificationUserId) return fail('No pending verification.');
    if (trimmed.length < 4) return fail('Enter verification code.');

    try {
      const data = await apiRequest(
        '/api/auth/verify',
        {
          method: 'POST',
          body: JSON.stringify({ userId: pendingVerificationUserId, code: trimmed }),
        },
        false
      );

      if (data.token && data.user) {
        const mapped = toUser(data.user);
        setToken(String(data.token));
        setPendingVerificationUserId('');
        setDb((prev) => ({
          ...prev,
          users: [mapped, ...prev.users.filter((item) => item.id !== mapped.id)],
          session: { ...prev.session, userId: mapped.id },
        }));
        await fetchFeed();
        await fetchUsers();
        await fetchFollows();
        return ok('Email verified.');
      }

      return fail('Verification response is invalid.');
    } catch (error: any) {
      return fail(String(error?.message || 'Verification failed.'));
    }
  };

  const login = async (payload: LoginPayload): Promise<ActionResult> => {
    const username = String(payload.username || '').trim().toLowerCase();
    const password = String(payload.password || '');
    if (!username || !password) return fail('Missing credentials.');

    try {
      const data = await apiRequest(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
        false
      );

      if (data.token && data.user) {
        const mapped = toUser(data.user);
        setToken(String(data.token));
        setDb((prev) => ({
          ...prev,
          users: [mapped, ...prev.users.filter((item) => item.id !== mapped.id)],
          session: { ...prev.session, userId: mapped.id },
        }));
        await fetchFeed();
        await fetchUsers();
        await fetchFollows();
        return ok('Login successful.');
      }

      return fail('Login response is invalid.');
    } catch (error: any) {
      return fail(String(error?.message || 'Login failed.'));
    }
  };

  const logout = () => {
    setToken('');
    setPendingVerificationUserId('');
    setDb((prev) => cleanDbState(prev.theme));
  };

  const setTheme = (theme: ThemeMode) => {
    setDb((prev) => ({ ...prev, theme }));
  };

  const setCurrentView = (view: AppView) => {
    setDb((prev) => ({ ...prev, session: { ...prev.session, currentView: view } }));
  };

  const setActiveChatUser = (userId: string | null) => {
    setDb((prev) => ({ ...prev, session: { ...prev.session, activeChatUserId: userId } }));
  };

  const setActiveGroup = (groupId: string | null) => {
    setDb((prev) => ({ ...prev, session: { ...prev.session, activeGroupId: groupId } }));
  };

  const createPost = (payload: PostPayload): ActionResult => {
    const text = String(payload.text || '').trim();
    if (!text) return fail('Post text is required.');
    if (!user) return fail('Unauthorized.');

    const optimisticPost: Post = {
      id: `temp-${Date.now()}`,
      authorId: user.id,
      text,
      mediaType: payload.mediaType,
      mediaUrl: payload.mediaUrl,
      createdAt: nowIso(),
      likedBy: [],
      repostedBy: [],
    };

    setDb((prev) => ({ ...prev, posts: [optimisticPost, ...prev.posts] }));

    void (async () => {
      try {
        const data = await apiRequest(
          '/api/posts',
          { method: 'POST', body: JSON.stringify({ content: text }) },
          true
        );
        const persisted = toPost(data.post);
        setDb((prev) => ({
          ...prev,
          posts: [persisted, ...prev.posts.filter((item) => item.id !== optimisticPost.id)],
        }));
      } catch {
        setDb((prev) => ({ ...prev, posts: prev.posts.filter((item) => item.id !== optimisticPost.id) }));
      }
    })();

    return ok('Post published.');
  };

  const deletePost = (postId: string): ActionResult => {
    const existing = db.posts.find((item) => item.id === postId);
    if (!existing) return fail('Post not found.');
    if (!user) return fail('Unauthorized.');

    setDb((prev) => ({
      ...prev,
      posts: prev.posts.filter((item) => item.id !== postId),
      postComments: prev.postComments.filter((item) => item.postId !== postId),
    }));

    const canAdminDelete = user.role === 'admin' && existing.authorId !== user.id;
    const endpoint = canAdminDelete ? `/api/admin/posts/${postId}` : `/api/posts/${postId}`;

    void apiRequest(endpoint, { method: 'DELETE' }, true).catch(() => {
      setDb((prev) => ({ ...prev, posts: [existing, ...prev.posts] }));
    });

    return ok('Post deleted.');
  };

  const togglePostLike = (postId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    setDb((prev) => ({
      ...prev,
      posts: prev.posts.map((post) => {
        if (post.id !== postId) return post;
        const liked = post.likedBy.includes(user.id);
        return {
          ...post,
          likedBy: liked ? post.likedBy.filter((id) => id !== user.id) : [...post.likedBy, user.id],
        };
      }),
    }));
    return ok('Like updated.');
  };

  const togglePostRepost = (postId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    setDb((prev) => ({
      ...prev,
      posts: prev.posts.map((post) => {
        if (post.id !== postId) return post;
        const has = post.repostedBy.includes(user.id);
        return {
          ...post,
          repostedBy: has ? post.repostedBy.filter((id) => id !== user.id) : [...post.repostedBy, user.id],
        };
      }),
    }));
    return ok('Repost updated.');
  };

  const addPostComment = (postId: string, text: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');
    const comment: PostComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      postId,
      authorId: user.id,
      text: trimmed,
      likedBy: [],
      createdAt: nowIso(),
    };
    setDb((prev) => ({ ...prev, postComments: [comment, ...prev.postComments] }));
    return ok('Comment added.');
  };

  const editPostComment = (commentId: string, text: string): ActionResult => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');
    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.map((comment) =>
        comment.id === commentId ? { ...comment, text: trimmed } : comment
      ),
    }));
    return ok('Comment updated.');
  };

  const deletePostComment = (commentId: string): ActionResult => {
    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.filter((comment) => comment.id !== commentId),
    }));
    return ok('Comment deleted.');
  };

  const togglePostCommentLike = (commentId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.map((comment) => {
        if (comment.id !== commentId) return comment;
        const liked = comment.likedBy.includes(user.id);
        return {
          ...comment,
          likedBy: liked ? comment.likedBy.filter((id) => id !== user.id) : [...comment.likedBy, user.id],
        };
      }),
    }));
    return ok('Comment like updated.');
  };

  const createStory = (_payload: StoryPayload): ActionResult => fail('Stories are disabled in API mode.');
  const deleteStory = (_storyId: string): ActionResult => fail('Stories are disabled in API mode.');
  const addStoryComment = (_storyId: string, _text: string): ActionResult =>
    fail('Stories are disabled in API mode.');

  const followUser = (targetUserId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!targetUserId || targetUserId === user.id) return fail('Invalid user.');

    const existing = db.follows.some(
      (relation) => relation.followerId === user.id && relation.followingId === targetUserId
    );

    if (existing) {
      setDb((prev) => ({
        ...prev,
        follows: prev.follows.filter(
          (relation) => !(relation.followerId === user.id && relation.followingId === targetUserId)
        ),
      }));
      void apiRequest(`/api/follow/${targetUserId}`, { method: 'DELETE' }, true).catch(() => {
        setDb((prev) => ({
          ...prev,
          follows: [
            ...prev.follows,
            {
              id: `follow-${Date.now()}-${targetUserId}`,
              followerId: user.id,
              followingId: targetUserId,
              createdAt: nowIso(),
            },
          ],
        }));
      });
      return ok('Unfollowed.');
    }

    const optimistic = {
      id: `follow-${Date.now()}-${targetUserId}`,
      followerId: user.id,
      followingId: targetUserId,
      createdAt: nowIso(),
    };

    setDb((prev) => ({ ...prev, follows: [...prev.follows, optimistic] }));
    void apiRequest(`/api/follow/${targetUserId}`, { method: 'POST' }, true).catch(() => {
      setDb((prev) => ({
        ...prev,
        follows: prev.follows.filter((relation) => relation.id !== optimistic.id),
      }));
    });
    return ok('Followed.');
  };

  const sendMessage = (
    toUserId: string,
    payload: { text?: string; mediaType?: 'image' | 'voice'; mediaUrl?: string; expiresAt?: string }
  ): ActionResult => {
    if (!user) return fail('Unauthorized.');

    const content = String(payload.text || payload.mediaUrl || '').trim();
    if (!content) return fail('Message is empty.');

    const optimistic: Message = {
      id: `tmp-msg-${Date.now()}`,
      fromId: user.id,
      toId: toUserId,
      text: String(payload.text || ''),
      mediaType: payload.mediaType === 'voice' ? 'voice' : payload.mediaType,
      mediaUrl: payload.mediaUrl,
      expiresAt: payload.expiresAt,
      createdAt: nowIso(),
      readBy: [user.id],
    };

    setDb((prev) => ({ ...prev, messages: [...prev.messages, optimistic] }));

    void (async () => {
      try {
        const data = await apiRequest(
          '/api/messages',
          {
            method: 'POST',
            body: JSON.stringify({ receiverId: toUserId, content }),
          },
          true
        );

        if (!user.id) return;
        const persisted = toMessage(data.message, user.id);
        setDb((prev) => ({
          ...prev,
          messages: [...prev.messages.filter((item) => item.id !== optimistic.id), persisted],
        }));
      } catch {
        setDb((prev) => ({ ...prev, messages: prev.messages.filter((item) => item.id !== optimistic.id) }));
      }
    })();

    return ok('Message sent.');
  };

  const editMessage = (messageId: string, text: string): ActionResult => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Message is empty.');
    setDb((prev) => ({
      ...prev,
      messages: prev.messages.map((message) =>
        message.id === messageId ? { ...message, text: trimmed, editedAt: nowIso() } : message
      ),
    }));
    return ok('Message edited.');
  };

  const deleteMessage = (messageId: string): ActionResult => {
    setDb((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== messageId) }));
    return ok('Message deleted.');
  };

  const markChatRead = (chatUserId: string) => {
    if (!user) return;
    setDb((prev) => ({
      ...prev,
      messages: prev.messages.map((message) => {
        if (!(message.fromId === chatUserId && message.toId === user.id)) return message;
        if (message.readBy.includes(user.id)) return message;
        return { ...message, readBy: [...message.readBy, user.id] };
      }),
    }));
  };

  const markNotificationsRead = () => {
    if (!user) return;
    setDb((prev) => ({
      ...prev,
      notifications: prev.notifications.map((item) =>
        item.userId === user.id ? { ...item, read: true } : item
      ),
    }));
  };

  const updateProfile = (patch: ProfilePatch): ActionResult => {
    if (!user) return fail('Unauthorized.');

    const displayName = String(patch.displayName || user.displayName).trim();
    const bio = String(patch.bio || '');
    const avatarUrl = String(patch.avatar || '');

    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) =>
        candidate.id === user.id
          ? {
              ...candidate,
              displayName,
              bio,
              avatar: avatarUrl,
              coverImage: patch.coverImage || candidate.coverImage,
              hiddenFromFriends: Boolean(patch.hiddenFromFriends),
              updatedAt: nowIso(),
            }
          : candidate
      ),
    }));

    void apiRequest(
      '/api/users/me',
      {
        method: 'PUT',
        body: JSON.stringify({ displayName, bio, avatarUrl }),
      },
      true
    ).catch(() => {
      // keep optimistic profile in UI
    });

    return ok('Profile updated.');
  };

  const createGroup = (_payload: GroupPayload): ActionResult => fail('Groups are disabled in API mode.');
  const updateGroup = (_groupId: string, _patch: GroupPatch): ActionResult => fail('Groups are disabled in API mode.');
  const toggleGroupSubscription = (_groupId: string): ActionResult => fail('Groups are disabled in API mode.');
  const setGroupAllowMemberPosts = (_groupId: string, _allow: boolean): ActionResult =>
    fail('Groups are disabled in API mode.');
  const createGroupPost = (
    _groupId: string,
    _text: string,
    _mediaType?: MediaType,
    _mediaUrl?: string
  ): ActionResult => fail('Groups are disabled in API mode.');
  const toggleGroupPostLike = (_groupPostId: string): ActionResult => fail('Groups are disabled in API mode.');
  const repostGroupPost = (_groupPostId: string, _targetGroupId: string): ActionResult =>
    fail('Groups are disabled in API mode.');
  const repostGroupPostToProfile = (_groupPostId: string): ActionResult =>
    fail('Groups are disabled in API mode.');
  const publishGroupPostToFeed = (_groupPostId: string): ActionResult =>
    fail('Groups are disabled in API mode.');
  const editGroupPost = (_groupPostId: string, _text: string): ActionResult => fail('Groups are disabled in API mode.');
  const deleteGroupPost = (_groupPostId: string): ActionResult => fail('Groups are disabled in API mode.');
  const addGroupPostComment = (_groupPostId: string, _text: string): ActionResult =>
    fail('Groups are disabled in API mode.');
  const editGroupPostComment = (_commentId: string, _text: string): ActionResult =>
    fail('Groups are disabled in API mode.');
  const deleteGroupPostComment = (_commentId: string): ActionResult => fail('Groups are disabled in API mode.');
  const toggleGroupPostCommentLike = (_commentId: string): ActionResult =>
    fail('Groups are disabled in API mode.');

  const patchAdminUser = (
    targetUserId: string,
    patch: Record<string, unknown>,
    successMessage: string
  ): ActionResult => {
    if (!user || user.role !== 'admin') return fail('Admin access required.');
    const existing = db.users.find((candidate) => candidate.id === targetUserId);
    if (!existing) return fail('User not found.');

    const optimistic = toUser({
      ...existing,
      ...patch,
      isVerified: patch.isVerified ?? existing.verified,
      updatedAt: nowIso(),
    });

    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) => (candidate.id === targetUserId ? optimistic : candidate)),
    }));

    void apiRequest(
      `/api/admin/users/${targetUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      true
    )
      .then((payload) => {
        if (!payload?.user) return;
        const persisted = toUser(payload.user);
        setDb((prev) => ({
          ...prev,
          users: prev.users.map((candidate) => (candidate.id === targetUserId ? persisted : candidate)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          users: prev.users.map((candidate) => (candidate.id === targetUserId ? existing : candidate)),
        }));
      });

    return ok(successMessage);
  };

  const setUserRole = (targetUserId: string, role: UserRole): ActionResult =>
    patchAdminUser(targetUserId, { role }, 'Role updated.');
  const setUserBan = (targetUserId: string, banned: boolean): ActionResult =>
    patchAdminUser(targetUserId, { banned }, banned ? 'User banned.' : 'User unbanned.');
  const setUserRestricted = (targetUserId: string, restricted: boolean): ActionResult =>
    patchAdminUser(
      targetUserId,
      { restricted },
      restricted ? 'User restricted.' : 'User restriction removed.'
    );
  const setUserVerified = (targetUserId: string, verified: boolean): ActionResult =>
    patchAdminUser(
      targetUserId,
      { isVerified: verified },
      verified ? 'User verified.' : 'User verification removed.'
    );

  const exportSqlBackup = async (): Promise<ActionResult> => {
    if (!token || !user || user.role !== 'admin') return fail('Admin access required.');
    try {
      const response = await fetch(apiUrl('/api/admin/sql/export'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        return fail(String(payload?.message || `Export failed (${response.status}).`));
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fallbackName = `aura-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
      const filename = match?.[1] || fallbackName;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      return ok('SQL backup downloaded.');
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to export SQL backup.'));
    }
  };

  const importSqlBackup = async (file: File): Promise<ActionResult> => {
    if (!token || !user || user.role !== 'admin') return fail('Admin access required.');
    if (!file) return fail('SQL file is required.');

    try {
      const sql = await file.text();
      if (!sql.trim()) return fail('SQL file is empty.');

      const response = await fetch(apiUrl('/api/admin/sql/import'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/sql',
        },
        body: sql,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return fail(String(payload?.message || `Import failed (${response.status}).`));
      }

      await hydrateMe();
      await fetchFeed();
      await fetchUsers();
      await fetchFollows();
      if (activeChatUserId) {
        await fetchMessagesWith(activeChatUserId);
      } else {
        setDb((prev) => ({ ...prev, messages: [] }));
      }

      return ok(String(payload?.message || 'SQL import completed.'));
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to import SQL backup.'));
    }
  };

  const clearNetworkData = (): ActionResult => {
    setDb((prev) => ({
      ...prev,
      posts: [],
      postComments: [],
      stories: [],
      storyComments: [],
      messages: [],
      groups: [],
      groupMembers: [],
      groupPosts: [],
      groupPostComments: [],
      notifications: [],
    }));
    return ok('Network data cleared.');
  };

  const resetAllData = (): ActionResult => {
    logout();
    return ok('Session reset.');
  };

  return {
    db,
    user,
    users,
    posts,
    postComments,
    stories,
    storyComments,
    messages,
    groups,
    groupMembers,
    groupPosts,
    groupPostComments,
    notifications,
    unreadMessagesCount,
    isAuthenticated,
    darkMode,
    currentView,
    activeChatUserId,
    activeGroupId,
    register,
    verifyPending,
    login,
    logout,
    setTheme,
    setCurrentView,
    setActiveChatUser,
    setActiveGroup,
    createPost,
    deletePost,
    togglePostLike,
    togglePostRepost,
    addPostComment,
    editPostComment,
    deletePostComment,
    togglePostCommentLike,
    createStory,
    deleteStory,
    addStoryComment,
    followUser,
    sendMessage,
    editMessage,
    deleteMessage,
    markChatRead,
    markNotificationsRead,
    updateProfile,
    createGroup,
    updateGroup,
    toggleGroupSubscription,
    setGroupAllowMemberPosts,
    createGroupPost,
    toggleGroupPostLike,
    repostGroupPost,
    repostGroupPostToProfile,
    publishGroupPostToFeed,
    editGroupPost,
    deleteGroupPost,
    addGroupPostComment,
    editGroupPostComment,
    deleteGroupPostComment,
    toggleGroupPostCommentLike,
    setUserRole,
    setUserBan,
    setUserRestricted,
    setUserVerified,
    clearNetworkData,
    resetAllData,
    exportSqlBackup,
    importSqlBackup,
  };
}
