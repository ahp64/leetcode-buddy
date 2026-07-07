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

  if (s.freeze) {
    card.hidden = false;
    active.hidden = false;
    offer.hidden = true;
    hint.hidden = true;
    $('freeze-until').textContent = s.freeze.until;
    $('unfreeze-btn').hidden = staticMode;
    return;
  }
  active.hidden = true;
  if (staticMode || s.members.length === 0) {
    card.hidden = true;
    return;
  }
  if (s.canFreeze?.ok) {
    card.hidden = false;
    offer.hidden = false;
    hint.hidden = true;
  } else if (s.todayComplete) {
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

$('freeze-btn').addEventListener('click', async () => {
  const errEl = $('freeze-error');
  const btn = $('freeze-btn');
  errEl.hidden = true;
  btn.disabled = true;
  try {
    await api('/api/freeze', {
      method: 'POST',
      body: JSON.stringify({ days: Number($('freeze-days').value) }),
    });
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('unfreeze-btn').addEventListener('click', async () => {
  if (!confirm('Unfreeze the streak? Daily solves are required again starting today.')) return;
  await api('/api/freeze', { method: 'DELETE' }).catch((err) => alert(err.message));
  refresh();
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
