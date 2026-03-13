# Project Command Center — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local project dashboard that auto-scans ~/projects for service configs and serves a spreadsheet-style UI with inline editing, auto-save, and macOS auto-start.

**Architecture:** Node.js scanner crawls the home directory and writes `projects-data.json`. Express server serves a single-file HTML dashboard, merges scanner + user data via API, and handles saves. LaunchAgent auto-starts server on login; `dash` alias opens the browser.

**Tech Stack:** Node.js (ESM), Express, vanilla HTML/CSS/JS (single file), macOS LaunchAgent

**Spec:** `docs/superpowers/specs/2026-03-13-command-center-design.md`

---

## File Structure

```
~/project-dashboard/
├── package.json              # { "type": "module", dependencies: { "express": "^5" } }
├── scanner.mjs               # Filesystem crawler — reads configs, writes projects-data.json
├── server.mjs                # Express server — 4 endpoints, port 3333
├── dashboard.html            # Single-file spreadsheet UI with embedded CSS/JS
├── seed-user-data.mjs        # One-time script to create initial user-data.json
├── dash.sh                   # Shell script to open browser
├── com.jonathanlucia.command-center.plist  # LaunchAgent definition
├── projects-data.json        # (generated) Scanner output
└── user-data.json            # (generated) User annotations
```

---

## Chunk 1: Scanner + Server Foundation

### Task 1: Project Setup

**Files:**
- Create: `package.json`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "project-dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "scan": "node scanner.mjs"
  },
  "dependencies": {
    "express": "^5.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd ~/project-dashboard && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 3: Add .gitignore**

Create `.gitignore`:
```
node_modules/
projects-data.json
user-data.json
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: initialize project with express dependency"
```

---

### Task 2: Scanner — GitHub Detection

**Files:**
- Create: `scanner.mjs`

- [ ] **Step 1: Write scanner skeleton with GitHub detection**

`scanner.mjs` — The scanner reads first-level directories under a configurable scan directory (defaulting to the user's home dir). It skips known non-project directories. For each remaining directory, it checks for `.git/config` and extracts the origin remote URL via regex.

```javascript
import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';

const SCAN_DIR = process.env.SCAN_DIR || homedir();
const SKIP_DIRS = new Set([
  'Library', 'Movies', 'Music', 'Pictures', 'Public', 'Documents',
  'Downloads', 'Applications', 'Desktop', 'bin', 'go', 'pnpm',
  'node_modules', '.Trash', '.cache', '.npm', '.nvm', '.claude',
  '.superpowers', 'AndroidStudioProjects', 'ApkProjects', 'Sites'
]);

const OUTPUT_FILE = join(import.meta.dirname, 'projects-data.json');

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

// --- Service Detectors ---

async function detectGithub(dir) {
  const config = await readText(join(dir, '.git', 'config'));
  if (!config) return null;
  const match = config.match(/\[remote "origin"\]\s*\n\s*url\s*=\s*(.+)/);
  if (!match) return null;
  const url = match[1].trim()
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^https?:\/\//, '');
  return { remote: url };
}

// --- Main ---

async function scanProjects() {
  const entries = await readdir(SCAN_DIR, { withFileTypes: true });
  const projects = {};

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const dir = join(SCAN_DIR, entry.name);

    const services = {};
    const github = await detectGithub(dir);
    if (github) services.github = github;

    // Only include if it looks like a project (has .git, package.json, or any service detected)
    const hasPkg = await exists(join(dir, 'package.json'));
    if (Object.keys(services).length === 0 && !hasPkg) continue;

    const pkg = await readJson(join(dir, 'package.json'));

    projects[entry.name] = {
      path: dir,
      packageName: pkg?.name || null,
      services,
      envVars: []
    };
  }

  const output = {
    scanDate: new Date().toISOString(),
    scanDir: SCAN_DIR,
    projects
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Scanned ${Object.keys(projects).length} projects → ${OUTPUT_FILE}`);
  return output;
}

