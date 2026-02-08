import { User } from '../types';

export const userAvatar = (user: Pick<User, 'avatar' | 'displayName' | 'username'>) => {
  const avatar = user.avatar?.trim();
  if (avatar) return avatar;
  const label = encodeURIComponent((user.displayName || user.username || 'U').slice(0, 40));
  return `https://ui-avatars.com/api/?name=${label}&background=e2e8f0&color=0f172a&size=256`;
};

export const userCover = (user: Pick<User, 'coverImage'>) => {
  const cover = user.coverImage?.trim();
  return cover || '';
};

export const formatTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleString();
};

export const containsSearch = (text: string, query: string) => {
  if (!query.trim()) return true;
  return text.toLowerCase().includes(query.trim().toLowerCase());
};

export const isUserOnline = (user: Pick<User, 'lastSeenAt'>) => {
  const lastSeenMs = new Date(user.lastSeenAt).getTime();
  if (Number.isNaN(lastSeenMs)) return false;
  return Date.now() - lastSeenMs <= 2 * 60 * 1000;
};
