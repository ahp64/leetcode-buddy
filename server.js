import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createStore } from './lib/store.js';
import { getGroupStatus } from './lib/status.js';
import { userExists } from './lib/leetcode.js';
import { startScheduler, sendReminders } from './lib/scheduler.js';
import { isValidTimeZone } from './lib/time.js';

const app = express();
const store = createStore();

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/status', async (req, res) => {
  try {
    res.json(await getGroupStatus(store));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/members', async (req, res) => {
  const { name, leetcodeUsername, email, phone, notifyEmail, notifySms } =
    req.body ?? {};
  if (!leetcodeUsername?.trim()) {
    return res.status(400).json({ error: 'LeetCode username is required.' });
  }
  const username = leetcodeUsername.trim();
  if (
    store.data.members.some(
      (m) => m.leetcodeUsername.toLowerCase() === username.toLowerCase()
    )
  ) {
    return res.status(409).json({ error: `${username} is already in the group.` });
  }
  try {
    if (!(await userExists(username))) {
      return res
        .status(404)
        .json({ error: `No LeetCode user named "${username}" found.` });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not verify username: ${err.message}` });
  }
  const member = store.addMember({
    name: name?.trim() || username,
    leetcodeUsername: username,
    email,
    phone,
    notifyEmail,
    notifySms,
  });
  res.status(201).json(member);
});

app.patch('/api/members/:id', (req, res) => {
  const { name, email, phone, notifyEmail, notifySms } = req.body ?? {};
  const member = store.updateMember(req.params.id, {
    name,
    email,
    phone,
    notifyEmail,
    notifySms,
  });
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json(member);
});

app.delete('/api/members/:id', (req, res) => {
  if (!store.getMember(req.params.id)) {
    return res.status(404).json({ error: 'Member not found.' });
  }
  store.removeMember(req.params.id);
  res.status(204).end();
});

app.patch('/api/settings', (req, res) => {
  const { timezone, reminderHours } = req.body ?? {};
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    return res.status(400).json({ error: `"${timezone}" is not a valid IANA timezone.` });
  }
  const hours =
    reminderHours === undefined
      ? undefined
      : [...new Set(reminderHours.map(Number))]
          .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
          .sort((a, b) => a - b);
  res.json(store.updateSettings({ timezone, reminderHours: hours }));
});

app.post('/api/remind-now', async (req, res) => {
  try {
    res.json(await sendReminders(store, { fresh: true }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`LeetCode Buddy Streak running at http://localhost:${port}`);
  console.log(
    `Reminder hours (${store.data.settings.timezone}): ${store.data.settings.reminderHours.join(', ')}`
  );
  startScheduler(store);
});
