# Project Command Center — Design Spec

## Overview

A local web dashboard that tracks all of Jonathan's projects, the services they use, which accounts are associated, and their current status. Two-part system: a Node.js filesystem scanner that auto-detects project configurations, and a local Express server that serves an interactive spreadsheet-style dashboard with inline editing and auto-save.

## Problem

~42 projects spread across multiple services (GitHub, Vercel, Expo, Firebase, Supabase, Cloudflare, Netlify) under 3 different email accounts (jonmlucia@gmail.com, structma@yahoo.com, jonathan@cinnamon.news). No single place to see what's where, which account owns what, or what's active vs abandoned.

## Architecture

```
~/project-dashboard/
├── server.mjs              # Express server (~40 lines), port 3333
├── scanner.mjs             # Filesystem crawler for ~/
├── dashboard.html          # Single-file spreadsheet UI
├── projects-data.json      # Scanner output (auto-generated, overwritten each scan)
├── user-data.json           # User edits (notes, status, type, accounts — never overwritten by scanner)
├── dash.sh                 # Opens browser to localhost:3333
├── package.json            # express dependency
└── com.jonathanlucia.command-center.plist  # LaunchAgent (symlinked to ~/Library/LaunchAgents/)
```

### Data Separation

The scanner writes `projects-data.json` with auto-detected facts (services, git remotes, package names, env var names). User annotations (status, type, notes, account assignments) live in `user-data.json` and are never touched by the scanner. The server merges both at load time: scanner data provides the base, user-data fields are overlaid per project key, with user-data winning for any shared fields. If either file is missing (e.g., first run), the server returns an empty project list gracefully.

## Scanner (scanner.mjs)

Crawls first-level directories under `~/` (skipping non-project dirs like Library, Music, etc.). For monorepo projects, also peeks one level into `apps/` and `packages/` subdirectories for service config files (e.g., `wrangler.toml`, `app.json`, `.firebaserc`). Detects:

| Service | Detection Method |
|---------|-----------------|
| GitHub | `.git/config` → extract origin remote URL |
| Vercel | `.vercel/project.json` → orgId, projectId |
| Expo | `app.json` or `app.config.js` → slug, projectId, owner |
| Firebase | `.firebaserc` → project ID; `firebase.json` presence |
| Supabase | `.env*` files containing `SUPABASE_URL`; `supabase/` directory; `@supabase/supabase-js` in package.json |
| Cloudflare | `wrangler.toml` or `wrangler.jsonc` → worker name, D1 bindings; `opennextjs-cloudflare` in dependencies |
| Netlify | `netlify.toml` presence; `.netlify/state.json` → site ID |

Also extracts:
- **Package name** from `package.json`
- **Notable env var names** (not values) from `.env*` files — only service-related ones (SUPABASE_*, FIREBASE_*, API keys, etc.)

### Scanner Output Format (projects-data.json)

```json
{
  "scanDate": "2026-03-13T10:30:00Z",
  "scanDir": "/Users/jonathanlucia",
  "projects": {
    "ovl": {
      "path": "/Users/jonathanlucia/ovl",
      "packageName": "myoval-monorepo",
      "services": {
        "github": { "remote": "github.com/StructureMA/myoval.git" },
        "expo": { "projectId": "7d7d9839-fca5-487a-9994-783c1098784f" },
        "firebase": { "projectId": "oval-8740f" },
        "cloudflare": true
      },
      "envVars": ["ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID"]
    }
  }
}
```

## Server (server.mjs)

Tiny Express server with 4 endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves `dashboard.html` |
| `/api/data` | GET | Reads and merges `projects-data.json` + `user-data.json`, returns combined JSON |
| `/api/save` | POST | Writes request body to `user-data.json` |
| `/api/scan` | POST | Runs `scanner.mjs` as child process, returns updated data when complete |

Port: **3333**

## User Data Format (user-data.json)

```json
{
  "accounts": [
    { "email": "jonmlucia@gmail.com", "label": "Primary", "color": "#8b5cf6" },
    { "email": "structma@yahoo.com", "label": "Legacy", "color": "#f59e0b" },
    { "email": "jonathan@cinnamon.news", "label": "Cinnamon", "color": "#10b981" }
  ],
  "projects": {
    "ovl": {
      "status": "active",
      "type": "mobile",
      "notes": "Deep Agent, on TestFlight",
      "accounts": {
        "default": "jonmlucia@gmail.com"
      }
    },
    "portfolio": {
      "status": "active",
      "type": "website",
      "notes": "Custom domain on Cloudflare",
      "accounts": {
        "vercel": "jonmlucia@gmail.com",
        "cloudflare": "structma@yahoo.com"
      }
    }
  }
}
```

