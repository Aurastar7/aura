import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Message, User } from '../types';
import { isUserOnline, userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface MessagesProps {
  currentUser: User;
  users: User[];
  messages: Message[];
  activeChatUserId: string | null;
  onSelectChat: (userId: string | null) => void;
  onSendMessage: (
    userId: string,
    payload: { text?: string; mediaType?: 'image'; mediaUrl?: string }
  ) => void;
  onEditMessage: (messageId: string, text: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onMarkChatRead: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const isVideoUrl = (url: string) =>
  url.startsWith('data:video/') || /\.(mp4|webm|ogg|mov)$/i.test(url);

const Messages: React.FC<MessagesProps> = ({
  currentUser,
  users,
  messages,
  activeChatUserId,
  onSelectChat,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onMarkChatRead,
  onOpenProfile,
}) => {
  const [text, setText] = useState('');
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>(activeChatUserId ? 'chat' : 'list');
  const [draftMediaType, setDraftMediaType] = useState<'image' | null>(null);
  const [draftMediaUrl, setDraftMediaUrl] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [mediaPreview, setMediaPreview] = useState<{
    url: string;
    isVideo: boolean;
    zoom: number;
    fit: 'contain' | 'cover';
  } | null>(null);
  const onMarkChatReadRef = useRef(onMarkChatRead);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onMarkChatReadRef.current = onMarkChatRead;
  }, [onMarkChatRead]);

  const candidates = users.filter((candidate) => !candidate.banned);
  const activeChatUser = candidates.find((candidate) => candidate.id === activeChatUserId) ?? null;

  const unreadByUser = useMemo(() => {
    const map = new Map<string, number>();
    messages.forEach((message) => {
      const isUnread = message.toId === currentUser.id && !message.readBy.includes(currentUser.id);
      if (!isUnread) return;
      map.set(message.fromId, (map.get(message.fromId) ?? 0) + 1);
    });
    return map;
  }, [messages, currentUser.id]);

  useEffect(() => {
    if (activeChatUserId) {
      setMobilePane('chat');
      onMarkChatReadRef.current(activeChatUserId);
    }
  }, [activeChatUserId]);

  const conversation = useMemo(() => {
    if (!activeChatUser) return [];
    return messages
      .filter(
        (message) =>
          (message.fromId === currentUser.id && message.toId === activeChatUser.id) ||
          (message.fromId === activeChatUser.id && message.toId === currentUser.id)
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, currentUser.id, activeChatUser]);

  useEffect(() => {
    if (!activeChatUserId) return;
    const container = conversationRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [activeChatUserId, conversation.length]);

  const resetDraft = () => {
    setText('');
    setDraftMediaType(null);
    setDraftMediaUrl('');
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeChatUser) return;
    onSendMessage(activeChatUser.id, {
      text,
      mediaType: draftMediaType || undefined,
      mediaUrl: draftMediaUrl || undefined,
    });
    resetDraft();
  };

  const openChat = (userId: string) => {
    onSelectChat(userId);
    onMarkChatRead(userId);
    setMobilePane('chat');
  };

  const pickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setDraftMediaType('image');
    setDraftMediaUrl(dataUrl);
    event.target.value = '';
  };

  const chatList = (
    <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden h-full min-h-0 flex flex-col">
      <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-500">Choose user</h2>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-800 flex-1 min-h-0 overflow-y-auto">
        {candidates.length > 0 ? (
          candidates.map((candidate) => {
            const unread = unreadByUser.get(candidate.id) ?? 0;
            return (
              <button
                key={candidate.id}
                onClick={() => openChat(candidate.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 ${
                  activeChatUser?.id === candidate.id
                    ? 'bg-slate-100 dark:bg-slate-900'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-950'
                }`}
              >
                <div className="relative shrink-0">
                  <img src={userAvatar(candidate)} alt={candidate.username} className="w-10 h-10 rounded-xl object-cover" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                      isUserOnline(candidate) ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                    title={isUserOnline(candidate) ? 'online' : 'offline'}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                    <span className="truncate">{candidate.displayName}</span>
                    <RoleBadge user={candidate} />
                  </p>
                  <p className="text-xs text-slate-500 truncate">@{candidate.username}</p>
                </div>
                {unread > 0 ? (
                  <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-[10px] grid place-items-center">
                    {unread}
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <p className="px-4 py-8 text-sm text-slate-500">No users available.</p>
        )}
      </div>
    </div>
  );

  const chatWindow = activeChatUser ? (
    <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden h-full min-h-0 flex flex-col">
      <div className="px-4 py-3 border-b-2 border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              onSelectChat(null);
              setMobilePane('list');
            }}
            className="lg:hidden rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
          >
            Back
          </button>
          <button onClick={() => onOpenProfile(activeChatUser.id)} className="flex items-center gap-3 min-w-0 text-left">
            <div className="relative shrink-0">
              <img src={userAvatar(activeChatUser)} alt={activeChatUser.username} className="w-9 h-9 rounded-xl object-cover" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                  isUserOnline(activeChatUser) ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            </div>
            <div>
              <p className="font-bold flex items-center gap-1.5">
                {activeChatUser.displayName}
                <RoleBadge user={activeChatUser} />
              </p>
              <p className="text-xs text-slate-500">@{activeChatUser.username}</p>
            </div>
          </button>
        </div>
        <button
          onClick={() => onOpenProfile(activeChatUser.id)}
          className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
        >
          Open profile
        </button>
      </div>

      <div ref={conversationRef} className="flex-1 min-h-0 px-4 py-4 space-y-2 overflow-y-auto">
        {conversation.length > 0 ? (
          conversation.map((message) => {
            const isMine = message.fromId === currentUser.id;
            const isEditing = editingMessageId === message.id;
            const canEdit = isMine && message.mediaType !== 'voice';

            return (
              <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${
                    isMine
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                      : 'bg-slate-100 dark:bg-slate-900'
                  }`}
                >
                  {message.mediaType === 'voice' && message.mediaUrl ? (
                    <audio controls src={message.mediaUrl} className="w-full mb-2" />
                  ) : message.mediaUrl ? (
                    isVideoUrl(message.mediaUrl) ? (
                      <button
                        type="button"
                        className="block w-full mb-2"
                        onClick={() =>
                          setMediaPreview({
                            url: message.mediaUrl || '',
                            isVideo: true,
                            zoom: 1,
                            fit: 'contain',
                          })
                        }
                      >
                        <video src={message.mediaUrl} className="rounded-xl max-h-56 w-full object-cover" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="block w-full mb-2"
                        onClick={() =>
                          setMediaPreview({
                            url: message.mediaUrl || '',
                            isVideo: false,
                            zoom: 1,
                            fit: 'contain',
                          })
                        }
                      >
                        <img src={message.mediaUrl} alt="message media" className="rounded-xl max-h-56 w-full object-cover" />
                      </button>
                    )
                  ) : null}

                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onEditMessage(message.id, editingText);
                            setEditingMessageId(null);
                            setEditingText('');
                          }}
                          className="text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingMessageId(null);
                            setEditingText('');
                          }}
                          className="text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>{message.text}</p>
                  )}

                  <div className="text-[10px] opacity-70 mt-1 flex items-center justify-between gap-2">
                    <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                    <span>{message.editedAt ? 'edited' : ''}</span>
                  </div>
                  {canEdit && !isEditing ? (
                    <div className="mt-1 flex gap-1.5">
                      <button
                        onClick={() => {
                          setEditingMessageId(message.id);
                          setEditingText(message.text);
                        }}
                        className="text-[11px] rounded-lg border border-current/30 px-2 py-0.5"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDeleteMessage(message.id)}
                        className="text-[11px] rounded-lg border border-current/30 px-2 py-0.5"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">No messages in this conversation.</p>
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 px-4 py-3 border-t-2 border-slate-200 dark:border-slate-800 space-y-2">
        {(draftMediaType && draftMediaUrl) ? (
          <div className="rounded-xl border-2 border-slate-300 dark:border-slate-700 p-2 text-xs">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span>Attachment: photo/video</span>
              <button
                type="button"
                onClick={() => {
                  setDraftMediaType(null);
                  setDraftMediaUrl('');
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-0.5"
              >
                Remove
              </button>
            </div>
            {draftMediaType === 'image' ? (
              <img src={draftMediaUrl} alt="preview" className="max-h-28 rounded-lg object-cover" />
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write a message"
            className="flex-1 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!text.trim() && !draftMediaUrl}
            className="rounded-xl px-4 py-2 text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-black disabled:opacity-50"
          >
            Send
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 cursor-pointer">
            Photo
            <input type="file" accept="image/*,video/*" className="hidden" onChange={pickImage} />
          </label>
        </div>
      </form>
    </section>
  ) : (
    <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 h-full min-h-0 flex items-center justify-center text-sm text-slate-500 p-8 text-center">
      Select user to start a conversation.
    </div>
  );

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+72px)] lg:pb-6 h-[calc(var(--app-height)-56px)] lg:h-[var(--app-height)] flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold">Messages</h1>
      </header>

      <div className="p-4 lg:hidden flex-1 min-h-0">
        {mobilePane === 'list' ? chatList : chatWindow}
      </div>

      <div className="hidden lg:grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 p-4 flex-1 min-h-0">
        {chatList}
        {chatWindow}
      </div>

      {mediaPreview ? (
        <div className="fixed inset-0 z-[70] bg-black/85 p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black overflow-hidden">
            <div className="px-3 py-2 border-b-2 border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setMediaPreview((prev) =>
                      prev ? { ...prev, zoom: Math.max(0.6, Number((prev.zoom - 0.2).toFixed(2))) } : prev
                    )
                  }
                  className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMediaPreview((prev) =>
                      prev ? { ...prev, zoom: Math.min(3, Number((prev.zoom + 0.2).toFixed(2))) } : prev
                    )
                  }
                  className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMediaPreview((prev) =>
                      prev
                        ? { ...prev, fit: prev.fit === 'contain' ? 'cover' : 'contain' }
                        : prev
                    )
                  }
                  className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                >
                  {mediaPreview.fit === 'contain' ? 'Fill' : 'Fit'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setMediaPreview(null)}
                className="rounded-lg border-2 border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>
            <div className="h-[70vh] bg-black grid place-items-center overflow-auto">
              {mediaPreview.isVideo ? (
                <video
                  src={mediaPreview.url}
                  controls
                  autoPlay
                  className={`max-w-full max-h-full ${mediaPreview.fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                  style={{ transform: `scale(${mediaPreview.zoom})`, transformOrigin: 'center center' }}
                />
              ) : (
                <img
                  src={mediaPreview.url}
                  alt="preview"
                  className={`max-w-full max-h-full ${mediaPreview.fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                  style={{ transform: `scale(${mediaPreview.zoom})`, transformOrigin: 'center center' }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Messages;
