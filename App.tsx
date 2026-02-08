import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from './components/Layout';
import Feed from './components/Feed';
import Profile from './components/Profile';
import RightPanel from './components/RightPanel';
import AuthScreen from './components/AuthScreen';
import Explore from './components/Explore';
import Notifications from './components/Notifications';
import Messages from './components/Messages';
import AdminPanel from './components/AdminPanel';
import Groups from './components/Groups';
import { ActionResult } from './types';
import { useStore } from './store/useStore';

type ToastItem = {
  id: string;
  ok: boolean;
  text: string;
  actorId?: string;
};

const App: React.FC = () => {
  const {
    db,
    user,
    users,
    posts,
    postComments,
    stories,
    messages,
    groups,
    groupMembers,
    groupPosts,
    groupPostComments,
    notifications,
    unreadMessagesCount,
    isAuthenticated,
    darkMode,
    currentView,
    activeChatUserId,
    activeGroupId,
    register,
    login,
    logout,
    setTheme,
    setCurrentView,
    setActiveChatUser,
    setActiveGroup,
    createPost,
    deletePost,
    togglePostLike,
    togglePostRepost,
    addPostComment,
    createStory,
    deleteStory,
    addStoryComment,
    followUser,
    sendMessage,
    editMessage,
    deleteMessage,
    markChatRead,
    markNotificationsRead,
    updateProfile,
    createGroup,
    updateGroup,
    toggleGroupSubscription,
    createGroupPost,
    toggleGroupPostLike,
    repostGroupPostToProfile,
    publishGroupPostToFeed,
    editGroupPost,
    deleteGroupPost,
    addGroupPostComment,
    setUserRole,
    setUserBan,
    setUserRestricted,
    setUserVerified,
    clearNetworkData,
    resetAllData,
  } = useStore();

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeHashtag, setActiveHashtag] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [composeSignal, setComposeSignal] = useState(0);
  const seenNotifIds = useRef<Set<string>>(new Set());
  const seenMessageIds = useRef<Set<string>>(new Set());
  const usersByIdRef = useRef<Record<string, typeof db.users[number]>>({});
  const toastTimersRef = useRef<number[]>([]);
  const setCurrentViewRef = useRef(setCurrentView);
  const setActiveGroupRef = useRef(setActiveGroup);

  const usersById = useMemo(
    () => Object.fromEntries(db.users.map((candidate) => [candidate.id, candidate])),
    [db.users]
  );
  const groupsById = useMemo(
    () => Object.fromEntries(groups.map((candidate) => [candidate.id, candidate])),
    [groups]
  );

  const unreadCount = notifications.filter((item) => !item.read).length;
  const canOpenAdmin = user?.role === 'admin';

  useEffect(() => {
    setCurrentViewRef.current = setCurrentView;
    setActiveGroupRef.current = setActiveGroup;
  }, [setCurrentView, setActiveGroup]);

  useEffect(() => {
    usersByIdRef.current = usersById;
  }, [usersById]);

  useEffect(
    () => () => {
      toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      toastTimersRef.current = [];
    },
    []
  );

  const setHash = (value: string) => {
    const next = value.startsWith('#') ? value : `#${value}`;
    if (window.location.hash === next) return;
    window.history.replaceState(null, '', next);
  };

  const clearTrackedTimer = (id: number) => {
    toastTimersRef.current = toastTimersRef.current.filter((timer) => timer !== id);
  };

  const pushToast = (ok: boolean, text: string, actorId?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, ok, text, actorId }].slice(-4));

    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(ok ? 920 : 560, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.22);
      const closeTimer = window.setTimeout(() => {
        clearTrackedTimer(closeTimer);
        void ctx.close();
      }, 350);
      toastTimersRef.current.push(closeTimer);
    } catch {
      // ignore audio errors in restricted browser contexts
    }

    const removeTimer = window.setTimeout(() => {
      clearTrackedTimer(removeTimer);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3800);
    toastTimersRef.current.push(removeTimer);
  };

  useEffect(() => {
    if (!user?.id) {
      seenNotifIds.current.clear();
      return;
    }
    const currentIds = new Set(notifications.map((item) => item.id));
    if (seenNotifIds.current.size === 0) {
      seenNotifIds.current = currentIds;
      return;
    }

    notifications.forEach((item) => {
      if (!seenNotifIds.current.has(item.id) && !item.read) {
        pushToast(true, item.text, item.actorId);
      }
    });

    seenNotifIds.current = currentIds;
  }, [notifications, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      seenMessageIds.current.clear();
      return;
    }
    const currentIds = new Set(messages.map((item) => item.id));
    if (seenMessageIds.current.size === 0) {
      seenMessageIds.current = currentIds;
      return;
    }

    messages.forEach((item) => {
      if (item.toId !== user.id) return;
      if (seenMessageIds.current.has(item.id)) return;
      const sender = usersByIdRef.current[item.fromId];
      pushToast(true, `${sender?.displayName || 'User'} sent a message.`, item.fromId);
    });
    seenMessageIds.current = currentIds;
  }, [messages, user?.id]);

  useEffect(() => {
    const applyHash = () => {
      const hash = (window.location.hash || '#/').replace(/^#/, '');
      const profileMatch = hash.match(/^\/u\/(.+)$/);
      const groupMatch = hash.match(/^\/g\/(.+)$/);
      const tagMatch = hash.match(/^\/tag\/(.+)$/);
      if (profileMatch) {
        const userId = decodeURIComponent(profileMatch[1]);
        setActiveHashtag(null);
        setProfileUserId(userId);
        setCurrentViewRef.current('profile');
        return;
      }
      if (groupMatch) {
        const groupId = decodeURIComponent(groupMatch[1]);
        setActiveHashtag(null);
        setActiveGroupRef.current(groupId);
        setCurrentViewRef.current('groups');
        return;
      }
      if (tagMatch) {
        const tag = decodeURIComponent(tagMatch[1]);
        setActiveHashtag(tag.startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`);
        setCurrentViewRef.current('feed');
        return;
      }
      if (hash === '/groups') {
        setActiveHashtag(null);
        setActiveGroupRef.current(null);
        setCurrentViewRef.current('groups');
        return;
      }
      if (hash === '/messages') {
        setActiveHashtag(null);
        setCurrentViewRef.current('messages');
        return;
      }
      if (hash === '/notifications') {
        setActiveHashtag(null);
        setCurrentViewRef.current('notifications');
        return;
      }
      if (hash === '/explore') {
        setActiveHashtag(null);
        setCurrentViewRef.current('explore');
        return;
      }
      setActiveHashtag(null);
      setCurrentViewRef.current('feed');
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    window.dispatchEvent(new Event('hashchange'));
  }, [isAuthenticated]);

  const showResult = (result: ActionResult) => {
    pushToast(result.ok, result.message);
    return result;
  };

  const scrollToElement = (id: string) => {
    let attempts = 0;
    const tryScroll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (attempts >= 6) return;
      attempts += 1;
      window.dispatchEvent(new Event('aura:expand-posts'));
      window.setTimeout(tryScroll, 140);
    };
    window.setTimeout(tryScroll, 140);
  };

  const goToChat = (targetUserId: string) => {
    setActiveChatUser(targetUserId);
    markChatRead(targetUserId);
    setCurrentView('messages');
    setHash('/messages');
  };

  const openProfile = (targetUserId: string) => {
    setActiveHashtag(null);
    setProfileUserId(targetUserId);
    setCurrentView('profile');
    setHash(`/u/${encodeURIComponent(targetUserId)}`);
  };

  const openGroup = (groupId: string | null) => {
    setActiveHashtag(null);
    setActiveGroup(groupId);
    setCurrentView('groups');
    setHash(groupId ? `/g/${encodeURIComponent(groupId)}` : '/groups');
  };

  const openHashtag = (tag: string) => {
    const normalized = tag.startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`;
    setSearchQuery('');
    setActiveHashtag(normalized);
    setCurrentView('feed');
    setHash(`/tag/${encodeURIComponent(normalized)}`);
  };

  const openNotification = (notification: typeof notifications[number]) => {
    if (notification.groupId) {
      openGroup(notification.groupId);
      if (notification.commentId) {
        scrollToElement(`group-comment-${notification.commentId}`);
        return;
      }
      if (notification.groupPostId) {
        scrollToElement(`group-post-${notification.groupPostId}`);
      }
      return;
    }
    if (notification.postId) {
      const targetPost = posts.find((item) => item.id === notification.postId);
      if (targetPost?.authorId === user.id) {
        openProfile(user.id);
      } else {
        setCurrentView('feed');
        setHash('/');
        setActiveHashtag(null);
      }
      if (notification.commentId) {
        scrollToElement(`post-comment-${notification.commentId}`);
        return;
      }
      scrollToElement(`post-${notification.postId}`);
      return;
    }
    if (notification.actorId) {
      openProfile(notification.actorId);
    }
  };

  const openPost = (postId: string) => {
    const targetPost = posts.find((item) => item.id === postId);
    if (targetPost?.authorId === user.id) {
      openProfile(user.id);
    } else {
      setCurrentView('feed');
      setHash('/');
      setActiveHashtag(null);
    }
    scrollToElement(`post-${postId}`);
  };

  const goToComposer = () => {
    setActiveHashtag(null);
    setCurrentView('feed');
    setHash('/');
    setComposeSignal((prev) => prev + 1);
  };

  const handleChangeView = (view: typeof currentView) => {
    if (view === 'profile') {
      setActiveHashtag(null);
      setProfileUserId(user.id);
      setHash(`/u/${encodeURIComponent(user.id)}`);
    } else if (view === 'groups') {
      setActiveHashtag(null);
      setActiveGroup(null);
      setHash('/groups');
    } else if (view === 'messages') {
      setActiveHashtag(null);
      setHash('/messages');
    } else if (view === 'notifications') {
      setActiveHashtag(null);
      setHash('/notifications');
    } else if (view === 'explore') {
      setActiveHashtag(null);
      setHash('/explore');
    } else {
      setActiveHashtag(null);
      setHash('/');
    }
    setCurrentView(view);
  };

  if (!isAuthenticated || !user) {
    return (
      <>
        <AuthScreen
          darkMode={darkMode}
          onToggleTheme={() => setTheme(darkMode ? 'light' : 'dark')}
          onLogin={(username, password) => showResult(login({ username, password }))}
          onRegister={(displayName, username, password) =>
            showResult(register({ displayName, username, password }))
          }
        />

        <div className="fixed bottom-4 inset-x-0 z-[90] flex flex-col items-center gap-2 px-4 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-xl px-4 py-2 text-sm font-semibold shadow-lg ${
                toast.ok
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                {toast.actorId && usersById[toast.actorId] ? (
                  <img
                    src={usersById[toast.actorId].avatar || `https://i.pravatar.cc/100?u=${usersById[toast.actorId].username}`}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : null}
                <span>{toast.text}</span>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  const profileUser = usersById[profileUserId || user.id] || user;
  const viewerFollowingProfile = db.follows.some(
    (item) => item.followerId === user.id && item.followingId === profileUser.id
  );

  const renderView = () => {
    switch (currentView) {
      case 'feed':
        return (
          <Feed
            user={user}
            posts={posts}
            postComments={postComments}
            stories={stories}
            usersById={usersById}
            groupsById={groupsById}
            isRestricted={user.restricted}
            searchQuery={searchQuery}
            activeHashtag={activeHashtag}
            composeSignal={composeSignal}
            onCreatePost={(text, mediaType, mediaUrl) =>
              showResult(createPost({ text, mediaType, mediaUrl }))
            }
            onTogglePostLike={(postId) => showResult(togglePostLike(postId))}
            onTogglePostRepost={(postId) => showResult(togglePostRepost(postId))}
            onDeletePost={(postId) => showResult(deletePost(postId))}
            onAddPostComment={(postId, text) => showResult(addPostComment(postId, text))}
            onCreateStory={(caption, mediaType, mediaUrl) =>
              showResult(createStory({ caption, mediaType, mediaUrl }))
            }
            onDeleteStory={(storyId) => showResult(deleteStory(storyId))}
            onAddStoryComment={(storyId, text) => showResult(addStoryComment(storyId, text))}
            onOpenProfile={openProfile}
            onOpenHashtag={openHashtag}
            onClearHashtag={() => {
              setActiveHashtag(null);
              setHash('/');
            }}
          />
        );
      case 'explore':
        return (
          <Explore
            currentUser={user}
            users={users}
            groups={groups}
            posts={posts}
            follows={db.follows}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onFollowToggle={(targetUserId) => showResult(followUser(targetUserId))}
            onOpenChat={goToChat}
            onOpenProfile={openProfile}
            onOpenGroup={openGroup}
            onOpenHashtag={openHashtag}
            onOpenPost={openPost}
          />
        );
      case 'notifications':
        return (
          <Notifications
            notifications={notifications}
            usersById={usersById}
            onMarkRead={markNotificationsRead}
            onOpenProfile={openProfile}
            onOpenNotification={openNotification}
          />
        );
      case 'messages':
        return (
          <Messages
            currentUser={user}
            users={users}
            messages={messages}
            activeChatUserId={activeChatUserId}
            onSelectChat={setActiveChatUser}
            onSendMessage={(toUserId, payload) => showResult(sendMessage(toUserId, payload))}
            onEditMessage={(messageId, text) => showResult(editMessage(messageId, text))}
            onDeleteMessage={(messageId) => showResult(deleteMessage(messageId))}
            onMarkChatRead={markChatRead}
            onOpenProfile={openProfile}
          />
        );
      case 'groups':
        return (
          <Groups
            currentUser={user}
            usersById={usersById}
            groups={groups}
            groupMembers={groupMembers}
            groupPosts={groupPosts}
            groupPostComments={groupPostComments}
            activeGroupId={activeGroupId}
            onSetActiveGroup={openGroup}
            onCreateGroup={(payload) => showResult(createGroup(payload))}
            onUpdateGroup={(groupId, patch) => showResult(updateGroup(groupId, patch))}
            onToggleSubscription={(groupId) => showResult(toggleGroupSubscription(groupId))}
            onCreatePost={(groupId, text, mediaType, mediaUrl) =>
              showResult(createGroupPost(groupId, text, mediaType, mediaUrl))
            }
            onTogglePostLike={(groupPostId) => showResult(toggleGroupPostLike(groupPostId))}
            onRepostToProfile={(groupPostId) => showResult(repostGroupPostToProfile(groupPostId))}
            onPublishToFeed={(groupPostId) => showResult(publishGroupPostToFeed(groupPostId))}
            onEditPost={(groupPostId, text) => showResult(editGroupPost(groupPostId, text))}
            onDeletePost={(groupPostId) => showResult(deleteGroupPost(groupPostId))}
            onAddComment={(groupPostId, text) =>
              showResult(addGroupPostComment(groupPostId, text))
            }
            onOpenProfile={openProfile}
            onOpenHashtag={openHashtag}
            onCopyLink={(value) => {
              navigator.clipboard.writeText(value);
              pushToast(true, 'Link copied.');
            }}
          />
        );
      case 'profile':
        return (
          <Profile
            viewer={user}
            profileUser={profileUser}
            posts={posts}
            postComments={postComments}
            stories={stories}
            follows={db.follows}
            usersById={usersById}
            groupsById={groupsById}
            isFollowing={viewerFollowingProfile}
            onSave={(patch) => showResult(updateProfile(patch))}
            onToggleFollow={(targetUserId) => showResult(followUser(targetUserId))}
            onMessage={goToChat}
            onTogglePostLike={(postId) => showResult(togglePostLike(postId))}
            onTogglePostRepost={(postId) => showResult(togglePostRepost(postId))}
            onDeletePost={(postId) => showResult(deletePost(postId))}
            onAddPostComment={(postId, text) => showResult(addPostComment(postId, text))}
            onOpenProfile={openProfile}
            onOpenHashtag={openHashtag}
            onBack={() => {
              setActiveHashtag(null);
              setCurrentView('feed');
              setHash('/');
            }}
            onCopyProfileLink={(value) => {
              navigator.clipboard.writeText(value);
              pushToast(true, 'Profile link copied.');
            }}
          />
        );
      case 'admin':
        if (!canOpenAdmin) {
          return (
            <Explore
              currentUser={user}
              users={users}
              groups={groups}
              posts={posts}
              follows={db.follows}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onFollowToggle={(targetUserId) => showResult(followUser(targetUserId))}
              onOpenChat={goToChat}
              onOpenProfile={openProfile}
              onOpenGroup={openGroup}
              onOpenHashtag={openHashtag}
              onOpenPost={openPost}
            />
          );
        }
        return (
          <AdminPanel
            currentAdmin={user}
            users={db.users}
            posts={posts}
            stories={stories}
            notifications={db.notifications}
            onRoleChange={(userId, role) => showResult(setUserRole(userId, role))}
            onBanToggle={(userId, value) => showResult(setUserBan(userId, value))}
            onRestrictToggle={(userId, value) => showResult(setUserRestricted(userId, value))}
            onVerifyToggle={(userId, value) => showResult(setUserVerified(userId, value))}
            onDeletePost={(postId) => showResult(deletePost(postId))}
            onDeleteStory={(storyId) => showResult(deleteStory(storyId))}
            onClearNetworkData={() => showResult(clearNetworkData())}
            onResetAllData={() => showResult(resetAllData())}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Layout
        user={user}
        currentView={currentView}
        darkMode={darkMode}
        unreadCount={unreadCount}
        unreadMessagesCount={unreadMessagesCount}
        canOpenAdmin={canOpenAdmin}
        onChangeView={handleChangeView}
        onToggleTheme={() => setTheme(darkMode ? 'light' : 'dark')}
        onLogout={logout}
        onCompose={goToComposer}
        rightPanel={
          <RightPanel
            user={user}
            users={users}
            posts={posts}
            follows={db.follows}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onFollowToggle={(targetUserId) => showResult(followUser(targetUserId))}
            onOpenMessages={goToChat}
            onOpenProfile={openProfile}
            onOpenGroup={(groupId) => openGroup(groupId)}
            onOpenHashtag={openHashtag}
            groups={groups}
          />
        }
      >
        {renderView()}
      </Layout>

      <div className="fixed bottom-4 inset-x-0 z-[90] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl px-4 py-2 text-sm font-semibold shadow-lg ${
              toast.ok
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.actorId && usersById[toast.actorId] ? (
                <img
                  src={usersById[toast.actorId].avatar || `https://i.pravatar.cc/100?u=${usersById[toast.actorId].username}`}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : null}
              <span>{toast.text}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default App;
