import React from 'react';
import { ICONS } from '../constants';
import { AppView, User } from '../types';
import { isUserOnline, userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface SidebarProps {
  user: User;
  currentView: AppView;
  darkMode: boolean;
  unreadCount: number;
  unreadMessagesCount: number;
  canOpenAdmin: boolean;
  onChangeView: (view: AppView) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onCompose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  user,
  currentView,
  darkMode,
  unreadCount,
  unreadMessagesCount,
  canOpenAdmin,
  onChangeView,
  onToggleTheme,
  onLogout,
  onCompose,
}) => {
  const menuItems: Array<{ id: AppView; label: string; icon: React.FC<any>; badge?: number }> = [
    { id: 'feed', label: 'Home', icon: ICONS.Home },
    { id: 'explore', label: 'Explore', icon: ICONS.Explore },
    { id: 'notifications', label: 'Notifications', icon: ICONS.Notifications, badge: unreadCount },
    { id: 'messages', label: 'Messages', icon: ICONS.Messages, badge: unreadMessagesCount },
    { id: 'groups', label: 'Groups', icon: ICONS.Group },
    { id: 'profile', label: 'Profile', icon: ICONS.Profile },
  ];

  if (canOpenAdmin) {
    menuItems.push({ id: 'admin', label: 'Admin', icon: ICONS.Shield });
  }

  return (
    <div className="h-full flex flex-col justify-between px-3 py-4">
      <div className="space-y-6">
        <button
          onClick={() => onChangeView('feed')}
          className="w-12 h-12 bg-slate-900 dark:bg-white dark:text-black text-white rounded-2xl grid place-items-center font-black text-2xl shadow-sm"
          title="Feed"
        >
          A
        </button>

        <nav className="space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`flex items-center gap-4 w-full p-3 rounded-2xl transition-all ${
                currentView === item.id || (currentView === 'settings' && item.id === 'profile')
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <div className="relative">
                <item.icon className="w-6 h-6" />
                {item.badge ? (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] grid place-items-center">
                    {item.badge}
                  </span>
                ) : null}
              </div>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <button
          onClick={onCompose}
          className="w-full bg-slate-900 dark:bg-white dark:text-black text-white rounded-2xl py-3 font-semibold transition-opacity hover:opacity-90"
        >
          Echo Now
        </button>
      </div>

      <div className="space-y-4">
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-4 w-full p-3 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          {darkMode ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
          <span className="font-medium">{darkMode ? 'Light mode' : 'Dark mode'}</span>
        </button>

        <button
          onClick={() => onChangeView('settings')}
          className={`flex items-center gap-4 w-full p-3 rounded-2xl transition-all ${
            currentView === 'settings'
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
              : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <ICONS.Settings className="w-6 h-6" />
          <span className="font-medium">Settings</span>
        </button>

        <button
          onClick={() => onChangeView('profile')}
          className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="relative">
            {user.status ? (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 text-white dark:bg-white dark:text-black px-2 py-0.5 text-[10px] font-semibold max-w-[120px] truncate">
                {user.status}
              </span>
            ) : null}
            <img src={userAvatar(user)} alt={user.username} className="w-10 h-10 rounded-xl object-cover" />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-black ${
                isUserOnline(user) ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
              title={isUserOnline(user) ? 'online' : 'offline'}
            />
          </div>
          <div className="min-w-0 text-left">
            <p className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
              <span className="truncate">{user.displayName}</span>
              <RoleBadge user={user} />
            </p>
            <p className="text-sm text-slate-500 truncate">@{user.username}</p>
          </div>
        </button>

        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-300 dark:border-slate-700 py-2.5 font-semibold"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