### Project Status Values
- `active` — currently being worked on
- `paused` — on hold, will return to it
- `archived` — done or abandoned

### Project Type Values
- `mobile` — Expo/React Native app
- `webapp` — Next.js, Vite, or other web application
- `website` — Marketing site, portfolio, static site
- `backend` — API, Cloudflare Worker, CLI tool
- `library` — Shared package, SDK

### Account Assignment

Each project has an `accounts` object. The `default` key applies to all services unless overridden by a service-specific key (e.g., `"vercel": "structma@yahoo.com"`). This handles the case where different services are under different accounts.

## Dashboard (dashboard.html)

Single HTML file with embedded CSS and JS. No build step, no framework.

### Layout

1. **Top bar** — Title, project count, last scan timestamp, search input, re-scan button
2. **Filter pills** — Status filters (All, Active, Paused, Archived) + Type filters (Mobile, Web App, Website, Backend, Library)
3. **Spreadsheet table** — The main view

### Table Columns

| Column | Content | Editable |
|--------|---------|----------|
| Project | Directory name + package name | No (auto-detected) |
| Type | Mobile/Web App/Website/Backend/Library | Yes (dropdown) |
| Status | Active/Paused/Archived | Yes (dropdown) |
| GitHub | ✓ or — | No (auto-detected) |
| Vercel | ✓ or — | No (auto-detected) |
| Expo | ✓ or — | No (auto-detected) |
| Firebase | ✓ or — | No (auto-detected) |
| Supabase | ✓ or — | No (auto-detected) |
| Cloudflare | ✓ or — | No (auto-detected) |
| Netlify | ✓ or — | No (auto-detected) |
| Account | Email(s) associated | Yes (in expanded row) |
| Notes | Free-text notes | Yes (in expanded row) |

### Interactions

- **Search** — filters rows by project name, package name, or notes content
- **Filter pills** — toggle to show/hide by status or type
- **Column header click** — sort ascending/descending
- **Row click** — expands an inline edit panel below the row with:
  - Status dropdown
  - Type dropdown
  - Notes text field
  - Per-service account dropdowns (only shown for services the project uses)
- **Auto-save** — changes POST to `/api/save` on field blur, with a subtle "saved" indicator
- **Re-scan loading** — shows a spinner overlay with "Scanning..." while `/api/scan` is in progress
- **Default sort** — alphabetical by directory name on initial load

### Styling

- Dark theme (background `#0f1219`)
- Sticky first column (project name) for horizontal scrolling
- Color-coded status badges (green=active, amber=paused, gray=archived)
- Color-coded account emails (each account gets a consistent color)
- Hover highlight on rows

## Automation

### macOS LaunchAgent

`com.jonathanlucia.command-center.plist` — starts `server.mjs` on login, restarts on failure.

Symlinked to `~/Library/LaunchAgents/`.

### Shell Alias

`dash.sh` — opens `http://localhost:3333` in the default browser.

Added as alias to shell profile: `alias dash="~/project-dashboard/dash.sh"`

## Workflow

1. **Login to Mac** → LaunchAgent auto-starts server in background
2. **Type `dash`** → browser opens to dashboard
3. **Browse/search/filter** → see all projects at a glance
4. **Click to edit** → change status, type, notes, accounts — auto-saves
5. **Hit "Re-scan"** → scanner re-crawls `~/`, refreshes auto-detected data, preserves user edits

## Seed Data

The scanner output will be pre-populated from the initial scan. User data will be seeded with:
- 3 known accounts (jonmlucia@gmail.com, structma@yahoo.com, jonathan@cinnamon.news)
- Status/type/notes for projects with known context from memory (ovl, myfam, portfolio, oval, cinnamon, etc.)

## Out of Scope

- Multi-user support
- Remote access / hosting
- Git status or branch tracking
- Deployment status from services
- Cost tracking across services
- Automatic account detection (user manually assigns accounts)
