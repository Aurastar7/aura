import React, { useEffect, useMemo, useState } from 'react';
import { Follow, Group, Post, PostComment, ProfilePatch, Story, User } from '../types';
import PostItem from './PostItem';
import { isUserOnline, userAvatar, userCover } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface ProfileProps {
  viewer: User;
  profileUser: User;
  posts: Post[];
  postComments: PostComment[];
  stories: Story[];
  follows: Follow[];
  usersById: Record<string, User>;
  groupsById: Record<string, Group>;
  isFollowing: boolean;
  onSave: (patch: ProfilePatch) => void;
  onToggleFollow: (userId: string) => void;
  onMessage: (userId: string) => void;
  onTogglePostLike: (postId: string) => void;
  onTogglePostRepost: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onAddPostComment: (postId: string, text: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenHashtag: (tag: string) => void;
  onCopyProfileLink: (link: string) => void;
  onBack: () => void;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const Profile: React.FC<ProfileProps> = ({
  viewer,
  profileUser,
  posts,
  postComments,
  stories,
  follows,
  usersById,
  groupsById,
  isFollowing,
  onSave,
  onToggleFollow,
  onMessage,
  onTogglePostLike,
  onTogglePostRepost,
  onDeletePost,
  onAddPostComment,
  onOpenProfile,
  onOpenHashtag,
  onCopyProfileLink,
  onBack,
}) => {
  const isOwn = viewer.id === profileUser.id;
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'echoes' | 'replies' | 'media' | 'likes' | 'friends'>('echoes');
  const [visibleCount, setVisibleCount] = useState(10);

  const [displayName, setDisplayName] = useState(profileUser.displayName);
  const [bio, setBio] = useState(profileUser.bio);
  const [status, setStatus] = useState(profileUser.status || '');
  const [avatar, setAvatar] = useState(profileUser.avatar);
  const [coverImage, setCoverImage] = useState(profileUser.coverImage);
  const [hiddenFromFriends, setHiddenFromFriends] = useState(profileUser.hiddenFromFriends);

  useEffect(() => {
    if (editing) return;
    setDisplayName(profileUser.displayName);
    setBio(profileUser.bio);
    setStatus(profileUser.status || '');
    setAvatar(profileUser.avatar);
    setCoverImage(profileUser.coverImage);
    setHiddenFromFriends(profileUser.hiddenFromFriends);
  }, [
    editing,
    profileUser.displayName,
    profileUser.bio,
    profileUser.status,
    profileUser.avatar,
    profileUser.coverImage,
    profileUser.hiddenFromFriends,
  ]);

  useEffect(() => {
    setEditing(false);
  }, [profileUser.id]);

  const pickAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setAvatar(dataUrl);
    event.target.value = '';
  };

  const pickCoverFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setCoverImage(dataUrl);
    event.target.value = '';
  };

  const userPosts = useMemo(() => posts.filter((post) => post.authorId === profileUser.id), [posts, profileUser.id]);
  const userStoriesCount = useMemo(() => stories.filter((story) => story.authorId === profileUser.id).length, [stories, profileUser.id]);
  const followers = follows.filter((item) => item.followingId === profileUser.id).length;
  const following = follows.filter((item) => item.followerId === profileUser.id).length;
  const friendIds = useMemo(() => {
    const ids = new Set<string>();
    follows.forEach((item) => {
      if (item.followerId === profileUser.id) ids.add(item.followingId);
      if (item.followingId === profileUser.id) ids.add(item.followerId);
    });
    ids.delete(profileUser.id);
    return [...ids];
  }, [follows, profileUser.id]);
  const friends = useMemo(
    () =>
      friendIds
        .map((id) => usersById[id])
        .filter((item): item is User => Boolean(item))
        .filter((item) => !item.hiddenFromFriends || item.id === viewer.id || isOwn),
    [friendIds, isOwn, usersById, viewer.id]
  );

  const commentsMap = useMemo(() => {
    const map = new Map<string, PostComment[]>();
    postComments.forEach((comment) => {
      const list = map.get(comment.postId) ?? [];
      list.push(comment);
      map.set(comment.postId, list);
    });
    return map;
  }, [postComments]);

  const repliedPostIds = useMemo(() => {
    const ids = new Set<string>();
    postComments.forEach((comment) => {
      if (comment.authorId === profileUser.id) ids.add(comment.postId);
    });
    return ids;
  }, [postComments, profileUser.id]);

  const filteredPosts = useMemo(() => {
    if (activeTab === 'media') return userPosts.filter((post) => Boolean(post.mediaUrl));
    if (activeTab === 'likes') return posts.filter((post) => post.likedBy.includes(profileUser.id));
    if (activeTab === 'replies') return posts.filter((post) => repliedPostIds.has(post.id));
    if (activeTab === 'friends') return [];
    return userPosts;
  }, [activeTab, posts, profileUser.id, repliedPostIds, userPosts]);

  useEffect(() => {
    setVisibleCount(10);
  }, [activeTab, profileUser.id]);

  useEffect(() => {
    const expand = () => setVisibleCount((prev) => Math.max(prev, filteredPosts.length));
    window.addEventListener('aura:expand-posts', expand);
    return () => window.removeEventListener('aura:expand-posts', expand);
  }, [filteredPosts.length]);

  const postsById = useMemo(
    () => Object.fromEntries(posts.map((post) => [post.id, post])),
    [posts]
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({ displayName, bio, status, avatar, coverImage, hiddenFromFriends });
    setEditing(false);
  };

  return (
    <div className="flex flex-col pb-20">
      <div className="sticky top-0 z-20 px-4 md:px-6 py-3 flex items-center gap-4 md:gap-6 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-black">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold dark:text-white leading-tight flex items-center gap-1.5">
            <span className="truncate">{profileUser.displayName}</span>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isUserOnline(profileUser) ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
              title={isUserOnline(profileUser) ? 'online' : 'offline'}
            />
            <RoleBadge user={profileUser} />
          </h1>
          <p className="text-sm text-slate-500 font-medium">{userPosts.length} Echoes</p>
        </div>
      </div>

      <div className="h-48 md:h-64 bg-slate-200 dark:bg-slate-800 relative">
        {userCover(profileUser) ? (
          <img src={userCover(profileUser)} className="w-full h-full object-cover" alt="Cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-sm text-slate-500">No cover image yet</div>
        )}
      </div>

      <div className="px-4 md:px-6 relative mb-6">
        <div className="flex items-end gap-2 sm:gap-3 -mt-10 md:-mt-16 mb-4">
          <div className="p-1 bg-white dark:bg-black rounded-[26px] md:rounded-[32px] relative shrink-0">
            <img src={userAvatar(profileUser)} className="w-20 h-20 md:w-32 md:h-32 rounded-[22px] md:rounded-[28px] object-cover border-4 border-white dark:border-black" alt="Avatar" />
            <span
              className={`absolute bottom-2 right-2 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                isUserOnline(profileUser) ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
              title={isUserOnline(profileUser) ? 'online' : 'offline'}
            />
          </div>

          <div className="ml-auto min-w-0 flex-1 flex flex-wrap justify-end gap-1.5 sm:gap-2">
            {isOwn ? (
              <button onClick={() => setEditing((prev) => !prev)} className="border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-sm sm:text-base font-bold text-slate-900 dark:text-white transition-colors leading-tight">
                {editing ? 'Cancel' : 'Edit Profile'}
              </button>
            ) : (
              <>
                <button onClick={() => onMessage(profileUser.id)} className="border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-sm sm:text-base font-bold text-slate-900 dark:text-white transition-colors leading-tight">
                  Message
                </button>
                <button onClick={() => onToggleFollow(profileUser.id)} className={`px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-sm sm:text-base font-bold transition-colors leading-tight ${isFollowing ? 'border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-white' : 'bg-slate-900 dark:bg-white dark:text-black text-white hover:bg-slate-800 dark:hover:bg-slate-200'}`}>
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
              </>
            )}
            <button
              onClick={() => onCopyProfileLink(`${window.location.origin}/#/u/${encodeURIComponent(profileUser.id)}`)}
              className="border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-sm sm:text-base font-bold text-slate-900 dark:text-white transition-colors leading-tight"
            >
              Copy link
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-black dark:text-white tracking-tight flex items-center gap-1.5">
              {profileUser.displayName}
              <RoleBadge user={profileUser} className="mt-0.5" />
            </h2>
            <p className="text-slate-500">@{profileUser.username}</p>
            {profileUser.status ? (
              <p className="inline-block mt-2 rounded-full px-3 py-1 text-xs font-semibold bg-slate-900 text-white dark:bg-white dark:text-black">{profileUser.status}</p>
            ) : null}
          </div>

          <p className="text-[17px] text-slate-700 dark:text-slate-300 leading-relaxed max-w-lg">{profileUser.bio || 'No bio yet.'}</p>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1.5"><b className="text-slate-900 dark:text-white">{followers}</b> Followers</span>
            <span className="flex items-center gap-1.5"><b className="text-slate-900 dark:text-white">{following}</b> Following</span>
            <span className="flex items-center gap-1.5"><b className="text-slate-900 dark:text-white">{friends.length}</b> Friends</span>
            <span className="flex items-center gap-1.5"><b className="text-slate-900 dark:text-white">{userStoriesCount}</b> Stories</span>
          </div>
        </div>

        {isOwn && editing ? (
          <form onSubmit={submit} className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50 dark:bg-black">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Bio</span>
              <textarea value={bio} onChange={(event) => setBio(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm min-h-[80px]" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Status (shown above profile icon)</span>
              <input value={status} onChange={(event) => setStatus(event.target.value)} placeholder="online / busy / coding" className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm" />
            </label>
            <div className="block">
              <span className="text-xs font-semibold text-slate-500">Avatar URL (GIF supported)</span>
              <input value={avatar} onChange={(event) => setAvatar(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm" />
              <label className="mt-2 inline-block rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs cursor-pointer">
                Upload avatar from device
                <input type="file" accept="image/*" className="hidden" onChange={pickAvatarFile} />
              </label>
            </div>
            <div className="block">
              <span className="text-xs font-semibold text-slate-500">Cover URL</span>
              <input value={coverImage} onChange={(event) => setCoverImage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm" />
              <label className="mt-2 inline-block rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs cursor-pointer">
                Upload cover from device
                <input type="file" accept="image/*" className="hidden" onChange={pickCoverFile} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hiddenFromFriends}
                onChange={(event) => setHiddenFromFriends(event.target.checked)}
              />
              Hide my account in other users' Friends lists
            </label>
            <button type="submit" className="bg-slate-900 dark:bg-white dark:text-black text-white px-6 py-2 rounded-2xl font-bold">Save</button>
          </form>
        ) : null}
      </div>

      <div className="px-2 md:px-6 pb-2">
        <div className="flex overflow-x-auto rounded-2xl border-2 border-slate-200 dark:border-slate-800">
        {[
          { id: 'echoes', label: 'Echoes' },
          { id: 'replies', label: 'Replies' },
          { id: 'media', label: 'Media' },
          { id: 'likes', label: 'Likes' },
          { id: 'friends', label: 'Friends' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() =>
              setActiveTab(tab.id as 'echoes' | 'replies' | 'media' | 'likes' | 'friends')
            }
            className={`flex-1 py-3 sm:py-4 text-xs sm:text-sm font-bold transition-colors border-b-2 whitespace-nowrap min-w-[72px] sm:min-w-[90px] ${
              activeTab === tab.id
                ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {activeTab === 'friends' ? (
        <div className="px-6 py-4 grid sm:grid-cols-2 gap-3">
          {friends.length > 0 ? (
            friends.map((friend) => (
              <div key={friend.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3">
                <button onClick={() => onOpenProfile(friend.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  <img src={userAvatar(friend)} alt="" className="w-11 h-11 rounded-xl object-cover" />
                  <div className="min-w-0">
                    <p className="font-semibold truncate flex items-center gap-1.5">
                      <span className="truncate">{friend.displayName}</span>
                      <RoleBadge user={friend} />
                    </p>
                    <p className="text-sm text-slate-500 truncate">@{friend.username}</p>
                  </div>
                </button>
                <div className="flex gap-2">
                  <button onClick={() => onOpenProfile(friend.id)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs">Open</button>
                  {friend.id !== viewer.id ? (
                    <button onClick={() => onMessage(friend.id)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs">Message</button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="py-16 text-center text-slate-400 col-span-full">No friends yet.</div>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredPosts.slice(0, visibleCount).map((post) => (
            <PostItem
              key={post.id}
              post={post}
              postsById={postsById}
              groupsById={groupsById}
              author={usersById[post.authorId] || profileUser}
              currentUser={viewer}
              comments={commentsMap.get(post.id) ?? []}
              usersById={usersById}
              onToggleLike={onTogglePostLike}
              onToggleRepost={onTogglePostRepost}
              onDeletePost={onDeletePost}
              onAddComment={onAddPostComment}
              onOpenProfile={onOpenProfile}
              onOpenHashtag={onOpenHashtag}
            />
          ))}

          {filteredPosts.length === 0 ? (
            <div className="py-20 text-center text-slate-400">
              {activeTab === 'media' && 'No media posts yet.'}
              {activeTab === 'likes' && 'No liked posts yet.'}
              {activeTab === 'replies' && 'No replies yet.'}
              {activeTab === 'echoes' && 'No echoes yet. Start the conversation!'}
            </div>
          ) : null}
          {filteredPosts.length > visibleCount ? (
            <div className="px-6 py-5">
              <button
                onClick={() => setVisibleCount((prev) => prev + 10)}
                className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-semibold"
              >
                Show more posts
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default Profile;
