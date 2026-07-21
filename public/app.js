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
    throw new Error('The token can\'t do that — make sure it has "Contents", "Actions", and "Secrets" all set to Read and write for this repository.');
  }
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  return res.status === 204 ? null : res.json();
}

// --- Writing GitHub Actions secrets from the browser -----------------------
// GitHub never accepts a secret's plaintext — it has to be sealed-box
// encrypted (libsodium) against the repo's public key first, which is what
// `gh secret set` does under the hood. The crypto library (~1MB) is only
// loaded the first time it's actually needed, not on every page visit.
// Pinned to exact versions with Subresource Integrity hashes, so the
// browser refuses to run the script at all if the CDN ever serves anything
// other than the exact bytes verified when these were pinned.
const SODIUM_SCRIPTS = [
  {
    src: 'https://cdn.jsdelivr.net/npm/libsodium@0.8.4/dist/modules/libsodium.js',
    integrity: 'sha384-3KUAqev6nUaNHDSTa/UjyEycVN8iMfq/UtzKf3ZDTuGSb+P3y9kMu/WCVqnLAxUB',
  },
  {
    src: 'https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.15/dist/modules/libsodium-wrappers.js',
    integrity: 'sha384-Ke/M093F2nkCtYtfjMexgZEIU3S3EqPl8ZLZC52CSafBgRHrvz5ToAuVGFrWCoGy',
  },
];

let sodiumLoading = null;
function loadSodium() {
  if (sodiumLoading) return sodiumLoading;
  const loadScript = ({ src, integrity }) =>
    new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.integrity = integrity;
      el.crossOrigin = 'anonymous';
      el.onload = resolve;
      el.onerror = () =>
        reject(new Error(`Failed to load ${src} (blocked, offline, or integrity mismatch)`));
      document.head.appendChild(el);
    });
  sodiumLoading = (async () => {
    for (const script of SODIUM_SCRIPTS) await loadScript(script);
    await window.sodium.ready;
    return window.sodium;
  })();
  return sodiumLoading;
}

async function writeSecret(name, plaintext) {
  const sodium = await loadSodium();
  const { key, key_id } = await gh('/actions/secrets/public-key');
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(plaintext),
    sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
  );
  await gh(`/actions/secrets/${name}`, {
    method: 'PUT',
    body: JSON.stringify({
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id,
    }),
  });
}

