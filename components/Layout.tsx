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
    const applyViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    };

    applyViewportHeight();
    window.addEventListener('resize', applyViewportHeight);
    window.addEventListener('orientationchange', applyViewportHeight);
    window.visualViewport?.addEventListener('resize', applyViewportHeight);

    return () => {
      window.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('orientationchange', applyViewportHeight);
      window.visualViewport?.removeEventListener('resize', applyViewportHeight);
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
    <div className="min-h-[var(--app-height)] w-full overflow-x-hidden bg-slate-50 dark:bg-black transition-colors">
      <div className="min-h-[var(--app-height)] w-full max-w-[1440px] mx-auto flex items-start justify-center">
        <div className="hidden lg:block w-72 shrink-0 self-start sticky top-0 h-[var(--app-height)] border-r-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
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
        </div>

        <main className="flex-1 w-full max-w-3xl border-r-0 xl:border-r-2 border-slate-200 dark:border-slate-800 min-h-screen bg-white dark:bg-black pt-14 lg:pt-0 pb-[calc(env(safe-area-inset-bottom)+72px)] lg:pb-0">
          {children}
        </main>

        <div className="hidden xl:block w-80 xl:w-96 shrink-0 self-start sticky top-0 h-[var(--app-height)] p-4 overflow-y-auto bg-slate-50 dark:bg-black">
          {rightPanel}
        </div>
      </div>

      <div className="lg:hidden fixed top-0 inset-x-0 z-40 border-b-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-black px-4 py-3 flex items-center justify-between">
        <button onClick={() => onChangeView('feed')} className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white font-black grid place-items-center">A</button>
        <div className="flex items-center gap-2">
          <button onClick={onCompose} className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white grid place-items-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v16m8-8H4" /></svg>
          </button>
          <button onClick={onToggleTheme} className="w-9 h-9 rounded-xl border border-slate-300 dark:border-slate-700 grid place-items-center text-xs font-bold">
            {darkMode ? 'L' : 'D'}
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
