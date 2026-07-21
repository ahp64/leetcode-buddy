// Builds the static, read-only dashboard for GitHub Pages into dist/:
// a copy of public/ plus a sanitized status.json snapshot. Emails, phone
// numbers, member ids, and notification toggles are deliberately stripped —
// everything published here is already public on leetcode.com.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './lib/store.js';
import { getGroupStatus } from './lib/status.js';

const store = createStore();
const status = await getGroupStatus(store, { fresh: true });

const publicStatus = {
  readOnly: true,
  generatedAt: new Date().toISOString(),
  // Lets the static dashboard link to the GitHub forms that manage the group.
  repoUrl: process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : null,
  today: status.today,
  timezone: status.settings.timezone,
  streak: status.streak,
  atRisk: status.atRisk,
  todayComplete: status.todayComplete,
  freeze: status.freeze,
  frozenToday: status.frozenToday,
  canFreeze: status.canFreeze,
  members: status.members.map((m) => ({
    // id is just leetcodeUsername lowercased — already public via the
    // profile link below, so including it isn't a privacy leak, and the
    // hosted page's edit/remove flow needs it to match members against the
    // browser's local shadow copy of BUDDY_CONFIG.
    id: m.id,
    name: m.name,
    leetcodeUsername: m.leetcodeUsername,
    solvedToday: m.solvedToday,
    solvedCountToday: m.solvedCountToday,
    lastSolve: m.lastSolve,
    error: m.error ? 'Could not check LeetCode' : null,
  })),
};

const dist = path.join(process.cwd(), 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(process.cwd(), 'public'), dist, { recursive: true });
fs.writeFileSync(
  path.join(dist, 'status.json'),
  JSON.stringify(publicStatus, null, 2)
);
console.log(
  `Built dist/ — streak ${status.streak}, ${status.members.length} member(s), generated ${publicStatus.generatedAt}`
);
