import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ICONS } from '../constants';
import { MediaType, Post, PostComment, Story, User } from '../types';
import PostItem from './PostItem';
import StoryBar from './StoryBar';
import { userAvatar } from '../utils/ui';

interface FeedProps {
  user: User;
  posts: Post[];
  postComments: PostComment[];
  stories: Story[];
  usersById: Record<string, User>;
  isRestricted: boolean;
  searchQuery: string;
  composeSignal: number;
  onCreatePost: (text: string, mediaType?: MediaType, mediaUrl?: string) => void;
  onTogglePostLike: (postId: string) => void;
  onTogglePostRepost: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onAddPostComment: (postId: string, text: string) => void;
  onCreateStory: (caption: string, mediaType: MediaType, mediaUrl: string) => void;
  onDeleteStory: (storyId: string) => void;
  onAddStoryComment: (storyId: string, text: string) => void;
  onOpenProfile: (userId: string) => void;
}

const Feed: React.FC<FeedProps> = ({
  user,
  posts,
  postComments,
  stories,
  usersById,
  isRestricted,
  searchQuery,
  composeSignal,
  onCreatePost,
  onTogglePostLike,
  onTogglePostRepost,
  onDeletePost,
  onAddPostComment,
  onCreateStory,
  onDeleteStory,
  onAddStoryComment,
  onOpenProfile,
}) => {
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostMediaType, setNewPostMediaType] = useState<MediaType>('image');
  const [newPostMediaUrl, setNewPostMediaUrl] = useState('');
  const [showMediaControls, setShowMediaControls] = useState(false);
  const [feedTab, setFeedTab] = useState<'relevant' | 'recent'>('relevant');

  const [storyCaption, setStoryCaption] = useState('');
  const [storyMediaType, setStoryMediaType] = useState<MediaType>('image');
  const [storyMediaUrl, setStoryMediaUrl] = useState('');
  const [showStoryForm, setShowStoryForm] = useState(false);

  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [storyReply, setStoryReply] = useState('');
  const [storyProgress, setStoryProgress] = useState(0);

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
    const searched = posts.filter((post) => {
      if (!query) return true;
      const author = usersById[post.authorId];
      const authorText = author ? `${author.displayName} ${author.username}`.toLowerCase() : '';
      return (
        post.text.toLowerCase().includes(query) ||
        (post.mediaUrl || '').toLowerCase().includes(query) ||
        authorText.includes(query)
      );
    });

    return [...searched].sort((a, b) => {
      if (feedTab === 'recent') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      const likesDiff = b.likedBy.length - a.likedBy.length;
      if (likesDiff !== 0) return likesDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [feedTab, posts, searchQuery, usersById]);

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
    if (!activeStory || activeStory.mediaType === 'video') {
      setStoryProgress(0);
      return;
    }

    setStoryProgress(0);
    const durationMs = 7000;
    const stepMs = 100;
    const steps = durationMs / stepMs;
    let current = 0;

    const timer = window.setInterval(() => {
      current += 1;
      setStoryProgress((current / steps) * 100);
      if (current >= steps) {
        window.clearInterval(timer);
        setActiveStoryIndex((index) => {
          if (index === null) return null;
          return index + 1 < stories.length ? index + 1 : null;
        });
      }
    }, stepMs);

    return () => window.clearInterval(timer);
  }, [activeStory, stories.length]);

  const submitStoryReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeStory || !storyReply.trim()) return;
    onAddStoryComment(activeStory.id, storyReply);
    setStoryReply('');
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
          <form onSubmit={handleSubmitStory} className="grid md:grid-cols-[1fr_140px_1fr_auto] gap-2">
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
            <div className="grid md:grid-cols-[120px_1fr] gap-2 mt-2">
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
            </div>
          ) : null}

          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-2 text-slate-700 dark:text-slate-100">
              <button
                type="button"
                onClick={() => setShowMediaControls((prev) => !prev)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
              <button type="button" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>
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
        {filteredPosts.map((post) => {
          const author = usersById[post.authorId];
          if (!author) return null;
          return (
            <PostItem
              key={post.id}
              post={post}
              postsById={postsById}
              author={author}
              currentUser={user}
              comments={postCommentsByPostId.get(post.id) ?? []}
              usersById={usersById}
              onToggleLike={onTogglePostLike}
              onToggleRepost={onTogglePostRepost}
              onDeletePost={onDeletePost}
              onAddComment={onAddPostComment}
              onOpenProfile={onOpenProfile}
            />
          );
        })}

        {filteredPosts.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            {searchQuery ? 'No posts found for search.' : 'No posts yet. Start the conversation!'}
          </div>
        ) : null}
      </div>

      {activeStory ? (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
            <div className="h-1 bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-slate-900 dark:bg-white transition-all" style={{ width: `${storyProgress}%` }} />
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
