import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ICONS } from '../constants';
import { Group, MediaType, Post, PostComment, Story, User } from '../types';
import PostItem from './PostItem';
import StoryBar from './StoryBar';
import { userAvatar } from '../utils/ui';

interface FeedProps {
  user: User;
  posts: Post[];
  postComments: PostComment[];
  stories: Story[];
  usersById: Record<string, User>;
  groupsById: Record<string, Group>;
  isRestricted: boolean;
  searchQuery: string;
  activeHashtag: string | null;
  composeSignal: number;
  onCreatePost: (text: string, mediaType?: MediaType, mediaUrl?: string) => void;
  onTogglePostLike: (postId: string) => void;
  onTogglePostRepost: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onAddPostComment: (postId: string, text: string) => void;
  onEditPostComment: (commentId: string, text: string) => void;
  onDeletePostComment: (commentId: string) => void;
  onCreateStory: (caption: string, mediaType: MediaType, mediaUrl: string) => void;
  onDeleteStory: (storyId: string) => void;
  onAddStoryComment: (storyId: string, text: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenHashtag: (tag: string) => void;
  onOpenGroup: (groupId: string) => void;
  onClearHashtag: () => void;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const QUICK_EMOJIS = ['😀', '😂', '😍', '😎', '🔥', '🎉', '❤️', '👍', '🙏', '👀', '💯', '✨'];

const Feed: React.FC<FeedProps> = ({
  user,
  posts,
  postComments,
  stories,
  usersById,
  groupsById,
  isRestricted,
  searchQuery,
  activeHashtag,
  composeSignal,
  onCreatePost,
  onTogglePostLike,
  onTogglePostRepost,
  onDeletePost,
  onAddPostComment,
  onEditPostComment,
  onDeletePostComment,
  onCreateStory,
  onDeleteStory,
  onAddStoryComment,
  onOpenProfile,
  onOpenHashtag,
  onOpenGroup,
  onClearHashtag,
}) => {
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostMediaType, setNewPostMediaType] = useState<MediaType>('image');
  const [newPostMediaUrl, setNewPostMediaUrl] = useState('');
  const [showMediaControls, setShowMediaControls] = useState(false);
  const [feedTab, setFeedTab] = useState<'relevant' | 'recent'>('recent');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const [storyCaption, setStoryCaption] = useState('');
  const [storyMediaType, setStoryMediaType] = useState<MediaType>('image');
  const [storyMediaUrl, setStoryMediaUrl] = useState('');
  const [showStoryForm, setShowStoryForm] = useState(false);

  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [storyReply, setStoryReply] = useState('');

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const postCommentsByPostId = useMemo(() => {
    const map = new Map<string, PostComment[]>();
    postComments.forEach((comment) => {
      const list = map.get(comment.postId) ?? [];
      list.push(comment);
      map.set(comment.postId, list);
    });
    return map;
  }, [postComments]);

  const postsById = useMemo(
    () => Object.fromEntries(posts.map((post) => [post.id, post])),
    [posts]
  );

  useEffect(() => {
    if (!composeSignal) return;
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [composeSignal]);

  const filteredPosts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const hashtagFilter = activeHashtag?.toLowerCase().trim() || '';
    const searched = posts.filter((post) => {
      if (post.repostOfPostId) return false;
      if (hashtagFilter) {
        const tags = post.text.match(/#[a-zA-Z0-9_]+/g) ?? [];
        if (!tags.map((item) => item.toLowerCase()).includes(hashtagFilter)) return false;
      }
      if (!query) return true;
      const author = usersById[post.authorId];
      const authorText = author ? `${author.displayName} ${author.username}`.toLowerCase() : '';
      return (
        post.text.toLowerCase().includes(query) ||
        (post.mediaUrl || '').toLowerCase().includes(query) ||
        authorText.includes(query)
      );
    });

    return [...searched].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [activeHashtag, posts, searchQuery, usersById]);

  useEffect(() => {
    setVisibleCount(10);
  }, [searchQuery, activeHashtag, feedTab]);

  useEffect(() => {
    const expand = () => setVisibleCount((prev) => Math.max(prev, filteredPosts.length));
    window.addEventListener('aura:expand-posts', expand);
    return () => window.removeEventListener('aura:expand-posts', expand);
  }, [filteredPosts.length]);

  const visiblePosts = filteredPosts.slice(0, visibleCount);

  const handleSubmitPost = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newPostContent.trim() && !newPostMediaUrl.trim()) return;
    onCreatePost(newPostContent, newPostMediaType, newPostMediaUrl);
    setNewPostContent('');
    setNewPostMediaUrl('');
    setShowMediaControls(false);
  };

