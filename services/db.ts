import { SocialDb } from '../types';
import { API_URL, apiUrl } from './api';

const DB_KEY = 'aura-social-db-v5';

const socketUrl = (() => {
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

export const cleanDbState = (): SocialDb => ({
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
  theme: 'dark',
  session: {
    userId: null,
    currentView: 'feed',
    activeChatUserId: null,
    activeGroupId: null,
  },
});

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

export const loadDb = (): SocialDb => {
  if (!storage) return cleanDbState();
  try {
    const raw = storage.getItem(DB_KEY);
    if (!raw) return cleanDbState();
    const parsed = JSON.parse(raw) as Partial<SocialDb>;
    return {
      ...cleanDbState(),
      ...parsed,
      session: {
        ...cleanDbState().session,
        ...(parsed.session || {}),
      },
      theme: parsed.theme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return cleanDbState();
  }
};

export const persistDb = (state: SocialDb) => {
  if (!storage) return;
  try {
    storage.setItem(DB_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
};

export const resetDb = () => {
  storage?.removeItem(DB_KEY);
};

export const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const syncFingerprint = (state: SocialDb): string => JSON.stringify(state);

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
  type: string;
  revision?: number;
  updatedAt?: string | null;
  [key: string]: unknown;
};

export const loadRemoteDb = async (signal?: AbortSignal): Promise<RemoteLoadResult> => {
  try {
    const response = await fetch(apiUrl('/api/health'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      return { ok: false, exists: false, state: null, revision: 0 };
    }
    return { ok: false, exists: false, state: null, revision: 0 };
  } catch {
    return { ok: false, exists: false, state: null, revision: 0 };
  }
};

export const persistRemoteDb = async (
  _state: SocialDb,
  _revision: number,
  _signal?: AbortSignal
): Promise<RemotePersistResult> => ({
  ok: false,
  conflict: false,
  revision: 0,
  state: null,
});

export const connectSyncSocket = (onEvent: (event: SyncEvent) => void) => {
  if (typeof window === 'undefined') return () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(socketUrl);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as SyncEvent;
        onEvent(payload);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    ws?.close();
  };
};
