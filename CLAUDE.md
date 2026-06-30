# MediaVault — Project Context

Self-hosted media app: React (Vite) frontend + Express/SQLite backend, streams
from a seedbox over SSH. No Plex dependency.

## Layout
- `src/` — React frontend (Vite). Pages in `src/pages/`, layout in `src/components/layout/`.
- `server/` — Express API. Routes in `server/routes/`, services in `server/services/`.
- Frontend served from `dist/` in production (built by Vite).

## Local dev
- `npm run dev` — Vite dev server on **http://localhost:3000** (proxies `/api` → :3001).
- `npm run server` — backend on **:3001**.
- `npm run dev:all` — both together.
- This machine: `NucBox_K16` (Windows). Dev server reads `src/` live; **production serves built `dist/`** — rebuild needed for prod.

## Production deploy (Hostinger VPS)
- Live site: `media.baseinthe.cloud`. Deployed over SSH from this machine (ask the user to confirm host/user/credentials each session — not stored here).
- Project on VPS: **`/docker/mediavault`**.
- Served via **Docker + Traefik** (container `mediavault`, image `mediavault:latest`, internal port 3001).
- Dockerfile builds the frontend inside the image (`npm run build`), so deploying = rebuild image.
- Deploy steps (run on VPS in `/docker/mediavault`):
  1. `git pull`  (repo: github.com/KJ2kDK/mediavault, branch `master`)
  2. `docker compose build && docker compose up -d`
- NOTE: production only updates after commit → push → VPS pull → rebuild. Local edits alone never change the live site.

## RBAC / auth
- JWT auth wall (`server/middleware/auth.js`), then per-user view grants + read-only seedbox (`server/middleware/permissions.js`).
- Admin-only routes use `requireAdmin`. Non-admin → 403.
- Frontend gating in `MainLayout.jsx` (role + `allowedViews`) is UX only; the server middleware is the real wall.

## Conventions
- Tailwind with `vault-*` custom tokens (accent, card, border, muted, gold, teal).
- Global `fetch` wrapper in `src/App.jsx` auto-attaches the JWT to `/api/*` calls.
- Seedbox file ops go over SSH via `server/services/seedbox.js` (`exec`, `listDir`, etc.). Always confine paths to the media root.

## Recent work (uncommitted as of this note)
- LibraryPage: multi-select + delete **movies** (`POST /api/seedbox/delete`).
- Admin-only **File Manager**: `server/routes/files.js` (+ `/api/files` mount), `src/pages/FileManagerPage.jsx`, sidebar entry. Confined to media root.
- Renamed "Library" menu label → **"WhutBux?"** (`Sidebar.jsx`, `TopBar.jsx`).
