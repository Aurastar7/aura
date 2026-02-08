import React, { useMemo } from 'react';
import { Follow, Group, Post, User } from '../types';
import { isUserOnline, userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface ExploreProps {
  currentUser: User;
  users: User[];
  groups: Group[];
  posts: Post[];
  follows: Follow[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onFollowToggle: (userId: string) => void;
  onOpenChat: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenGroup: (groupId: string) => void;
  onOpenHashtag: (tag: string) => void;
  onOpenPost: (postId: string) => void;
}

const Explore: React.FC<ExploreProps> = ({
  currentUser,
  users,
  groups,
  posts,
  follows,
  searchQuery,
  onSearchChange,
  onFollowToggle,
  onOpenChat,
  onOpenProfile,
  onOpenGroup,
  onOpenHashtag,
  onOpenPost,
}) => {
  const followed = useMemo(
    () => new Set(follows.filter((item) => item.followerId === currentUser.id).map((item) => item.followingId)),
    [follows, currentUser.id]
  );

  const query = searchQuery.trim().toLowerCase();

  const filteredUsers = users.filter((candidate) => {
    if (candidate.banned) return false;
    if (!query) return true;
    const haystack = `${candidate.displayName} ${candidate.username}`.toLowerCase();
    return haystack.includes(query);
  });

  const filteredGroups = useMemo(() => {
    if (!query) return groups.slice(0, 5);
    return groups.filter((group) => group.name.toLowerCase().includes(query)).slice(0, 8);
  }, [groups, query]);

  const filteredPosts = useMemo(() => {
    if (!query) return [];
    return posts
      .filter((post) => post.text.toLowerCase().includes(query))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);
  }, [posts, query]);

  const hashtagResults = useMemo(() => {
    if (!query) return [];
    const clean = query.replace(/^#/, '');
    const map = new Set<string>();
    posts.forEach((post) => {
      const tags = post.text.match(/#[a-zA-Z0-9_]+/g) ?? [];
      tags.forEach((tag) => {
        if (tag.toLowerCase().includes(clean)) {
          map.add(tag.toLowerCase());
        }
      });
    });
    return [...map].slice(0, 8);
  }, [posts, query]);

  return (
    <div className="pb-20 lg:pb-0">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold">Explore</h1>
        <p className="text-sm text-slate-500">Open profiles, follow users, or contact directly.</p>
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search users, groups, posts, hashtags..."
          className="mt-3 w-full max-w-xl rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
        />
      </header>

      {query ? (
        <div className="space-y-4 p-4">
          <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 font-semibold">Users</div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredUsers.slice(0, 8).map((candidate) => {
                const isFollowing = followed.has(candidate.id);
                return (
                  <div key={candidate.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <button onClick={() => onOpenProfile(candidate.id)} className="flex items-center gap-3 min-w-0 text-left">
                      <div className="relative">
                        <img src={userAvatar(candidate)} alt={candidate.username} className="w-10 h-10 rounded-xl object-cover" />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                            isUserOnline(candidate) ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold truncate flex items-center gap-1.5">
                          <span className="truncate">{candidate.displayName}</span>
                          <RoleBadge user={candidate} />
                        </p>
                        <p className="text-sm text-slate-500 truncate">@{candidate.username}</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenChat(candidate.id)}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-700"
                      >
                        Message
                      </button>
                      <button
                        onClick={() => onFollowToggle(candidate.id)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                          isFollowing
                            ? 'border border-slate-300 dark:border-slate-700'
                            : 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        }`}
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredUsers.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No users found.</div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 font-semibold">Groups</div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => onOpenGroup(group.id)}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center gap-3"
                >
                  <img src={group.avatar} alt="" className="w-10 h-10 rounded-xl object-cover" />
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{group.name}</p>
                    <p className="text-xs text-slate-500 truncate">Group</p>
                  </div>
                </button>
              ))}
              {filteredGroups.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No groups found.</div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 font-semibold">Hashtags</div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {hashtagResults.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onOpenHashtag(tag)}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 font-semibold"
                >
                  {tag}
                </button>
              ))}
              {hashtagResults.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No hashtags found.</div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 font-semibold">Posts</div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredPosts.map((post) => (
                <button key={post.id} onClick={() => onOpenPost(post.id)} className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900">
                  <p className="text-sm line-clamp-2">{post.text || '(media post)'}</p>
                </button>
              ))}
              {filteredPosts.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No posts found.</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : (
        <section className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredUsers.length > 0 ? (
            filteredUsers.map((candidate) => {
            const isFollowing = followed.has(candidate.id);
            return (
              <div key={candidate.id} className="px-6 py-4 flex items-center justify-between gap-3">
                <button onClick={() => onOpenProfile(candidate.id)} className="flex items-center gap-3 min-w-0 text-left">
                  <div className="relative">
                    <img src={userAvatar(candidate)} alt={candidate.username} className="w-12 h-12 rounded-2xl object-cover" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                        isUserOnline(candidate) ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate flex items-center gap-1.5">
                      <span className="truncate">{candidate.displayName}</span>
                      <RoleBadge user={candidate} />
                    </p>
                    <p className="text-sm text-slate-500 truncate">@{candidate.username}</p>
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenChat(candidate.id)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-700"
                  >
                    Message
                  </button>
                  <button
                    onClick={() => onFollowToggle(candidate.id)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                      isFollowing
                        ? 'border border-slate-300 dark:border-slate-700'
                        : 'bg-slate-900 text-white dark:bg-white dark:text-black'
                    }`}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                </div>
              </div>
            );
            })
          ) : (
            <div className="px-6 py-16 text-center text-slate-500">No users found for current search.</div>
          )}
        </section>
      )}
    </div>
  );
};

export default Explore;
