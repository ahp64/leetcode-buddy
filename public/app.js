const $ = (id) => document.getElementById(id);

let latest = null;
// Static mode: this page is being served from GitHub Pages, where there's no
// API — data comes from a status.json snapshot and management UI is hidden.
let staticMode = false;

async function loadStatic() {
  const res = await fetch(`./status.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`status.json missing (${res.status})`);
  const s = await res.json();
  // Normalize to the /api/status shape render() expects.
  return {
    ...s,
    settings: { timezone: s.timezone, reminderHours: [] },
    channels: { email: false, sms: false },
  };
}

// --- Managing the group straight from the GitHub Pages mirror ------------
// A static page can't have a backend, but GitHub's own API accepts browser
// requests — so with a repo-scoped token (pasted once, kept in this
// browser's localStorage) the page dispatches the "Manage buddies" workflow
// that adds/removes people and redeploys this dashboard.

const TOKEN_KEY = 'lcbuddy_token';
const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
const repoPath = () => new URL(latest.repoUrl).pathname.slice(1);

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${repoPath()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      ...opts.headers,
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token — it may have expired. Disconnect and paste a new one.');
  if (res.status === 403 || res.status === 404) {
    throw new Error('The token can\'t do that — make sure it has access to this repository with the "Actions" permission set to Read and write.');
  }
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  return res.status === 204 ? null : res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyRosterChange(inputs, progress) {
  const startedAt = Date.now();
  progress(`Asking GitHub to ${inputs.action} @${inputs.leetcode_username}…`);
  await gh('/actions/workflows/manage.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs }),
  });

  // The dispatch call returns before the run exists; find it, then follow it.
  progress('GitHub is applying the change (takes about a minute)…');
  let run = null;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const { workflow_runs } = await gh('/actions/workflows/manage.yml/runs?per_page=1');
    const candidate = workflow_runs?.[0];
    if (!candidate || new Date(candidate.created_at).getTime() < startedAt - 30000) continue;
    run = candidate;
    if (run.status === 'completed') break;
  }
  if (!run || run.status !== 'completed') {
    throw new Error('GitHub is taking unusually long — check the Actions tab for the result.');
  }
  if (run.conclusion !== 'success') {
    throw new Error(`GitHub couldn't apply it (usually a mistyped LeetCode username). Details: ${run.html_url}`);
  }

  // Run finished (dashboard redeployed) — wait for the CDN to serve it.
  progress('Change applied — refreshing dashboard…');
  const before = latest.generatedAt;
  for (let i = 0; i < 15; i++) {
    await sleep(4000);
    latest = await loadStatic();
    if (latest.generatedAt !== before) break;
  }
  render(latest);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

async function refresh() {
  try {
    latest = staticMode ? await loadStatic() : await api('/api/status');
  } catch (err) {
    if (!staticMode) {
      try {
        latest = await loadStatic();
        staticMode = true;
      } catch {
        $('streak-label').textContent = err.message;
        return;
      }
    } else {
      $('streak-label').textContent = err.message;
      return;
    }
  }
  render(latest);
}

function render(s) {
  // Header / flame
  const flame = $('flame');
  flame.className = 'flame';
  if (s.streak > 0) flame.classList.add(s.atRisk ? 'at-risk' : 'lit');
  $('streak-number').textContent = s.streak;
  $('streak-label').textContent =
    s.streak === 1 ? 'day shared streak' : 'days shared streak';

  const banner = $('banner');
  banner.hidden = s.members.length === 0;
  if (s.members.length > 0) {
    if (s.todayComplete) {
      banner.className = 'banner good';
      banner.textContent = '✅ Everyone solved today — streak secured!';
    } else if (s.atRisk) {
      const pending = s.members.filter((m) => !m.solvedToday).map((m) => m.name);
      banner.className = 'banner warn';
      banner.textContent = `⚠️ Waiting on ${pending.join(' & ')} — streak dies at midnight!`;
    } else {
      banner.className = 'banner dead';
      banner.textContent = 'No active streak — everyone solve today to start one.';
    }
  }

  $('today-date').textContent = `${s.today} · ${s.settings.timezone}`;
  $('solo-hint').hidden = staticMode || s.members.length !== 1;

  // On GitHub Pages the page has no backend: roster changes go through the
  // GitHub API (token pasted once), everything else links to GitHub forms.
  document.body.classList.toggle('static', staticMode);
  $('add-section').hidden = staticMode && !s.repoUrl;
  $('settings-section').hidden = staticMode;
  const connected = staticMode && Boolean(getToken());
  $('connect-card').hidden = !staticMode || connected;
  $('add-form').hidden = staticMode && !connected;
  const tokenStatus = $('token-status');
  tokenStatus.hidden = !connected;
  if (connected) {
    tokenStatus.innerHTML =
      'Connected to GitHub ✓ — changes run through your repo\'s "Manage buddies" workflow. <a href="#" id="token-disconnect">Disconnect</a>';
    tokenStatus.querySelector('#token-disconnect').addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem(TOKEN_KEY);
      render(latest);
    });
  }
  if (staticMode && s.repoUrl) {
    $('contacts-link').innerHTML =
      `<a href="${s.repoUrl}/settings/secrets/actions" target="_blank" rel="noopener">CONTACTS secret</a>`;
  }
  const note = $('readonly-note');
  note.hidden = !staticMode;
  if (staticMode && s.generatedAt) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(s.generatedAt)) / 60000));
    const age = mins < 1 ? 'just now' : `${mins} min ago`;
    const links = s.repoUrl
      ? ` · <a href="${s.repoUrl}/settings/secrets/actions" target="_blank" rel="noopener">🔔 reminder contacts</a>` +
        ` · <a href="${s.repoUrl}/edit/main/config.json" target="_blank" rel="noopener">⚙️ hours/timezone</a>`
      : '';
    note.innerHTML = `Updated ${age}${links}`;
  }

  // Member cards
  const container = $('members');
  container.innerHTML = '';
  if (s.members.length === 0) {
    container.innerHTML = staticMode
      ? '<p class="hint">No one in the streak yet.</p>'
      : '<p class="hint">No one in the streak yet. Add yourself and your buddy below. 👇</p>';
  }
  for (const m of s.members) {
    container.appendChild(memberCard(m));
  }

  // Settings
  if (document.activeElement !== $('tz-input')) {
    $('tz-input').value = s.settings.timezone;
  }
  if (document.activeElement !== $('hours-input')) {
    $('hours-input').value = s.settings.reminderHours.join(', ');
  }
  $('channel-status').textContent =
    `Delivery channels — email: ${s.channels.email ? 'configured ✅' : 'not configured (logs to server console)'}, ` +
    `text: ${s.channels.sms ? 'configured ✅' : 'not configured (logs to server console)'}. ` +
    'Configure in .env — see .env.example.';
}

