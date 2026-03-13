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
