import fs from 'node:fs';
import path from 'node:path';

// Config is split by sensitivity so the repo can stay public:
//  - config.json (committed): timezone, reminder hours, member names +
//    leetcode usernames — all public-safe (activity is public on leetcode.com)
//  - data/contacts.json (gitignored; CONTACTS secret on CI): emails, phone
//    numbers, notification toggles, keyed by lowercased leetcode username
//  - data/history.json (gitignored): recorded daily results + reminder marks
const CONFIG_FILE = path.join(process.cwd(), 'config.json');
const DATA_DIR = path.join(process.cwd(), 'data');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    throw new Error(
      `${path.basename(file)} is not valid JSON (${err.message}). ` +
        (file === CONTACTS_FILE
          ? 'If you are using the CONTACTS secret, check it against the example in the README — every quote and brace matters.'
          : 'Fix the file and try again.')
    );
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function createStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = loadJson(CONFIG_FILE, {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reminderHours: [12, 18, 21],
    members: [],
  });
  const contacts = loadJson(CONTACTS_FILE, {});
  const history = loadJson(HISTORY_FILE, {});

  const memberId = (username) => username.trim().toLowerCase();

  const merged = () =>
    config.members.map((m) => {
      const c = contacts[memberId(m.leetcodeUsername)] ?? {};
      return {
        id: memberId(m.leetcodeUsername),
        name: m.name,
        leetcodeUsername: m.leetcodeUsername,
        email: c.email ?? '',
        phone: c.phone ?? '',
        notifyEmail: Boolean(c.notifyEmail),
        notifySms: Boolean(c.notifySms),
      };
    });

  const store = {
    get data() {
      return {
        settings: {
          timezone: config.timezone,
          reminderHours: config.reminderHours,
        },
        members: merged(),
        history,
      };
    },
    save() {
      writeJson(CONFIG_FILE, config);
      writeJson(CONTACTS_FILE, contacts);
      writeJson(HISTORY_FILE, history);
    },
    addMember({ name, leetcodeUsername, email, phone, notifyEmail, notifySms }) {
      const username = leetcodeUsername.trim();
      config.members.push({ name: (name ?? '').trim() || username, leetcodeUsername: username });
      contacts[memberId(username)] = {
        email: (email ?? '').trim(),
        phone: (phone ?? '').trim(),
        notifyEmail: Boolean(notifyEmail),
        notifySms: Boolean(notifySms),
      };
      store.save();
      return store.getMember(memberId(username));
    },
    getMember(id) {
      return merged().find((m) => m.id === id);
    },
    updateMember(id, fields) {
      const configMember = config.members.find(
        (m) => memberId(m.leetcodeUsername) === id
      );
      if (!configMember) return null;
      if (fields.name !== undefined) {
        configMember.name = String(fields.name).trim() || configMember.name;
      }
      const c = (contacts[id] ??= {});
      if (fields.email !== undefined) c.email = String(fields.email).trim();
      if (fields.phone !== undefined) c.phone = String(fields.phone).trim();
      if (fields.notifyEmail !== undefined) c.notifyEmail = Boolean(fields.notifyEmail);
      if (fields.notifySms !== undefined) c.notifySms = Boolean(fields.notifySms);
      store.save();
      return store.getMember(id);
    },
    removeMember(id) {
      config.members = config.members.filter(
        (m) => memberId(m.leetcodeUsername) !== id
      );
      delete contacts[id];
      store.save();
    },
    updateSettings({ timezone, reminderHours }) {
      if (timezone !== undefined) config.timezone = timezone;
      if (reminderHours !== undefined) config.reminderHours = reminderHours;
      store.save();
      return store.data.settings;
    },
    dayRecord(day) {
      return (history[day] ??= { complete: false, solved: {}, remindersSent: {} });
    },
  };
  return store;
}
