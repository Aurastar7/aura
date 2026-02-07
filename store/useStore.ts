import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  cleanDbState,
  connectSyncSocket,
  loadDb,
  loadRemoteDb,
  makeId,
  persistDb,
  persistRemoteDb,
  resetDb,
  syncFingerprint,
} from '../services/db';

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
  register: (payload: RegisterPayload) => ActionResult;
  login: (payload: LoginPayload) => ActionResult;
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
  createStory: (payload: StoryPayload) => ActionResult;
  deleteStory: (storyId: string) => ActionResult;
  addStoryComment: (storyId: string, text: string) => ActionResult;
  followUser: (targetUserId: string) => ActionResult;
  sendMessage: (
    toUserId: string,
    payload: { text?: string; mediaType?: 'image' | 'voice'; mediaUrl?: string; expiresAt?: string }
  ) => ActionResult;
  editMessage: (messageId: string, text: string) => ActionResult;
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
  publishGroupPostToFeed: (groupPostId: string) => ActionResult;
  addGroupPostComment: (groupPostId: string, text: string) => ActionResult;
  setUserRole: (userId: string, role: UserRole) => ActionResult;
  setUserBan: (userId: string, banned: boolean) => ActionResult;
  setUserRestricted: (userId: string, restricted: boolean) => ActionResult;
  setUserVerified: (userId: string, verified: boolean) => ActionResult;
  clearNetworkData: () => ActionResult;
  resetAllData: () => ActionResult;
};

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const isAdmin = (user: User | null) => user?.role === 'admin';

