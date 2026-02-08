<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Aura Social: PostgreSQL + WebSocket backend

## Local run

Prerequisites:
- Node.js 20+
- PostgreSQL 14+

1. Install dependencies:
   `npm install`
2. Set env vars:
   - `DATABASE_URL=postgresql://user:password@localhost:5432/aura_social`
   - optional `PGSSL=false` for local non-SSL postgres
   - optional `VITE_API_URL=http://localhost:3001` (empty by default in local dev)
3. Start web + backend:
   `npm run dev`

Services:
- Web UI: `http://localhost:3000`
- Backend API + WebSocket: `http://localhost:3001` (`/api/*`, `/ws`)

## Backend storage

Backend now uses PostgreSQL table `aura_state` with revision-based updates:
- optimistic concurrency (`revision`)
- conflict-safe writes
- reliable persistence for multi-device access

SQL bootstrap file:
- `server/sql/init.sql`

## Render deployment

Use two services:
- Backend (Node service):
  - Start command: `npm run start:sync`
  - Env: `DATABASE_URL` (Render Postgres URL), optional `PGSSL=true`
- Frontend (Static site):
  - Build command: `npm run build`
  - Publish directory: `dist`
  - Env: `VITE_API_URL=https://<your-backend>.onrender.com`

## API URL in frontend

```ts
import { API_URL } from '../services/api';

fetch(`${API_URL}/api/db`);
```

`API_URL` is configured in `config/api.ts` and exported through `services/api.ts`.
