// Add or remove a streak member from the command line — used by the
// "Manage buddies" GitHub Actions form so the group can be managed entirely
// from the browser, and handy locally too.
//
// Usage:
//   node manage.js add <leetcode-username> [display name]
//   node manage.js remove <leetcode-username>
//
// Only public-safe fields (name + username) are touched here; contact info
// lives in data/contacts.json locally or the CONTACTS secret on CI.
import { createStore } from './lib/store.js';
import { userExists } from './lib/leetcode.js';

const [action, usernameArg, ...nameParts] = process.argv.slice(2);
const username = usernameArg?.trim();

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!['add', 'remove'].includes(action)) fail('first argument must be "add" or "remove"');
if (!username) fail('a LeetCode username is required');

const store = createStore();
const id = username.toLowerCase();
const existing = store.getMember(id);

if (action === 'add') {
  if (existing) fail(`${username} is already in the group.`);
  if (!(await userExists(username))) {
    fail(`no LeetCode user named "${username}" found.`);
  }
  const member = store.addMember({
    name: nameParts.join(' '),
    leetcodeUsername: username,
  });
  console.log(`Added ${member.name} (@${member.leetcodeUsername}) to the streak.`);
} else {
  if (!existing) fail(`${username} is not in the group.`);
  store.removeMember(id);
  console.log(`Removed ${existing.name} (@${existing.leetcodeUsername}) from the streak.`);
}
console.log(
  `Group is now: ${store.data.members.map((m) => '@' + m.leetcodeUsername).join(', ') || '(empty)'}`
);