const sortByDateDesc = <T extends { createdAt: string }>(list: T[]) =>
  [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const withLocalSession = (remote: SocialDb, prev: SocialDb): SocialDb => ({
  ...remote,
  theme: prev.theme,
  session: {
    ...remote.session,
    userId: prev.session.userId,
    currentView: prev.session.currentView,
    activeChatUserId: prev.session.activeChatUserId,
    activeGroupId: prev.session.activeGroupId ?? remote.session.activeGroupId,
  },
});

const newerIso = (left?: string, right?: string) =>
  new Date(left || 0).getTime() >= new Date(right || 0).getTime();

const mergeById = <T extends { id: string }>(
  local: T[],
  remote: T[],
  choose: (localItem: T, remoteItem: T) => T
) => {
  const map = new Map<string, T>();
  remote.forEach((item) => map.set(item.id, item));
  local.forEach((item) => {
    const existing = map.get(item.id);
    map.set(item.id, existing ? choose(item, existing) : item);
  });
  return [...map.values()];
};

const mergeUsers = (local: User[], remote: User[]): User[] => {
  const map = new Map<string, User>();
  remote.forEach((item) => map.set(item.id, item));
  local.forEach((localUser) => {
    const remoteUser = map.get(localUser.id);
    if (!remoteUser) {
      map.set(localUser.id, localUser);
      return;
    }

    const preferLocal = newerIso(localUser.updatedAt, remoteUser.updatedAt);
    const base = preferLocal ? localUser : remoteUser;
    const other = preferLocal ? remoteUser : localUser;
    map.set(localUser.id, {
      ...base,
      // Keep presence as newest heartbeat signal, but role/profile from newest updatedAt.
      lastSeenAt: newerIso(localUser.lastSeenAt, remoteUser.lastSeenAt)
        ? localUser.lastSeenAt
        : remoteUser.lastSeenAt,
      updatedAt: newerIso(base.updatedAt, other.updatedAt) ? base.updatedAt : other.updatedAt,
    });
  });
  return [...map.values()];
};

const mergeGroups = (local: Group[], remote: Group[]): Group[] => {
  const map = new Map<string, Group>();
  remote.forEach((item) => map.set(item.id, item));
  local.forEach((localGroup) => {
    const remoteGroup = map.get(localGroup.id);
    if (!remoteGroup) {
      map.set(localGroup.id, localGroup);
      return;
    }

    const localUpdatedAt = localGroup.updatedAt || localGroup.createdAt;
    const remoteUpdatedAt = remoteGroup.updatedAt || remoteGroup.createdAt;
    map.set(localGroup.id, newerIso(localUpdatedAt, remoteUpdatedAt) ? localGroup : remoteGroup);
  });
  return [...map.values()];
};

const mergeDb = (local: SocialDb, remote: SocialDb): SocialDb => ({
  ...remote,
  users: mergeUsers(local.users, remote.users),
  follows: mergeById(local.follows, remote.follows, (l, r) => (newerIso(l.createdAt, r.createdAt) ? l : r)),
  posts: mergeById(local.posts, remote.posts, (l, r) => (newerIso(l.createdAt, r.createdAt) ? l : r)),
  postComments: mergeById(local.postComments, remote.postComments, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  stories: mergeById(local.stories, remote.stories, (l, r) => (newerIso(l.createdAt, r.createdAt) ? l : r)),
  storyComments: mergeById(local.storyComments, remote.storyComments, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  messages: mergeById(local.messages, remote.messages, (l, r) => (newerIso(l.createdAt, r.createdAt) ? l : r)),
  groups: mergeGroups(local.groups, remote.groups),
  groupMembers: mergeById(local.groupMembers, remote.groupMembers, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  groupPosts: mergeById(local.groupPosts, remote.groupPosts, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  groupPostComments: mergeById(local.groupPostComments, remote.groupPostComments, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  notifications: mergeById(local.notifications, remote.notifications, (l, r) =>
    newerIso(l.createdAt, r.createdAt) ? l : r
  ),
  theme: local.theme,
  session: local.session,
});

export function useStore(): UseStore {
  const [db, setDb] = useState<SocialDb>(() => loadDb());
  const [remoteEnabled, setRemoteEnabled] = useState(true);
  const [remoteSynced, setRemoteSynced] = useState(false);
  const syncHashRef = useRef<string>('');
  const startupHashRef = useRef<string>('');
  const remoteRevisionRef = useRef(0);
  const remoteFailCountRef = useRef(0);
  const pushingRef = useRef(false);
  const dbRef = useRef(db);

  if (!startupHashRef.current) {
    startupHashRef.current = syncFingerprint(db);
  }

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const user = useMemo(
    () => db.users.find((candidate) => candidate.id === db.session.userId) ?? null,
    [db.users, db.session.userId]
  );

  const posts = useMemo(() => sortByDateDesc(db.posts), [db.posts]);
  const postComments = useMemo(() => sortByDateDesc(db.postComments), [db.postComments]);
  const stories = useMemo(
    () =>
      sortByDateDesc(
        db.stories.filter((story) => new Date(story.expiresAt).getTime() > Date.now())
      ),
    [db.stories]
  );
  const storyComments = useMemo(() => sortByDateDesc(db.storyComments), [db.storyComments]);
  const messages = useMemo(() => sortByDateDesc(db.messages), [db.messages]);
  const groups = useMemo(() => sortByDateDesc(db.groups), [db.groups]);
  const groupMembers = useMemo(() => sortByDateDesc(db.groupMembers), [db.groupMembers]);
  const groupPosts = useMemo(() => sortByDateDesc(db.groupPosts), [db.groupPosts]);
  const groupPostComments = useMemo(
    () => sortByDateDesc(db.groupPostComments),
    [db.groupPostComments]
  );

  const notifications = useMemo(() => {
    if (!user) return [];
    const allowed = new Set(['follow', 'post_like', 'post_repost', 'group_post_like']);
    return sortByDateDesc(
      db.notifications.filter((item) => item.userId === user.id && allowed.has(item.type))
    );
  }, [db.notifications, user]);

  const unreadMessagesCount = useMemo(() => {
    if (!user) return 0;
    return db.messages.filter(
      (message) => message.toId === user.id && !message.readBy.includes(user.id)
    ).length;
  }, [db.messages, user]);

  const users = useMemo(
    () => db.users.filter((candidate) => candidate.id !== user?.id),
    [db.users, user?.id]
  );

  useEffect(() => {
    if (remoteSynced || !remoteEnabled) return;
    let cancelled = false;
    const bootstrap = async () => {
      const remote = await loadRemoteDb();
      if (cancelled) return;
      if (!remote.ok) {
        remoteFailCountRef.current += 1;
        if (remoteFailCountRef.current >= 3) {
          setRemoteEnabled(false);
          setRemoteSynced(true);
        }
        return;
      }
      remoteFailCountRef.current = 0;
      remoteRevisionRef.current = remote.revision;
      if (remote.state) {
        const localNow = dbRef.current;
        const localHash = syncFingerprint(localNow);
        const remoteHash = syncFingerprint(remote.state);
        if (localHash !== startupHashRef.current && localHash !== remoteHash) {
          const merged = mergeDb(localNow, remote.state as SocialDb);
          setDb((prev) => withLocalSession(merged, prev));
          const pushed = await persistRemoteDb(merged, remote.revision);
          if (pushed.ok) {
            remoteRevisionRef.current = pushed.revision;
            syncHashRef.current = syncFingerprint(merged);
          } else if (pushed.conflict && pushed.state) {
            remoteRevisionRef.current = pushed.revision;
            const mergedAfterConflict = mergeDb(merged, pushed.state as SocialDb);
            syncHashRef.current = syncFingerprint(mergedAfterConflict);
            setDb((prev) => withLocalSession(mergedAfterConflict, prev));
          }
        } else {
          syncHashRef.current = remoteHash;
          setDb((prev) => withLocalSession(remote.state as SocialDb, prev));
        }
      } else {
        const pushed = await persistRemoteDb(dbRef.current, remote.revision);
        if (pushed.ok) {
          remoteRevisionRef.current = pushed.revision;
          syncHashRef.current = syncFingerprint(dbRef.current);
        }
      }
      setRemoteSynced(true);
    };

    void bootstrap();
    const timer = window.setInterval(() => {
      if (remoteSynced || !remoteEnabled) return;
      void bootstrap();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, remoteSynced]);

  useEffect(() => {
    persistDb(db);
    if (!remoteSynced || !remoteEnabled) return;

    const nextHash = syncFingerprint(db);
    if (nextHash === syncHashRef.current) return;

    const timer = window.setTimeout(async () => {
      pushingRef.current = true;
      const pushed = await persistRemoteDb(db, remoteRevisionRef.current);
      pushingRef.current = false;
      if (pushed.ok) {
        remoteRevisionRef.current = pushed.revision;
        syncHashRef.current = nextHash;
        return;
      }
      if (pushed.conflict && pushed.state) {
        remoteRevisionRef.current = pushed.revision;
        const merged = mergeDb(dbRef.current, pushed.state as SocialDb);
        syncHashRef.current = syncFingerprint(merged);
        setDb((prev) => withLocalSession(merged, prev));
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [db, remoteEnabled, remoteSynced]);

  useEffect(() => {
    if (!remoteSynced || !remoteEnabled) return;

    const pullRemote = async () => {
      if (pushingRef.current) return;
      const remote = await loadRemoteDb();
      if (!remote.ok || !remote.state) return;
      remoteRevisionRef.current = remote.revision;
      const remoteHash = syncFingerprint(remote.state);
      if (remoteHash === syncHashRef.current) return;
      const merged = mergeDb(dbRef.current, remote.state as SocialDb);
      syncHashRef.current = syncFingerprint(merged);
      setDb((prev) => withLocalSession(merged, prev));
    };

    const disconnectSocket = connectSyncSocket((event) => {
      const incomingRevision = Number(event.revision ?? 0);
      if (event.type === 'db:updated' && incomingRevision <= remoteRevisionRef.current) return;
      void pullRemote();
    });

    const timer = window.setInterval(() => {
      void pullRemote();
    }, 8000);

    return () => {
      disconnectSocket();
      window.clearInterval(timer);
    };
  }, [remoteEnabled, remoteSynced]);

  useEffect(() => {
    if (db.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [db.theme]);

  useEffect(() => {
    if (!user || !user.banned) return;
    setDb((prev) => ({
      ...prev,
      session: {
        ...prev.session,
        userId: null,
        currentView: 'feed',
        activeChatUserId: null,
      },
    }));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const touch = () => {
      setDb((prev) => ({
        ...prev,
        users: prev.users.map((candidate) =>
          candidate.id === user.id
            ? { ...candidate, lastSeenAt: new Date().toISOString() }
            : candidate
        ),
      }));
    };

    touch();
    const timer = window.setInterval(touch, 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') touch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDb((prev) => ({
        ...prev,
        messages: prev.messages.filter((message) => {
          if (message.mediaType !== 'voice' || !message.expiresAt) return true;
          return new Date(message.expiresAt).getTime() > Date.now();
        }),
      }));
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  const addNotification = (
    prev: SocialDb,
    payload: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>
  ): SocialDb => ({
    ...prev,
    notifications: [
      {
        id: makeId('notif'),
        createdAt: new Date().toISOString(),
        read: false,
        ...payload,
      },
      ...prev.notifications,
    ],
  });

  const register = (payload: RegisterPayload): ActionResult => {
    const username = payload.username.trim().toLowerCase();
    const displayName = payload.displayName.trim();
    const password = payload.password.trim();

    if (username.length < 3) return fail('Username must contain at least 3 characters.');
    if (displayName.length < 2) return fail('Display name must contain at least 2 characters.');
    if (password.length < 3) return fail('Password must contain at least 3 characters.');
    if (db.users.some((candidate) => candidate.username.toLowerCase() === username)) {
      return fail('This username is already taken.');
    }

    const createdAt = new Date().toISOString();
    const newUser: User = {
      id: makeId('user'),
      username,
      password,
      displayName,
      bio: '',
      status: '',
      avatar: '',
      coverImage: '',
      role: 'user',
      banned: false,
      restricted: false,
      verified: false,
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
    };

    setDb((prev) => {
      return {
        ...prev,
        users: [newUser, ...prev.users],
        session: {
          ...prev.session,
          userId: newUser.id,
          currentView: 'feed' as AppView,
        },
      };
    });

    return ok('Registration complete. You are now logged in.');
  };

  const login = (payload: LoginPayload): ActionResult => {
    const username = payload.username.trim().toLowerCase();
    const password = payload.password.trim();
    const target = db.users.find((candidate) => candidate.username.toLowerCase() === username);

    if (!target || target.password !== password) {
      return fail('Invalid username or password.');
    }
    if (target.banned) {
      return fail('This account is banned.');
    }

    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) =>
        candidate.id === target.id
          ? { ...candidate, lastSeenAt: new Date().toISOString() }
          : candidate
      ),
      session: {
        ...prev.session,
        userId: target.id,
        currentView: 'feed',
      },
    }));

    return ok(target.role === 'admin' ? 'Admin session started.' : 'Successfully logged in.');
  };

  const logout = () => {
    setDb((prev) => ({
      ...prev,
      session: {
        ...prev.session,
        userId: null,
        currentView: 'feed',
        activeChatUserId: null,
      },
    }));
  };

  const setTheme = (theme: ThemeMode) => {
    setDb((prev) => ({ ...prev, theme }));
  };

  const setCurrentView = (view: AppView) => {
    if (view === 'admin' && !isAdmin(user)) return;
    setDb((prev) => ({
      ...prev,
      session: { ...prev.session, currentView: view },
    }));
  };

  const setActiveChatUser = (userId: string | null) => {
    setDb((prev) => ({
      ...prev,
      session: { ...prev.session, activeChatUserId: userId },
      messages:
        userId && user
          ? prev.messages.map((message) => {
              const isTarget =
                message.toId === user.id &&
                message.fromId === userId &&
                !message.readBy.includes(user.id);
              if (!isTarget) return message;
              return { ...message, readBy: [...message.readBy, user.id] };
            })
          : prev.messages,
    }));
  };

  const setActiveGroup = (groupId: string | null) => {
    setDb((prev) => ({
      ...prev,
      session: { ...prev.session, activeGroupId: groupId },
    }));
  };

  const createPost = (payload: PostPayload): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot create posts.');

    const text = payload.text.trim();
    const mediaUrl = payload.mediaUrl?.trim();
    if (!text && !mediaUrl) return fail('Add text or media to create post.');

    const post: Post = {
      id: makeId('post'),
      authorId: user.id,
      text,
      mediaType: mediaUrl ? payload.mediaType ?? 'image' : undefined,
      mediaUrl: mediaUrl || undefined,
      createdAt: new Date().toISOString(),
      likedBy: [],
      repostedBy: [],
    };

    setDb((prev) => ({ ...prev, posts: [post, ...prev.posts] }));
    return ok('Post published.');
  };

  const deletePost = (postId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const post = db.posts.find((item) => item.id === postId);
    if (!post) return fail('Post not found.');
    if (post.authorId !== user.id && user.role !== 'admin') {
      return fail('No access to delete this post.');
    }

    setDb((prev) => {
      const deleteIds = new Set<string>([postId]);
      if (!post.repostOfPostId) {
        prev.posts
          .filter((item) => item.repostOfPostId === post.id)
          .forEach((item) => deleteIds.add(item.id));
      }

      return {
        ...prev,
        posts: prev.posts
          .filter((item) => !deleteIds.has(item.id))
          .map((item) =>
            post.repostOfPostId && item.id === post.repostOfPostId
              ? { ...item, repostedBy: item.repostedBy.filter((id) => id !== post.authorId) }
              : item
          ),
        postComments: prev.postComments.filter((comment) => !deleteIds.has(comment.postId)),
      };
    });
    return ok('Post deleted.');
  };

  const togglePostLike = (postId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const post = db.posts.find((item) => item.id === postId);
    if (!post) return fail('Post not found.');

    const wasLiked = post.likedBy.includes(user.id);

    setDb((prev) => {
      const withUpdatedPost = {
        ...prev,
        posts: prev.posts.map((item) =>
          item.id === postId
            ? {
                ...item,
                likedBy: item.likedBy.includes(user.id)
                  ? item.likedBy.filter((id) => id !== user.id)
                  : [...item.likedBy, user.id],
              }
            : item
        ),
      };
      if (wasLiked || post.authorId === user.id) return withUpdatedPost;
      return addNotification(withUpdatedPost, {
        userId: post.authorId,
        actorId: user.id,
        type: 'post_like',
        text: `${user.displayName} liked your post.`,
      });
    });

    return ok(wasLiked ? 'Like removed.' : 'Post liked.');
  };

  const togglePostRepost = (postId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot repost.');
    const source = db.posts.find((item) => item.id === postId);
    if (!source) return fail('Post not found.');

    const rootId = source.repostOfPostId ?? source.id;
    const root = db.posts.find((item) => item.id === rootId);
    if (!root) return fail('Original post not found.');

    const existingRepost = db.posts.find(
      (item) => item.authorId === user.id && item.repostOfPostId === rootId
    );

    setDb((prev) => {
      if (existingRepost) {
        return {
          ...prev,
          posts: prev.posts
            .filter((item) => item.id !== existingRepost.id)
            .map((item) =>
              item.id === rootId
                ? { ...item, repostedBy: item.repostedBy.filter((id) => id !== user.id) }
                : item
            ),
          postComments: prev.postComments.filter((comment) => comment.postId !== existingRepost.id),
        };
      }

      const repostPost: Post = {
        id: makeId('post'),
        authorId: user.id,
        text: root.text,
        mediaType: root.mediaType,
        mediaUrl: root.mediaUrl,
        createdAt: new Date().toISOString(),
        likedBy: [],
        repostedBy: [],
        repostOfPostId: rootId,
      };
      const withRepost = {
        ...prev,
        posts: [repostPost, ...prev.posts].map((item) =>
          item.id === rootId && !item.repostedBy.includes(user.id)
            ? { ...item, repostedBy: [...item.repostedBy, user.id] }
            : item
        ),
      };
      if (root.authorId === user.id) return withRepost;
      return addNotification(withRepost, {
        userId: root.authorId,
        actorId: user.id,
        type: 'post_repost',
        text: `${user.displayName} reposted your post.`,
      });
    });

    return ok(existingRepost ? 'Repost removed.' : 'Reposted to your wall.');
  };

  const addPostComment = (postId: string, text: string): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot comment.');
    const post = db.posts.find((item) => item.id === postId);
    if (!post) return fail('Post not found.');

    const cleanText = text.trim();
    if (!cleanText) return fail('Comment is empty.');

    const comment: PostComment = {
      id: makeId('post-comment'),
      postId,
      authorId: user.id,
      text: cleanText,
      createdAt: new Date().toISOString(),
    };

    setDb((prev) => ({ ...prev, postComments: [comment, ...prev.postComments] }));

    return ok('Comment added.');
  };

  const createStory = (payload: StoryPayload): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot add stories.');

    const mediaUrl = payload.mediaUrl.trim();
    const caption = payload.caption.trim();
    if (!mediaUrl) return fail('Story media URL is required.');

    const createdAt = new Date().toISOString();
    const story: Story = {
      id: makeId('story'),
      authorId: user.id,
      caption,
      mediaType: payload.mediaType,
      mediaUrl,
      createdAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    setDb((prev) => ({ ...prev, stories: [story, ...prev.stories] }));
    return ok('Story published.');
  };

  const deleteStory = (storyId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const story = db.stories.find((item) => item.id === storyId);
    if (!story) return fail('Story not found.');
    if (story.authorId !== user.id && user.role !== 'admin') {
      return fail('No access to delete this story.');
    }

    setDb((prev) => ({
      ...prev,
      stories: prev.stories.filter((item) => item.id !== storyId),
      storyComments: prev.storyComments.filter((comment) => comment.storyId !== storyId),
    }));
    return ok('Story deleted.');
  };

  const addStoryComment = (storyId: string, text: string): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot reply to stories.');
    const story = db.stories.find((item) => item.id === storyId);
    if (!story) return fail('Story not found.');

    const cleanText = text.trim();
    if (!cleanText) return fail('Comment is empty.');

    const privateReply: Message = {
      id: makeId('msg'),
      fromId: user.id,
      toId: story.authorId,
      text: `Story reply: ${cleanText}`,
      readBy: [user.id],
      createdAt: new Date().toISOString(),
    };

    setDb((prev) => ({
      ...prev,
      messages: [privateReply, ...prev.messages],
    }));

    return ok('Story reply sent to private messages.');
  };

  const followUser = (targetUserId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    if (targetUserId === user.id) return fail('You cannot follow yourself.');

    const target = db.users.find((candidate) => candidate.id === targetUserId);
    if (!target) return fail('User not found.');

    const existing = db.follows.find(
      (relation) => relation.followerId === user.id && relation.followingId === targetUserId
    );

    setDb((prev) => {
      if (existing) {
        return {
          ...prev,
          follows: prev.follows.filter((relation) => relation.id !== existing.id),
        };
      }

      const next = {
        ...prev,
        follows: [
          {
            id: makeId('follow'),
            followerId: user.id,
            followingId: targetUserId,
            createdAt: new Date().toISOString(),
          },
          ...prev.follows,
        ],
      };
      return addNotification(next, {
        userId: targetUserId,
        actorId: user.id,
        type: 'follow',
        text: `${user.displayName} followed you.`,
      });
    });

    return ok(existing ? 'Unfollowed.' : 'Followed user.');
  };

  const sendMessage = (
    toUserId: string,
    payload: { text?: string; mediaType?: 'image' | 'voice'; mediaUrl?: string; expiresAt?: string }
  ): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot send messages.');
    if (toUserId === user.id) return fail('Choose another user.');
    const receiver = db.users.find((candidate) => candidate.id === toUserId);
    if (!receiver) return fail('Recipient not found.');

    const cleanText = (payload.text || '').trim();
    const cleanMediaUrl = (payload.mediaUrl || '').trim();
    if (!cleanText && !cleanMediaUrl) return fail('Message is empty.');
    if (cleanMediaUrl.startsWith('data:') && cleanMediaUrl.length > 2_500_000) {
      return fail('Media file is too large. Please send a smaller file.');
    }

    const message: Message = {
      id: makeId('msg'),
      fromId: user.id,
      toId: toUserId,
      text: cleanText,
      mediaType: cleanMediaUrl ? payload.mediaType : undefined,
      mediaUrl: cleanMediaUrl || undefined,
      expiresAt: payload.mediaType === 'voice' ? payload.expiresAt : undefined,
      readBy: [user.id],
      createdAt: new Date().toISOString(),
    };

    setDb((prev) => ({
      ...prev,
      messages: [message, ...prev.messages],
      session: { ...prev.session, activeChatUserId: toUserId },
    }));

    return ok('Message sent.');
  };

  const editMessage = (messageId: string, text: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const cleanText = text.trim();
    if (!cleanText) return fail('Message is empty.');
    const target = db.messages.find((message) => message.id === messageId);
    if (!target) return fail('Message not found.');
    if (target.fromId !== user.id) return fail('You can only edit your own message.');
    if (target.mediaType && target.mediaType !== 'image') {
      return fail('Only text/image messages can be edited.');
    }

    setDb((prev) => ({
      ...prev,
      messages: prev.messages.map((message) =>
        message.id === messageId
          ? { ...message, text: cleanText, editedAt: new Date().toISOString() }
          : message
      ),
    }));
    return ok('Message edited.');
  };

  const markChatRead = (chatUserId: string) => {
    if (!user) return;
    setDb((prev) => ({
      ...prev,
      messages: prev.messages.map((message) => {
        const isTarget =
          message.toId === user.id && message.fromId === chatUserId && !message.readBy.includes(user.id);
        if (!isTarget) return message;
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
    if (!user) return fail('Please login first.');
    const displayName = patch.displayName.trim();
    if (displayName.length < 2) return fail('Display name is too short.');
    const nowIso = new Date().toISOString();

    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) =>
        candidate.id === user.id
          ? {
              ...candidate,
              displayName,
              bio: patch.bio.trim(),
              status: patch.status.trim(),
              avatar: patch.avatar.trim(),
              coverImage: patch.coverImage.trim(),
              updatedAt: nowIso,
              lastSeenAt: nowIso,
            }
          : candidate
      ),
    }));
    return ok('Profile updated.');
  };

  const createGroup = (payload: GroupPayload): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot create groups.');
    const name = payload.name.trim();
    const description = payload.description.trim();
    if (name.length < 3) return fail('Group name must contain at least 3 characters.');
    if (db.groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      return fail('Group with this name already exists.');
    }

    const groupId = makeId('group');
    const group: Group = {
      id: groupId,
      name,
      description,
      adminId: user.id,
      allowMemberPosts: payload.allowMemberPosts,
      avatar: `https://picsum.photos/seed/${encodeURIComponent(groupId)}-avatar/200/200`,
      coverImage: `https://picsum.photos/seed/${encodeURIComponent(groupId)}-cover/1400/420`,
      verified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const member: GroupMember = {
      id: makeId('group-member'),
      groupId,
      userId: user.id,
      role: 'admin',
      createdAt: new Date().toISOString(),
    };

    setDb((prev) => ({
      ...prev,
      groups: [group, ...prev.groups],
      groupMembers: [member, ...prev.groupMembers],
      session: {
        ...prev.session,
        currentView: 'groups',
        activeGroupId: groupId,
      },
    }));
    return ok('Group created.');
  };

  const updateGroup = (groupId: string, patch: GroupPatch): ActionResult => {
    if (!user) return fail('Please login first.');
    const group = db.groups.find((candidate) => candidate.id === groupId);
    if (!group) return fail('Group not found.');
    if (!canManageGroup(group)) return fail('Only group admin can edit group.');

    const nextName = patch.name.trim();
    const nextDescription = patch.description.trim();
    if (nextName.length < 3) return fail('Group name must contain at least 3 characters.');
    if (
      db.groups.some(
        (candidate) =>
          candidate.id !== groupId && candidate.name.toLowerCase() === nextName.toLowerCase()
      )
    ) {
      return fail('Group with this name already exists.');
    }

    const canSetVerified = user.role === 'admin' || group.adminId === user.id;
    const nowIso = new Date().toISOString();

    setDb((prev) => ({
      ...prev,
      groups: prev.groups.map((candidate) =>
        candidate.id === groupId
          ? {
              ...candidate,
              name: nextName,
              description: nextDescription,
              avatar: patch.avatar.trim(),
              coverImage: patch.coverImage.trim(),
              allowMemberPosts: patch.allowMemberPosts,
              verified: canSetVerified ? patch.verified : candidate.verified,
              updatedAt: nowIso,
            }
          : candidate
      ),
    }));
    return ok('Group updated.');
  };

  const canManageGroup = (group: Group) =>
    Boolean(user && (group.adminId === user.id || user.role === 'admin'));

  const toggleGroupSubscription = (groupId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const group = db.groups.find((candidate) => candidate.id === groupId);
    if (!group) return fail('Group not found.');

    const existing = db.groupMembers.find(
      (member) => member.groupId === groupId && member.userId === user.id
    );
    if (existing?.role === 'admin' && group.adminId === user.id) {
      return fail('Group admin cannot leave own group.');
    }

    setDb((prev) => {
      if (existing) {
        return {
          ...prev,
          groupMembers: prev.groupMembers.filter((member) => member.id !== existing.id),
        };
      }
      const member: GroupMember = {
        id: makeId('group-member'),
        groupId,
        userId: user.id,
        role: 'member',
        createdAt: new Date().toISOString(),
      };
      const withMember = {
        ...prev,
        groupMembers: [member, ...prev.groupMembers],
      };
      return withMember;
    });

    return ok(existing ? 'Unsubscribed from group.' : 'Subscribed to group.');
  };

  const setGroupAllowMemberPosts = (groupId: string, allow: boolean): ActionResult => {
    if (!user) return fail('Please login first.');
    const group = db.groups.find((candidate) => candidate.id === groupId);
    if (!group) return fail('Group not found.');
    if (!canManageGroup(group)) {
      return fail('Only group admin can change this setting.');
    }

    const nowIso = new Date().toISOString();
    setDb((prev) => ({
      ...prev,
      groups: prev.groups.map((candidate) =>
        candidate.id === groupId
          ? { ...candidate, allowMemberPosts: allow, updatedAt: nowIso }
          : candidate
      ),
    }));
    return ok(allow ? 'Members can publish in this group.' : 'Only admin can publish in this group.');
  };

  const createGroupPost = (
    groupId: string,
    text: string,
    mediaType?: MediaType,
    mediaUrl?: string
  ): ActionResult => {
    if (!user) return fail('Please login first.');
    const group = db.groups.find((candidate) => candidate.id === groupId);
    if (!group) return fail('Group not found.');

    const member = db.groupMembers.find(
      (candidate) => candidate.groupId === groupId && candidate.userId === user.id
    );
    if (!member) return fail('Subscribe to the group first.');
    if (member.role !== 'admin' && !group.allowMemberPosts && user.role !== 'admin') {
      return fail('Only group admin can post right now.');
    }

    const cleanText = text.trim();
    const cleanMedia = (mediaUrl || '').trim();
    if (!cleanText && !cleanMedia) return fail('Post text is empty.');

    const post: GroupPost = {
      id: makeId('group-post'),
      groupId,
      authorId: user.id,
      text: cleanText,
      mediaType: cleanMedia ? mediaType ?? 'image' : undefined,
      mediaUrl: cleanMedia || undefined,
      createdAt: new Date().toISOString(),
      likedBy: [],
      repostedBy: [],
    };

    setDb((prev) => ({
      ...prev,
      groupPosts: [post, ...prev.groupPosts],
    }));
    return ok('Group post published.');
  };

  const toggleGroupPostLike = (groupPostId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const target = db.groupPosts.find((post) => post.id === groupPostId);
    if (!target) return fail('Group post not found.');

    const liked = target.likedBy.includes(user.id);
    setDb((prev) => {
      const withLike = {
        ...prev,
        groupPosts: prev.groupPosts.map((post) =>
          post.id === groupPostId
            ? {
                ...post,
                likedBy: liked
                  ? post.likedBy.filter((id) => id !== user.id)
                  : [...post.likedBy, user.id],
              }
            : post
        ),
      };

      if (liked || target.authorId === user.id) return withLike;
      return addNotification(withLike, {
        userId: target.authorId,
        actorId: user.id,
        type: 'group_post_like',
        text: `${user.displayName} liked your group post.`,
      });
    });
    return ok(liked ? 'Like removed.' : 'Group post liked.');
  };

  const repostGroupPost = (groupPostId: string, targetGroupId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    if (user.restricted) return fail('Your account is restricted and cannot repost.');
    const source = db.groupPosts.find((post) => post.id === groupPostId);
    if (!source) return fail('Original post not found.');
    const group = db.groups.find((candidate) => candidate.id === targetGroupId);
    if (!group) return fail('Target group not found.');

    const member = db.groupMembers.find(
      (candidate) => candidate.groupId === targetGroupId && candidate.userId === user.id
    );
    if (!member) return fail('Subscribe to target group first.');
    if (member.role !== 'admin' && !group.allowMemberPosts && user.role !== 'admin') {
      return fail('Only group admin can publish in target group.');
    }

    const rootId = source.repostOfPostId ?? source.id;
    const root = db.groupPosts.find((post) => post.id === rootId);
    if (!root) return fail('Original post not found.');

    const existingRepost = db.groupPosts.find(
      (post) =>
        post.groupId === targetGroupId &&
        post.authorId === user.id &&
        post.repostOfPostId === rootId
    );

    setDb((prev) => {
      if (existingRepost) {
        return {
          ...prev,
          groupPosts: prev.groupPosts
            .filter((post) => post.id !== existingRepost.id)
            .map((post) =>
              post.id === rootId
                ? { ...post, repostedBy: post.repostedBy.filter((id) => id !== user.id) }
                : post
            ),
          groupPostComments: prev.groupPostComments.filter(
            (comment) => comment.groupPostId !== existingRepost.id
          ),
        };
      }

      const repost: GroupPost = {
        id: makeId('group-post'),
        groupId: targetGroupId,
        authorId: user.id,
        text: root.text,
        mediaType: root.mediaType,
        mediaUrl: root.mediaUrl,
        createdAt: new Date().toISOString(),
        likedBy: [],
        repostedBy: [],
        repostOfPostId: rootId,
      };

      return {
        ...prev,
        groupPosts: [repost, ...prev.groupPosts].map((post) =>
          post.id === rootId && !post.repostedBy.includes(user.id)
            ? { ...post, repostedBy: [...post.repostedBy, user.id] }
            : post
        ),
      };
    });

    return ok(existingRepost ? 'Group repost removed.' : 'Group repost published.');
  };

  const publishGroupPostToFeed = (groupPostId: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const source = db.groupPosts.find((post) => post.id === groupPostId);
    if (!source) return fail('Group post not found.');
    const group = db.groups.find((candidate) => candidate.id === source.groupId);
    if (!group) return fail('Group not found.');
    if (!canManageGroup(group)) return fail('Only group admin can publish this post to main wall.');
    const sourceAuthor = db.users.find((candidate) => candidate.id === source.authorId);

    const post: Post = {
      id: makeId('post'),
      authorId: user.id,
      text: `[${group.name}] ${sourceAuthor?.displayName || 'User'}: ${source.text}`.trim(),
      mediaType: source.mediaType,
      mediaUrl: source.mediaUrl,
      createdAt: new Date().toISOString(),
      likedBy: [],
      repostedBy: [],
    };

    setDb((prev) => ({
      ...prev,
      posts: [post, ...prev.posts],
    }));
    return ok('Group post published to main wall.');
  };

  const addGroupPostComment = (groupPostId: string, text: string): ActionResult => {
    if (!user) return fail('Please login first.');
    const post = db.groupPosts.find((candidate) => candidate.id === groupPostId);
    if (!post) return fail('Group post not found.');

    const cleanText = text.trim();
    if (!cleanText) return fail('Comment is empty.');

    const comment: GroupPostComment = {
      id: makeId('group-comment'),
      groupPostId,
      authorId: user.id,
      text: cleanText,
      createdAt: new Date().toISOString(),
    };

    setDb((prev) => ({
      ...prev,
      groupPostComments: [comment, ...prev.groupPostComments],
    }));
    return ok('Comment added to group post.');
  };

  const setUserRole = (userId: string, role: UserRole): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    const target = db.users.find((candidate) => candidate.id === userId);
    if (!target) return fail('User not found.');

    const nowIso = new Date().toISOString();
    setDb((prev) => {
      const next = {
        ...prev,
        users: prev.users.map((candidate) =>
          candidate.id === userId ? { ...candidate, role, updatedAt: nowIso } : candidate
        ),
      };
      return addNotification(next, {
        userId,
        actorId: user?.id,
        type: 'moderation',
        text: `Your role has been changed to ${role}.`,
      });
    });
    return ok('Role updated.');
  };

  const setUserBan = (userId: string, banned: boolean): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    const target = db.users.find((candidate) => candidate.id === userId);
    if (!target) return fail('User not found.');

    const nowIso = new Date().toISOString();
    setDb((prev) => {
      const next: SocialDb = {
        ...prev,
        users: prev.users.map((candidate) =>
          candidate.id === userId
            ? { ...candidate, banned, updatedAt: nowIso }
            : candidate
        ),
        session:
          prev.session.userId === userId && banned
            ? { ...prev.session, userId: null, currentView: 'feed', activeChatUserId: null }
            : prev.session,
      };
      return addNotification(next, {
        userId,
        actorId: user?.id,
        type: 'moderation',
        text: banned ? 'Your account has been banned.' : 'Your account ban was removed.',
      });
    });
    return ok(banned ? 'User banned.' : 'User unbanned.');
  };

  const setUserRestricted = (userId: string, restricted: boolean): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    const target = db.users.find((candidate) => candidate.id === userId);
    if (!target) return fail('User not found.');

    const nowIso = new Date().toISOString();
    setDb((prev) => {
      const next = {
        ...prev,
        users: prev.users.map((candidate) =>
          candidate.id === userId
            ? { ...candidate, restricted, updatedAt: nowIso }
            : candidate
        ),
      };
      return addNotification(next, {
        userId,
        actorId: user?.id,
        type: 'moderation',
        text: restricted
          ? 'Your account has writing restrictions.'
          : 'Your writing restrictions were removed.',
      });
    });
    return ok(restricted ? 'User restricted.' : 'Restriction removed.');
  };

  const setUserVerified = (userId: string, verified: boolean): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    const target = db.users.find((candidate) => candidate.id === userId);
    if (!target) return fail('User not found.');

    const nowIso = new Date().toISOString();
    setDb((prev) => ({
      ...prev,
      users: prev.users.map((candidate) =>
        candidate.id === userId ? { ...candidate, verified, updatedAt: nowIso } : candidate
      ),
    }));
    return ok(verified ? 'Verified badge granted.' : 'Verified badge removed.');
  };

  const clearNetworkData = (): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    setDb((prev) => ({
      ...prev,
      follows: [],
      posts: [],
      postComments: [],
      stories: [],
      storyComments: [],
      messages: [],
      groupPosts: [],
      groupPostComments: [],
      notifications: [],
      session: { ...prev.session, currentView: 'feed', activeChatUserId: null },
    }));
    return ok('Network activity data cleared (users and groups kept).');
  };

  const resetAllData = (): ActionResult => {
    if (!isAdmin(user)) return fail('Admin access required.');
    resetDb();
    setDb(cleanDbState());
    return ok('Database fully reset to clean state.');
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
    isAuthenticated: Boolean(user),
    darkMode: db.theme === 'dark',
    currentView: db.session.currentView,
    activeChatUserId: db.session.activeChatUserId,
    activeGroupId: db.session.activeGroupId,
    register,
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
    createStory,
    deleteStory,
    addStoryComment,
    followUser,
    sendMessage,
    editMessage,
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
    publishGroupPostToFeed,
    addGroupPostComment,
    setUserRole,
    setUserBan,
    setUserRestricted,
    setUserVerified,
    clearNetworkData,
    resetAllData,
  };
}
