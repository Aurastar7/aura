import React, { useMemo } from 'react';
import { Follow, Group, Post, User } from '../types';
import { isUserOnline, userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface RightPanelProps {
  user: User;
  users: User[];
  groups: Group[];
  posts: Post[];
  follows: Follow[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onFollowToggle: (userId: string) => void;
  onOpenMessages: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenGroup: (groupId: string) => void;
}

const RightPanel: React.FC<RightPanelProps> = ({
  user,
  users,
  groups,
  posts,
  follows,
  searchQuery,
  onSearchChange,
  onFollowToggle,
  onOpenMessages,
  onOpenProfile,
  onOpenGroup,
}) => {
  const followed = useMemo(
    () => new Set(follows.filter((item) => item.followerId === user.id).map((item) => item.followingId)),
    [follows, user.id]
  );

  const hashtags = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((post) => {
      const tags = post.text.match(/#[a-zA-Z0-9_]+/g) ?? [];
      tags.forEach((tag) => map.set(tag.toLowerCase(), (map.get(tag.toLowerCase()) ?? 0) + 1));
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [posts]);

  const suggestions = users
    .filter((candidate) => !candidate.banned)
    .slice(0, 3)
    .map((candidate) => ({
      ...candidate,
      isFollowed: followed.has(candidate.id),
    }));

  const resultUsers = users
    .filter((candidate) => {
      if (!searchQuery.trim()) return false;
      const source = `${candidate.displayName} ${candidate.username}`.toLowerCase();
      return source.includes(searchQuery.toLowerCase());
    })
    .slice(0, 4);

  const resultPosts = posts
    .filter((post) => searchQuery.trim() && post.text.toLowerCase().includes(searchQuery.toLowerCase()))
    .slice(0, 3);

  const resultGroups = groups
    .filter((group) => searchQuery.trim() && group.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .slice(0, 3);

  const usersOnline = [user, ...users].filter((candidate) => isUserOnline(candidate)).length;

  return (
    <div className="space-y-6">
      <div className="relative group">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          type="text"
          placeholder="Search Resonance..."
          className="w-full bg-slate-100 dark:bg-slate-900 border-none rounded-2xl py-3 pl-12 pr-4 focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all dark:text-white"
        />
      </div>

      {searchQuery.trim() ? (
        <div className="bg-white dark:bg-black border-2 border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
            <h2 className="font-bold text-lg dark:text-white">Search results</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
            {resultUsers.map((candidate) => (
              <button key={candidate.id} onClick={() => onOpenProfile(candidate.id)} className="w-full px-6 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center gap-3">
                <div className="relative">
                  <img src={userAvatar(candidate)} className="w-9 h-9 rounded-xl object-cover" alt="" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                      isUserOnline(candidate) ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                </div>
                <div>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {candidate.displayName}
                    <RoleBadge user={candidate} />
                  </p>
                  <p className="text-xs text-slate-500">@{candidate.username}</p>
                </div>
              </button>
            ))}
            {resultGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => onOpenGroup(group.id)}
                className="w-full px-6 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center gap-3"
              >
                <img src={group.avatar} alt="" className="w-9 h-9 rounded-xl object-cover" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{group.name}</p>
                  <p className="text-xs text-slate-500 truncate">Group</p>
                </div>
              </button>
            ))}
            {resultPosts.map((post) => (
              <div key={post.id} className="px-6 py-3">
                <p className="text-xs text-slate-500">Post</p>
                <p className="text-sm line-clamp-2">{post.text || '(media post)'}</p>
              </div>
            ))}
            {resultUsers.length === 0 && resultPosts.length === 0 && resultGroups.length === 0 ? (
              <p className="px-6 py-4 text-sm text-slate-500">Nothing found.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="bg-white dark:bg-black border-2 border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <h2 className="font-bold text-lg dark:text-white">Trending Vibes</h2>
          <span className="text-slate-900 dark:text-white text-sm font-semibold">Refresh</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {hashtags.length > 0 ? (
            hashtags.map(([tag, count]) => (
              <div key={tag} className="px-6 py-4">
                <p className="text-slate-500 text-xs font-medium">Trending</p>
                <p className="font-bold text-slate-900 dark:text-white">{tag}</p>
                <p className="text-slate-400 text-xs">{count} resonances</p>
              </div>
            ))
          ) : (
            <p className="px-6 py-4 text-sm text-slate-500">No hashtags yet.</p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-black border-2 border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
          <h2 className="font-bold text-lg dark:text-white">Who to Echo</h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {suggestions.map((candidate) => (
            <div key={candidate.id} className="px-6 py-4 flex items-center justify-between">
              <button onClick={() => onOpenProfile(candidate.id)} className="flex gap-3 text-left">
                <div className="relative">
                  <img src={userAvatar(candidate)} className="w-10 h-10 rounded-xl object-cover" alt="" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                      isUserOnline(candidate) ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                    <span className="truncate">{candidate.displayName}</span>
                    <RoleBadge user={candidate} />
                  </p>
                  <p className="text-sm text-slate-400 truncate">@{candidate.username}</p>
                </div>
              </button>
              <div className="flex gap-2">
                <button onClick={() => onOpenMessages(candidate.id)} className="border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold">Chat</button>
                <button
                  onClick={() => onFollowToggle(candidate.id)}
                  className={`px-4 py-1.5 rounded-xl font-bold text-sm ${
                    candidate.isFollowed
                      ? 'border-2 border-slate-300 dark:border-slate-700'
                      : 'bg-slate-900 dark:bg-white dark:text-black text-white'
                  }`}
                >
                  {candidate.isFollowed ? 'Following' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-2">
        <a href="#" className="hover:underline">Terms</a>
        <a href="#" className="hover:underline">Privacy</a>
        <a href="#" className="hover:underline">Cookies</a>
        <span>Users {[user, ...users].length}</span>
        <span>Users online {usersOnline}</span>
      </div>
    </div>
  );
};

export default RightPanel;
