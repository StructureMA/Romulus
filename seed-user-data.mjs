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