scanProjects();
export { scanProjects };
```

- [ ] **Step 2: Run scanner and verify GitHub detection**

Run: `cd ~/project-dashboard && node scanner.mjs`
Expected: `projects-data.json` created with projects that have `services.github.remote` populated for repos with git origins.

- [ ] **Step 3: Commit**

```bash
git add scanner.mjs
git commit -m "feat: add scanner with GitHub detection"
```

---

### Task 3: Scanner — All Service Detectors

**Files:**
- Modify: `scanner.mjs`

- [ ] **Step 1: Add Vercel detector**

Add after `detectGithub`:

```javascript
async function detectVercel(dir) {
  const data = await readJson(join(dir, '.vercel', 'project.json'));
  if (!data) return null;
  return { orgId: data.orgId, projectId: data.projectId };
}
```

- [ ] **Step 2: Add Expo detector**

```javascript
async function detectExpo(dir) {
  const appJson = await readJson(join(dir, 'app.json'));
  const expoConfig = appJson?.expo;
  // Also check for app.config.js/ts presence as fallback
  if (!expoConfig) {
    const hasConfigJs = await exists(join(dir, 'app.config.js')) || await exists(join(dir, 'app.config.ts'));
    if (hasConfigJs) return true;
    return null;
  }
  const result = {};
  if (expoConfig.slug) result.slug = expoConfig.slug;
  if (expoConfig.owner) result.owner = expoConfig.owner;
  if (expoConfig.extra?.eas?.projectId) result.projectId = expoConfig.extra.eas.projectId;
  if (expoConfig.updates?.url) {
    const idMatch = expoConfig.updates.url.match(/\/([a-f0-9-]+)$/);
    if (idMatch && !result.projectId) result.projectId = idMatch[1];
  }
  return Object.keys(result).length > 0 ? result : null;
}
```

- [ ] **Step 3: Add Firebase detector**

```javascript
async function detectFirebase(dir) {
  const rc = await readJson(join(dir, '.firebaserc'));
  const hasConfig = await exists(join(dir, 'firebase.json'));
  if (!rc && !hasConfig) return null;
  const result = {};
  if (rc?.projects?.default) result.projectId = rc.projects.default;
  return Object.keys(result).length > 0 ? result : true;
}
```

- [ ] **Step 4: Add env var scanner and helper (needed by Supabase detector)**

```javascript
async function checkEnvForPattern(dir, pattern) {
  const entries = await readdir(dir).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith('.env')) continue;
    const content = await readText(join(dir, name));
    if (content && pattern.test(content)) return true;
  }
  return false;
}