function memberCard(m) {
  const el = document.createElement('div');
  el.className = 'member';

  let dot, detailClass, detailText;
  if (m.error) {
    dot = '❓';
    detailClass = 'error';
    detailText = `Couldn't check LeetCode: ${m.error}`;
  } else if (m.solvedToday) {
    dot = '✅';
    detailClass = 'ok';
    detailText = `Solved ${m.solvedCountToday} today` +
      (m.lastSolve ? ` — latest: “${m.lastSolve.title}”` : '');
  } else {
    dot = '⏳';
    detailClass = 'pending';
    detailText = 'Nothing solved yet today';
  }

  const controls = staticMode
    ? getToken()
      ? '<div class="controls"><button class="remove">remove</button></div>'
      : ''
    : `<div class="controls">
        <label class="toggle"><input type="checkbox" data-field="notifyEmail" ${m.notifyEmail ? 'checked' : ''}/> email</label>
        <label class="toggle"><input type="checkbox" data-field="notifySms" ${m.notifySms ? 'checked' : ''}/> text</label>
        <button class="remove">remove</button>
      </div>`;
  el.innerHTML = `
    <div class="status-dot">${dot}</div>
    <div class="info">
      <div class="name">${esc(m.name)}
        <a href="https://leetcode.com/u/${encodeURIComponent(m.leetcodeUsername)}/" target="_blank" rel="noopener">@${esc(m.leetcodeUsername)}</a>
      </div>
      <div class="detail ${detailClass}">${esc(detailText)}</div>
    </div>
    ${controls}`;

  if (staticMode) {
    el.querySelector('.remove')?.addEventListener('click', async () => {
      if (!confirm(`Remove ${m.name} from the streak?`)) return;
      const errEl = $('add-error');
      const progress = (msg) => {
        errEl.textContent = msg;
        errEl.className = 'form-error progress';
        errEl.hidden = false;
      };
      try {
        await applyRosterChange(
          { action: 'remove', leetcode_username: m.leetcodeUsername },
          progress
        );
        errEl.hidden = true;
      } catch (err) {
        errEl.textContent = err.message;
        errEl.className = 'form-error';
        errEl.hidden = false;
      }
    });
    return el;
  }

  el.querySelectorAll('input[data-field]').forEach((box) => {
    box.addEventListener('change', async () => {
      await api(`/api/members/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [box.dataset.field]: box.checked }),
      }).catch((err) => alert(err.message));
    });
  });
  el.querySelector('.remove').addEventListener('click', async () => {
    if (!confirm(`Remove ${m.name} from the streak?`)) return;
    await api(`/api/members/${m.id}`, { method: 'DELETE' }).catch((err) =>
      alert(err.message)
    );
    refresh();
  });
  return el;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('add-btn');
  const errEl = $('add-error');
  errEl.hidden = true;
  errEl.className = 'form-error';
  btn.disabled = true;
  btn.textContent = staticMode ? 'Sending to GitHub…' : 'Checking LeetCode…';
  try {
    const data = Object.fromEntries(new FormData(form));
    if (staticMode) {
      await applyRosterChange(
        {
          action: 'add',
          leetcode_username: data.leetcodeUsername.trim(),
          display_name: (data.name ?? '').trim(),
        },
        (msg) => {
          errEl.textContent = msg;
          errEl.className = 'form-error progress';
          errEl.hidden = false;
        }
      );
      errEl.hidden = true;
    } else {
      data.notifyEmail = form.notifyEmail.checked;
      data.notifySms = form.notifySms.checked;
      await api('/api/members', { method: 'POST', body: JSON.stringify(data) });
      await refresh();
    }
    form.reset();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.className = 'form-error';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add to streak';
  }
});

$('token-save').addEventListener('click', async () => {
  const errEl = $('token-error');
  errEl.hidden = true;
  const token = $('token-input').value.trim();
  if (!token) {
    errEl.textContent = 'Paste a token first.';
    errEl.hidden = false;
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
  try {
    // Cheap permission check before declaring victory.
    await gh('/actions/workflows/manage.yml/runs?per_page=1');
    $('token-input').value = '';
    render(latest);
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('save-settings').addEventListener('click', async () => {
  const msg = $('settings-msg');
  msg.hidden = true;
  try {
    await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        timezone: $('tz-input').value.trim(),
        reminderHours: $('hours-input')
          .value.split(',')
          .map((h) => h.trim())
          .filter(Boolean),
      }),
    });
    msg.textContent = 'Saved ✓';
    msg.className = 'form-error ok';
    msg.hidden = false;
    refresh();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
    msg.hidden = false;
  }
});

$('remind-now').addEventListener('click', async () => {
  const msg = $('settings-msg');
  const btn = $('remind-now');
  btn.disabled = true;
  msg.hidden = true;
  try {
    const result = await api('/api/remind-now', { method: 'POST' });
    msg.textContent = result.message;
    msg.className = 'form-error ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
  } finally {
    msg.hidden = false;
    btn.disabled = false;
  }
});

refresh();
setInterval(refresh, 60 * 1000);
