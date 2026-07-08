const $ = (id) => document.getElementById(id);

let latest = null;
// Static mode: this page is being served from GitHub Pages, where there's no
// API — data comes from a status.json snapshot, management happens by
// editing the repo's secrets, and this page is a read-only mirror.
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

// --- One-click freeze/unfreeze on the GitHub Pages mirror -----------------
// The static page has no backend, but GitHub's API accepts browser requests:
// with a repo-scoped token (pasted once, kept in this browser's
// localStorage) the buttons dispatch the freeze/unfreeze workflows directly
// instead of linking out to the Actions tab.

const TOKEN_KEY = 'lcbuddy_token';
const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
const repoPath = () => new URL(latest.repoUrl).pathname.slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false; // suppress the auto-refresh while following a workflow run

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${repoPath()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      ...opts.headers,
    },
  });
  if (res.status === 401) {
    throw new Error('GitHub rejected the token — it may have expired. Disconnect and paste a new one.');
  }
  if (res.status === 403 || res.status === 404) {
    throw new Error('The token can\'t do that — make sure it has access to this repository with the "Actions" permission set to Read and write.');
  }
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  return res.status === 204 ? null : res.json();
}

// Dispatch a workflow and follow its run to completion. Once the run
// succeeds the freeze state has definitively changed, so we apply the known
// result to the UI immediately (via `optimistic`) rather than blocking on
// GitHub Pages' CDN, which can take another 10–40s to serve the rebuilt
// status.json. A background reconcile picks up the authoritative copy once
// the CDN catches up.
async function runWorkflow(file, inputs, progress, optimistic) {
  const startedAt = Date.now();
  progress('Asking GitHub…');
  await gh(`/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    body: JSON.stringify(inputs ? { ref: 'main', inputs } : { ref: 'main' }),
  });

  progress('GitHub is applying it…');
  let run = null;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const { workflow_runs } = await gh(`/actions/workflows/${file}/runs?per_page=1`);
    const candidate = workflow_runs?.[0];
    if (!candidate || new Date(candidate.created_at).getTime() < startedAt - 30000) continue;
    run = candidate;
    if (run.status === 'completed') break;
  }
  if (!run || run.status !== 'completed') {
    throw new Error('GitHub is taking unusually long — check the Actions tab for the result.');
  }
  if (run.conclusion !== 'success') {
    throw new Error(`GitHub refused the change (see the log: ${run.html_url})`);
  }

  // Run succeeded → reflect the new state now; reconcile with the CDN later.
  optimistic?.(latest);
  reconcileFromCdn(latest.generatedAt);
}

// Poll the published status.json in the background until its generatedAt
// advances past `before`, then repaint with the authoritative data.
async function reconcileFromCdn(before) {
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    if (busy) continue; // a newer action is in flight; let it own the state
    try {
      const fresh = await loadStatic();
      if (fresh.generatedAt !== before) {
        latest = fresh;
        render(latest);
        return;
      }
    } catch {
      /* transient; keep trying */
    }
  }
}

// Wraps a freeze/unfreeze action with progress + error display and the
// busy guard, then re-renders.
async function freezeAction(fn) {
  const errEl = $('freeze-error');
  const progress = (msg) => {
    errEl.textContent = msg;
    errEl.className = 'form-error progress';
    errEl.hidden = false;
  };
  busy = true;
  try {
    await fn(progress);
    busy = false;
    render(latest); // hides the progress line
  } catch (err) {
    busy = false;
    render(latest);
    errEl.textContent = err.message;
    errEl.className = 'form-error';
    errEl.hidden = false;
  }
}

async function refresh() {
  if (busy) return; // don't repaint mid freeze/unfreeze operation
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
  if (s.frozenToday) flame.classList.add('frozen');
  else if (s.streak > 0) flame.classList.add(s.atRisk ? 'at-risk' : 'lit');
  $('streak-number').textContent = s.streak;
  $('streak-label').textContent =
    s.streak === 1 ? 'day shared streak' : 'days shared streak';

  const banner = $('banner');
  banner.hidden = s.members.length === 0;
  if (s.members.length > 0) {
    if (s.frozenToday) {
      banner.className = 'banner frozen';
      banner.textContent = `❄️ Frozen through ${s.freeze.until} — no solves required today.`;
    } else if (s.todayComplete) {
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

  // Static mirror: hide management, point at the repo secret instead.
  $('add-section').hidden = staticMode;
  $('settings-section').hidden = staticMode;
  const note = $('readonly-note');
  note.hidden = !staticMode;
  if (staticMode && s.generatedAt) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(s.generatedAt)) / 60000));
    const age = mins < 1 ? 'just now' : `${mins} min ago`;
    const manage = s.repoUrl
      ? ` · <a href="${s.repoUrl}/settings/secrets/actions" target="_blank" rel="noopener">⚙️ manage group (BUDDY_CONFIG secret)</a>`
      : '';
    note.innerHTML = `Updated ${age}${manage}`;
  }

  // No group configured yet: walk the visitor through setup right here,
  // instead of leaving them at an empty page with only a small link.
  const needsSetup = staticMode && s.members.length === 0;
  $('setup-card').hidden = !needsSetup;
  if (needsSetup && s.repoUrl) {
    $('setup-secrets-link').href = `${s.repoUrl}/settings/secrets/actions`;
    $('setup-run-link').href = `${s.repoUrl}/actions/workflows/streak.yml`;
    $('setup-readme-link').href = `${s.repoUrl}#readme`;
  }
  // The regular member-list empty state only applies once a group exists.
  $('members-section').hidden = needsSetup;

  renderFreeze(s);

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

function renderFreeze(s) {
  const card = $('freeze-card');
  const active = $('freeze-active');
  const offer = $('freeze-offer');
  const hint = $('freeze-hint');
  $('freeze-error').hidden = true;

  // Static mirror, three tiers: connected (token pasted) gets real one-click
  // buttons that dispatch the workflows via the GitHub API; unconnected gets
  // deep links to the workflows' Run forms plus a "connect" offer.
  const connected = staticMode && Boolean(getToken());
  const interactive = !staticMode || connected;

  const showConnectOffer = (visible) => {
    $('freeze-connect').hidden = !(visible && staticMode && !connected && s.repoUrl);
    const status = $('token-status');
    status.hidden = !(visible && connected);
    if (visible && connected) {
      status.innerHTML =
        '⚡ Connected to GitHub — one-click controls active. <a href="#" id="token-disconnect">Disconnect</a>';
      status.querySelector('#token-disconnect').addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem(TOKEN_KEY);
        render(latest);
      });
    }
  };

  if (s.freeze) {
    card.hidden = false;
    active.hidden = false;
    offer.hidden = true;
    hint.hidden = true;
    $('freeze-until').textContent = s.freeze.until;
    $('unfreeze-btn').hidden = !interactive;
    const unfreezeLink = $('unfreeze-link');
    unfreezeLink.hidden = !(staticMode && !connected && s.repoUrl);
    if (s.repoUrl) unfreezeLink.href = `${s.repoUrl}/actions/workflows/unfreeze.yml`;
    showConnectOffer(true);
    return;
  }
  active.hidden = true;
  if (s.members.length === 0) {
    card.hidden = true;
    return;
  }
  if (s.canFreeze?.ok) {
    card.hidden = false;
    offer.hidden = false;
    hint.hidden = true;
    $('freeze-btn').hidden = !interactive;
    $('freeze-days').closest('label').hidden = !interactive;
    const freezeLink = $('freeze-link');
    freezeLink.hidden = !(staticMode && !connected && s.repoUrl);
    if (s.repoUrl) freezeLink.href = `${s.repoUrl}/actions/workflows/freeze.yml`;
    showConnectOffer(true);
  } else if (s.todayComplete && !staticMode) {
    // Solved, but too late in the day to freeze — say why.
    card.hidden = false;
    offer.hidden = true;
    hint.textContent = `🧊 ${s.canFreeze?.reason ?? ''}`;
    hint.hidden = false;
    showConnectOffer(false);
  } else {
    card.hidden = true;
  }
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
  } else if (latest.frozenToday) {
    dot = '❄️';
    detailClass = 'pending';
    detailText = 'Day off — streak is frozen';
  } else {
    dot = '⏳';
    detailClass = 'pending';
    detailText = 'Nothing solved yet today';
  }

  const controls = staticMode
    ? ''
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

  if (staticMode) return el;

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
  btn.disabled = true;
  btn.textContent = 'Checking LeetCode…';
  try {
    const data = Object.fromEntries(new FormData(form));
    data.notifyEmail = form.notifyEmail.checked;
    data.notifySms = form.notifySms.checked;
    await api('/api/members', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add to streak';
  }
});

