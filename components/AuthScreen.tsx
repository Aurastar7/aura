import React, { useMemo, useRef, useState } from 'react';
import { ActionResult } from '../types';

interface AuthScreenProps {
  onLogin: (username: string, password: string) => Promise<ActionResult> | ActionResult;
  onRegister: (
    displayName: string,
    username: string,
    email: string,
    password: string
  ) => Promise<ActionResult> | ActionResult;
  onVerify: (code: string) => Promise<ActionResult> | ActionResult;
  darkMode: boolean;
  onToggleTheme: () => void;
}

const CODE_LENGTH = 6;

const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  onRegister,
  onVerify,
  darkMode,
  onToggleTheme,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState(Array.from({ length: CODE_LENGTH }, () => ''));
  const [message, setMessage] = useState<ActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);

  const verificationCode = useMemo(() => digits.join('').trim(), [digits]);

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const result = await Promise.resolve(
      mode === 'login'
        ? onLogin(username, password)
        : onRegister(displayName, username, email, password)
    );
    setSubmitting(false);

    setMessage(result);
    if (!result.ok) return;

    if (mode === 'register') {
      setMode('verify');
      setPassword('');
      setTimeout(() => digitRefs.current[0]?.focus(), 0);
      return;
    }

    setPassword('');
  };

  const submitVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const result = await Promise.resolve(onVerify(verificationCode));
    setSubmitting(false);
    setMessage(result);
  };

  const updateDigit = (index: number, value: string) => {
    const next = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });

    if (next && index < CODE_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white flex items-center justify-center px-4 py-12 transition-colors">
      <button
        onClick={onToggleTheme}
        className="absolute top-4 right-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 text-sm font-semibold"
      >
        {darkMode ? 'Light mode' : 'Dark mode'}
      </button>

      <div className="w-full max-w-xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-black p-6 md:p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-300 font-semibold">Aura Social</p>
        <h1 className="mt-2 text-3xl font-black">Welcome</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Secure sign in with email verification.
        </p>

        {mode !== 'verify' ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 p-1">
              <button
                onClick={() => setMode('login')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  mode === 'login'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                    : 'text-slate-500 dark:text-slate-300'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setMode('register')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  mode === 'register'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                    : 'text-slate-500 dark:text-slate-300'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={submitAuth} className="mt-6 space-y-4">
              {mode === 'register' && (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Display name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                    className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 outline-none"
                    required
                  />
                </label>
              )}

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Username</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="username"
                  className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 outline-none"
                  required
                />
              </label>

              {mode === 'register' && (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 outline-none"
                    required
                  />
                </label>
              )}

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="password"
                  className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black px-3 py-2 outline-none"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl py-3 bg-slate-900 text-white dark:bg-white dark:text-black font-bold"
              >
                {submitting ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={submitVerify} className="mt-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Enter the 6-digit code from your email.
            </p>
            <div className="flex items-center justify-between gap-2">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(node) => {
                    digitRefs.current[index] = node;
                  }}
                  value={digit}
                  onChange={(event) => updateDigit(index, event.target.value)}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  inputMode="numeric"
                  maxLength={1}
                  className="w-11 h-12 text-center text-lg rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-black outline-none"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl py-3 bg-slate-900 text-white dark:bg-white dark:text-black font-bold"
            >
              {submitting ? 'Please wait...' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('login');
                setDigits(Array.from({ length: CODE_LENGTH }, () => ''));
              }}
              className="w-full rounded-xl py-2 border border-slate-300 dark:border-slate-700"
            >
              Back to login
            </button>
          </form>
        )}

        {message && (
          <p
            className={`mt-4 rounded-xl px-3 py-2 text-sm ${
              message.ok
                ? 'bg-emerald-100 text-emerald-700 dark:bg-white dark:text-black'
                : 'bg-rose-100 text-rose-700 dark:bg-white dark:text-black'
            }`}
          >
            {message.message}
          </p>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
