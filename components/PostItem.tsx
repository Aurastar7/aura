import React, { useMemo, useRef, useState } from 'react';
import { Group, Post, PostComment, User } from '../types';
import { ICONS } from '../constants';
import { userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface PostItemProps {
  post: Post;
  postsById: Record<string, Post>;
  groupsById: Record<string, Group>;
  author: User;
  currentUser: User;
  comments: PostComment[];
  usersById: Record<string, User>;
  onToggleLike: (postId: string) => void;
  onToggleRepost: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onAddComment: (postId: string, text: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenHashtag: (tag: string) => void;
}

const PostItem: React.FC<PostItemProps> = ({
  post,
  postsById,
  groupsById,
  author,
  currentUser,
  comments,
  usersById,
  onToggleLike,
  onToggleRepost,
  onDeletePost,
  onAddComment,
  onOpenProfile,
  onOpenHashtag,
}) => {
  const [commentText, setCommentText] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [visibleCommentsCount, setVisibleCommentsCount] = useState(5);
  const commentInputRef = useRef<HTMLInputElement | null>(null);

  const rootPost = useMemo(() => {
    if (!post.repostOfPostId) return post;
    return postsById[post.repostOfPostId] || post;
  }, [post, postsById]);

  const rootAuthor = usersById[rootPost.authorId] || author;
  const sourceGroup = post.repostSourceGroupId ? groupsById[post.repostSourceGroupId] : undefined;
  const isLiked = post.likedBy.includes(currentUser.id);
  const isReposted = rootPost.repostedBy.includes(currentUser.id);
  const canDelete = currentUser.role === 'admin' || currentUser.id === post.authorId;

  const submitComment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    onAddComment(post.id, commentText);
    setCommentText('');
    setShowComments(true);
  };

  const startReply = (targetUser: User) => {
    setCommentText(`@${targetUser.username} `);
    setShowComments(true);
    requestAnimationFrame(() => commentInputRef.current?.focus());
  };

  const renderPostText = (text: string) => {
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

  return (
    <article id={`post-${post.id}`} className="px-6 py-6 hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors scroll-mt-24">
      <div className="flex gap-4 items-start">
        <button onClick={() => onOpenProfile(author.id)} className="shrink-0">
          <img src={userAvatar(author)} className="w-12 h-12 rounded-2xl object-cover" alt="" />
        </button>

        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button onClick={() => onOpenProfile(author.id)} className="font-bold hover:underline truncate">
                  {author.displayName}
                </button>
                <RoleBadge user={author} />
              </div>
              <div className="text-slate-500 text-sm font-normal truncate">
                @{author.username} · {new Date(post.createdAt).toLocaleTimeString()}
              </div>
            </div>
            {canDelete ? (
              <button onClick={() => onDeletePost(post.id)} className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700">
                Delete
              </button>
            ) : (
              <button className="text-slate-400 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                <ICONS.More className="w-5 h-5" />
              </button>
            )}
          </div>

          {post.repostOfPostId ? (
            <button
              onClick={() => onOpenProfile(rootAuthor.id)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:underline"
            >
              <ICONS.Repost className="w-4 h-4" />
              Repost from {rootAuthor.displayName} @{rootAuthor.username}
            </button>
          ) : null}

          {post.repostOfGroupPostId && sourceGroup ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 text-xs text-slate-500"
            >
              <img src={sourceGroup.avatar} alt="" className="w-5 h-5 rounded-md object-cover" />
              Repost from group {sourceGroup.name}
            </button>
          ) : null}

          <p className="text-[17px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            {renderPostText(post.text || '')}
          </p>

          {post.mediaUrl ? (
            <div className="rounded-3xl overflow-hidden border-2 border-slate-200 dark:border-slate-800 mt-2 bg-black">
              {post.mediaType === 'video' ? (
                <video src={post.mediaUrl} controls className="w-full h-auto object-cover max-h-[512px]" />
              ) : (
                <img src={post.mediaUrl} className="w-full h-auto object-cover max-h-[512px]" alt="Post content" />
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-2 max-w-md">
            <button
              onClick={() => {
                setShowComments((prev) => !prev);
                setVisibleCommentsCount(5);
              }}
              className="flex items-center gap-2 group/btn text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <div className="p-2 rounded-xl group-hover/btn:bg-slate-100 dark:group-hover/btn:bg-slate-800">
                <ICONS.Comment className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium">{comments.length}</span>
            </button>

            <button
              onClick={() => onToggleRepost(rootPost.id)}
              className={`flex items-center gap-2 group/btn transition-colors ${
                isReposted ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'
              }`}
            >
              <div
                className={`p-2 rounded-xl ${
                  isReposted
                    ? 'bg-emerald-50 dark:bg-slate-800'
                    : 'group-hover/btn:bg-emerald-50 dark:group-hover/btn:bg-slate-800'
                }`}
              >
                <ICONS.Repost className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium">{rootPost.repostedBy.length}</span>
            </button>

            <button
              onClick={() => onToggleLike(post.id)}
              className={`flex items-center gap-2 group/btn transition-colors ${
                isLiked ? 'text-rose-600' : 'text-slate-500 hover:text-rose-600'
              }`}
            >
              <div
                className={`p-2 rounded-xl ${
                  isLiked
                    ? 'bg-rose-50 dark:bg-slate-800'
                    : 'group-hover/btn:bg-rose-50 dark:group-hover/btn:bg-slate-800'
                }`}
              >
                <ICONS.Like className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
              </div>
              <span className="text-sm font-medium">{post.likedBy.length}</span>
            </button>
          </div>

          <form onSubmit={submitComment} className="flex gap-2">
            <input
              ref={commentInputRef}
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder="Write a comment"
              className="flex-1 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-xl px-4 py-2 text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-black">
              Send
            </button>
          </form>

          {showComments ? (
            <div className="space-y-2">
              {comments.length ? (
                comments.slice(0, visibleCommentsCount).map((comment) => {
                  const cUser = usersById[comment.authorId];
                  if (!cUser) return null;
                  return (
                    <div id={`post-comment-${comment.id}`} key={comment.id} className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-800 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 scroll-mt-24">
                      <div className="flex items-start gap-2">
                        <button onClick={() => onOpenProfile(cUser.id)} className="shrink-0">
                          <img src={userAvatar(cUser)} alt="" className="w-8 h-8 rounded-lg object-cover" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <button onClick={() => onOpenProfile(cUser.id)} className="text-left">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold">{cUser.displayName}</p>
                              <RoleBadge user={cUser} />
                            </div>
                          </button>
                          <p className="text-xs text-slate-500">@{cUser.username}</p>
                          <p className="mt-1 text-sm whitespace-pre-wrap break-words">{renderPostText(comment.text)}</p>
                          <button
                            type="button"
                            onClick={() => startReply(cUser)}
                            className="mt-2 rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium"
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500">No comments yet.</p>
              )}
              {comments.length > visibleCommentsCount ? (
                <button
                  type="button"
                  onClick={() => setVisibleCommentsCount((prev) => prev + 5)}
                  className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold"
                >
                  Show 5 more comments
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
};

export default PostItem;
