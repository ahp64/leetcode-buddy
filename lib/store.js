import fs from 'node:fs';
import path from 'node:path';

// Group config (settings + members, including contact info) lives in
// data/db.json — gitignored; on CI it is restored from the BUDDY_CONFIG
// repo secret each run.
//
// Freeze state and daily history live apart in freeze.json/history.json
// (committed — no PII, just dates/booleans keyed by day and member id,
// which is already public via each member's LeetCode profile link) so the
// GitHub workflows can persist them with a plain commit instead of a secret
// write. This matters for history specifically: CI runs are stateless
// between the 15-minute scheduled checks (BUDDY_CONFIG is restored fresh
// each time), so without committing history.json back, reminder/congrats
// "already sent today" guards would never actually hold across runs.
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const FREEZE_FILE = path.join(process.cwd(), 'freeze.json');
const HISTORY_FILE = path.join(process.cwd(), 'history.json');

function defaults() {
  return {
    settings: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminderHours: [12, 18, 21],
    },
    members: [],
  };
}

// freeze.json: { "freeze": { activatedOn, from, until } | null }
function loadFreeze(legacy) {
  if (!fs.existsSync(FREEZE_FILE)) return legacy ?? null;
  try {
    return JSON.parse(fs.readFileSync(FREEZE_FILE, 'utf8')).freeze ?? null;
  } catch (err) {
    throw new Error(`freeze.json is not valid JSON (${err.message}).`);
  }
}

// history.json: { "history": { [dayKey]: { complete, solved: {memberId:
//   bool}, remindersSent: {hour: true}, congratsSent: {memberId: true} } } }
function loadHistory(legacy) {
  if (!fs.existsSync(HISTORY_FILE)) return legacy ?? {};
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).history ?? {};
  } catch (err) {
    throw new Error(`history.json is not valid JSON (${err.message}).`);
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return defaults();
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (err) {
    throw new Error(
      `db.json is not valid JSON (${err.message}). If you are using the ` +
        'BUDDY_CONFIG secret, check it against the example in the README — ' +
        'every quote and brace matters.'
    );
  }
}

export function createStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = loadData();
  // Legacy: honor a freeze/history field from db.json/BUDDY_CONFIG if the
  // dedicated file doesn't exist yet; the dedicated file wins otherwise.
  data.freeze = loadFreeze(data.freeze);
  data.history = loadHistory(data.history);
  // Members are identified by lowercased leetcode username; derive it so
  // hand-written BUDDY_CONFIG entries don't need an id field.
  for (const m of data.members) {
    m.id ??= m.leetcodeUsername.trim().toLowerCase();
    m.name ||= m.leetcodeUsername;
    m.email ??= '';
    m.ntfyTopic ??= '';
    m.notifyEmail = Boolean(m.notifyEmail);
    m.notifyNtfy = Boolean(m.notifyNtfy);
  }

  const store = {
    data,
    save() {
      const { freeze, history, ...db } = data;
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
      fs.renameSync(tmp, DATA_FILE);
      const ftmp = FREEZE_FILE + '.tmp';
      fs.writeFileSync(ftmp, JSON.stringify({ freeze: freeze ?? null }, null, 2) + '\n');
      fs.renameSync(ftmp, FREEZE_FILE);
      const htmp = HISTORY_FILE + '.tmp';
      fs.writeFileSync(htmp, JSON.stringify({ history: history ?? {} }, null, 2) + '\n');
      fs.renameSync(htmp, HISTORY_FILE);
    },
    addMember({ name, leetcodeUsername, email, ntfyTopic, notifyEmail, notifyNtfy }) {
      const username = leetcodeUsername.trim();
      const member = {
        id: username.toLowerCase(),
        name: (name ?? '').trim() || username,
        leetcodeUsername: username,
        email: (email ?? '').trim(),
        ntfyTopic: (ntfyTopic ?? '').trim(),
        notifyEmail: Boolean(notifyEmail),
        notifyNtfy: Boolean(notifyNtfy),
      };
      data.members.push(member);
      store.save();
      return member;
    },
    getMember(id) {
      return data.members.find((m) => m.id === id);
    },
    updateMember(id, fields) {
      const m = store.getMember(id);
      if (!m) return null;
      if (fields.name !== undefined) m.name = String(fields.name).trim() || m.name;
      if (fields.email !== undefined) m.email = String(fields.email).trim();
      if (fields.ntfyTopic !== undefined) m.ntfyTopic = String(fields.ntfyTopic).trim();
      if (fields.notifyEmail !== undefined) m.notifyEmail = Boolean(fields.notifyEmail);
      if (fields.notifyNtfy !== undefined) m.notifyNtfy = Boolean(fields.notifyNtfy);
      store.save();
      return m;
    },
    removeMember(id) {
      data.members = data.members.filter((m) => m.id !== id);
      store.save();
    },
    updateSettings({ timezone, reminderHours }) {
      if (timezone !== undefined) data.settings.timezone = timezone;
      if (reminderHours !== undefined) data.settings.reminderHours = reminderHours;
      store.save();
      return data.settings;
    },
    dayRecord(day) {
      const record = (data.history[day] ??= {
        complete: false,
        solved: {},
        remindersSent: {},
        congratsSent: {},
      });
      // Backfill fields for day records saved before congratsSent existed.
      record.congratsSent ??= {};
      return record;
    },
  };
  return store;
}