  const handleSubmitStory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!storyMediaUrl.trim()) return;
    onCreateStory(storyCaption, storyMediaType, storyMediaUrl);
    setStoryCaption('');
    setStoryMediaUrl('');
    setShowStoryForm(false);
  };

  const activeStory = activeStoryIndex === null ? null : stories[activeStoryIndex] ?? null;

  useEffect(() => {
    if (!activeStory || activeStory.mediaType === 'video') return;
    const timer = window.setTimeout(() => {
      setActiveStoryIndex((index) => {
        if (index === null) return null;
        return index + 1 < stories.length ? index + 1 : null;
      });
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [activeStory?.id, activeStory?.mediaType, stories.length]);

  const submitStoryReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeStory || !storyReply.trim()) return;
    onAddStoryComment(activeStory.id, storyReply);
    setStoryReply('');
  };

  const appendEmoji = (emoji: string) => {
    const textarea = composerRef.current;
    if (!textarea) {
      setNewPostContent((prev) => `${prev}${emoji}`);
      return;
    }
    const start = textarea.selectionStart ?? newPostContent.length;
    const end = textarea.selectionEnd ?? newPostContent.length;
    const nextValue = `${newPostContent.slice(0, start)}${emoji}${newPostContent.slice(end)}`;
    setNewPostContent(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + emoji.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const pickPostMediaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setNewPostMediaType(file.type.startsWith('video/') ? 'video' : 'image');
    setNewPostMediaUrl(dataUrl);
    setShowMediaControls(true);
    event.target.value = '';
  };

  const pickStoryMediaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setStoryMediaType(file.type.startsWith('video/') ? 'video' : 'image');
    setStoryMediaUrl(dataUrl);
    setShowStoryForm(true);
    event.target.value = '';
  };

  return (
    <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
      <div className="sticky top-14 lg:top-0 z-10 glass px-6 py-4 flex items-center justify-between border-b-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
        <h1 className="text-xl font-bold dark:text-white">Feed</h1>
        <div className="flex items-center gap-4 text-sm font-medium">
          <button
            onClick={() => setFeedTab('relevant')}
            className={`pb-1 border-b-2 ${feedTab === 'relevant' ? 'text-slate-900 dark:text-white border-slate-900 dark:border-white' : 'text-slate-400 border-transparent'}`}
          >
            Relevant
          </button>
          <button
            onClick={() => setFeedTab('recent')}
            className={`pb-1 border-b-2 ${feedTab === 'recent' ? 'text-slate-900 dark:text-white border-slate-900 dark:border-white' : 'text-slate-400 border-transparent'}`}
          >
            Recent
          </button>
        </div>
      </div>

      {activeHashtag ? (
        <div className="px-6 py-3 border-b-2 border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Hashtag: <span className="text-slate-900 dark:text-white">{activeHashtag}</span>
          </p>
          <button
            onClick={onClearHashtag}
            className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs font-semibold"
          >
            Clear
          </button>
        </div>
      ) : null}

      <StoryBar
        stories={stories}
        usersById={usersById}
        currentUserId={user.id}
        onCreateStory={() => setShowStoryForm((prev) => !prev)}
        onOpenStory={(storyId) => {
          const index = stories.findIndex((story) => story.id === storyId);
          setActiveStoryIndex(index >= 0 ? index : null);
        }}
      />

      {showStoryForm ? (
        <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
          <form onSubmit={handleSubmitStory} className="grid md:grid-cols-[1fr_140px_1fr_auto_auto] gap-2">
            <input
              value={storyCaption}
              onChange={(event) => setStoryCaption(event.target.value)}
              placeholder="Story caption"
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
            />
            <select
              value={storyMediaType}
              onChange={(event) => setStoryMediaType(event.target.value as MediaType)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
            >
              <option value="image">Photo</option>
              <option value="video">Video</option>
            </select>
            <input
              value={storyMediaUrl}
              onChange={(event) => setStoryMediaUrl(event.target.value)}
              placeholder="Story media URL"
              required
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
            />
            <label className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm cursor-pointer inline-flex items-center justify-center">
              Upload file
              <input type="file" accept="image/*,video/*" className="hidden" onChange={pickStoryMediaFile} />
            </label>
            <button
              type="submit"
              disabled={isRestricted}
              className="rounded-xl px-4 py-2 text-sm font-semibold bg-slate-900 dark:bg-white dark:text-black text-white disabled:opacity-50"
            >
              Add story
            </button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Replies to stories are sent privately to messages.</p>
        </div>
      ) : null}

      <div className="px-6 py-4 flex gap-4">
        <button onClick={() => onOpenProfile(user.id)} className="relative flex-shrink-0">
          {user.status ? (
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 max-w-[100px] truncate rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-[10px] px-2 py-0.5">
              {user.status}
            </span>
          ) : null}
          <img src={userAvatar(user)} className="w-12 h-12 rounded-2xl object-cover" alt="" />
        </button>

        <form onSubmit={handleSubmitPost} className="flex-1">
          <textarea
            ref={composerRef}
            value={newPostContent}
            onChange={(event) => setNewPostContent(event.target.value)}
            placeholder="Share your resonance..."
            className="w-full bg-transparent border-none focus:ring-0 text-lg resize-none placeholder:text-slate-400 dark:text-white h-20 outline-none"
          />

          {showMediaControls ? (
            <div className="grid md:grid-cols-[120px_1fr_auto] gap-2 mt-2">
              <select
                value={newPostMediaType}
                onChange={(event) => setNewPostMediaType(event.target.value as MediaType)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              >
                <option value="image">Photo</option>
                <option value="video">Video</option>
              </select>
              <input
                value={newPostMediaUrl}
                onChange={(event) => setNewPostMediaUrl(event.target.value)}
                placeholder="Optional media URL"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              />
              <label className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm cursor-pointer inline-flex items-center justify-center">
                Upload file
                <input type="file" accept="image/*,video/*" className="hidden" onChange={pickPostMediaFile} />
              </label>
            </div>
          ) : null}

          <div className="flex items-center justify-between mt-2">
            <div className="relative flex gap-2 text-slate-700 dark:text-slate-100">
              <button
                type="button"
                onClick={() => setShowMediaControls((prev) => !prev)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
              <button
                type="button"
                onClick={() => setShowEmojiPicker((prev) => !prev)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>
              {showEmojiPicker ? (
                <div className="absolute top-11 left-0 z-20 w-56 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-black p-2 grid grid-cols-6 gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        appendEmoji(emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="rounded-lg px-1 py-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isRestricted || (!newPostContent.trim() && !newPostMediaUrl.trim())}
              className="bg-slate-900 dark:bg-white dark:text-black disabled:opacity-50 text-white px-6 py-2 rounded-2xl font-semibold"
            >
              Echo
            </button>
          </div>
        </form>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {visiblePosts.map((post) => {
          const author = usersById[post.authorId];
          if (!author) return null;
          return (
            <PostItem
              key={post.id}
              post={post}
              postsById={postsById}
              groupsById={groupsById}
              author={author}
              currentUser={user}
              comments={postCommentsByPostId.get(post.id) ?? []}
              usersById={usersById}
              onToggleLike={onTogglePostLike}
              onToggleRepost={onTogglePostRepost}
              onDeletePost={onDeletePost}
              onAddComment={onAddPostComment}
              onEditComment={onEditPostComment}
              onDeleteComment={onDeletePostComment}
              onOpenProfile={onOpenProfile}
              onOpenHashtag={onOpenHashtag}
              onOpenGroup={onOpenGroup}
            />
          );
        })}

        {filteredPosts.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            {searchQuery ? 'No posts found for search.' : 'No posts yet. Start the conversation!'}
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

      {activeStory ? (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
            <div className="h-1 bg-slate-200 dark:bg-slate-800">
              {activeStory.mediaType !== 'video' ? (
                <div key={activeStory.id} className="h-full bg-slate-900 dark:bg-white story-progress" />
              ) : null}
            </div>

            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button onClick={() => onOpenProfile(activeStory.authorId)} className="flex items-center gap-2">
                <img src={userAvatar(usersById[activeStory.authorId] || user)} className="w-9 h-9 rounded-xl object-cover" alt="" />
                <div className="text-left">
                  <p className="text-sm font-bold">{usersById[activeStory.authorId]?.displayName || 'User'}</p>
                  <p className="text-xs text-slate-500">{activeStory.caption || 'Story'}</p>
                </div>
              </button>

              <div className="flex items-center gap-2">
                {(user.role === 'admin' || activeStory.authorId === user.id) ? (
                  <button
                    onClick={() => {
                      onDeleteStory(activeStory.id);
                      setActiveStoryIndex(null);
                    }}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    Delete
                  </button>
                ) : null}
                <button
                  onClick={() => setActiveStoryIndex(null)}
                  className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-4 grid md:grid-cols-[100px_1fr_100px] gap-3 items-center">
              <button
                onClick={() => setActiveStoryIndex((index) => (index !== null && index > 0 ? index - 1 : index))}
                disabled={activeStoryIndex === 0}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 disabled:opacity-40"
              >
                Prev
              </button>

              <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-black">
                {activeStory.mediaType === 'video' ? (
                  <video src={activeStory.mediaUrl} controls autoPlay className="w-full max-h-[70vh]" />
                ) : (
                  <img src={activeStory.mediaUrl} alt="story" className="w-full max-h-[70vh] object-contain" />
                )}
              </div>

              <button
                onClick={() =>
                  setActiveStoryIndex((index) => {
                    if (index === null) return null;
                    return index + 1 < stories.length ? index + 1 : null;
                  })
                }
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2"
              >
                Next
              </button>
            </div>

            <form onSubmit={submitStoryReply} className="px-4 pb-4 flex gap-2">
              <input
                value={storyReply}
                onChange={(event) => setStoryReply(event.target.value)}
                placeholder="Reply to story (private message)"
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={isRestricted}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-slate-900 dark:bg-white dark:text-black text-white disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Feed;
