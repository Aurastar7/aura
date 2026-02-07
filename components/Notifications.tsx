import React from 'react';
import { NotificationItem, User } from '../types';
import { userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface NotificationsProps {
  notifications: NotificationItem[];
  usersById: Record<string, User>;
  onMarkRead: () => void;
}

const Notifications: React.FC<NotificationsProps> = ({ notifications, usersById, onMarkRead }) => {
  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <div className="pb-24 lg:pb-6">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-black">Notifications</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">Unread: {unreadCount}</p>
        </div>
        <button
          onClick={onMarkRead}
          className="rounded-xl px-3 py-2 text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-black"
        >
          Mark all read
        </button>
      </header>

      <section className="divide-y divide-slate-200 dark:divide-slate-800">
        {notifications.length > 0 ? (
          notifications.map((item) => {
            const actor = item.actorId ? usersById[item.actorId] : null;
            return (
              <div
                key={item.id}
                className={`px-6 py-4 ${
                  item.read ? 'bg-transparent' : 'bg-slate-50 dark:bg-slate-900'
                }`}
              >
                <div className="flex items-start gap-3">
                  {actor ? (
                    <img src={userAvatar(actor)} alt="" className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 grid place-items-center text-xs">i</div>
                  )}
                  <div className="min-w-0">
                    {actor ? (
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <span>{actor.displayName}</span>
                        <RoleBadge user={actor} />
                        <span className="text-xs text-slate-500">@{actor.username}</span>
                      </p>
                    ) : null}
                    <p className="text-sm">{item.text}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
            );
          })
        ) : (
          <div className="px-6 py-16 text-center text-slate-500">No notifications yet.</div>
        )}
      </section>
    </div>
  );
};

export default Notifications;
