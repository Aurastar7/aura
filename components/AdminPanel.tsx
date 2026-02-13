import React, { useState } from 'react';
import { NotificationItem, Post, Story, User, UserRole } from '../types';

interface AdminPanelProps {
  currentAdmin: User;
  users: User[];
  posts: Post[];
  stories: Story[];
  notifications: NotificationItem[];
  onRoleChange: (userId: string, role: UserRole) => void;
  onBanToggle: (userId: string, value: boolean) => void;
  onRestrictToggle: (userId: string, value: boolean) => void;
  onVerifyToggle: (userId: string, value: boolean) => void;
  onDeletePost: (postId: string) => void;
  onDeleteStory: (storyId: string) => void;
  onClearNetworkData: () => void;
  onResetAllData: () => void;
  onExportSql: () => Promise<void>;
  onImportSql: (file: File) => Promise<void>;
}

const roles: UserRole[] = ['user', 'moderator', 'curator', 'admin'];

const AdminPanel: React.FC<AdminPanelProps> = ({
  currentAdmin,
  users,
  posts,
  stories,
  notifications,
  onRoleChange,
  onBanToggle,
  onRestrictToggle,
  onVerifyToggle,
  onDeletePost,
  onDeleteStory,
  onClearNetworkData,
  onResetAllData,
  onExportSql,
  onImportSql,
}) => {
  const [sqlBusy, setSqlBusy] = useState(false);
  const nonAdminUsers = users.filter((user) => user.id !== currentAdmin.id);

  const handleSqlExport = async () => {
    setSqlBusy(true);
    try {
      await onExportSql();
    } finally {
      setSqlBusy(false);
    }
  };

  const handleSqlImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSqlBusy(true);
    try {
      await onImportSql(file);
    } finally {
      setSqlBusy(false);
    }
  };

  return (
    <div className="pb-24 lg:pb-6">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl md:text-2xl font-black">Admin Panel</h1>
        <p className="text-sm text-slate-500 dark:text-slate-300">Moderation, privileges, and network monitoring.</p>
      </header>

      <section className="px-6 py-4 grid md:grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs text-slate-500">Users</p>
          <p className="text-2xl font-black">{users.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs text-slate-500">Posts</p>
          <p className="text-2xl font-black">{posts.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs text-slate-500">Stories</p>
          <p className="text-2xl font-black">{stories.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs text-slate-500">Events</p>
          <p className="text-2xl font-black">{notifications.length}</p>
        </div>
      </section>

      <section className="px-6 py-2 flex flex-wrap gap-2">
        <button
          onClick={onClearNetworkData}
          className="rounded-xl px-3 py-2 text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-black"
        >
          Clear network data
        </button>
        <button
          onClick={onResetAllData}
          className="rounded-xl px-3 py-2 text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-black"
        >
          Reset database
        </button>
        <button
          onClick={handleSqlExport}
          disabled={sqlBusy}
          className="rounded-xl px-3 py-2 text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-black disabled:opacity-60"
        >
          {sqlBusy ? 'Preparing SQL...' : 'Download SQL backup'}
        </button>
        <label className="rounded-xl px-3 py-2 text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-black cursor-pointer disabled:opacity-60">
          Upload SQL backup
          <input
            type="file"
            accept=".sql,text/plain,application/sql"
            className="hidden"
            onChange={handleSqlImport}
            disabled={sqlBusy}
          />
        </label>
      </section>

      <section className="px-6 py-4">
        <h2 className="font-bold mb-2">Users and privileges</h2>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="text-left px-3 py-2">User</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-left px-3 py-2">Verified</th>
                <th className="text-left px-3 py-2">Restricted</th>
                <th className="text-left px-3 py-2">Banned</th>
              </tr>
            </thead>
            <tbody>
              {nonAdminUsers.map((candidate) => (
                <tr key={candidate.id} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="px-3 py-2">
                    <p className="font-semibold">{candidate.displayName}</p>
                    <p className="text-xs text-slate-500">@{candidate.username}</p>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={candidate.role}
                      onChange={(event) => onRoleChange(candidate.id, event.target.value as UserRole)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-2 py-1"
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={candidate.verified}
                      onChange={(event) => onVerifyToggle(candidate.id, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={candidate.restricted}
                      onChange={(event) => onRestrictToggle(candidate.id, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={candidate.banned}
                      onChange={(event) => onBanToggle(candidate.id, event.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="px-6 pb-4 grid md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
          <h3 className="font-bold">Posts moderation</h3>
          <div className="mt-2 max-h-64 overflow-auto space-y-2">
            {posts.length > 0 ? (
              posts.map((post) => (
                <div key={post.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 flex items-center justify-between gap-2">
                  <p className="text-xs line-clamp-2">{post.text || '(media post)'}</p>
                  <button
                    onClick={() => onDeletePost(post.id)}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No posts.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
          <h3 className="font-bold">Stories moderation</h3>
          <div className="mt-2 max-h-64 overflow-auto space-y-2">
            {stories.length > 0 ? (
              stories.map((story) => (
                <div key={story.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 flex items-center justify-between gap-2">
                  <p className="text-xs line-clamp-2">{story.caption || '(story without caption)'}</p>
                  <button
                    onClick={() => onDeleteStory(story.id)}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No stories.</p>
            )}
          </div>
        </div>
      </section>

      <section className="px-6 pb-6">
        <h3 className="font-bold mb-2">Recent monitoring events</h3>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {notifications.length > 0 ? (
            notifications.slice(0, 20).map((event) => (
              <div key={event.id} className="px-3 py-2 border-t first:border-t-0 border-slate-200 dark:border-slate-800 text-sm">
                <p>{event.text}</p>
                <p className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-slate-500">No events yet.</p>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminPanel;