async function extractEnvVars(dir) {
  const vars = new Set();
  const SERVICE_PATTERNS = /^(SUPABASE_|FIREBASE_|EXPO_PUBLIC_|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE|ANTHROPIC_|OPENAI_|GOOGLE_CLIENT|SLACK_|DISCORD_|GITHUB_PAT|R2_|VAPID_|ELEVENLABS_)/;
  const entries = await readdir(dir).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith('.env')) continue;
    const content = await readText(join(dir, name));
    if (!content) continue;
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
      if (match && SERVICE_PATTERNS.test(match[1])) vars.add(match[1]);
    }
  }
  return [...vars];
}
```

- [ ] **Step 5: Add Supabase detector**

```javascript
async function detectSupabase(dir) {
  // Check for supabase/ directory
  const hasDir = await exists(join(dir, 'supabase'));
  // Check package.json for @supabase/supabase-js
  const pkg = await readJson(join(dir, 'package.json'));
  const hasDep = pkg?.dependencies?.['@supabase/supabase-js'] || pkg?.devDependencies?.['@supabase/supabase-js'];
  // Check .env files for SUPABASE_URL
  const hasEnv = await checkEnvForPattern(dir, /SUPABASE_URL/);
  if (!hasDir && !hasDep && !hasEnv) return null;
  return true;
}
```

- [ ] **Step 6: Add Cloudflare detector**

```javascript
async function detectCloudflare(dir) {
  const wranglerToml = await readText(join(dir, 'wrangler.toml'));
  const wranglerJsonc = await readJson(join(dir, 'wrangler.jsonc'));
  const pkg = await readJson(join(dir, 'package.json'));
  const hasOpenNext = pkg?.dependencies?.['opennextjs-cloudflare'] || pkg?.devDependencies?.['opennextjs-cloudflare'];

  if (!wranglerToml && !wranglerJsonc && !hasOpenNext) return null;

  const result = {};
  if (wranglerToml) {
    const nameMatch = wranglerToml.match(/^name\s*=\s*"(.+)"/m);
    if (nameMatch) result.workerName = nameMatch[1];
  }
  if (wranglerJsonc?.name && !result.workerName) result.workerName = wranglerJsonc.name;
  return Object.keys(result).length > 0 ? result : true;
}
```

- [ ] **Step 7: Add Netlify detector**

```javascript
async function detectNetlify(dir) {
  const hasToml = await exists(join(dir, 'netlify.toml'));
  const state = await readJson(join(dir, '.netlify', 'state.json'));
  if (!hasToml && !state) return null;
  if (state?.siteId) return { siteId: state.siteId };
  return true;
}
```

- [ ] **Step 8: Wire all detectors into the main scan loop**

Update the `for` loop in `scanProjects()`:

```javascript
    const services = {};
    const github = await detectGithub(dir);
    if (github) services.github = github;
    const vercel = await detectVercel(dir);
    if (vercel) services.vercel = vercel;
    const expo = await detectExpo(dir);
    if (expo) services.expo = expo;
    const firebase = await detectFirebase(dir);
    if (firebase) services.firebase = firebase;
    const supabase = await detectSupabase(dir);
    if (supabase) services.supabase = supabase;
    const cloudflare = await detectCloudflare(dir);
    if (cloudflare) services.cloudflare = cloudflare;
    const netlify = await detectNetlify(dir);
    if (netlify) services.netlify = netlify;

    // Also peek into apps/ and packages/ for monorepos
    for (const sub of ['apps', 'packages']) {
      const subDir = join(dir, sub);
      if (!await exists(subDir)) continue;
      const subEntries = await readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;
        const nested = join(subDir, subEntry.name);
        if (!services.expo) { const e = await detectExpo(nested); if (e) services.expo = e; }
        if (!services.firebase) { const f = await detectFirebase(nested); if (f) services.firebase = f; }
        if (!services.cloudflare) { const c = await detectCloudflare(nested); if (c) services.cloudflare = c; }
        if (!services.vercel) { const v = await detectVercel(nested); if (v) services.vercel = v; }
        if (!services.netlify) { const n = await detectNetlify(nested); if (n) services.netlify = n; }
        if (!services.supabase) { const s = await detectSupabase(nested); if (s) services.supabase = s; }
      }
    }

    const hasPkg = await exists(join(dir, 'package.json'));
    if (Object.keys(services).length === 0 && !hasPkg) continue;

    const pkg = await readJson(join(dir, 'package.json'));
    const envVars = await extractEnvVars(dir);

    projects[entry.name] = {
      path: dir,
      packageName: pkg?.name || null,
      services,
      envVars
    };
```

- [ ] **Step 9: Run scanner and verify all detectors**

Run: `cd ~/project-dashboard && node scanner.mjs`
Expected: `projects-data.json` shows Vercel data for projects like `Argu`, `jumove`; Expo data for `myfam`, `argu-mobile`; Firebase for `cinnamon`; Supabase for `mica`, `jumove`; Cloudflare for `whatever`, `portfolio`; Netlify for `mica`, `micast`.

- [ ] **Step 10: Commit**

```bash
git add scanner.mjs
git commit -m "feat: add all service detectors (Vercel, Expo, Firebase, Supabase, Cloudflare, Netlify)"
```

---

### Task 4: Express Server

**Files:**
- Create: `server.mjs`

- [ ] **Step 1: Write server.mjs**

```javascript
import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = import.meta.dirname;
const PORT = process.env.PORT || 3333;

const app = express();
app.use(express.json());

