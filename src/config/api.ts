const env = (import.meta as any).env as Record<string, string | undefined> | undefined;

export const API_URL = (env?.VITE_API_URL || '').replace(/\/$/, '');
