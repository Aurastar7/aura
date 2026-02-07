import React, { useEffect, useMemo, useState } from 'react';
import {
  Group,
  GroupMember,
  GroupPatch,
  GroupPayload,
  GroupPost,
  GroupPostComment,
  MediaType,
  User,
} from '../types';
import { ICONS } from '../constants';
import { userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface GroupsProps {
  currentUser: User;
  usersById: Record<string, User>;
  groups: Group[];
  groupMembers: GroupMember[];
  groupPosts: GroupPost[];
  groupPostComments: GroupPostComment[];
  activeGroupId: string | null;
  onSetActiveGroup: (groupId: string | null) => void;
  onCreateGroup: (payload: GroupPayload) => void;
  onUpdateGroup: (groupId: string, patch: GroupPatch) => void;
  onToggleSubscription: (groupId: string) => void;
  onCreatePost: (groupId: string, text: string, mediaType?: MediaType, mediaUrl?: string) => void;
  onTogglePostLike: (groupPostId: string) => void;
  onRepost: (groupPostId: string, targetGroupId: string) => void;
  onPublishToFeed: (groupPostId: string) => void;
  onAddComment: (groupPostId: string, text: string) => void;
  onOpenProfile: (userId: string) => void;
  onCopyLink: (link: string) => void;
}

const Groups: React.FC<GroupsProps> = ({
  currentUser,
  usersById,
  groups,
  groupMembers,
  groupPosts,
  groupPostComments,
  activeGroupId,
  onSetActiveGroup,
  onCreateGroup,
  onUpdateGroup,
  onToggleSubscription,
  onCreatePost,
  onTogglePostLike,
  onRepost,
  onPublishToFeed,
  onAddComment,
  onOpenProfile,
  onCopyLink,
}) => {
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [allowMemberPosts, setAllowMemberPosts] = useState(true);

  const [newPostText, setNewPostText] = useState('');
  const [newPostMediaType, setNewPostMediaType] = useState<MediaType>('image');
  const [newPostMediaUrl, setNewPostMediaUrl] = useState('');
  const [showMediaControls, setShowMediaControls] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupEdit, setGroupEdit] = useState<GroupPatch | null>(null);

  const membersByGroup = useMemo(() => {
    const map = new Map<string, GroupMember[]>();
    groupMembers.forEach((member) => {
      const list = map.get(member.groupId) ?? [];
      list.push(member);
      map.set(member.groupId, list);
    });
    return map;
  }, [groupMembers]);

  const commentsByPost = useMemo(() => {
    const map = new Map<string, GroupPostComment[]>();
    groupPostComments.forEach((comment) => {
      const list = map.get(comment.groupPostId) ?? [];
      list.push(comment);
      map.set(comment.groupPostId, list);
    });
    return map;
  }, [groupPostComments]);

  const currentGroup = useMemo(
    () => (activeGroupId ? groups.find((group) => group.id === activeGroupId) ?? null : null),
    [activeGroupId, groups]
  );

  const groupPostsById = useMemo(
    () => Object.fromEntries(groupPosts.map((post) => [post.id, post])),
    [groupPosts]
  );

  const currentGroupMembers = currentGroup
    ? (membersByGroup.get(currentGroup.id) ?? []).sort((a, b) => {
        if (a.role === b.role) return 0;
        return a.role === 'admin' ? -1 : 1;
      })
    : [];

  const currentGroupPosts = currentGroup
    ? groupPosts.filter((post) => post.groupId === currentGroup.id)
    : [];

  useEffect(() => {
    if (!currentGroup) {
      setGroupEdit(null);
      setEditingGroup(false);
      return;
    }
    setGroupEdit({
      name: currentGroup.name,
      description: currentGroup.description,
      avatar: currentGroup.avatar,
      coverImage: currentGroup.coverImage,
      verified: currentGroup.verified,
      allowMemberPosts: currentGroup.allowMemberPosts,
    });
  }, [currentGroup]);

  const myMembership = currentGroupMembers.find((member) => member.userId === currentUser.id);
  const isGroupAdmin = Boolean(
    currentGroup && (currentGroup.adminId === currentUser.id || currentUser.role === 'admin')
  );
  const canPost = Boolean(
    currentGroup &&
      myMembership &&
      (isGroupAdmin || myMembership.role === 'admin' || currentGroup.allowMemberPosts)
  );

  const submitCreateGroup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    onCreateGroup({
      name: groupName,
      description: groupDescription,
      allowMemberPosts,
    });
    setGroupName('');
    setGroupDescription('');
    setAllowMemberPosts(true);
  };

  const submitGroupPost = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentGroup || (!newPostText.trim() && !newPostMediaUrl.trim())) return;
    onCreatePost(currentGroup.id, newPostText, newPostMediaType, newPostMediaUrl);
    setNewPostText('');
    setNewPostMediaUrl('');
    setShowMediaControls(false);
  };

  if (!currentGroup) {
    return (
      <div className="pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-6">
        <header className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
          <h1 className="text-2xl font-bold">Groups</h1>
          <p className="text-sm text-slate-500">Open a group card to view full page.</p>
        </header>

        <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-4 p-4">
          <form
            onSubmit={submitCreateGroup}
            className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 p-4 space-y-3 h-fit"
          >
            <p className="font-semibold">Create community</p>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Group name"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
            />
            <textarea
              value={groupDescription}
              onChange={(event) => setGroupDescription(event.target.value)}
              placeholder="Description"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm min-h-20"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowMemberPosts}
                onChange={(event) => setAllowMemberPosts(event.target.checked)}
              />
              Allow members to publish
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white py-2 font-semibold"
            >
              Create group
            </button>
          </form>

          <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 font-semibold">Communities</div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {groups.length > 0 ? (
                groups.map((group) => {
                  const membersCount = membersByGroup.get(group.id)?.length ?? 0;
                  const subscribed = groupMembers.some(
                    (member) => member.groupId === group.id && member.userId === currentUser.id
                  );
                  return (
                    <button
                      key={group.id}
                      onClick={() => onSetActiveGroup(group.id)}
                      className="w-full px-4 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                    >
                      <div className="flex items-center gap-3">
                        <img src={group.avatar} className="w-12 h-12 rounded-xl object-cover" alt="" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate flex items-center gap-1.5">
                            <span className="truncate">{group.name}</span>
                            {group.verified ? (
                              <span className="text-sky-500" title="Подтвержденная группа">
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                  <path d="M10 1.5 12.4 4l3.4-.3 1.1 3.2 3 1.7-1.7 3 1.7 3-3 1.7-1.1 3.2-3.4-.3L10 18.5 7.6 16l-3.4.3-1.1-3.2-3-1.7 1.7-3-1.7-3 3-1.7L4.2 3.7 7.6 4 10 1.5Zm3.2 6.7-3.9 3.9-2.5-2.4-1.1 1.1 3.6 3.6 5-5-1.1-1.2Z" />
                                </svg>
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500 truncate">{membersCount} subscribers</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-2">{group.description || 'No description'}</p>
                      <span className="inline-block mt-2 text-[11px] rounded-full px-2 py-0.5 border-2 border-slate-300 dark:border-slate-700">
                        {subscribed ? 'Subscribed' : 'Open'}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-16 text-center text-slate-500">No groups yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-6">
      <header className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSetActiveGroup(null)}
            className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-sm"
          >
            Back
          </button>
          <h1 className="text-2xl font-bold">Group page</h1>
        </div>
        <button
          onClick={() =>
            onCopyLink(`${window.location.origin}/#/g/${encodeURIComponent(currentGroup.id)}`)
          }
          className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold"
        >
          Copy link
        </button>
      </header>

      <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden m-4">
        <div className="h-44 md:h-64 bg-slate-200 dark:bg-slate-900">
          <img src={currentGroup.coverImage} className="w-full h-full object-cover" alt="" />
        </div>

        <div className="px-4 md:px-6 -mt-10 md:-mt-12">
          <div className="flex items-end justify-between gap-3">
            <img src={currentGroup.avatar} className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover border-4 border-white dark:border-black" alt="" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggleSubscription(currentGroup.id)}
                className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold"
              >
                {myMembership ? 'Unsubscribe' : 'Subscribe'}
              </button>
              {isGroupAdmin ? (
                <button
                  onClick={() => setEditingGroup((prev) => !prev)}
                  className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold"
                >
                  {editingGroup ? 'Close edit' : 'Edit group'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-3">
            <h2 className="text-2xl font-black flex items-center gap-1.5">
              {currentGroup.name}
              {currentGroup.verified ? (
                <span className="text-sky-500" title="Подтвержденная группа">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M10 1.5 12.4 4l3.4-.3 1.1 3.2 3 1.7-1.7 3 1.7 3-3 1.7-1.1 3.2-3.4-.3L10 18.5 7.6 16l-3.4.3-1.1-3.2-3-1.7 1.7-3-1.7-3 3-1.7L4.2 3.7 7.6 4 10 1.5Zm3.2 6.7-3.9 3.9-2.5-2.4-1.1 1.1 3.6 3.6 5-5-1.1-1.2Z" />
                  </svg>
                </span>
              ) : null}
            </h2>
            <p className="text-sm text-slate-500">{currentGroup.description || 'No description yet.'}</p>
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
            <span>
              <b className="text-slate-900 dark:text-white">{currentGroupMembers.length}</b> Subscribers
            </span>
            <span>
              <b className="text-slate-900 dark:text-white">{currentGroupPosts.length}</b> Posts
            </span>
            <span>
              Admin:{' '}
              <b className="text-slate-900 dark:text-white">
                {usersById[currentGroup.adminId]?.displayName || 'Unknown'}
              </b>
            </span>
          </div>
        </div>

        {editingGroup && isGroupAdmin ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!groupEdit) return;
              onUpdateGroup(currentGroup.id, groupEdit);
            }}
            className="mx-4 md:mx-6 mt-4 rounded-2xl border-2 border-slate-200 dark:border-slate-800 p-3 space-y-2"
          >
            {!groupEdit ? null : (
              <>
            <input
              value={groupEdit.name}
              placeholder="Group name"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-black"
              onChange={(event) =>
                setGroupEdit((prev) => (prev ? { ...prev, name: event.target.value } : prev))
              }
            />
            <textarea
              value={groupEdit.description}
              placeholder="Description"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-black min-h-20"
              onChange={(event) =>
                setGroupEdit((prev) =>
                  prev ? { ...prev, description: event.target.value } : prev
                )
              }
            />
            <input
              value={groupEdit.avatar}
              placeholder="Avatar URL"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-black"
              onChange={(event) =>
                setGroupEdit((prev) => (prev ? { ...prev, avatar: event.target.value } : prev))
              }
            />
            <input
              value={groupEdit.coverImage}
              placeholder="Cover URL"
              className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-black"
              onChange={(event) =>
                setGroupEdit((prev) =>
                  prev ? { ...prev, coverImage: event.target.value } : prev
                )
              }
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setGroupEdit((prev) =>
                    prev ? { ...prev, allowMemberPosts: !prev.allowMemberPosts } : prev
                  )
                }
                className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold"
              >
                {groupEdit.allowMemberPosts ? 'Only admin posts' : 'Allow member posts'}
              </button>
              <button
                type="button"
                onClick={() =>
                  setGroupEdit((prev) =>
                    prev ? { ...prev, verified: !prev.verified } : prev
                  )
                }
                className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold"
              >
                {groupEdit.verified ? 'Remove verified' : 'Set verified'}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white px-3 py-1.5 text-xs font-semibold"
              >
                Save changes
              </button>
            </div>
              </>
            )}
          </form>
        ) : null}

        <div className="px-4 md:px-6 py-3 border-t-2 border-b-2 border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 mt-4">
          {currentGroupMembers.map((member) => {
            const memberUser = usersById[member.userId];
            if (!memberUser) return null;
            return (
              <button
                key={member.id}
                onClick={() => onOpenProfile(member.userId)}
                className="flex items-center gap-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 px-2 py-1"
              >
                <img src={userAvatar(memberUser)} alt="" className="w-6 h-6 rounded-full object-cover" />
                <span className="text-xs">{memberUser.displayName}</span>
                <RoleBadge user={memberUser} />
              </button>
            );
          })}
        </div>

        <form onSubmit={submitGroupPost} className="px-4 md:px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
          <textarea
            value={newPostText}
            onChange={(event) => setNewPostText(event.target.value)}
            placeholder={canPost ? 'Write to community wall...' : 'You cannot publish in this group now.'}
            disabled={!canPost}
            className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm min-h-20 disabled:opacity-50"
          />

          {showMediaControls ? (
            <div className="grid md:grid-cols-[120px_1fr] gap-2 mt-2">
              <select
                value={newPostMediaType}
                onChange={(event) => setNewPostMediaType(event.target.value as MediaType)}
                className="rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              >
                <option value="image">Photo</option>
                <option value="video">Video</option>
              </select>
              <input
                value={newPostMediaUrl}
                onChange={(event) => setNewPostMediaUrl(event.target.value)}
                placeholder="Media URL"
                className="rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowMediaControls((prev) => !prev)}
              className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
            >
              {showMediaControls ? 'Hide media' : 'Add photo/video'}
            </button>
            <button
              type="submit"
              disabled={!canPost || (!newPostText.trim() && !newPostMediaUrl.trim())}
              className="rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Publish
            </button>
          </div>
        </form>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {currentGroupPosts.length > 0 ? (
            currentGroupPosts.map((post) => {
              const author = usersById[post.authorId];
              const rootPost = post.repostOfPostId
                ? groupPostsById[post.repostOfPostId] || post
                : post;
              const rootAuthor = usersById[rootPost.authorId] || author;
              if (!author) return null;
              const comments = commentsByPost.get(post.id) ?? [];
              const liked = post.likedBy.includes(currentUser.id);
              const reposted = rootPost.repostedBy.includes(currentUser.id);

              return (
                <article key={post.id} className="px-4 md:px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => onOpenProfile(author.id)} className="flex items-center gap-2 min-w-0 text-left">
                      <img src={userAvatar(author)} alt="" className="w-10 h-10 rounded-xl object-cover" />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                          <span className="truncate">{author.displayName}</span>
                          <RoleBadge user={author} />
                        </p>
                        <p className="text-xs text-slate-500 truncate">@{author.username}</p>
                      </div>
                    </button>
                    <span className="text-xs text-slate-500 ml-auto">
                      {new Date(post.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {post.repostOfPostId ? (
                    <button
                      onClick={() => onOpenProfile(rootAuthor?.id || author.id)}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:underline"
                    >
                      <ICONS.Repost className="w-4 h-4" />
                      Repost from {rootAuthor?.displayName || 'Unknown'}
                    </button>
                  ) : null}

                  <p className="mt-2 text-sm whitespace-pre-wrap break-words">{post.text}</p>

                  {post.mediaUrl ? (
                    <div className="mt-2 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-800 bg-black">
                      {post.mediaType === 'video' ? (
                        <video src={post.mediaUrl} controls className="w-full max-h-[420px]" />
                      ) : (
                        <img src={post.mediaUrl} alt="" className="w-full max-h-[420px] object-cover" />
                      )}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => onTogglePostLike(post.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold border ${
                        liked
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      Like {post.likedBy.length}
                    </button>
                    <button
                      onClick={() => onRepost(post.id, currentGroup.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold border ${
                        reposted
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      Repost {rootPost.repostedBy.length}
                    </button>
                    {isGroupAdmin ? (
                      <button
                        onClick={() => onPublishToFeed(post.id)}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-700"
                      >
                        Publish to feed
                      </button>
                    ) : null}
                  </div>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = (commentDrafts[post.id] || '').trim();
                      if (!value) return;
                      onAddComment(post.id, value);
                      setCommentDrafts((prev) => ({ ...prev, [post.id]: '' }));
                    }}
                    className="mt-3 flex gap-2"
                  >
                    <input
                      value={commentDrafts[post.id] || ''}
                      onChange={(event) =>
                        setCommentDrafts((prev) => ({ ...prev, [post.id]: event.target.value }))
                      }
                      placeholder="Write a comment"
                      className="flex-1 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white px-3 py-2 text-sm font-semibold"
                    >
                      Send
                    </button>
                  </form>

                  {comments.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {comments.slice(0, 4).map((comment) => {
                        const commentUser = usersById[comment.authorId];
                        return (
                          <div
                            key={comment.id}
                            className="rounded-xl bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 px-3 py-2"
                          >
                            <p className="text-xs font-semibold">{commentUser?.displayName || 'User'}</p>
                            <p className="text-sm">{comment.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="px-4 py-16 text-sm text-slate-500 text-center">
              No posts in this community yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Groups;
