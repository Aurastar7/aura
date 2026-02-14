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
  resendVerificationCode: () => Promise<ActionResult>;
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
  changePassword: (currentPassword: string, newPassword: string) => Promise<ActionResult>;
  requestEmailChange: (newEmail: string) => Promise<ActionResult>;
  confirmEmailChange: (code: string) => Promise<ActionResult>;
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

class ApiRequestError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
  }
}

const toUser = (raw: any): User => {
  const createdAt = String(raw?.createdAt || raw?.created_at || nowIso());
  // Treat missing timestamps as "very old" so partial payloads cannot overwrite fresh local state.
  const updatedAt = String(
    raw?.updatedAt ||
      raw?.updated_at ||
      raw?.createdAt ||
      raw?.created_at ||
      '1970-01-01T00:00:00.000Z'
  );
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
    coverImage: String(raw?.coverImage ?? raw?.cover_image_url ?? raw?.cover_image ?? ''),
    role,
    banned: Boolean(raw?.banned),
    restricted: Boolean(raw?.restricted),
    verified: Boolean(raw?.isVerified || raw?.verified),
    hiddenFromFriends: Boolean(raw?.hiddenFromFriends ?? raw?.hidden_from_friends),
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

const toPostComment = (raw: any): PostComment => ({
  id: String(raw?.id || ''),
  postId: String(raw?.postId || raw?.post_id || ''),
  authorId: String(raw?.authorId || raw?.author_id || ''),
  text: String(raw?.text || raw?.content || ''),
  likedBy: Array.isArray(raw?.likedBy) ? raw.likedBy.map(String) : [],
  createdAt: String(raw?.createdAt || raw?.created_at || nowIso()),
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

const toGroup = (raw: any): Group => {
  const createdAt = String(raw?.createdAt || raw?.created_at || nowIso());
  const updatedAt = String(raw?.updatedAt || raw?.updated_at || createdAt);
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || ''),
    description: String(raw?.description || ''),
    adminId: String(raw?.adminId || raw?.admin_id || ''),
    allowMemberPosts: Boolean(raw?.allowMemberPosts ?? raw?.allow_member_posts),
    avatar: String(raw?.avatar || raw?.avatarUrl || raw?.avatar_url || ''),
    coverImage: String(raw?.coverImage || raw?.cover_image_url || ''),
    verified: Boolean(raw?.verified),
    createdAt,
    updatedAt,
  };
};

const toGroupMember = (raw: any): GroupMember => ({
  id: String(raw?.id || ''),
  groupId: String(raw?.groupId || raw?.group_id || ''),
  userId: String(raw?.userId || raw?.user_id || ''),
  role: raw?.role === 'admin' ? 'admin' : 'member',
  createdAt: String(raw?.createdAt || raw?.created_at || nowIso()),
});

const toGroupPost = (raw: any): GroupPost => ({
  id: String(raw?.id || ''),
  groupId: String(raw?.groupId || raw?.group_id || ''),
  authorId: String(raw?.authorId || raw?.author_id || ''),
  text: String(raw?.text || raw?.content || ''),
  mediaType: raw?.mediaType === 'video' ? 'video' : raw?.mediaType === 'image' ? 'image' : undefined,
  mediaUrl: raw?.mediaUrl ? String(raw.mediaUrl) : undefined,
  createdAt: String(raw?.createdAt || raw?.created_at || nowIso()),
  likedBy: Array.isArray(raw?.likedBy) ? raw.likedBy.map(String) : [],
  repostedBy: Array.isArray(raw?.repostedBy) ? raw.repostedBy.map(String) : [],
  repostOfPostId: raw?.repostOfPostId ? String(raw.repostOfPostId) : undefined,
});

const toGroupPostComment = (raw: any): GroupPostComment => ({
  id: String(raw?.id || ''),
  groupPostId: String(raw?.groupPostId || raw?.group_post_id || ''),
  authorId: String(raw?.authorId || raw?.author_id || ''),
  text: String(raw?.text || raw?.content || ''),
  likedBy: Array.isArray(raw?.likedBy) ? raw.likedBy.map(String) : [],
  createdAt: String(raw?.createdAt || raw?.created_at || nowIso()),
});

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
        throw new ApiRequestError(
          String(data?.message || `Request failed (${response.status})`),
          response.status,
          data
        );
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
        if (!current) {
          map.set(item.id, item);
          return;
        }

        const currentUpdatedAt = Date.parse(String(current.updatedAt || ''));
        const incomingUpdatedAt = Date.parse(String(item.updatedAt || ''));
        const currentTs = Number.isFinite(currentUpdatedAt) ? currentUpdatedAt : 0;
        const incomingTs = Number.isFinite(incomingUpdatedAt) ? incomingUpdatedAt : 0;

        // Prefer the fresher record when fields conflict; still keep any unknown keys from both.
        map.set(item.id, incomingTs >= currentTs ? { ...current, ...item } : { ...item, ...current });
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
      const payload = await apiRequest('/api/posts/feed?limit=50&offset=0', {}, Boolean(token));
      const nextPosts = (payload.items || []).map(toPost);
      const authorUsers = (payload.items || [])
        .map((item: any) => item.author)
        .filter(Boolean)
        .map((raw: any) => toUser({ ...raw, isVerified: Boolean(raw?.isVerified || raw?.verified) }));
      const extraUsers = Array.isArray(payload.users) ? payload.users.map(toUser) : [];
      const nextComments = Array.isArray(payload.comments) ? payload.comments.map(toPostComment) : [];

      mergeUsers([...authorUsers, ...extraUsers]);
      setDb((prev) => {
        const postIds = new Set(nextPosts.map((post) => post.id).filter(Boolean));
        const optimistic = prev.postComments.filter(
          (comment) => postIds.has(comment.postId) && String(comment.id || '').startsWith('tmp-')
        );
        const keep = prev.postComments.filter((comment) => !postIds.has(comment.postId));
        return { ...prev, posts: nextPosts, postComments: [...keep, ...nextComments, ...optimistic] };
      });
    } catch {
      // keep current data
    }
  }, [apiRequest, mergeUsers, token]);

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

  const fetchGroups = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await apiRequest('/api/groups?limit=50&offset=0', {}, true);
      const nextGroups = Array.isArray(payload.groups) ? payload.groups.map(toGroup) : [];
      const nextMembers = Array.isArray(payload.members) ? payload.members.map(toGroupMember) : [];
      const usersFromPayload = Array.isArray(payload.users) ? payload.users.map(toUser) : [];
      mergeUsers(usersFromPayload);

      setDb((prev) => ({
        ...prev,
        groups: nextGroups,
        groupMembers: nextMembers,
      }));
    } catch {
      // keep current groups
    }
  }, [apiRequest, mergeUsers, token]);

  const fetchGroup = useCallback(
    async (groupId: string) => {
      if (!token || !groupId) return;
      try {
        const payload = await apiRequest(`/api/groups/${encodeURIComponent(groupId)}?limit=50&offset=0`, {}, true);
        const group = payload.group ? toGroup(payload.group) : null;
        const members = Array.isArray(payload.members) ? payload.members.map(toGroupMember) : [];
        const posts = Array.isArray(payload.posts) ? payload.posts.map(toGroupPost) : [];
        const comments = Array.isArray(payload.comments) ? payload.comments.map(toGroupPostComment) : [];
        const usersFromPayload = Array.isArray(payload.users) ? payload.users.map(toUser) : [];
        mergeUsers(usersFromPayload);

        setDb((prev) => {
          const nextGroups = group
            ? [group, ...prev.groups.filter((candidate) => candidate.id !== group.id)]
            : prev.groups;

          const nextMembers = [
            ...prev.groupMembers.filter((item) => item.groupId !== groupId),
            ...members,
          ];

          const removedPostIds = new Set(
            prev.groupPosts.filter((item) => item.groupId === groupId).map((item) => item.id)
          );
          const nextPosts = [...prev.groupPosts.filter((item) => item.groupId !== groupId), ...posts];
          const nextComments = [
            ...prev.groupPostComments.filter((item) => !removedPostIds.has(item.groupPostId)),
            ...comments,
          ];

          return {
            ...prev,
            groups: nextGroups,
            groupMembers: nextMembers,
            groupPosts: nextPosts,
            groupPostComments: nextComments,
          };
        });
      } catch {
        // keep current group data
      }
    },
    [apiRequest, mergeUsers, token]
  );

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

  const fetchChats = useCallback(async () => {
    if (!token || !db.session.userId) return;
    try {
      const payload = await apiRequest('/api/chats?limit=50&offset=0', {}, true);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const peerUsers = items
        .map((item: any) => item.peer)
        .filter(Boolean)
        .map((raw: any) => toUser({ ...raw, isVerified: Boolean(raw?.isVerified || raw?.verified) }));

      mergeUsers(peerUsers);

      setDb((prev) => {
        const knownIds = new Set(prev.messages.map((message) => message.id));
        const seeded = items
          .map((item: any) => item.lastMessage)
          .filter((item: any) => item && item.id && !knownIds.has(String(item.id)))
          .map((item: any) => toMessage(item, prev.session.userId || ''));

        if (!seeded.length) return prev;
        return { ...prev, messages: [...prev.messages, ...seeded] };
      });
    } catch {
      // keep current chats
    }
  }, [apiRequest, db.session.userId, mergeUsers, token]);

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
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', db.theme === 'dark');
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
    void fetchChats();
    void fetchGroups();
  }, [token, hydrateMe, fetchFeed, fetchUsers, fetchFollows, fetchChats, fetchGroups]);

  useEffect(() => {
    if (!activeChatUserId) return;
    void fetchMessagesWith(activeChatUserId);
  }, [activeChatUserId, fetchMessagesWith]);

  useEffect(() => {
    if (!token) return;
    if (!db.session.activeGroupId) return;
    void fetchGroup(db.session.activeGroupId);
  }, [db.session.activeGroupId, fetchGroup, token]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      void fetchChats();
      if (activeChatUserId) {
        void fetchMessagesWith(activeChatUserId);
      }
    }, 20000);
    return () => window.clearInterval(timer);
  }, [activeChatUserId, fetchChats, fetchMessagesWith, token]);

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
        return {
          ok: true,
          message: 'Account created. Enter the code from your email.',
          requiresVerification: true,
        };
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
    if (trimmed.length !== 6) return fail('Enter 6-digit verification code.');

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

  const resendVerificationCode = async (): Promise<ActionResult> => {
    if (!pendingVerificationUserId) return fail('No pending verification.');
    try {
      await apiRequest(
        '/api/auth/resend-verification',
        {
          method: 'POST',
          body: JSON.stringify({ userId: pendingVerificationUserId }),
        },
        false
      );
      return ok('A new verification code has been sent to your email.');
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to resend verification code.'));
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
      if (
        error instanceof ApiRequestError &&
        error.status === 403 &&
        Boolean(error.data?.requiresVerification) &&
        error.data?.userId
      ) {
        setPendingVerificationUserId(String(error.data.userId));
        return {
          ok: false,
          message: String(error?.message || 'Email not verified.'),
          requiresVerification: true,
        };
      }
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
    if (!token) return fail('Unauthorized.');
    const existing = db.posts.find((post) => post.id === postId);
    if (!existing) return fail('Post not found.');

    const liked = existing.likedBy.includes(user.id);
    const optimisticLikedBy = liked
      ? existing.likedBy.filter((id) => id !== user.id)
      : [...existing.likedBy, user.id];

    setDb((prev) => ({
      ...prev,
      posts: prev.posts.map((post) => (post.id === postId ? { ...post, likedBy: optimisticLikedBy } : post)),
    }));

    void apiRequest(`/api/posts/${encodeURIComponent(postId)}/like`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.likedBy)) return;
        setDb((prev) => ({
          ...prev,
          posts: prev.posts.map((post) =>
            post.id === postId ? { ...post, likedBy: payload.likedBy.map(String) } : post
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          posts: prev.posts.map((post) => (post.id === postId ? existing : post)),
        }));
      });
    return ok('Like updated.');
  };

  const togglePostRepost = (postId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!token) return fail('Unauthorized.');
    const existing = db.posts.find((post) => post.id === postId);
    if (!existing) return fail('Post not found.');

    const has = existing.repostedBy.includes(user.id);
    const optimisticRepostedBy = has
      ? existing.repostedBy.filter((id) => id !== user.id)
      : [...existing.repostedBy, user.id];

    setDb((prev) => ({
      ...prev,
      posts: prev.posts.map((post) => (post.id === postId ? { ...post, repostedBy: optimisticRepostedBy } : post)),
    }));

    void apiRequest(`/api/posts/${encodeURIComponent(postId)}/repost`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.repostedBy)) return;
        setDb((prev) => ({
          ...prev,
          posts: prev.posts.map((post) =>
            post.id === postId ? { ...post, repostedBy: payload.repostedBy.map(String) } : post
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          posts: prev.posts.map((post) => (post.id === postId ? existing : post)),
        }));
      });
    return ok('Repost updated.');
  };

  const addPostComment = (postId: string, text: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!token) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');
    const comment: PostComment = {
      id: `tmp-post-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      postId,
      authorId: user.id,
      text: trimmed,
      likedBy: [],
      createdAt: nowIso(),
    };
    setDb((prev) => ({ ...prev, postComments: [comment, ...prev.postComments] }));

    void apiRequest(
      `/api/posts/${encodeURIComponent(postId)}/comments`,
      { method: 'POST', body: JSON.stringify({ text: trimmed }) },
      true
    )
      .then((payload) => {
        const persisted = payload?.comment ? toPostComment(payload.comment) : null;
        const usersFromPayload = Array.isArray(payload?.users) ? payload.users.map(toUser) : [];
        mergeUsers(usersFromPayload);
        if (!persisted) return;
        setDb((prev) => ({
          ...prev,
          postComments: [persisted, ...prev.postComments.filter((item) => item.id !== comment.id && item.id !== persisted.id)],
        }));
      })
      .catch(() => {
        setDb((prev) => ({ ...prev, postComments: prev.postComments.filter((item) => item.id !== comment.id) }));
      });

    return ok('Comment added.');
  };

  const editPostComment = (commentId: string, text: string): ActionResult => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');
    if (!user) return fail('Unauthorized.');
    if (!token) return fail('Unauthorized.');
    const existing = db.postComments.find((comment) => comment.id === commentId);
    if (!existing) return fail('Comment not found.');

    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.map((comment) =>
        comment.id === commentId ? { ...comment, text: trimmed } : comment
      ),
    }));

    void apiRequest(
      `/api/posts/comments/${encodeURIComponent(commentId)}`,
      { method: 'PATCH', body: JSON.stringify({ text: trimmed }) },
      true
    )
      .then((payload) => {
        if (!payload?.comment) return;
        const persisted = toPostComment(payload.comment);
        setDb((prev) => ({
          ...prev,
          postComments: prev.postComments.map((comment) => (comment.id === commentId ? persisted : comment)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          postComments: prev.postComments.map((comment) => (comment.id === commentId ? existing : comment)),
        }));
      });
    return ok('Comment updated.');
  };

  const deletePostComment = (commentId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!token) return fail('Unauthorized.');
    const existing = db.postComments.find((comment) => comment.id === commentId);
    if (!existing) return fail('Comment not found.');

    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.filter((comment) => comment.id !== commentId),
    }));

    void apiRequest(`/api/posts/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }, true).catch(() => {
      setDb((prev) => ({ ...prev, postComments: [existing, ...prev.postComments] }));
    });
    return ok('Comment deleted.');
  };

  const togglePostCommentLike = (commentId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!token) return fail('Unauthorized.');
    const existing = db.postComments.find((comment) => comment.id === commentId);
    if (!existing) return fail('Comment not found.');

    const liked = existing.likedBy.includes(user.id);
    const optimisticLikedBy = liked
      ? existing.likedBy.filter((id) => id !== user.id)
      : [...existing.likedBy, user.id];

    setDb((prev) => ({
      ...prev,
      postComments: prev.postComments.map((comment) => {
        if (comment.id !== commentId) return comment;
        return {
          ...comment,
          likedBy: optimisticLikedBy,
        };
      }),
    }));

    void apiRequest(`/api/posts/comments/${encodeURIComponent(commentId)}/like`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.likedBy)) return;
        setDb((prev) => ({
          ...prev,
          postComments: prev.postComments.map((comment) =>
            comment.id === commentId ? { ...comment, likedBy: payload.likedBy.map(String) } : comment
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          postComments: prev.postComments.map((comment) => (comment.id === commentId ? existing : comment)),
        }));
      });
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
        void fetchChats();
        void fetchMessagesWith(toUserId);
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

    const candidateName = patch.displayName !== undefined ? String(patch.displayName || '').trim() : '';
    const displayName = candidateName || user.displayName;
    const bio = patch.bio !== undefined ? String(patch.bio || '') : String(user.bio || '');
    const status = patch.status !== undefined ? String(patch.status || '') : String(user.status || '');
    const avatarUrl = patch.avatar !== undefined ? String(patch.avatar || '') : String(user.avatar || '');
    const coverImage =
      patch.coverImage !== undefined ? String(patch.coverImage || '') : String(user.coverImage || '');
    const hiddenFromFriends =
      patch.hiddenFromFriends !== undefined ? Boolean(patch.hiddenFromFriends) : Boolean(user.hiddenFromFriends);
    const previousUser = user;

    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) =>
        candidate.id === user.id
          ? {
              ...candidate,
              displayName,
              bio,
              status,
              avatar: avatarUrl,
              coverImage,
              hiddenFromFriends,
              updatedAt: nowIso(),
            }
          : candidate
      ),
    }));

    void apiRequest(
      '/api/users/me',
      {
        method: 'PUT',
        body: JSON.stringify({ displayName, bio, status, avatarUrl, coverImage, hiddenFromFriends }),
      },
      true
    )
      .then((payload) => {
        if (!payload?.user) return;
        const persisted = toUser(payload.user);
        setDb((prev) => ({
          ...prev,
          users: prev.users.map((candidate) => (candidate.id === user.id ? persisted : candidate)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          users: prev.users.map((candidate) =>
            candidate.id === previousUser.id ? { ...candidate, ...previousUser } : candidate
          ),
        }));
      });

    return ok('Profile updated.');
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<ActionResult> => {
    if (!token) return fail('Unauthorized.');
    const current = String(currentPassword || '');
    const next = String(newPassword || '');
    if (!current || next.length < 6) return fail('Invalid password payload.');
    try {
      const payload = await apiRequest(
        '/api/users/change-password',
        { method: 'PUT', body: JSON.stringify({ currentPassword: current, newPassword: next }) },
        true
      );
      return ok(String(payload?.message || 'Password updated.'));
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to update password.'));
    }
  };

  const requestEmailChange = async (newEmail: string): Promise<ActionResult> => {
    if (!token) return fail('Unauthorized.');
    const email = String(newEmail || '').trim().toLowerCase();
    if (!email) return fail('Email is required.');
    try {
      const payload = await apiRequest(
        '/api/users/request-email-change',
        { method: 'POST', body: JSON.stringify({ newEmail: email }) },
        true
      );
      return ok(String(payload?.message || 'Confirmation code sent.'));
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to request email change.'));
    }
  };

  const confirmEmailChange = async (code: string): Promise<ActionResult> => {
    if (!token) return fail('Unauthorized.');
    const trimmed = String(code || '').trim();
    if (!trimmed) return fail('Code is required.');
    try {
      const payload = await apiRequest(
        '/api/users/confirm-email-change',
        { method: 'POST', body: JSON.stringify({ code: trimmed }) },
        true
      );
      if (payload?.user) {
        const persisted = toUser(payload.user);
        setDb((prev) => ({
          ...prev,
          users: prev.users.map((candidate) => (candidate.id === persisted.id ? persisted : candidate)),
        }));
      }
      return ok('Email updated.');
    } catch (error: any) {
      return fail(String(error?.message || 'Failed to confirm email change.'));
    }
  };

  const groupAvatar = (name: string) => {
    const label = encodeURIComponent(String(name || 'Group').slice(0, 40));
    return `https://ui-avatars.com/api/?name=${label}&background=0f172a&color=ffffff&size=256`;
  };

  const createGroup = (payload: GroupPayload): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const allowMemberPosts = Boolean(payload.allowMemberPosts);
    if (name.length < 3) return fail('Group name is too short.');

    const optimistic: Group = {
      id: `tmp-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      adminId: user.id,
      allowMemberPosts,
      avatar: groupAvatar(name),
      coverImage: '',
      verified: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const optimisticMember: GroupMember = {
      id: `tmp-gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupId: optimistic.id,
      userId: user.id,
      role: 'admin',
      createdAt: nowIso(),
    };

    setDb((prev) => ({
      ...prev,
      groups: [optimistic, ...prev.groups],
      groupMembers: [optimisticMember, ...prev.groupMembers],
    }));

    void apiRequest(
      '/api/groups',
      {
        method: 'POST',
        body: JSON.stringify({ name, description, allowMemberPosts }),
      },
      true
    )
      .then((payload) => {
        const persisted = payload?.group ? toGroup(payload.group) : null;
        const member = payload?.member ? toGroupMember(payload.member) : null;
        const payloadUsers = Array.isArray(payload?.users) ? payload.users.map(toUser) : [];
        mergeUsers(payloadUsers);

        if (!persisted) return;
        setDb((prev) => ({
          ...prev,
          groups: [persisted, ...prev.groups.filter((item) => item.id !== optimistic.id && item.id !== persisted.id)],
          groupMembers: member
            ? [
                member,
                ...prev.groupMembers.filter(
                  (item) => item.id !== optimisticMember.id && !(item.groupId === member.groupId && item.userId === member.userId)
                ),
              ]
            : prev.groupMembers.filter((item) => item.id !== optimisticMember.id),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groups: prev.groups.filter((item) => item.id !== optimistic.id),
          groupMembers: prev.groupMembers.filter((item) => item.id !== optimisticMember.id),
        }));
      });

    return ok('Community created.');
  };

  const updateGroup = (groupId: string, patch: GroupPatch): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groups.find((item) => item.id === groupId);
    if (!existing) return fail('Group not found.');
    const previous = existing;

    const optimistic: Group = {
      ...existing,
      name: String(patch.name || existing.name).trim(),
      description: String(patch.description || ''),
      avatar: String(patch.avatar || existing.avatar),
      coverImage: String(patch.coverImage || ''),
      verified: Boolean(patch.verified),
      allowMemberPosts: Boolean(patch.allowMemberPosts),
      updatedAt: nowIso(),
    };

    setDb((prev) => ({
      ...prev,
      groups: prev.groups.map((item) => (item.id === groupId ? optimistic : item)),
    }));

    void apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: optimistic.name,
          description: optimistic.description,
          avatar: optimistic.avatar,
          coverImage: optimistic.coverImage,
          verified: optimistic.verified,
          allowMemberPosts: optimistic.allowMemberPosts,
        }),
      },
      true
    )
      .then((payload) => {
        if (!payload?.group) return;
        const persisted = toGroup(payload.group);
        setDb((prev) => ({
          ...prev,
          groups: prev.groups.map((item) => (item.id === groupId ? persisted : item)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groups: prev.groups.map((item) => (item.id === groupId ? previous : item)),
        }));
      });

    return ok('Group updated.');
  };

  const toggleGroupSubscription = (groupId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    if (!groupId) return fail('Group is missing.');

    const existing = db.groupMembers.find((item) => item.groupId === groupId && item.userId === user.id);
    if (existing) {
      setDb((prev) => ({
        ...prev,
        groupMembers: prev.groupMembers.filter((item) => item.id !== existing.id),
      }));

      void apiRequest(`/api/groups/${encodeURIComponent(groupId)}/subscribe`, { method: 'DELETE' }, true).catch(() => {
        setDb((prev) => ({
          ...prev,
          groupMembers: [existing, ...prev.groupMembers],
        }));
      });

      return ok('Unsubscribed.');
    }

    const optimistic: GroupMember = {
      id: `tmp-gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupId,
      userId: user.id,
      role: 'member',
      createdAt: nowIso(),
    };

    setDb((prev) => ({ ...prev, groupMembers: [optimistic, ...prev.groupMembers] }));
    void apiRequest(`/api/groups/${encodeURIComponent(groupId)}/subscribe`, { method: 'POST' }, true)
      .then((payload) => {
        if (!payload?.member) return;
        const persisted = toGroupMember(payload.member);
        setDb((prev) => ({
          ...prev,
          groupMembers: [persisted, ...prev.groupMembers.filter((item) => item.id !== optimistic.id)],
        }));
      })
      .catch(() => {
        setDb((prev) => ({ ...prev, groupMembers: prev.groupMembers.filter((item) => item.id !== optimistic.id) }));
      });

    return ok('Subscribed.');
  };

  const setGroupAllowMemberPosts = (groupId: string, allow: boolean): ActionResult =>
    updateGroup(groupId, {
      ...(db.groups.find((item) => item.id === groupId) || {
        name: '',
        description: '',
        avatar: '',
        coverImage: '',
        verified: false,
      }),
      allowMemberPosts: allow,
    } as GroupPatch);

  const createGroupPost = (groupId: string, text: string, mediaType?: MediaType, mediaUrl?: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    const url = String(mediaUrl || '').trim();
    if (!trimmed && !url) return fail('Post is empty.');

    const optimistic: GroupPost = {
      id: `tmp-gpost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupId,
      authorId: user.id,
      text: trimmed,
      mediaType,
      mediaUrl: url || undefined,
      createdAt: nowIso(),
      likedBy: [],
      repostedBy: [],
    };

    setDb((prev) => ({ ...prev, groupPosts: [optimistic, ...prev.groupPosts] }));

    void apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}/posts`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: trimmed,
          mediaType: mediaType || undefined,
          mediaUrl: url || undefined,
        }),
      },
      true
    )
      .then((payload) => {
        if (!payload?.post) return;
        const persisted = toGroupPost(payload.post);
        setDb((prev) => ({
          ...prev,
          groupPosts: [persisted, ...prev.groupPosts.filter((item) => item.id !== optimistic.id)],
        }));
      })
      .catch(() => {
        setDb((prev) => ({ ...prev, groupPosts: prev.groupPosts.filter((item) => item.id !== optimistic.id) }));
      });

    return ok('Published.');
  };

  const toggleGroupPostLike = (groupPostId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groupPosts.find((item) => item.id === groupPostId);
    if (!existing) return fail('Post not found.');

    const liked = existing.likedBy.includes(user.id);
    const optimisticLikedBy = liked ? existing.likedBy.filter((id) => id !== user.id) : [...existing.likedBy, user.id];

    setDb((prev) => ({
      ...prev,
      groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? { ...item, likedBy: optimisticLikedBy } : item)),
    }));

    void apiRequest(`/api/groups/posts/${encodeURIComponent(groupPostId)}/like`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.likedBy)) return;
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) =>
            item.id === groupPostId ? { ...item, likedBy: payload.likedBy.map(String) } : item
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? existing : item)),
        }));
      });

    return ok('Like updated.');
  };

  const repostGroupPost = (_groupPostId: string, _targetGroupId: string): ActionResult =>
    fail('Repost between groups is not supported yet.');

  const repostGroupPostToProfile = (groupPostId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groupPosts.find((item) => item.id === groupPostId);
    if (!existing) return fail('Post not found.');

    const has = existing.repostedBy.includes(user.id);
    const optimistic = has ? existing.repostedBy.filter((id) => id !== user.id) : [...existing.repostedBy, user.id];
    setDb((prev) => ({
      ...prev,
      groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? { ...item, repostedBy: optimistic } : item)),
    }));

    void apiRequest(`/api/groups/posts/${encodeURIComponent(groupPostId)}/repost`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.repostedBy)) return;
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) =>
            item.id === groupPostId ? { ...item, repostedBy: payload.repostedBy.map(String) } : item
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? existing : item)),
        }));
      });

    return ok('Repost updated.');
  };

  const publishGroupPostToFeed = (_groupPostId: string): ActionResult =>
    fail('Publishing group posts to feed is not supported yet.');

  const editGroupPost = (groupPostId: string, text: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Post is empty.');

    const existing = db.groupPosts.find((item) => item.id === groupPostId);
    if (!existing) return fail('Post not found.');
    const previous = existing;

    setDb((prev) => ({
      ...prev,
      groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? { ...item, text: trimmed } : item)),
    }));

    void apiRequest(
      `/api/groups/posts/${encodeURIComponent(groupPostId)}`,
      { method: 'PATCH', body: JSON.stringify({ content: trimmed }) },
      true
    )
      .then((payload) => {
        if (!payload?.post) return;
        const persisted = toGroupPost(payload.post);
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? { ...item, ...persisted } : item)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPosts: prev.groupPosts.map((item) => (item.id === groupPostId ? previous : item)),
        }));
      });

    return ok('Post updated.');
  };

  const deleteGroupPost = (groupPostId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groupPosts.find((item) => item.id === groupPostId);
    if (!existing) return fail('Post not found.');

    setDb((prev) => {
      const removedIds = new Set([groupPostId]);
      return {
        ...prev,
        groupPosts: prev.groupPosts.filter((item) => item.id !== groupPostId),
        groupPostComments: prev.groupPostComments.filter((item) => !removedIds.has(item.groupPostId)),
      };
    });

    void apiRequest(`/api/groups/posts/${encodeURIComponent(groupPostId)}`, { method: 'DELETE' }, true).catch(() => {
      setDb((prev) => ({ ...prev, groupPosts: [existing, ...prev.groupPosts] }));
    });

    return ok('Post deleted.');
  };

  const addGroupPostComment = (groupPostId: string, text: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');

    const optimistic: GroupPostComment = {
      id: `tmp-gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupPostId,
      authorId: user.id,
      text: trimmed,
      likedBy: [],
      createdAt: nowIso(),
    };

    setDb((prev) => ({ ...prev, groupPostComments: [...prev.groupPostComments, optimistic] }));

    void apiRequest(
      `/api/groups/posts/${encodeURIComponent(groupPostId)}/comments`,
      { method: 'POST', body: JSON.stringify({ text: trimmed }) },
      true
    )
      .then((payload) => {
        if (!payload?.comment) return;
        const persisted = toGroupPostComment(payload.comment);
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.map((item) => (item.id === optimistic.id ? persisted : item)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.filter((item) => item.id !== optimistic.id),
        }));
      });

    return ok('Comment added.');
  };

  const editGroupPostComment = (commentId: string, text: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const trimmed = String(text || '').trim();
    if (!trimmed) return fail('Comment is empty.');
    const existing = db.groupPostComments.find((item) => item.id === commentId);
    if (!existing) return fail('Comment not found.');
    const previous = existing;

    setDb((prev) => ({
      ...prev,
      groupPostComments: prev.groupPostComments.map((item) => (item.id === commentId ? { ...item, text: trimmed } : item)),
    }));

    void apiRequest(
      `/api/groups/comments/${encodeURIComponent(commentId)}`,
      { method: 'PATCH', body: JSON.stringify({ text: trimmed }) },
      true
    )
      .then((payload) => {
        if (!payload?.comment) return;
        const persisted = toGroupPostComment(payload.comment);
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.map((item) => (item.id === commentId ? persisted : item)),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.map((item) => (item.id === commentId ? previous : item)),
        }));
      });

    return ok('Comment updated.');
  };

  const deleteGroupPostComment = (commentId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groupPostComments.find((item) => item.id === commentId);
    if (!existing) return fail('Comment not found.');

    setDb((prev) => ({
      ...prev,
      groupPostComments: prev.groupPostComments.filter((item) => item.id !== commentId),
    }));

    void apiRequest(`/api/groups/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }, true).catch(() => {
      setDb((prev) => ({ ...prev, groupPostComments: [...prev.groupPostComments, existing] }));
    });

    return ok('Comment deleted.');
  };

  const toggleGroupPostCommentLike = (commentId: string): ActionResult => {
    if (!user) return fail('Unauthorized.');
    const existing = db.groupPostComments.find((item) => item.id === commentId);
    if (!existing) return fail('Comment not found.');

    const liked = existing.likedBy.includes(user.id);
    const optimistic = liked ? existing.likedBy.filter((id) => id !== user.id) : [...existing.likedBy, user.id];

    setDb((prev) => ({
      ...prev,
      groupPostComments: prev.groupPostComments.map((item) =>
        item.id === commentId ? { ...item, likedBy: optimistic } : item
      ),
    }));

    void apiRequest(`/api/groups/comments/${encodeURIComponent(commentId)}/like`, { method: 'POST' }, true)
      .then((payload) => {
        if (!Array.isArray(payload?.likedBy)) return;
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.map((item) =>
            item.id === commentId ? { ...item, likedBy: payload.likedBy.map(String) } : item
          ),
        }));
      })
      .catch(() => {
        setDb((prev) => ({
          ...prev,
          groupPostComments: prev.groupPostComments.map((item) => (item.id === commentId ? existing : item)),
        }));
      });

    return ok('Like updated.');
  };

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
    resendVerificationCode,
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
    changePassword,
    requestEmailChange,
    confirmEmailChange,
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
