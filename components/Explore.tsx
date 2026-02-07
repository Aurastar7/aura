import React, { useMemo } from 'react';
import { Follow, User } from '../types';
import { isUserOnline, userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface ExploreProps {
  currentUser: User;
  users: User[];
  follows: Follow[];
  searchQuery: string;
  onFollowToggle: (userId: string) => void;
  onOpenChat: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
}

const Explore: React.FC<ExploreProps> = ({
  currentUser,
  users,
  follows,
  searchQuery,
  onFollowToggle,
  onOpenChat,
  onOpenProfile,
}) => {
  const followed = useMemo(
    () => new Set(follows.filter((item) => item.followerId === currentUser.id).map((item) => item.followingId)),
    [follows, currentUser.id]
  );

  const filteredUsers = users.filter((candidate) => {
    if (candidate.banned) return false;
    if (!searchQuery.trim()) return true;
    const haystack = `${candidate.displayName} ${candidate.username}`.toLowerCase();
    return haystack.includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="pb-20 lg:pb-0">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold">Explore</h1>
        <p className="text-sm text-slate-500">Open profiles, follow users, or contact directly.</p>
      </header>

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
    </div>
  );
};

export default Explore;
