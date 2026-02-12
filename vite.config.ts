import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiProxyTarget = env.VITE_DEV_API_PROXY || env.VITE_API_URL;
    const wsProxyTarget =
      env.VITE_DEV_WS_PROXY ||
      (apiProxyTarget
        ? apiProxyTarget.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
        : undefined);

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy:
          apiProxyTarget && wsProxyTarget
            ? {
                '/api': {
                  target: apiProxyTarget,
                  changeOrigin: true,
                },
                '/ws': {
                  target: wsProxyTarget,
                  ws: true,
                },
              }
            : undefined,
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