// --- Local shadow copy of BUDDY_CONFIG --------------------------------------
// Secrets can never be read back via the API, so editing members/settings
// from this page requires this browser to hold its own working copy — the
// dashboard's public status.json only ever has names/usernames, never
// emails/ntfy topics. On first use in a browser, the existing BUDDY_CONFIG value
// has to be pasted in once to seed this; after that, edits made here keep it
// in sync. If BUDDY_CONFIG is ever edited elsewhere (Settings, another
// device), re-paste it here to pick up that change before editing again.
const SHADOW_KEY = 'lcbuddy_shadow_config';
const getShadowConfig = () => {
  try {
    return JSON.parse(localStorage.getItem(SHADOW_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const setShadowConfig = (config) => localStorage.setItem(SHADOW_KEY, JSON.stringify(config));

// Applies a new member list to `latest` for immediate display, preserving
// today's solve status for members we already knew about (a brand new
// member's status is genuinely unknown until the next scheduled check).
function mergeOptimisticMembers(members) {
  const prevById = new Map(latest.members.map((m) => [m.id, m]));
  latest.members = members.map((m) => {
    const id = m.leetcodeUsername.toLowerCase();
    const prev = prevById.get(id);
    return {
      id,
      name: m.name,
      leetcodeUsername: m.leetcodeUsername,
      notifyEmail: Boolean(m.notifyEmail),
      notifyNtfy: Boolean(m.notifyNtfy),
      solvedToday: prev?.solvedToday ?? false,
      solvedCountToday: prev?.solvedCountToday ?? 0,
      lastSolve: prev?.lastSolve ?? null,
      error: prev?.error ?? null,
    };
  });
  latest.todayComplete =
    latest.members.length > 0 && latest.members.every((m) => m.solvedToday);
}

// Writes a full BUDDY_CONFIG value from the shadow copy, updates the shadow,
// and reflects the change in the UI immediately.
async function saveShadowConfig(config, message) {
  await writeSecret('BUDDY_CONFIG', JSON.stringify(config, null, 2) + '\n');
  setShadowConfig(config);
  mergeOptimisticMembers(config.members);
  nudgeRebuild();
  reconcileFromCdn(latest.generatedAt);
}

// Writes freeze.json directly via GitHub's Contents API (browser-callable —
// api.github.com sends permissive CORS headers, unlike leetcode.com). This
// needs the token's "Contents" permission, not just "Actions": the browser
// commits the file itself instead of asking a workflow to do it, so both
// freeze and unfreeze apply in ~1 request round trip instead of waiting on a
// workflow run.
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function writeFreezeFile(newFreezeValue, message) {
  const { sha } = await gh('/contents/freeze.json?ref=main');
  const content = toBase64(JSON.stringify({ freeze: newFreezeValue }, null, 2) + '\n');
  await gh('/contents/freeze.json', {
    method: 'PUT',
    body: JSON.stringify({ message, content, sha, branch: 'main' }),
  });
}

// Client-side port of lib/status.js's freezeEligibility, run against the
// already-loaded (possibly up to ~15 min stale) status snapshot — the
// browser can't re-poll LeetCode itself (no CORS from leetcode.com), so this
// trusts the last scheduled check rather than guaranteeing a live one.
const FREEZE_MIN_HOURS_LEFT = 8;
const FREEZE_MAX_DAYS = 14;

function hoursUntilMidnightClient(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return 24 - (get('hour') % 24) - get('minute') / 60;
}

function freezeEligibilityClient(s) {
  if (s.members.length === 0) return { ok: false, reason: 'No members yet.' };
  if (s.freeze && s.freeze.until >= s.today) {
    return { ok: false, reason: `Already frozen through ${s.freeze.until}.` };
  }
  if (!s.todayComplete) {
    return { ok: false, reason: 'Everyone must solve today before you can freeze.' };
  }
  const hoursLeft = hoursUntilMidnightClient(s.timezone);
  if (hoursLeft < FREEZE_MIN_HOURS_LEFT) {
    return {
      ok: false,
      reason: `Freezing closes ${FREEZE_MIN_HOURS_LEFT}h before midnight — too late for today.`,
    };
  }
  return { ok: true, reason: null };
}

// Best-effort nudge so other visitors' copies catch up sooner than the next
// 15-min scheduled tick. Never blocks or surfaces an error — the clicking
// user's own view is already correct via the optimistic update either way.
function nudgeRebuild() {
  gh('/actions/workflows/streak.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main' }),
  }).catch(() => {});
}

// Dispatch a workflow and follow its run to completion. Once the run
// succeeds the freeze state has definitively changed, so we apply the known
// result to the UI immediately (via `optimistic`) rather than blocking on
// GitHub Pages' CDN, which can take another 10–40s to serve the rebuilt
// status.json. A background reconcile picks up the authoritative copy once
// the CDN catches up.
async function dispatchAndAwaitWorkflow(file, inputs, progress) {
  const startedAt = Date.now();
  progress('Asking GitHub…');
  await gh(`/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    body: JSON.stringify(inputs ? { ref: 'main', inputs } : { ref: 'main' }),
  });

  progress('GitHub is running it…');
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
    throw new Error(`GitHub run failed — check the log: ${run.html_url}`);
  }
  return run;
}

// Freeze/unfreeze specifically: once the run succeeds the new state is
// known, so we reflect it immediately (via `optimistic`) rather than
// blocking on GitHub Pages' CDN, which can take another 10–40s to serve the
// rebuilt status.json. A background reconcile picks up the authoritative
// copy once the CDN catches up.
async function runWorkflow(file, inputs, progress, optimistic) {
  await dispatchAndAwaitWorkflow(file, inputs, progress);
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
  // Connected static visitors get the real "add a buddy" hint too, not just local.
  const connected = staticMode && Boolean(getToken());
  $('solo-hint').hidden = (staticMode && !connected) || s.members.length !== 1;

  // Static mirror: management needs a connected token (writes secrets
  // directly); unconnected visitors are pointed at the repo secret instead.
  $('add-section').hidden = staticMode && !connected;
  $('settings-section').hidden = staticMode && !connected;
  $('delivery-section').hidden = !connected;
  $('remind-now').hidden = staticMode; // no static equivalent implemented
  $('add-cors-hint').hidden = !connected;
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

  // A connected visitor manages the group right here (bootstrap + form
  // below); unconnected visitors on an empty dashboard get the manual
  // secret-editing walkthrough instead of a dead end.
  const needsManualSetup = staticMode && !connected && s.members.length === 0;
  $('setup-card').hidden = !needsManualSetup;
  if (needsManualSetup && s.repoUrl) {
    $('setup-secrets-link').href = `${s.repoUrl}/settings/secrets/actions`;
    $('setup-run-link').href = `${s.repoUrl}/actions/workflows/streak.yml`;
    $('setup-readme-link').href = `${s.repoUrl}#readme`;
  }
  $('members-section').hidden = needsManualSetup;

  // Add-form needs a loaded shadow copy before it can safely write
  // BUDDY_CONFIG (otherwise it would clobber members it can't see).
  const shadow = connected ? getShadowConfig() : null;
  $('shadow-bootstrap').hidden = !(connected && !shadow);
  $('add-form').hidden = connected && !shadow;

  // Surface a stale shadow proactively instead of only failing per-click:
  // BUDDY_CONFIG can change outside this browser (Settings, another
  // device, or a workflow), and the shadow has no way to notice on its own.
  if (shadow) {
    const shadowNames = new Set(shadow.members.map((m) => m.leetcodeUsername.toLowerCase()));
    const liveNames = new Set(s.members.map((m) => m.leetcodeUsername.toLowerCase()));
    const inSync =
      shadowNames.size === liveNames.size &&
      [...shadowNames].every((n) => liveNames.has(n));
    $('shadow-drift-warning').hidden = inSync;
  } else {
    $('shadow-drift-warning').hidden = true;
  }

  renderConnectSection(s, connected);
  renderFreeze(s);

  // Member cards
  const container = $('members');
  container.innerHTML = '';
  if (s.members.length === 0) {
    container.innerHTML = !staticMode || connected
      ? '<p class="hint">No one in the streak yet. Add yourself and your buddy below. 👇</p>'
      : '<p class="hint">No one in the streak yet.</p>';
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
    `ntfy: always available (no setup needed, just a per-person topic). ` +
    'Configure email in .env — see .env.example.';
}

// Top-of-page connect prompt/status — visible to every static-mode visitor
// regardless of member count or freeze state, so a brand-new dashboard with
// no group yet still surfaces the option instead of burying it inside a
// card that only appears once there's a streak to manage.
function renderConnectSection(s, connected) {
  const section = $('connect-section');
  section.hidden = !staticMode;
  if (!staticMode) return;

  const prompt = $('freeze-connect').querySelector('p.hint');
  const status = $('token-status');
  prompt.hidden = connected;
  $('token-panel').hidden = connected || $('token-panel').hidden;
  status.hidden = !connected;
  if (connected) {
    status.innerHTML =
      '⚡ Connected to GitHub — managing members, settings, and freeze/unfreeze right from this page. <a href="#" id="token-disconnect">Disconnect</a>';
    status.querySelector('#token-disconnect').addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem(TOKEN_KEY);
      render(latest);
    });
  }
}

