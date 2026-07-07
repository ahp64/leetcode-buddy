import fs from 'node:fs';
import path from 'node:path';

// Single source of truth: data/db.json — settings, members (including
// contact info), and recorded history. The file is gitignored; on CI it is
// restored from the BUDDY_CONFIG repo secret, which is how the whole group
// is configured when running on GitHub.
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function defaults() {
  return {
    settings: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminderHours: [12, 18, 21],
    },
    members: [],
    // Active freeze: { activatedOn, from, until } (inclusive day keys), or null.
    freeze: null,
    // history[dayKey] = { complete, solved: {memberId: bool}, remindersSent: {hour: true} }
    history: {},
  };
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
  // Members are identified by lowercased leetcode username; derive it so
  // hand-written BUDDY_CONFIG entries don't need an id field.
  for (const m of data.members) {
    m.id ??= m.leetcodeUsername.trim().toLowerCase();
    m.name ||= m.leetcodeUsername;
    m.email ??= '';
    m.phone ??= '';
    m.notifyEmail = Boolean(m.notifyEmail);
    m.notifySms = Boolean(m.notifySms);
  }

  const store = {
    data,
    save() {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(tmp, DATA_FILE);
    },
    addMember({ name, leetcodeUsername, email, phone, notifyEmail, notifySms }) {
      const username = leetcodeUsername.trim();
      const member = {
        id: username.toLowerCase(),
        name: (name ?? '').trim() || username,
        leetcodeUsername: username,
        email: (email ?? '').trim(),
        phone: (phone ?? '').trim(),
        notifyEmail: Boolean(notifyEmail),
        notifySms: Boolean(notifySms),
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
      if (fields.notifyEmail !== undefined) m.notifyEmail = Boolean(fields.notifyEmail);
      if (fields.notifySms !== undefined) m.notifySms = Boolean(fields.notifySms);
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
