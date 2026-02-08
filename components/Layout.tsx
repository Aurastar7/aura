import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import { ICONS } from '../constants';
import { AppView, User } from '../types';

interface LayoutProps {
  user: User;
  currentView: AppView;
  darkMode: boolean;
  unreadCount: number;
  unreadMessagesCount: number;
  canOpenAdmin: boolean;
  rightPanel: React.ReactNode;
  children: React.ReactNode;
  onChangeView: (view: AppView) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onCompose: () => void;
}

const Layout: React.FC<LayoutProps> = ({
  user,
  currentView,
  darkMode,
  unreadCount,
  unreadMessagesCount,
  canOpenAdmin,
  rightPanel,
  children,
  onChangeView,
  onToggleTheme,
  onLogout,
  onCompose,
}) => {
  useEffect(() => {
    const root = document.documentElement;
    let timer: number | null = null;

    const applyViewportHeight = () => {
      const height = window.innerHeight;
      const nextVh = `${height * 0.01}px`;
      const nextAppHeight = `${height}px`;
      if (root.style.getPropertyValue('--vh') !== nextVh) {
        root.style.setProperty('--vh', nextVh);
      }
      if (root.style.getPropertyValue('--app-height') !== nextAppHeight) {
        root.style.setProperty('--app-height', nextAppHeight);
      }
    };

    const scheduleViewportHeight = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        applyViewportHeight();
      }, 120);
    };

    applyViewportHeight();
    window.addEventListener('resize', scheduleViewportHeight, { passive: true });
    window.addEventListener('orientationchange', scheduleViewportHeight, { passive: true });

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', scheduleViewportHeight);
      window.removeEventListener('orientationchange', scheduleViewportHeight);
    };
  }, []);

  const mobileItems: AppView[] = ['feed', 'explore', 'groups', 'notifications', 'messages', 'profile'];

  const iconByView: Record<AppView, React.FC<any>> = {
    feed: ICONS.Home,
    explore: ICONS.Explore,
    groups: ICONS.Group,
    notifications: ICONS.Notifications,
    messages: ICONS.Messages,
    profile: ICONS.Profile,
    admin: ICONS.Shield,
  };

  return (
    <div className="min-h-[var(--app-height)] w-full bg-slate-50 dark:bg-black transition-colors">
      <div className="min-h-[var(--app-height)] w-full max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[288px_minmax(0,1fr)_384px]">
        <aside className="hidden lg:block sticky top-0 h-[var(--app-height)] border-r-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
          <Sidebar
            user={user}
            currentView={currentView}
            darkMode={darkMode}
            unreadCount={unreadCount}
            unreadMessagesCount={unreadMessagesCount}
            canOpenAdmin={canOpenAdmin}
            onChangeView={onChangeView}
            onToggleTheme={onToggleTheme}
            onLogout={onLogout}
            onCompose={onCompose}
          />
        </aside>

        <main className="w-full min-w-0 max-w-none xl:max-w-3xl border-r-0 xl:border-r-2 border-slate-200 dark:border-slate-800 min-h-[var(--app-height)] bg-white dark:bg-black pt-[calc(env(safe-area-inset-top)+56px)] lg:pt-0 pb-[calc(env(safe-area-inset-bottom)+72px)] lg:pb-0">
          {children}
        </main>

        <aside className="hidden xl:block sticky top-0 h-[var(--app-height)] p-4 overflow-y-auto bg-slate-50 dark:bg-black">
          {rightPanel}
        </aside>
      </div>

      <div className="lg:hidden fixed top-0 inset-x-0 z-40 border-b-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black px-4 py-3 pt-[calc(env(safe-area-inset-top)+12px)] flex items-center justify-between">
        <button onClick={() => onChangeView('feed')} className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white font-black grid place-items-center">A</button>
        <div className="flex items-center gap-2">
          <button onClick={onCompose} className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white grid place-items-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v16m8-8H4" /></svg>
          </button>
          <button onClick={onToggleTheme} className="w-9 h-9 rounded-xl border border-slate-300 dark:border-slate-700 grid place-items-center text-xs font-bold">
            {darkMode ? 'L' : 'D'}
          </button>
          <button
            onClick={onLogout}
            className="w-9 h-9 rounded-xl border border-slate-300 dark:border-slate-700 grid place-items-center"
            title="Logout"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-7.5A2.25 2.25 0 0 0 3.75 5.25v13.5A2.25 2.25 0 0 0 6 21h7.5a2.25 2.25 0 0 0 2.25-2.25V15m-3-3h9m0 0-3-3m3 3-3 3" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6">
          {mobileItems.map((view) => {
            const Icon = iconByView[view];
            const active = currentView === view;
            return (
              <button key={view} onClick={() => onChangeView(view)} className="py-2.5 grid place-items-center relative">
                <span className={`w-10 h-10 rounded-xl grid place-items-center ${active ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                  <Icon className="w-5 h-5" />
                </span>
                {(view === 'notifications' && unreadCount > 0) || (view === 'messages' && unreadMessagesCount > 0) ? (
                  <span className="absolute top-1 right-1/2 translate-x-4 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] grid place-items-center">
                    {view === 'notifications' ? unreadCount : unreadMessagesCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default Layout;
