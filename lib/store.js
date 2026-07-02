import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function defaults() {
  return {
    settings: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Local hours (0-23) at which reminder checks run for anyone who
      // hasn't solved yet that day.
      reminderHours: [12, 18, 21],
    },
    members: [],
    // history[dayKey] = { complete, solved: {memberId: bool}, remindersSent: {hour: true} }
    history: {},
  };
}

export function createStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let data = defaults();
  if (fs.existsSync(DATA_FILE)) {
    data = { ...defaults(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  }

  const store = {
    data,
    save() {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store.data, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    },
    addMember({ name, leetcodeUsername, email, phone, notifyEmail, notifySms }) {
      const member = {
        id: randomUUID(),
        name: name.trim(),
        leetcodeUsername: leetcodeUsername.trim(),
        email: (email ?? '').trim(),
        phone: (phone ?? '').trim(),
        notifyEmail: Boolean(notifyEmail),
        notifySms: Boolean(notifySms),
      };
      store.data.members.push(member);
      store.save();
      return member;
    },
    getMember(id) {
      return store.data.members.find((m) => m.id === id);
    },
    removeMember(id) {
      store.data.members = store.data.members.filter((m) => m.id !== id);
      store.save();
    },
    dayRecord(day) {
      return (store.data.history[day] ??= {
        complete: false,
        solved: {},
        remindersSent: {},
      });
    },
  };
  return store;
}