function renderFreeze(s) {
  const card = $('freeze-card');
  const active = $('freeze-active');
  const offer = $('freeze-offer');
  const hint = $('freeze-hint');
  $('freeze-error').hidden = true;

  // Static mirror, two tiers: connected (token pasted) gets real one-click
  // buttons that dispatch the workflows via the GitHub API; unconnected gets
  // deep links to the workflows' Run forms.
  const connected = staticMode && Boolean(getToken());
  const interactive = !staticMode || connected;

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
  } else if (s.todayComplete && !staticMode) {
    // Solved, but too late in the day to freeze — say why.
    card.hidden = false;
    offer.hidden = true;
    hint.textContent = `🧊 ${s.canFreeze?.reason ?? ''}`;
    hint.hidden = false;
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

  const connected = staticMode && Boolean(getToken());
  const controls = staticMode && !connected
    ? ''
    : `<div class="controls">
        <label class="toggle"><input type="checkbox" data-field="notifyEmail" ${m.notifyEmail ? 'checked' : ''}/> email</label>
        <label class="toggle"><input type="checkbox" data-field="notifyNtfy" ${m.notifyNtfy ? 'checked' : ''}/> ntfy</label>
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

  if (staticMode && !connected) return el;

  // Connected static edits go through the shadow copy of BUDDY_CONFIG
  // (secrets can't be read back, so this browser's own cached copy is the
  // only source of truth it has for who else is in the group).
  const findInShadow = () => {
    const shadow = getShadowConfig();
    if (!shadow) {
      alert('Load your existing BUDDY_CONFIG above first, then try again.');
      return null;
    }
    const target = shadow.members.find(
      (sm) => sm.leetcodeUsername.toLowerCase() === m.id
    );
    if (!target) {
      alert(`${m.name} isn't in the loaded BUDDY_CONFIG copy — reload it above to pick up recent changes.`);
      return null;
    }
    return { shadow, target };
  };

  el.querySelectorAll('input[data-field]').forEach((box) => {
    box.addEventListener('change', async () => {
      if (staticMode) {
        const found = findInShadow();
        if (!found) {
          box.checked = !box.checked;
          return;
        }
        found.target[box.dataset.field] = box.checked;
        try {
          await saveShadowConfig(found.shadow, `Update ${m.name}`);
          render(latest);
        } catch (err) {
          box.checked = !box.checked;
          alert(err.message);
        }
      } else {
        await api(`/api/members/${m.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ [box.dataset.field]: box.checked }),
        }).catch((err) => alert(err.message));
      }
    });
  });
  el.querySelector('.remove').addEventListener('click', async () => {
    if (!confirm(`Remove ${m.name} from the streak?`)) return;
    if (staticMode) {
      // Must actually find the member in the shadow first — filtering blind
      // silently no-ops on a desynced shadow and still writes the (stale,
      // unchanged) copy back over BUDDY_CONFIG, which can revert other
      // real changes. findInShadow() alerts if it's missing.
      const found = findInShadow();
      if (!found) return;
      const config = {
        ...found.shadow,
        members: found.shadow.members.filter(
          (sm) => sm.leetcodeUsername.toLowerCase() !== m.id
        ),
      };
      try {
        await saveShadowConfig(config, `Remove ${m.name}`);
        render(latest);
      } catch (err) {
        alert(err.message);
      }
    } else {
      await api(`/api/members/${m.id}`, { method: 'DELETE' }).catch((err) =>
        alert(err.message)
      );
      refresh();
    }
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
  try {
    const data = Object.fromEntries(new FormData(form));
    const username = data.leetcodeUsername.trim();

    if (staticMode && getToken()) {
      btn.textContent = 'Saving to GitHub…';
      const shadow = getShadowConfig();
      if (!shadow) throw new Error('Load your existing BUDDY_CONFIG above first.');
      if (
        shadow.members.some(
          (m) => m.leetcodeUsername.toLowerCase() === username.toLowerCase()
        )
      ) {
        throw new Error(`${username} is already in the group.`);
      }
      const member = {
        name: (data.name ?? '').trim() || username,
        leetcodeUsername: username,
        email: (data.email ?? '').trim(),
        ntfyTopic: (data.ntfyTopic ?? '').trim(),
        notifyEmail: form.notifyEmail.checked,
        notifyNtfy: form.notifyNtfy.checked,
      };
      const config = { ...shadow, members: [...shadow.members, member] };
      await saveShadowConfig(config, `Add ${username}`);
    } else {
      btn.textContent = 'Checking LeetCode…';
      data.notifyEmail = form.notifyEmail.checked;
      data.notifyNtfy = form.notifyNtfy.checked;
      await api('/api/members', { method: 'POST', body: JSON.stringify(data) });
      latest = await api('/api/status');
    }
    form.reset();
    render(latest);
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
    if (staticMode && getToken()) {
      // Instant path: recheck eligibility against the loaded snapshot (up to
      // ~15 min stale — the browser can't re-poll LeetCode), then commit
      // freeze.json directly instead of dispatching a workflow.
      const eligibility = freezeEligibilityClient(latest);
      if (!eligibility.ok) throw new Error(eligibility.reason);
      progress('Writing to GitHub…');
      const freeze = { from: addDays(latest.today, 1), until: addDays(latest.today, days) };
      await writeFreezeFile(freeze, `Freeze streak (${days}d)`);
      latest.freeze = freeze;
      nudgeRebuild();
      reconcileFromCdn(latest.generatedAt);
    } else if (staticMode) {
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
    if (staticMode && getToken()) {
      // Unfreeze has no eligibility rule to bypass, so the instant path is
      // always safe here.
      progress('Writing to GitHub…');
      await writeFreezeFile(null, 'Unfreeze streak');
      latest.freeze = null;
      latest.frozenToday = false;
      // Mirror computeStreak: an unfrozen day with an unsolved member and a
      // running streak is back at risk. Reconcile fixes it either way.
      latest.atRisk = latest.streak > 0 && !latest.todayComplete;
      nudgeRebuild();
      reconcileFromCdn(latest.generatedAt);
    } else if (staticMode) {
      await runWorkflow('unfreeze.yml', undefined, progress, (s) => {
        s.freeze = null;
        s.frozenToday = false;
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
    // Cheap permission check before declaring victory — also doubles as the
    // first sha fetch a freeze/unfreeze write, and the first public-key
    // fetch a secret write, would each need anyway.
    await Promise.all([
      gh('/contents/freeze.json?ref=main'),
      gh('/actions/secrets/public-key'),
    ]);
    $('token-input').value = '';
    render(latest);
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('bootstrap-load').addEventListener('click', () => {
  const errEl = $('bootstrap-error');
  errEl.hidden = true;
  try {
    const config = JSON.parse($('bootstrap-input').value);
    if (!Array.isArray(config.members)) throw new Error('missing a "members" array');
    if (!config.settings?.timezone) throw new Error('missing "settings.timezone"');
    setShadowConfig(config);
    $('bootstrap-input').value = '';
    mergeOptimisticMembers(config.members);
    render(latest);
  } catch (err) {
    errEl.textContent = `That doesn't look like a valid BUDDY_CONFIG value: ${err.message}`;
    errEl.hidden = false;
  }
});

$('bootstrap-fresh').addEventListener('click', () => {
  if (
    !confirm(
      "Start a brand new, empty group? Only do this if BUDDY_CONFIG isn't already set to something you want to keep."
    )
  ) {
    return;
  }
  setShadowConfig({
    settings: {
      timezone: latest.timezone || latest.settings?.timezone || 'UTC',
      reminderHours: [12, 18, 21],
    },
    members: [],
  });
  render(latest);
});

$('save-credentials').addEventListener('click', async () => {
  const msg = $('credentials-msg');
  const btn = $('save-credentials');
  const fieldIds = ['smtp-host', 'smtp-port', 'smtp-user', 'smtp-pass', 'smtp-from'];
  const secretNames = {
    'smtp-host': 'SMTP_HOST',
    'smtp-port': 'SMTP_PORT',
    'smtp-user': 'SMTP_USER',
    'smtp-pass': 'SMTP_PASS',
    'smtp-from': 'SMTP_FROM',
  };
  const toWrite = fieldIds
    .map((id) => [id, $(id).value.trim()])
    .filter(([, value]) => value);

  msg.hidden = true;
  if (toWrite.length === 0) {
    msg.textContent = 'Nothing to save — fill in at least one field.';
    msg.className = 'form-error';
    msg.hidden = false;
    return;
  }
  btn.disabled = true;
  try {
    for (const [id, value] of toWrite) {
      await writeSecret(secretNames[id], value);
    }
    fieldIds.forEach((id) => ($(id).value = ''));
    msg.textContent = `Saved ✓ (${toWrite.map(([id]) => secretNames[id]).join(', ')})`;
    msg.className = 'form-error ok';
    msg.hidden = false;
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
    msg.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('save-settings').addEventListener('click', async () => {
  const msg = $('settings-msg');
  msg.hidden = true;
  try {
    const timezone = $('tz-input').value.trim();
    const reminderHours = $('hours-input')
      .value.split(',')
      .map((h) => h.trim())
      .filter(Boolean)
      .map(Number);

    if (staticMode && getToken()) {
      const shadow = getShadowConfig();
      if (!shadow) throw new Error('Load your existing BUDDY_CONFIG above first.');
      const config = { ...shadow, settings: { timezone, reminderHours } };
      await writeSecret('BUDDY_CONFIG', JSON.stringify(config, null, 2) + '\n');
      setShadowConfig(config);
      latest.settings = { timezone, reminderHours };
      nudgeRebuild();
      reconcileFromCdn(latest.generatedAt);
      render(latest); // reflect the optimistic update now, not the stale CDN copy
    } else {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone, reminderHours }) });
      refresh();
    }
    msg.textContent = 'Saved ✓';
    msg.className = 'form-error ok';
    msg.hidden = false;
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
    msg.hidden = false;
  }
});

$('test-notify-btn').addEventListener('click', async () => {
  const msg = $('settings-msg');
  const btn = $('test-notify-btn');
  btn.disabled = true;
  msg.hidden = true;
  try {
    let result;
    if (staticMode) {
      const progress = (text) => {
        msg.textContent = text;
        msg.className = 'form-error progress';
        msg.hidden = false;
      };
      const run = await dispatchAndAwaitWorkflow('test-notify.yml', undefined, progress);
      result = { message: `Test message workflow finished — check the run log for details: ${run.html_url}` };
    } else {
      result = await api('/api/test-notify', { method: 'POST' });
    }
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