function mergeData(scannerData, userData) {
  const merged = {};
  // Scanner projects as base
  for (const [key, scanProject] of Object.entries(scannerData.projects)) {
    const userProject = userData.projects?.[key] || {};
    merged[key] = { ...scanProject, ...userProject, services: scanProject.services };
  }
  // User-data-only projects (manually added or scanner dir deleted)
  for (const [key, userProject] of Object.entries(userData.projects || {})) {
    if (!merged[key]) {
      merged[key] = { path: null, packageName: null, services: {}, envVars: [], ...userProject };
    }
  }
  return { scanDate: scannerData.scanDate, accounts: userData.accounts || [], projects: merged };
}

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'dashboard.html'));
});

// Merge scanner data + user data
app.get('/api/data', async (req, res) => {
  let scannerData = { scanDate: null, scanDir: '', projects: {} };
  let userData = { accounts: [], projects: {} };

  try { scannerData = JSON.parse(await readFile(join(__dirname, 'projects-data.json'), 'utf8')); } catch {}
  try { userData = JSON.parse(await readFile(join(__dirname, 'user-data.json'), 'utf8')); } catch {}

  const merged = mergeData(scannerData, userData);
  res.json(merged);
});

// Save user data
app.post('/api/save', async (req, res) => {
  await writeFile(join(__dirname, 'user-data.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// Re-run scanner
app.post('/api/scan', async (req, res) => {
  try {
    await execFileAsync('node', [join(__dirname, 'scanner.mjs')]);
    // Return fresh merged data
    const scannerData = JSON.parse(await readFile(join(__dirname, 'projects-data.json'), 'utf8'));
    let userData = { accounts: [], projects: {} };
    try { userData = JSON.parse(await readFile(join(__dirname, 'user-data.json'), 'utf8')); } catch {}
    res.json(mergeData(scannerData, userData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Command Center → http://localhost:${PORT}`));
```

- [ ] **Step 2: Create a placeholder dashboard.html**

```html
<!DOCTYPE html>
<html><body><h1>Command Center</h1><p>Dashboard coming soon...</p></body></html>
```

- [ ] **Step 3: Test the server**

Run: `cd ~/project-dashboard && node server.mjs &`
Then: `curl http://localhost:3333/api/data | head -20`
Expected: JSON response with scanDate, accounts, projects
Then: `kill %1` (stop the background server)

- [ ] **Step 4: Commit**

```bash
git add server.mjs dashboard.html
git commit -m "feat: add Express server with data, save, and scan endpoints"
```

---

## Chunk 2: Dashboard UI

### Task 5: Dashboard — Table Layout + Data Loading

**Files:**
- Modify: `dashboard.html` (full rewrite)

- [ ] **Step 1: Write the dashboard HTML with embedded CSS and data loading JS**

`dashboard.html` — Single file. Dark theme spreadsheet. Fetches `/api/data` on load, renders the table. This step covers: top bar, stats row, filter pills, table with all columns, and data fetch/render logic.

The full HTML file should include:

**CSS (embedded in `<style>`):**
- Dark theme: `body { background: #0f1219; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; }`
- Top bar: flex row with title, project count badge, search input, last-scan timestamp, re-scan button
- Stats row: flex row with 4 stat boxes (Active, Paused, Archived, Accounts) — colored borders and numbers
- Filter pills: small rounded buttons for status (All/Active/Paused/Archived) and type (Mobile/Web App/Website/Backend/Library)
- Table: `width: 100%; border-collapse: collapse; font-size: 13px;`
- Table headers: `color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid rgba(255,255,255,0.08);`
- Sticky first column: `position: sticky; left: 0; background: #0f1219; z-index: 1;`
- Row hover: `tr:hover { background: rgba(255,255,255,0.03); }`
- Status badges: green (`rgba(16,185,129,0.15)` / `#6ee7b7`), amber (`rgba(245,158,11,0.15)` / `#fcd34d`), gray (`rgba(100,116,139,0.12)` / `#94a3b8`)
- Type badges: Mobile=indigo, Web App=cyan, Website=pink, Backend=amber, Library=teal
- Service checkmarks: `color: #22c55e` for ✓, `color: #334155` for —
- Account emails: colored per account color from user data
- Notes column: `color: #64748b; font-style: italic;`

**JS (embedded in `<script>`):**
- `let appData = { scanDate: null, accounts: [], projects: {} };`
- `let userData = { accounts: [], projects: {} };` (client-side copy for saves)
- `let filters = { status: 'all', type: 'all', search: '' };`
- `let sortCol = 'name'; let sortDir = 'asc';`
- `async function loadData()` — fetches `/api/data`, stores in `appData`. Initializes `userData` from `appData` (extracts accounts array and per-project user fields: status, type, notes, accounts). This `userData` object is what gets POSTed to `/api/save`. Calls `render()`
- `function render()` — clears table body, iterates `Object.entries(appData.projects)`, applies filters and sort, builds `<tr>` for each project with all columns
- `function getProjectType(key, project)` — returns user-set type or auto-detects from services (has expo → mobile, has vercel/netlify → webapp, has cloudflare worker → backend, else null)
- `function getProjectStatus(key)` — returns user-set status or 'active' default
- Service columns: `project.services.github ? '✓' : '—'` etc.
- Account column: look up `userData.projects[key]?.accounts`, show default or per-service emails with account colors
- Notes column: show `userData.projects[key]?.notes` or '—'
- Stats update: count active/paused/archived from current filtered data
- On load: call `loadData()`

- [ ] **Step 2: Run the server and verify table renders**

Run: `cd ~/project-dashboard && node scanner.mjs && node server.mjs &`
Open: `http://localhost:3333`
Expected: Dark themed spreadsheet table with all projects, service checkmarks, sortable columns
Then: `kill %1`

- [ ] **Step 3: Commit**

```bash
git add dashboard.html
git commit -m "feat: add spreadsheet dashboard with table layout and data loading"
```

---

### Task 6: Dashboard — Search, Filters, and Sorting

**Files:**
- Modify: `dashboard.html`

- [ ] **Step 1: Add search functionality**

In the JS section, add:
- `document.getElementById('search').addEventListener('input', (e) => { filters.search = e.target.value.toLowerCase(); render(); })`
- In `render()`, filter projects where name, packageName, or notes includes `filters.search`

- [ ] **Step 2: Add filter pill click handlers**

- Status pills: `data-filter-status="active"` etc. On click, set `filters.status` and toggle `.active` class on pills. `'all'` shows everything.
- Type pills: `data-filter-type="mobile"` etc. Same pattern.
- In `render()`, filter by status (if not 'all') and type (if not 'all').

- [ ] **Step 3: Add column sorting**

- Each `<th>` gets `onclick="sortBy('colname')"`
- `function sortBy(col)` — if same col, toggle `sortDir`; else set `sortCol = col, sortDir = 'asc'`; call `render()`
- In `render()`, sort entries array before building rows. For service columns, sort by boolean (has service). For name, sort alphabetically. For status/type, sort alphabetically.
- Show sort indicator (▲/▼) in active column header

- [ ] **Step 4: Verify search, filters, and sorting work**

Run server, open dashboard:
- Type "oval" in search → only oval-related projects show
- Click "Active" pill → only active projects show
- Click "GitHub" column header → sorts by GitHub presence
- Click again → reverses sort

- [ ] **Step 5: Commit**

```bash
git add dashboard.html
git commit -m "feat: add search, filter pills, and column sorting"
```

---

### Task 7: Dashboard — Inline Editing + Auto-save

**Files:**
- Modify: `dashboard.html`

- [ ] **Step 1: Add row click → expand edit panel**

When a table row is clicked, insert a `<tr class="edit-panel">` below it with a `<td colspan="12">` containing:
- Status dropdown: `<select>` with options active/paused/archived, pre-selected from userData
- Type dropdown: `<select>` with options mobile/webapp/website/backend/library, pre-selected
- Notes textarea: `<textarea>` pre-filled with current notes
- Per-service account dropdowns: for each service the project has, show a `<select>` with the user's accounts list + "none" option
- Clicking the same row again collapses the panel

CSS for edit panel:
```css
.edit-panel td {
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 16px 20px;
}
.edit-panel select, .edit-panel textarea {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e2e8f0;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
.edit-panel textarea { width: 100%; min-height: 60px; resize: vertical; }
.edit-field { display: inline-flex; flex-direction: column; gap: 4px; margin-right: 20px; }
.edit-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
```

- [ ] **Step 2: Add auto-save on field change**

```javascript
async function saveUserData() {
  const indicator = document.getElementById('save-indicator');
  indicator.textContent = 'Saving...';
  indicator.style.opacity = '1';
  await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData)
  });
  indicator.textContent = 'Saved ✓';
  setTimeout(() => { indicator.style.opacity = '0'; }, 1500);
}
```

Each dropdown gets an `onchange` handler, and each textarea gets an `onblur` handler (not `oninput` — avoid firing on every keystroke). Each handler:
1. Updates the `userData.projects[key]` object (creating it if needed)
2. Calls `saveUserData()`
3. Calls `render()` to update the table row with the new values

Add a save indicator element in the top bar: `<span id="save-indicator" style="opacity:0; transition: opacity 0.3s; font-size: 11px; color: #6ee7b7;">Saved ✓</span>`

- [ ] **Step 3: Add re-scan button handler**

```javascript
document.getElementById('rescan-btn').addEventListener('click', async () => {
  const btn = document.getElementById('rescan-btn');
  btn.textContent = '⏳ Scanning...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    appData = await res.json();
    render();
  } catch (err) {
    console.error('Scan failed:', err);
  }
  btn.textContent = '🔄 Re-scan';
  btn.disabled = false;
});
```

- [ ] **Step 4: Test inline editing and auto-save**

Run server, open dashboard:
- Click a project row → edit panel expands
- Change status to "paused" → "Saved ✓" appears, row updates
- Add a note → saves on blur
- Assign an account → saves
- Refresh page → edits persist
- Click "Re-scan" → button shows "Scanning...", data refreshes

- [ ] **Step 5: Commit**

```bash
git add dashboard.html
git commit -m "feat: add inline editing, auto-save, and re-scan"
```

---

## Chunk 3: Seed Data + Automation

### Task 8: Seed User Data

**Files:**
- Create: `seed-user-data.mjs`

- [ ] **Step 1: Write seed script**

`seed-user-data.mjs` — Creates the initial `user-data.json` with known accounts and project annotations from memory. Only writes if `user-data.json` doesn't exist yet (safe to run multiple times).

```javascript
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT = join(import.meta.dirname, 'user-data.json');

try {
  await access(OUTPUT);
  console.log('user-data.json already exists, skipping seed.');
  process.exit(0);
} catch {}

const userData = {
  accounts: [
    { email: 'jonmlucia@gmail.com', label: 'Primary', color: '#8b5cf6' },
    { email: 'structma@yahoo.com', label: 'Legacy', color: '#f59e0b' },
    { email: 'jonathan@cinnamon.news', label: 'Cinnamon', color: '#10b981' }
  ],
  projects: {
    ovl: { status: 'active', type: 'mobile', notes: 'Deep Agent — iOS app + CLI. On TestFlight.', accounts: { default: 'jonmlucia@gmail.com' } },
    myfam: { status: 'paused', type: 'mobile', notes: 'Family hub app. Phase 1-2 complete, on hold.', accounts: { default: 'jonmlucia@gmail.com' } },
    portfolio: { status: 'active', type: 'website', notes: 'jonathanlucia.com — custom domain on Cloudflare', accounts: { vercel: 'jonmlucia@gmail.com', cloudflare: 'structma@yahoo.com' } },
    oval: { status: 'active', type: 'backend', notes: 'Cloudflare Worker backend — D1 + Vectorize + AI', accounts: { default: 'jonmlucia@gmail.com' } },
    cinnamon: { status: 'archived', type: 'mobile', notes: 'Reference architecture for Expo apps', accounts: { default: 'jonathan@cinnamon.news' } },
    'argu-mobile': { status: 'archived', type: 'mobile', notes: '', accounts: { default: 'jonmlucia@gmail.com' } },
    Argu: { status: 'archived', type: 'webapp', notes: 'Debate platform — Anthropic + OpenAI + Prisma + Stripe', accounts: { default: 'jonmlucia@gmail.com' } },
    'ai-trend-agent': { status: 'active', type: 'backend', notes: 'Public proxy agent with Slack integration', accounts: { default: 'jonmlucia@gmail.com' } },
    jumove: { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    mica: { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    micast: { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    famhub: { status: 'archived', type: 'webapp', notes: 'Vite + React family dashboard', accounts: {} },
    whatever: { status: 'archived', type: 'backend', notes: 'CF Worker + D1 podcast API', accounts: {} },
    Emerald: { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    'continuum-web': { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    continuum: { status: 'archived', type: 'mobile', notes: '', accounts: {} },
    'my-expense-tracker': { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    'mind-web': { status: 'archived', type: 'webapp', notes: '', accounts: {} },
    'ai_for_beginners_llm': { status: 'archived', type: 'library', notes: '', accounts: {} },
    'ai-updates': { status: 'archived', type: 'backend', notes: 'Python email digest', accounts: {} }
  }
};

await writeFile(OUTPUT, JSON.stringify(userData, null, 2));
console.log(`Seeded ${Object.keys(userData.projects).length} projects → ${OUTPUT}`);
```

- [ ] **Step 2: Run seed + scanner and verify**

Run: `cd ~/project-dashboard && node scanner.mjs && node seed-user-data.mjs`
Expected: Both JSON files created. Then start server and verify dashboard shows statuses, types, and notes.

- [ ] **Step 3: Commit**

```bash
git add seed-user-data.mjs
git commit -m "feat: add seed script for initial user data"
```

---

### Task 9: LaunchAgent + Shell Alias

**Files:**
- Create: `com.jonathanlucia.command-center.plist`
- Create: `dash.sh`

- [ ] **Step 1: Write the LaunchAgent plist**

`com.jonathanlucia.command-center.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jonathanlucia.command-center</string>
    <key>ProgramArguments</key>
    <array>
        <string>NODE_PATH_HERE</string>
        <string>/Users/jonathanlucia/project-dashboard/server.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/jonathanlucia/project-dashboard</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/jonathanlucia/project-dashboard/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/jonathanlucia/project-dashboard/server.log</string>
</dict>
</plist>
```

**Important:** Replace `NODE_PATH_HERE` with the output of `which node` (e.g., `/opt/homebrew/bin/node` on Apple Silicon, `/usr/local/bin/node` on Intel). Run `which node` first and substitute the result.

- [ ] **Step 2: Write dash.sh**

```bash
#!/bin/bash
open "http://localhost:3333"
```

- [ ] **Step 3: Make dash.sh executable**

Run: `chmod +x ~/project-dashboard/dash.sh`

- [ ] **Step 4: Symlink LaunchAgent and load it**

Run: `ln -sf ~/project-dashboard/com.jonathanlucia.command-center.plist ~/Library/LaunchAgents/`
Run: `launchctl load ~/Library/LaunchAgents/com.jonathanlucia.command-center.plist`
Verify: `curl -s http://localhost:3333/api/data | head -5` returns JSON

- [ ] **Step 5: Add alias to shell profile**

Append to `~/.zshrc`:
```bash
alias dash="~/project-dashboard/dash.sh"
```

- [ ] **Step 6: Add server.log to .gitignore**

Append `server.log` to `.gitignore`.

- [ ] **Step 7: Test the full workflow**

Run: `source ~/.zshrc && dash`
Expected: Browser opens to dashboard at localhost:3333 with all projects, statuses, and service checkmarks.

- [ ] **Step 8: Commit**

```bash
git add com.jonathanlucia.command-center.plist dash.sh .gitignore
git commit -m "feat: add LaunchAgent auto-start and dash shell alias"
```

---

## Task Dependencies

```
Task 1 (setup) → Task 2 (scanner skeleton) → Task 3 (all detectors)
                                                     ↓
Task 4 (server) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
     ↓
Task 5 (dashboard table) → Task 6 (search/filter/sort) → Task 7 (editing/save)
                                                                    ↓
Task 8 (seed data) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
     ↓
Task 9 (automation)
```

Tasks 1-3 can be done sequentially as one batch (scanner).
Tasks 4-7 are the server + dashboard batch.
Tasks 8-9 are the polish + automation batch.
