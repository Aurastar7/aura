import React, { useMemo, useRef, useState } from 'react';
import { ActionResult, User } from '../types';
import { userAvatar } from '../utils/ui';
import RoleBadge from './RoleBadge';

interface SettingsProps {
  currentUser: User;
  onBack: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<ActionResult> | ActionResult;
  onRequestEmailChange: (newEmail: string) => Promise<ActionResult> | ActionResult;
  onConfirmEmailChange: (code: string) => Promise<ActionResult> | ActionResult;
}

const CODE_LENGTH = 6;

const Settings: React.FC<SettingsProps> = ({
  currentUser,
  onBack,
  onChangePassword,
  onRequestEmailChange,
  onConfirmEmailChange,
}) => {
  const [message, setMessage] = useState<ActionResult | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmingEmail, setConfirmingEmail] = useState(false);
  const [digits, setDigits] = useState(Array.from({ length: CODE_LENGTH }, () => ''));
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);

  const verificationCode = useMemo(() => digits.join('').trim(), [digits]);

  const updateDigit = (index: number, value: string) => {
    const next = value.replace(/\\D/g, '').slice(-1);
    setDigits((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });

    if (next && index < CODE_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    setDigits(Array.from({ length: CODE_LENGTH }, (_, i) => pasted[i] || ''));
    const lastIndex = Math.min(pasted.length, CODE_LENGTH) - 1;
    if (lastIndex >= 0) {
      setTimeout(() => digitRefs.current[Math.min(lastIndex + 1, CODE_LENGTH - 1)]?.focus(), 0);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingPassword) return;

    if (!currentPassword || newPassword.length < 6) {
      setMessage({ ok: false, message: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ ok: false, message: 'Passwords do not match.' });
      return;
    }

    setSavingPassword(true);
    try {
      const result = await Promise.resolve(onChangePassword(currentPassword, newPassword));
      setMessage(result);
      if (result.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (error: any) {
      setMessage({ ok: false, message: String(error?.message || 'Failed to update password.') });
    } finally {
      setSavingPassword(false);
    }
  };

  const sendEmailCode = async () => {
    if (sendingEmail) return;
    const email = String(newEmail || '').trim();
    if (!email) {
      setMessage({ ok: false, message: 'Enter new email.' });
      return;
    }
    setSendingEmail(true);
    try {
      const result = await Promise.resolve(onRequestEmailChange(email));
      setMessage(result);
      if (result.ok) {
        setDigits(Array.from({ length: CODE_LENGTH }, () => ''));
        setTimeout(() => digitRefs.current[0]?.focus(), 0);
      }
    } catch (error: any) {
      setMessage({ ok: false, message: String(error?.message || 'Failed to request email change.') });
    } finally {
      setSendingEmail(false);
    }
  };

  const submitEmailConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmingEmail) return;
    if (verificationCode.length !== CODE_LENGTH) {
      setMessage({ ok: false, message: 'Enter 6-digit code.' });
      return;
    }
    setConfirmingEmail(true);
    try {
      const result = await Promise.resolve(onConfirmEmailChange(verificationCode));
      setMessage(result);
      if (result.ok) {
        setDigits(Array.from({ length: CODE_LENGTH }, () => ''));
        setNewEmail('');
      }
    } catch (error: any) {
      setMessage({ ok: false, message: String(error?.message || 'Failed to confirm email change.') });
    } finally {
      setConfirmingEmail(false);
    }
  };

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-6">
      <header className="px-6 py-4 border-b-2 border-slate-200 dark:border-slate-800 flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold"
        >
          Back
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">Settings</h1>
          <p className="text-sm text-slate-500 truncate">Account preferences and security</p>
        </div>
      </header>

      <div className="p-4 space-y-4">
        <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 p-4 flex items-center gap-3">
          <img src={userAvatar(currentUser)} alt={currentUser.username} className="w-12 h-12 rounded-2xl object-cover" />
          <div className="min-w-0">
            <p className="font-bold truncate flex items-center gap-1.5">
              <span className="truncate">{currentUser.displayName}</span>
              <RoleBadge user={currentUser} />
            </p>
            <p className="text-sm text-slate-500 truncate">@{currentUser.username}</p>
          </div>
        </section>

        <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-lg font-black">Change password</h2>
          <p className="text-sm text-slate-500 mt-1">Use a strong password (6+ characters).</p>

          <form onSubmit={submitPassword} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Current password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="mt-1 w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-1 w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
                autoComplete="new-password"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
                autoComplete="new-password"
                required
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white px-4 py-2 text-sm font-bold disabled:opacity-60"
            >
              {savingPassword ? 'Saving...' : 'Update password'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-lg font-black">Change email</h2>
          <p className="text-sm text-slate-500 mt-1">
            We will send a 6-digit code to your new email to confirm the change.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">New email</span>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm"
              />
            </label>

            <button
              type="button"
              onClick={sendEmailCode}
              disabled={sendingEmail}
              className="rounded-xl border-2 border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-bold disabled:opacity-60"
            >
              {sendingEmail ? 'Sending...' : 'Send code'}
            </button>

            <form onSubmit={submitEmailConfirm} className="space-y-3">
              <div onPaste={handleDigitPaste} className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">Enter code</p>
                <div className="flex items-center justify-between gap-2">
                  {digits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(node) => {
                        digitRefs.current[index] = node;
                      }}
                      value={digit}
                      onChange={(event) => updateDigit(index, event.target.value)}
                      onKeyDown={(event) => handleDigitKeyDown(index, event)}
                      inputMode="numeric"
                      maxLength={1}
                      className="w-11 h-12 text-center text-lg rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-black outline-none"
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={confirmingEmail}
                className="rounded-xl bg-slate-900 dark:bg-white dark:text-black text-white px-4 py-2 text-sm font-bold disabled:opacity-60"
              >
                {confirmingEmail ? 'Confirming...' : 'Confirm email'}
              </button>
            </form>
          </div>
        </section>

        {message ? (
          <p
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              message.ok
                ? 'bg-emerald-100 text-emerald-700 dark:bg-white dark:text-black'
                : 'bg-rose-100 text-rose-700 dark:bg-white dark:text-black'
            }`}
          >
            {message.message}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default Settings;