const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

$('freeze-btn').addEventListener('click', async () => {
  const btn = $('freeze-btn');
  const days = Number($('freeze-days').value);
  btn.disabled = true;
  await freezeAction(async (progress) => {
    if (staticMode) {
      await runWorkflow('freeze.yml', { days: String(days) }, progress, (s) => {
        // Freeze starts tomorrow, so today isn't frozen yet — the card just
        // flips to the active-freeze state.
        s.freeze = { from: addDays(s.today, 1), until: addDays(s.today, days) };
      });
    } else {
      await api('/api/freeze', { method: 'POST', body: JSON.stringify({ days }) });
      latest = await api('/api/status');
    }
  });
  btn.disabled = false;
});

$('unfreeze-btn').addEventListener('click', async () => {
  if (!confirm('Unfreeze the streak? Daily solves are required again starting today.')) return;
  const btn = $('unfreeze-btn');
  btn.disabled = true;
  await freezeAction(async (progress) => {
    if (staticMode) {
      await runWorkflow('unfreeze.yml', undefined, progress, (s) => {
        s.freeze = null;
        s.frozenToday = false;
        // Mirror computeStreak: an unfrozen day with an unsolved member and a
        // running streak is back at risk. Reconcile fixes it either way.
        s.atRisk = s.streak > 0 && !s.todayComplete;
      });
    } else {
      await api('/api/freeze', { method: 'DELETE' });
      latest = await api('/api/status');
    }
  });
  btn.disabled = false;
});

$('show-token').addEventListener('click', (e) => {
  e.preventDefault();
  $('token-panel').hidden = !$('token-panel').hidden;
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
    await gh('/actions/workflows?per_page=1');
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
