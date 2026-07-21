import fs from 'node:fs';
import path from 'node:path';

// Group config lives in data/db.json — settings, members (including contact
// info), and recorded history. The file is gitignored; on CI it is restored
// from the BUDDY_CONFIG repo secret.
//
// The active freeze lives apart in freeze.json (committed — dates are
// public-safe), so the freeze/unfreeze GitHub workflows can flip it with a
// plain commit, no secret writes needed.
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const FREEZE_FILE = path.join(process.cwd(), 'freeze.json');

function defaults() {
  return {
    settings: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminderHours: [12, 18, 21],
    },
    members: [],
    // history[dayKey] = { complete, solved: {memberId: bool}, remindersSent: {hour: true} }
    history: {},
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
  // Legacy: honor a freeze field from db.json/BUDDY_CONFIG if freeze.json
  // doesn't exist yet; freeze.json wins otherwise.
  data.freeze = loadFreeze(data.freeze);
  // Members are identified by lowercased leetcode username; derive it so
  // hand-written BUDDY_CONFIG entries don't need an id field.
  for (const m of data.members) {
    m.id ??= m.leetcodeUsername.trim().toLowerCase();
    m.name ||= m.leetcodeUsername;
    m.email ??= '';
    m.phone ??= '';
    m.ntfyTopic ??= '';
    m.notifyEmail = Boolean(m.notifyEmail);
    m.notifySms = Boolean(m.notifySms);
    m.notifyNtfy = Boolean(m.notifyNtfy);
  }

  const store = {
    data,
    save() {
      const { freeze, ...db } = data;
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
      fs.renameSync(tmp, DATA_FILE);
      const ftmp = FREEZE_FILE + '.tmp';
      fs.writeFileSync(ftmp, JSON.stringify({ freeze: freeze ?? null }, null, 2) + '\n');
      fs.renameSync(ftmp, FREEZE_FILE);
    },
    addMember({ name, leetcodeUsername, email, phone, ntfyTopic, notifyEmail, notifySms, notifyNtfy }) {
      const username = leetcodeUsername.trim();
      const member = {
        id: username.toLowerCase(),
        name: (name ?? '').trim() || username,
        leetcodeUsername: username,
        email: (email ?? '').trim(),
        phone: (phone ?? '').trim(),
        ntfyTopic: (ntfyTopic ?? '').trim(),
        notifyEmail: Boolean(notifyEmail),
        notifySms: Boolean(notifySms),
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
      if (fields.phone !== undefined) m.phone = String(fields.phone).trim();
      if (fields.ntfyTopic !== undefined) m.ntfyTopic = String(fields.ntfyTopic).trim();
      if (fields.notifyEmail !== undefined) m.notifyEmail = Boolean(fields.notifyEmail);
      if (fields.notifySms !== undefined) m.notifySms = Boolean(fields.notifySms);
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
      return (data.history[day] ??= { complete: false, solved: {}, remindersSent: {} });
    },
  };
  return store;
}
