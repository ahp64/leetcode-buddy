// Sends a one-off test message to everyone with email/ntfy reminders
// toggled on, ignoring solve status — for verifying delivery actually
// works. Run locally with `npm run test-notify`, or via the "Test
// reminders" GitHub Actions workflow for the hosted setup.
import 'dotenv/config';
import { createStore } from './lib/store.js';
import { sendTestNotifications } from './lib/scheduler.js';

const store = createStore();
const result = await sendTestNotifications(store);
console.log(result.message);
