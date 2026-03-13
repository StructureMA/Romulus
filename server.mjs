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
  for (const [key, scanProject] of Object.entries(scannerData.projects)) {
    const userProject = userData.projects?.[key] || {};
    merged[key] = { ...scanProject, ...userProject, services: scanProject.services };
  }
  for (const [key, userProject] of Object.entries(userData.projects || {})) {
    if (!merged[key]) {
      merged[key] = { path: null, packageName: null, services: {}, envVars: [], ...userProject };
    }
  }
  return { scanDate: scannerData.scanDate, accounts: userData.accounts || [], projects: merged };
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'dashboard.html'));
});

app.get('/api/data', async (req, res) => {
  let scannerData = { scanDate: null, scanDir: '', projects: {} };
  let userData = { accounts: [], projects: {} };
  try { scannerData = JSON.parse(await readFile(join(__dirname, 'projects-data.json'), 'utf8')); } catch {}
  try { userData = JSON.parse(await readFile(join(__dirname, 'user-data.json'), 'utf8')); } catch {}
  res.json(mergeData(scannerData, userData));
});

app.post('/api/save', async (req, res) => {
  try {
    await writeFile(join(__dirname, 'user-data.json'), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    await execFileAsync('node', [join(__dirname, 'scanner.mjs')]);
    const scannerData = JSON.parse(await readFile(join(__dirname, 'projects-data.json'), 'utf8'));
    let userData = { accounts: [], projects: {} };
    try { userData = JSON.parse(await readFile(join(__dirname, 'user-data.json'), 'utf8')); } catch {}
    res.json(mergeData(scannerData, userData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate portfolio update prompt and open Claude Code
app.post('/api/portfolio-update', async (req, res) => {
  try {
    let scannerData = { projects: {} };
    let userData = { accounts: [], projects: {} };
    try { scannerData = JSON.parse(await readFile(join(__dirname, 'projects-data.json'), 'utf8')); } catch {}
    try { userData = JSON.parse(await readFile(join(__dirname, 'user-data.json'), 'utf8')); } catch {}
    const merged = mergeData(scannerData, userData);

    const active = [];
    const archived = [];
    for (const [key, p] of Object.entries(merged.projects)) {
      const status = p.status || 'unknown';
      const type = p.type || 'unknown';
      const notes = p.notes || '';
      const services = Object.keys(p.services || {}).join(', ') || 'none';
      const line = `- **${key}** (${type}) — ${notes || 'no description'}  [Services: ${services}]`;
      if (status === 'active') active.push(line);
      else if (status === 'archived') archived.push(line);
    }

    const prompt = `Update my portfolio site at ~/portfolio (jonathanlucia.com) based on my current project status from Command Center.

## Active Projects (should be featured)
${active.join('\n') || '(none)'}

## Archived Projects (should be removed or moved to past work)
${archived.join('\n') || '(none)'}

Please review the current portfolio site, compare it against this list, and suggest/make updates to feature active projects and remove or de-emphasize archived ones. Keep the existing design style.`;

    // Write prompt to a temp file and open Claude Code with it
    const promptFile = join(__dirname, '.portfolio-prompt.txt');
    await writeFile(promptFile, prompt);

    // Try to open a new terminal with claude
    const { exec } = await import('node:child_process');
    exec(`osascript -e 'tell application "Terminal" to do script "cd ~/portfolio && claude --print \\"$(cat ${promptFile})\\"" '`);

    res.json({ ok: true, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Command Center → http://localhost:${PORT}`));
