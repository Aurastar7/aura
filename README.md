# Aura Social (VPS Deployment)

## Required environment

Copy `.env.example` to `.env` and set real values:

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
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
