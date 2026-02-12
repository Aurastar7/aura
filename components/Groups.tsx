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
  onRepostToProfile: (groupPostId: string) => void;
  onEditPost: (groupPostId: string, text: string) => void;
  onDeletePost: (groupPostId: string) => void;
  onAddComment: (groupPostId: string, text: string) => void;
  onEditComment: (commentId: string, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenHashtag: (tag: string) => void;
  onCopyLink: (link: string) => void;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

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
  onRepostToProfile,
  onEditPost,
  onDeletePost,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onOpenProfile,
  onOpenHashtag,
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
  const [activeCommentMenuId, setActiveCommentMenuId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [collapsedReplies, setCollapsedReplies] = useState<Record<string, boolean>>({});
  const [editingGroup, setEditingGroup] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostText, setEditingPostText] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [visiblePostsCount, setVisiblePostsCount] = useState(10);
  const [visibleCommentsByPost, setVisibleCommentsByPost] = useState<Record<string, number>>({});
  const [expandedCommentsByPost, setExpandedCommentsByPost] = useState<Record<string, boolean>>({});
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
  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => group.name.toLowerCase().includes(query));
  }, [groupSearch, groups]);

  useEffect(() => {
    if (!currentGroup) {
      setGroupEdit(null);
      setEditingGroup(false);
      setShowAllMembers(false);
      setVisibleCommentsByPost({});
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

  useEffect(() => {
    setVisiblePostsCount(10);
    setVisibleCommentsByPost({});
    setExpandedCommentsByPost({});
    setCollapsedReplies({});
    setActiveCommentMenuId(null);
    setEditingCommentId(null);
    setEditingCommentText('');
  }, [currentGroup?.id]);

  useEffect(() => {
    const expand = () => setVisiblePostsCount((prev) => Math.max(prev, currentGroupPosts.length));
    window.addEventListener('aura:expand-posts', expand);
    return () => window.removeEventListener('aura:expand-posts', expand);
  }, [currentGroupPosts.length]);

  const myMembership = currentGroupMembers.find((member) => member.userId === currentUser.id);
  const isGroupAdmin = Boolean(
    currentGroup && (currentGroup.adminId === currentUser.id || currentUser.role === 'admin')
  );
  const canPost = Boolean(
    currentGroup &&
      myMembership &&
      (isGroupAdmin || myMembership.role === 'admin' || currentGroup.allowMemberPosts)
  );
  const visibleMembers = currentGroupMembers.slice(0, 3);
  const hiddenMembersCount = Math.max(0, currentGroupMembers.length - visibleMembers.length);

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

  const pickGroupAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setGroupEdit((prev) => (prev ? { ...prev, avatar: dataUrl } : prev));
    event.target.value = '';
  };

  const pickGroupCoverFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setGroupEdit((prev) => (prev ? { ...prev, coverImage: dataUrl } : prev));
    event.target.value = '';
  };

  const pickGroupPostMediaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setNewPostMediaType(file.type.startsWith('video/') ? 'video' : 'image');
    setNewPostMediaUrl(dataUrl);
    setShowMediaControls(true);
    event.target.value = '';
  };

  const usernameToUserId = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(usersById).forEach((candidate) => {
      map[candidate.username.toLowerCase()] = candidate.id;
    });
    return map;
  }, [usersById]);

  const renderWithTags = (text: string) => {
    const parts = text.split(/(#[a-zA-Z0-9_]+)/g);
    return parts.map((part, index) => {
      if (/^#[a-zA-Z0-9_]+$/.test(part)) {
        return (
          <button
            key={`${part}-${index}`}
            type="button"
            onClick={() => onOpenHashtag(part.toLowerCase())}
            className="text-sky-600 dark:text-sky-400 hover:underline"
          >
            {part}
          </button>
        );
      }
      return <span key={`text-${index}`}>{part}</span>;
    });
  };

  const buildThreads = (commentList: GroupPostComment[]) => {
    const ordered = [...commentList].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const parentByComment = new Map<string, string>();
    const repliesMap = new Map<string, GroupPostComment[]>();
    const latestByUser = new Map<string, string>();

    ordered.forEach((comment) => {
      const mention = comment.text.match(/^@([a-zA-Z0-9_]+)/);
      const mentionedUsername = mention?.[1]?.toLowerCase();
      const targetUserId = mentionedUsername ? usernameToUserId[mentionedUsername] : undefined;
      const parentId = targetUserId ? latestByUser.get(targetUserId) : undefined;
      if (parentId) {
        parentByComment.set(comment.id, parentId);
      }
      latestByUser.set(comment.authorId, comment.id);
    });

    const topLevel: GroupPostComment[] = [];
    ordered.forEach((comment) => {
      const parentId = parentByComment.get(comment.id);
      if (parentId) {
        const list = repliesMap.get(parentId) ?? [];
        list.push(comment);
        repliesMap.set(parentId, list);
      } else {
        topLevel.push(comment);
      }
    });

    return { topLevel, repliesMap };
  };

  const toggleCommentMenu = (commentId: string) => {
    setActiveCommentMenuId((prev) => (prev === commentId ? null : commentId));
  };

  useEffect(() => {
    if (!editingCommentId) return;
    if (!groupPostComments.some((comment) => comment.id === editingCommentId)) {
      setEditingCommentId(null);
      setEditingCommentText('');
    }
  }, [editingCommentId, groupPostComments]);

  if (!currentGroup) {
    return (
      <div className="pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-6">
        <header className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
          <h1 className="text-2xl font-bold">Groups</h1>
          <p className="text-sm text-slate-500">Open a group card to view full page.</p>
          <input
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
            placeholder="Search groups by name"
            className="mt-3 w-full max-w-md rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
          />
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
              {filteredGroups.length > 0 ? (
                filteredGroups.map((group) => {
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
                <div className="px-4 py-16 text-center text-slate-500">No groups found.</div>
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
            <label className="inline-block rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs cursor-pointer">
              Upload avatar
              <input type="file" accept="image/*" className="hidden" onChange={pickGroupAvatarFile} />
            </label>
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
            <label className="inline-block rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs cursor-pointer">
              Upload cover
              <input type="file" accept="image/*" className="hidden" onChange={pickGroupCoverFile} />
            </label>
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
              {currentUser.role === 'admin' ? (
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
              ) : null}
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
          {visibleMembers.map((member) => {
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
          {hiddenMembersCount > 0 ? (
            <button
              onClick={() => setShowAllMembers(true)}
              className="flex items-center gap-2 rounded-xl border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs font-semibold"
            >
              +{hiddenMembersCount}
            </button>
          ) : null}
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
            <div className="grid md:grid-cols-[120px_1fr_auto] gap-2 mt-2">
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
              <label className="rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm cursor-pointer inline-flex items-center justify-center">
                Upload file
                <input type="file" accept="image/*,video/*" className="hidden" onChange={pickGroupPostMediaFile} />
              </label>
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
            currentGroupPosts.slice(0, visiblePostsCount).map((post) => {
              const author = usersById[post.authorId];
              const rootPost = post.repostOfPostId
                ? groupPostsById[post.repostOfPostId] || post
                : post;
              const rootAuthor = usersById[rootPost.authorId] || author;
              if (!author) return null;
              const comments = commentsByPost.get(post.id) ?? [];
              const { topLevel, repliesMap } = buildThreads(comments);
              const liked = post.likedBy.includes(currentUser.id);
              const reposted = rootPost.repostedBy.includes(currentUser.id);
              const canManagePost = isGroupAdmin || post.authorId === currentUser.id;
              const isEditingPost = editingPostId === post.id;
              const visibleTopLevel = topLevel.slice(
                0,
                Math.min(visibleCommentsByPost[post.id] ?? 3, 10)
              );

              const renderComment = (comment: GroupPostComment, depth = 0): React.ReactNode => {
                const commentUser = usersById[comment.authorId];
                if (!commentUser) return null;
                const replies = repliesMap.get(comment.id) ?? [];
                const isCollapsed = collapsedReplies[comment.id];
                const canManageComment =
                  currentUser.role === 'admin' ||
                  comment.authorId === currentUser.id ||
                  isGroupAdmin;
                const isEditingComment = editingCommentId === comment.id;

                return (
                  <div
                    key={comment.id}
                    id={`group-comment-${comment.id}`}
                    className={`w-full max-w-full overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 px-3 py-2 scroll-mt-24 ${
                      depth > 0 ? 'ml-2 sm:ml-4 border-l-4 pl-3 sm:pl-4' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button onClick={() => onOpenProfile(commentUser.id)} className="shrink-0">
                        <img src={userAvatar(commentUser)} alt="" className="w-8 h-8 rounded-lg object-cover" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => onOpenProfile(commentUser.id)} className="text-left min-w-0">
                            <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                              <span className="truncate">{commentUser.displayName}</span>
                              <RoleBadge user={commentUser} />
                            </p>
                          </button>
                          {canManageComment ? (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => toggleCommentMenu(comment.id)}
                                className="text-slate-400 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <ICONS.More className="w-4 h-4" />
                              </button>
                              {activeCommentMenuId === comment.id ? (
                                <div className="absolute right-0 mt-1 w-24 rounded-lg border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black shadow-sm z-10">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId(comment.id);
                                      setEditingCommentText(comment.text);
                                      setActiveCommentMenuId(null);
                                    }}
                                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-900"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onDeleteComment(comment.id);
                                      setActiveCommentMenuId(null);
                                    }}
                                    className="block w-full px-3 py-1.5 text-left text-xs text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-900"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">@{commentUser.username}</p>
                        {isEditingComment ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              value={editingCommentText}
                              onChange={(event) => setEditingCommentText(event.target.value)}
                              className="w-full rounded-lg border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-2 py-1.5 text-sm min-h-[60px]"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  onEditComment(comment.id, editingCommentText);
                                  setEditingCommentId(null);
                                  setEditingCommentText('');
                                }}
                                className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs font-medium"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditingCommentText('');
                                }}
                                className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs font-medium"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap break-words mt-0.5">
                            {renderWithTags(comment.text)}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCommentDrafts((prev) => ({
                                ...prev,
                                [post.id]: `@${commentUser.username} `,
                              }))
                            }
                            className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium"
                          >
                            Reply
                          </button>
                          {replies.length > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedReplies((prev) => ({
                                  ...prev,
                                  [comment.id]: !prev[comment.id],
                                }))
                              }
                              className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium"
                            >
                              {isCollapsed ? `Show replies (${replies.length})` : 'Hide replies'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {!isCollapsed && replies.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {replies.map((reply) => renderComment(reply, depth + 1))}
                      </div>
                    ) : null}
                  </div>
                );
              };

              return (
                <article key={post.id} id={`group-post-${post.id}`} className="px-4 md:px-6 py-4 scroll-mt-24">
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
                    {canManagePost ? (
                      <div className="ml-2 flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditingPostId(post.id);
                            setEditingPostText(post.text);
                          }}
                          className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDeletePost(post.id)}
                          className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
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

                  {isEditingPost ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editingPostText}
                        onChange={(event) => setEditingPostText(event.target.value)}
                        className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm min-h-20"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onEditPost(post.id, editingPostText);
                            setEditingPostId(null);
                            setEditingPostText('');
                          }}
                          className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingPostId(null);
                            setEditingPostText('');
                          }}
                          className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm whitespace-pre-wrap break-words">{renderWithTags(post.text)}</p>
                  )}

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
                      onClick={() => onRepostToProfile(post.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold border ${
                        reposted
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      Repost {rootPost.repostedBy.length}
                    </button>
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

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCommentsByPost((prev) => ({
                          ...prev,
                          [post.id]: !prev[post.id],
                        }))
                      }
                      className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold"
                    >
                      {expandedCommentsByPost[post.id]
                        ? `Hide comments (${topLevel.length})`
                        : `Show comments (${topLevel.length})`}
                    </button>

                    {expandedCommentsByPost[post.id] ? (
                      <div className="mt-2 max-h-80 overflow-y-auto pr-1 rounded-xl border border-slate-200 dark:border-slate-800 p-2 space-y-1.5">
                        {topLevel.length > 0 ? (
                          <>
                            {visibleTopLevel.map((comment) => renderComment(comment))}
                            {Math.min(topLevel.length, 10) > (visibleCommentsByPost[post.id] ?? 3) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setVisibleCommentsByPost((prev) => ({
                                    ...prev,
                                    [post.id]: Math.min((prev[post.id] ?? 3) + 3, 10),
                                  }))
                                }
                                className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold"
                              >
                                Show more comments
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-xs text-slate-500 px-1 py-1">No comments yet.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="px-4 py-16 text-sm text-slate-500 text-center">
              No posts in this community yet.
            </div>
          )}
          {currentGroupPosts.length > visiblePostsCount ? (
            <div className="px-4 md:px-6 py-4">
              <button
                onClick={() => setVisiblePostsCount((prev) => prev + 10)}
                className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-semibold"
              >
                Show more posts
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {showAllMembers ? (
        <div className="fixed inset-0 z-[75] bg-black/50 p-4 flex items-center justify-center">
          <div className="w-full max-w-lg rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <p className="font-semibold">Group members ({currentGroupMembers.length})</p>
              <button
                onClick={() => setShowAllMembers(false)}
                className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
              {currentGroupMembers.map((member) => {
                const memberUser = usersById[member.userId];
                if (!memberUser) return null;
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      onOpenProfile(memberUser.id);
                      setShowAllMembers(false);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center gap-3"
                  >
                    <img src={userAvatar(memberUser)} alt="" className="w-9 h-9 rounded-xl object-cover" />
                    <div className="min-w-0">
                      <p className="font-semibold truncate flex items-center gap-1.5">
                        <span className="truncate">{memberUser.displayName}</span>
                        <RoleBadge user={memberUser} />
                      </p>
                      <p className="text-xs text-slate-500 truncate">@{memberUser.username}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Groups;
