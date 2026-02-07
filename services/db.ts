import { Group, GroupMember, GroupPost, Post, SocialDb, User } from '../types';
import { API_URL, apiUrl } from './api';

const DB_KEY = 'aura-social-db-v4';
const DAY_MS = 24 * 60 * 60 * 1000;
const REMOTE_URL = apiUrl('/api/db');
const REMOTE_WS_URL = (() => {
  if (API_URL) {
    if (API_URL.startsWith('https://')) return `${API_URL.replace('https://', 'wss://')}/ws`;
    if (API_URL.startsWith('http://')) return `${API_URL.replace('http://', 'ws://')}/ws`;
    return `${API_URL}/ws`;
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return '/ws';
})();

const now = () => new Date().toISOString();

const adminUser = (): User => ({
  id: 'admin-313',
  username: '313',
  password: '313',
  displayName: 'Aura Admin',
  bio: 'Administrator account',
  status: 'online',
  avatar: 'https://i.pravatar.cc/300?img=14',
  coverImage: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=80&auto=format&fit=crop',
  role: 'admin',
  banned: false,
  restricted: false,
  verified: true,
  createdAt: now(),
  updatedAt: now(),
  lastSeenAt: now(),
});

const defaultGroup = (): Group => ({
  id: 'group-general',
  name: 'Aura Community',
  description: 'Main community wall for all users.',
  adminId: 'admin-313',
  allowMemberPosts: true,
  avatar: 'https://picsum.photos/seed/group-general-avatar/200/200',
  coverImage: 'https://picsum.photos/seed/group-general-cover/1400/420',
  verified: true,
  createdAt: now(),
  updatedAt: now(),
});

const defaultGroupAdminMember = (): GroupMember => ({
  id: 'group-member-admin-313',
  groupId: 'group-general',
  userId: 'admin-313',
  role: 'admin',
  createdAt: now(),
});

export const cleanDbState = (): SocialDb => ({
  users: [adminUser()],
  follows: [],
  posts: [],
  postComments: [],
  stories: [],
  storyComments: [],
  messages: [],
  groups: [defaultGroup()],
  groupMembers: [defaultGroupAdminMember()],
  groupPosts: [],
  groupPostComments: [],
  notifications: [],
  theme: 'light',
  session: {
    userId: null,
    currentView: 'feed',
    activeChatUserId: null,
    activeGroupId: 'group-general',
  },
});

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

const ensureAdmin = (users: User[]): User[] => {
  const found = users.find((user) => user.username === '313');
  if (!found) return [adminUser(), ...users];
  return users.map((user) =>
    user.username === '313'
      ? {
          ...user,
          role: 'admin',
          banned: false,
          restricted: false,
          verified: true,
          status: user.status ?? 'online',
          updatedAt: user.updatedAt || user.createdAt || user.lastSeenAt || now(),
        }
      : user
  );
};

const ensureGroupAdmins = (groups: Group[], members: GroupMember[]): GroupMember[] => {
  const list = [...members];
  groups.forEach((group) => {
    const hasAdmin = list.some(
      (member) => member.groupId === group.id && member.userId === group.adminId && member.role === 'admin'
    );
    if (!hasAdmin) {
      list.unshift({
        id: `group-member-${group.adminId}-${group.id}`,
        groupId: group.id,
        userId: group.adminId,
        role: 'admin',
        createdAt: now(),
      });
    }
  });
  return list;
};

const normalizePostReposts = (posts: Post[]): Post[] => {
  const ordered = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const seenReposts = new Set<string>();
  const deduped = ordered.filter((post) => {
    if (!post.repostOfPostId) return true;
    const key = `${post.authorId}:${post.repostOfPostId}`;
    if (seenReposts.has(key)) return false;
    seenReposts.add(key);
    return true;
  });

  const repostAuthorsByRoot = new Map<string, Set<string>>();
  deduped.forEach((post) => {
    if (!post.repostOfPostId) return;
    const bucket = repostAuthorsByRoot.get(post.repostOfPostId) ?? new Set<string>();
    bucket.add(post.authorId);
    repostAuthorsByRoot.set(post.repostOfPostId, bucket);
  });

  return deduped.map((post) => ({
    ...post,
    repostedBy: post.repostOfPostId
      ? []
      : [...(repostAuthorsByRoot.get(post.id) ?? new Set<string>())],
  }));
};

const normalizeGroupPostReposts = (posts: GroupPost[]): GroupPost[] => {
  const ordered = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const seenReposts = new Set<string>();
  const deduped = ordered.filter((post) => {
    if (!post.repostOfPostId) return true;
    const key = `${post.groupId}:${post.authorId}:${post.repostOfPostId}`;
    if (seenReposts.has(key)) return false;
    seenReposts.add(key);
    return true;
  });

  const repostAuthorsByRoot = new Map<string, Set<string>>();
  deduped.forEach((post) => {
    if (!post.repostOfPostId) return;
    const bucket = repostAuthorsByRoot.get(post.repostOfPostId) ?? new Set<string>();
    bucket.add(post.authorId);
    repostAuthorsByRoot.set(post.repostOfPostId, bucket);
  });

  return deduped.map((post) => ({
    ...post,
    repostedBy: post.repostOfPostId
      ? []
      : [...(repostAuthorsByRoot.get(post.id) ?? new Set<string>())],
  }));
};

const normalizeDb = (input: Partial<SocialDb>): SocialDb => {
  const base = cleanDbState();
  const hydratedUsers = ensureAdmin(input.users ?? base.users).map((user) => ({
    ...user,
    status: user.status ?? '',
    updatedAt: user.updatedAt || user.createdAt || user.lastSeenAt || now(),
  }));
  const groups = (input.groups?.length ? input.groups : base.groups).map((group) => ({
    ...group,
    avatar: group.avatar || `https://picsum.photos/seed/${encodeURIComponent(group.id)}-avatar/200/200`,
    coverImage:
      group.coverImage || `https://picsum.photos/seed/${encodeURIComponent(group.id)}-cover/1400/420`,
    verified: Boolean(group.verified),
    updatedAt: group.updatedAt || group.createdAt || now(),
  }));
  const groupMembers = ensureGroupAdmins(groups, input.groupMembers ?? base.groupMembers);
  const posts = normalizePostReposts(
    (input.posts ?? base.posts).map((post) => ({
      ...post,
      repostedBy: post.repostedBy ?? [],
      repostOfPostId: post.repostOfPostId,
    }))
  );
  const groupPosts = normalizeGroupPostReposts(
    (input.groupPosts ?? base.groupPosts).map((post) => ({
      ...post,
      repostedBy: post.repostedBy ?? [],
      repostOfPostId: post.repostOfPostId,
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl,
    }))
  );

  const messages = (input.messages ?? base.messages)
    .map((message) => ({
      ...message,
      mediaType: message.mediaType,
      mediaUrl: message.mediaUrl,
      expiresAt: message.expiresAt,
      editedAt: message.editedAt,
      readBy: Array.isArray(message.readBy) ? message.readBy : [message.fromId],
    }))
    .filter((message) => {
      if (message.mediaType !== 'voice' || !message.expiresAt) return true;
      return new Date(message.expiresAt).getTime() > Date.now();
    });

  return {
    ...base,
    ...input,
    users: hydratedUsers,
    follows: input.follows ?? base.follows,
    posts,
    postComments: input.postComments ?? base.postComments,
    stories:
      input.stories?.filter((story) => new Date(story.expiresAt).getTime() > Date.now() - DAY_MS) ??
      base.stories,
    storyComments: input.storyComments ?? base.storyComments,
    messages,
    groups,
    groupMembers,
    groupPosts,
    groupPostComments: input.groupPostComments ?? base.groupPostComments,
    notifications: input.notifications ?? base.notifications,
    session: {
      ...base.session,
      ...(input.session ?? {}),
    },
    theme: input.theme === 'dark' ? 'dark' : 'light',
  };
};

export const loadDb = (): SocialDb => {
  if (!storage) return cleanDbState();
  try {
    const raw = storage.getItem(DB_KEY);
    if (!raw) return cleanDbState();
    const parsed = JSON.parse(raw) as Partial<SocialDb>;
    return normalizeDb(parsed);
  } catch (error) {
    console.warn('Failed to load local DB, fallback to clean state', error);
    return cleanDbState();
  }
};

export const persistDb = (state: SocialDb) => {
  if (!storage) return;
  try {
    storage.setItem(DB_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to persist local DB', error);
  }
};

export const resetDb = () => {
  storage?.removeItem(DB_KEY);
};

export const stateForRemote = (state: SocialDb): SocialDb => ({
  ...state,
  session: {
    userId: null,
    currentView: 'feed',
    activeChatUserId: null,
    activeGroupId: state.session.activeGroupId ?? 'group-general',
  },
});

export const syncFingerprint = (state: SocialDb): string => JSON.stringify(stateForRemote(state));

export type RemoteLoadResult = {
  ok: boolean;
  exists: boolean;
  state: SocialDb | null;
  revision: number;
};

export type RemotePersistResult = {
  ok: boolean;
  conflict: boolean;
  revision: number;
  state: SocialDb | null;
};

export type SyncEvent = {
  type: 'hello' | 'db:updated';
  revision?: number;
  updatedAt?: string | null;
};

export const loadRemoteDb = async (): Promise<RemoteLoadResult> => {
  if (typeof window === 'undefined') {
    return { ok: false, exists: false, state: null, revision: 0 };
  }
  try {
    const response = await fetch(REMOTE_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, exists: false, state: null, revision: 0 };
    }
    const payload = (await response.json()) as
      | {
          state?: Partial<SocialDb> | null;
          revision?: number;
        }
      | Partial<SocialDb>;
    const raw = (payload as { state?: Partial<SocialDb> | null }).state ?? (payload as Partial<SocialDb>);
    const revision = Number((payload as { revision?: number }).revision ?? 0);
    if (!raw || Object.keys(raw).length === 0) {
      return { ok: true, exists: false, state: null, revision };
    }
    return { ok: true, exists: true, state: normalizeDb(raw), revision };
  } catch (error) {
    console.warn('Remote DB is unavailable. Using local storage only.', error);
    return { ok: false, exists: false, state: null, revision: 0 };
  }
};

export const persistRemoteDb = async (
  state: SocialDb,
  revision: number
): Promise<RemotePersistResult> => {
  if (typeof window === 'undefined') {
    return { ok: false, conflict: false, revision, state: null };
  }
  try {
    const response = await fetch(REMOTE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateForRemote(state), revision }),
    });
    if (response.status === 409) {
      const payload = (await response.json()) as {
        state?: Partial<SocialDb> | null;
        revision?: number;
      };
      return {
        ok: false,
        conflict: true,
        revision: Number(payload.revision ?? revision),
        state: payload.state ? normalizeDb(payload.state) : null,
      };
    }
    if (!response.ok) {
      return { ok: false, conflict: false, revision, state: null };
    }
    const payload = (await response.json()) as { revision?: number };
    return {
      ok: true,
      conflict: false,
      revision: Number(payload.revision ?? revision + 1),
      state: null,
    };
  } catch (error) {
    console.warn('Failed to push state to remote DB.', error);
    return { ok: false, conflict: false, revision, state: null };
  }
};

export const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const avatarFromSeed = (seed: string) => `https://i.pravatar.cc/300?u=${encodeURIComponent(seed)}`;

export const coverFromSeed = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/1400/420`;

export const connectSyncSocket = (onEvent: (event: SyncEvent) => void) => {
  if (typeof window === 'undefined') return () => {};

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let isClosed = false;

  const open = () => {
    socket = new WebSocket(REMOTE_WS_URL);
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data as string) as SyncEvent;
        if (payload?.type === 'hello' || payload?.type === 'db:updated') {
          onEvent(payload);
        }
      } catch {
        // ignore malformed payload
      }
    };
    socket.onclose = () => {
      if (isClosed) return;
      reconnectTimer = window.setTimeout(open, 700);
    };
    socket.onerror = () => {
      socket?.close();
    };
  };

  open();

  return () => {
    isClosed = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
};
