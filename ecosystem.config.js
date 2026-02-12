module.exports = {
  apps: [
    {
      name: 'aura-backend',
      script: 'server/sync-server.mjs',
      instances: 4,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 2000,
      min_uptime: '10s',
      max_restarts: 20,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      time: true,
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
