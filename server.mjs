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

app.listen(PORT, () => console.log(`Command Center → http://localhost:${PORT}`));
