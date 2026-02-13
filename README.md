# Aura Social (VPS Deployment)

## Required environment

Copy `.env.example` to `.env` and set real values:

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `JWT_SECRET`
- `ADMIN_EMAILS`
- `BOOTSTRAP_ADMIN_ENABLED`
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_DISPLAY_NAME`
- `VITE_API_URL`
- `CORS_ORIGIN`

## Commands

- Install: `npm install`
- Migrate DB: `npm run migrate`
- Build frontend: `npm run build`
- Run backend: `npm run start`

## Deployment files

- PostgreSQL schema: `server/db/schema.sql`
- Pool config: `server/config/database.ts`
- PM2 config: `ecosystem.config.js`
- Nginx config: `nginx/aura.conf`

## Features

- Telegram-like direct dialog model (`dialogs`, `dialog_members`, `messages.dialog_id`)
- Redis feed caching
- Redis chat list caching
- Email verification with 6-digit code
- Admin moderation API (`/api/admin/users/:id`)
- SQL backup/restore from admin panel (`/api/admin/sql/export`, `/api/admin/sql/import`)
- Auto schema init on backend start + bootstrap admin seed for first run
