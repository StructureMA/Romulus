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

async function detectVercel(dir) {
  const data = await readJson(join(dir, '.vercel', 'project.json'));
  if (!data) return null;
  return { orgId: data.orgId, projectId: data.projectId };
}

async function detectExpo(dir) {
  const appJson = await readJson(join(dir, 'app.json'));
  const expoConfig = appJson?.expo;
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

async function detectFirebase(dir) {
  const rc = await readJson(join(dir, '.firebaserc'));
  const hasConfig = await exists(join(dir, 'firebase.json'));
  if (!rc && !hasConfig) return null;
  const result = {};
  if (rc?.projects?.default) result.projectId = rc.projects.default;
  return Object.keys(result).length > 0 ? result : true;
}

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

async function detectSupabase(dir) {
  const hasDir = await exists(join(dir, 'supabase'));
  const pkg = await readJson(join(dir, 'package.json'));
  const hasDep = pkg?.dependencies?.['@supabase/supabase-js'] || pkg?.devDependencies?.['@supabase/supabase-js'];
  const hasEnv = await checkEnvForPattern(dir, /SUPABASE_URL/);
  if (!hasDir && !hasDep && !hasEnv) return null;
  return true;
}

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

async function detectNetlify(dir) {
  const hasToml = await exists(join(dir, 'netlify.toml'));
  const state = await readJson(join(dir, '.netlify', 'state.json'));
  if (!hasToml && !state) return null;
  if (state?.siteId) return { siteId: state.siteId };
  return true;
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
