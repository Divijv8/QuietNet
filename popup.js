// QuietNet dashboard (popup + full-tab view)

const COLORS = ['#4285F4', '#E8338A', '#FBBC04', '#34A853', '#F57C00', '#EA4335'];
const OTHER_COLOR = '#9AA0A6';
const LIMIT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const RANGES = {
  today: { label: 'Today', days: 1, offset: 0 },
  yesterday: { label: 'Yesterday', days: 1, offset: 1 },
  week: { label: 'Last 7 days', days: 7, offset: 0 },
  month: { label: 'Last 30 days', days: 30, offset: 0 }
};

const state = {
  settings: mergeSettings(null),
  range: 'today',
  chartMode: 'donut',
  data: { sites: [], total: 0, visits: 0, blocked: 0, days: {} },
  today: emptyDay()
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function favicon(domain) {
  const src = chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent('https://' + domain)}&size=32`
  );
  const img = el('img', { class: 'fav', src, alt: '' });
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

function siteLabel(domain) {
  if (domain === 'Other') return 'Other';
  let n = domain.replace(/\.(com|org|net|io|co|in|app|dev|ai|me|tv|gg|edu|gov)(\.[a-z]{2})?$/, '');
  n = n.charAt(0).toUpperCase() + n.slice(1);
  return n.length > 12 ? n.slice(0, 11) + '…' : n;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function rangeDates(range) {
  const { days, offset } = RANGES[range];
  const out = [];
  for (let i = offset; i < offset + days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

async function loadData() {
  const dates = rangeDates(state.range);
  const keys = dates.map(d => dayKey(d));
  const todayKey = dayKey();
  const stored = await chrome.storage.local.get([...new Set([...keys, todayKey, 'settings'])]);

  state.settings = mergeSettings(stored.settings);
  state.today = stored[todayKey] || emptyDay();

  const sites = {};
  let blocked = 0;
  const days = {};
  for (const key of keys) {
    const day = stored[key];
    if (!day) continue;
    days[key.slice(4)] = day;
    blocked += day.blocked || 0;
    for (const [domain, v] of Object.entries(day.sites || {})) {
      const s = (sites[domain] ||= { domain, time: 0, visits: 0 });
      s.time += v.time || 0;
      s.visits += v.visits || 0;
    }
  }
  const list = Object.values(sites).filter(s => s.time > 0 || s.visits > 0)
    .sort((a, b) => b.time - a.time);

  state.data = {
    sites: list,
    total: list.reduce((a, s) => a + s.time, 0),
    visits: list.reduce((a, s) => a + s.visits, 0),
    blocked,
    days
  };
}

async function refreshAll() {
  await loadData();
  applyTheme(state.settings.theme);
  renderStats();
  // Don't yank the chart / lists out from under the user while they interact.
  if (!$('#chart').matches(':hover')) renderChart();
  renderTiles();
  if (!$('#view-limits').contains(document.activeElement)) renderLimits();
  renderSettings();
}
const refreshSoon = debounce(refreshAll, 150);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeLabel').textContent = theme === 'dark' ? 'Dark' : 'Light';
  try { localStorage.setItem('qn-theme', theme); } catch {}
}

// ---------------------------------------------------------------------------
// Dashboard: stats
// ---------------------------------------------------------------------------
function renderStats() {
  const { data, settings } = state;
  $('#statVisits').textContent = data.visits;
  $('#statSites').textContent = data.sites.filter(s => s.time > 0).length;
  $('#statBlocked').textContent = data.blocked;
  $('#statLimits').textContent = Object.keys(settings.limits).length;
}

// ---------------------------------------------------------------------------
// Dashboard: chart
// ---------------------------------------------------------------------------
function chartSegments() {
  const sites = state.data.sites.filter(s => s.time > 0);
  const top = sites.slice(0, 6).map((s, i) => ({ ...s, color: COLORS[i] }));
  const restTime = sites.slice(6).reduce((a, s) => a + s.time, 0);
  if (restTime > 0) top.push({ domain: 'Other', time: restTime, color: OTHER_COLOR, other: true });
  return top;
}

function renderChart() {
  const box = $('#chart');
  box.replaceChildren();
  if (state.chartMode === 'bars') renderBars(box);
  else renderDonut(box);
}

function renderDonut(box) {
  const W = 410, H = 340, cx = 205, cy = 170, r = 102, labelR = 124;
  const segs = chartSegments();
  const total = segs.reduce((a, s) => a + s.time, 0);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'donut', role: 'img' });

  // Center text
  const cap = svgEl('text', { x: cx, y: cy - 22, 'text-anchor': 'middle', class: 'center-cap' });
  const val = svgEl('text', { x: cx, y: cy + 8, 'text-anchor': 'middle', class: 'center-val' });
  const sub = svgEl('text', { x: cx, y: cy + 30, 'text-anchor': 'middle', class: 'center-sub' });
  const siteCount = state.data.sites.filter(s => s.time > 0).length;
  const resetCenter = () => {
    cap.textContent = RANGES[state.range].label;
    val.textContent = formatDuration(state.data.total);
    sub.textContent = total ? `across ${siteCount} site${siteCount === 1 ? '' : 's'}` : 'Start browsing to see stats';
  };
  resetCenter();
  svg.setAttribute('aria-label', `${RANGES[state.range].label}: ${formatDuration(state.data.total)}`);

  if (!total) {
    svg.append(svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': 10 }));
    svg.append(cap, val, sub);
    box.append(svg);
    return;
  }

  const gap = segs.length > 1 ? 0.045 : 0; // radians between segments
  let angle = -Math.PI / 2;
  const labels = [];
  const segNodes = [];

  for (const seg of segs) {
    const sweep = (seg.time / total) * Math.PI * 2;
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    let node;
    if (segs.length === 1) {
      node = svgEl('circle', { cx, cy, r, fill: 'none' });
    } else {
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const p1 = [cx + r * Math.cos(Math.max(a1, a0 + 0.001)), cy + r * Math.sin(Math.max(a1, a0 + 0.001))];
      const large = a1 - a0 > Math.PI ? 1 : 0;
      node = svgEl('path', { d: `M${p0[0]} ${p0[1]} A${r} ${r} 0 ${large} 1 ${p1[0]} ${p1[1]}`, fill: 'none' });
    }
    node.setAttribute('stroke', seg.color);
    node.setAttribute('stroke-width', 10);
    node.setAttribute('class', 'seg');
    const title = svgEl('title');
    title.textContent = `${seg.other ? 'Other sites' : seg.domain} · ${formatDuration(seg.time)}`;
    node.append(title);

    node.addEventListener('mouseenter', () => {
      segNodes.forEach(n => n.classList.toggle('dim', n !== node));
      node.classList.add('hot');
      cap.textContent = seg.other ? 'Other sites' : seg.domain;
      val.textContent = formatDuration(seg.time);
      sub.textContent = `${Math.round((seg.time / total) * 100)}% of your time`;
    });
    node.addEventListener('mouseleave', () => {
      segNodes.forEach(n => n.classList.remove('dim', 'hot'));
      resetCenter();
    });
    if (!seg.other) node.addEventListener('click', () => openLimitsFor(seg.domain));

    segNodes.push(node);
    svg.append(node);

    if (seg.time / total >= 0.035) {
      const mid = angle + sweep / 2;
      labels.push({ text: siteLabel(seg.domain), mid, x: cx + labelR * Math.cos(mid), y: cy + labelR * Math.sin(mid) });
    }
    angle += sweep;
  }

  // Keep labels from overlapping: on each side, push them apart vertically.
  for (const side of [l => Math.cos(l.mid) >= 0, l => Math.cos(l.mid) < 0]) {
    const group = labels.filter(side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.length; i++) {
      if (group[i].y - group[i - 1].y < 16) group[i].y = group[i - 1].y + 16;
    }
  }
  for (const l of labels) {
    const c = Math.cos(l.mid);
    const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
    const dy = Math.sin(l.mid) > 0.6 ? 10 : Math.sin(l.mid) < -0.6 ? -2 : 4;
    const t = svgEl('text', { x: l.x, y: l.y + dy, 'text-anchor': anchor, class: 'lbl' });
    t.textContent = l.text;
    svg.append(t);
  }

  svg.append(cap, val, sub);
  box.append(svg);
}

function renderBars(box) {
  const sites = state.data.sites.filter(s => s.time > 0).slice(0, 12);
  const wrap = el('div', { class: 'bars' },
    el('div', { class: 'bars-head' },
      el('span', { class: 'cap', text: RANGES[state.range].label }),
      el('span', { class: 'total', text: formatDuration(state.data.total) })
    )
  );
  if (!sites.length) {
    wrap.append(el('p', { class: 'empty-chart', text: 'Start browsing to see your stats.' }));
  }
  const max = sites[0]?.time || 1;
  sites.forEach((s, i) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.width = Math.max(2, (s.time / max) * 100) + '%';
    fill.style.background = COLORS[i] || OTHER_COLOR;
    const row = el('div', { class: 'bar-row', title: `${s.domain} · ${s.visits} visit${s.visits === 1 ? '' : 's'}` },
      favicon(s.domain),
      el('span', { class: 'bar-name', text: s.domain }),
      el('span', { class: 'bar-time', text: formatDuration(s.time, { short: true }) }),
      el('span'),
      el('div', { class: 'bar-track' }, fill)
    );
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openLimitsFor(s.domain));
    wrap.append(row);
  });
  box.append(wrap);
}

// ---------------------------------------------------------------------------
// Dashboard: control tiles
// ---------------------------------------------------------------------------
function setTile(id, on) {
  const tile = $(id);
  tile.classList.toggle('on', on);
  tile.setAttribute('aria-pressed', String(on));
  const st = tile.querySelector('.tile-state');
  if (st) st.textContent = on ? 'ON' : 'OFF';
}

function renderTiles() {
  const s = state.settings;
  const now = Date.now();

  // Bedtime
  const bedOn = s.bedtime.enabled;
  const bedActive = isBedtimeNow(s.bedtime);
  setTile('#tileBedtime', bedOn);
  $('#bedtimeTitle').textContent = `Bedtime Mode ${bedOn ? 'ON' : 'OFF'}${bedActive ? ' · active now' : ''}`;
  $('#bedtimeRange').textContent = `From ${format12h(s.bedtime.start)} to ${format12h(s.bedtime.end)}`;

  // Focus
  const focusOn = isFocusActive(s, now);
  setTile('#tileFocus', focusOn);
  if (focusOn && s.focus.until) {
    const left = Math.max(1, Math.ceil((s.focus.until - now) / 60000));
    $('#focusSub').textContent = `${left} min left · tap to stop`;
  } else if (focusOn) {
    $('#focusSub').textContent = 'Tap to stop';
  } else {
    $('#focusSub').textContent = s.focus.minutes ? `Block distractions for ${s.focus.minutes} min` : 'Blocks distracting sites';
  }

  setTile('#tileDnd', s.dnd);
  setTile('#tileMute', s.mute);
  setTile('#tileHeadsUp', s.headsUp.on);
  $('#headsUpSub').textContent = `Break nudge every ${s.headsUp.minutes} min`;
}

async function toggle(name) {
  const s = state.settings;
  let patch;
  let msg;
  switch (name) {
    case 'bedtime':
      patch = { bedtime: { ...s.bedtime, enabled: !s.bedtime.enabled } };
      msg = patch.bedtime.enabled
        ? `Bedtime on: ${format12h(s.bedtime.start)} – ${format12h(s.bedtime.end)}`
        : 'Bedtime Mode off';
      break;
    case 'focus': {
      const on = !isFocusActive(s);
      const until = on && s.focus.minutes ? Date.now() + s.focus.minutes * 60000 : null;
      patch = { focus: { ...s.focus, on, until } };
      msg = on ? `Focus on${s.focus.minutes ? ` for ${s.focus.minutes} min` : ''}: distracting sites blocked` : 'Focus Mode off';
      break;
    }
    case 'dnd':
      patch = { dnd: !s.dnd };
      msg = patch.dnd ? 'Site notifications silenced' : 'Site notifications allowed again';
      break;
    case 'mute':
      patch = { mute: !s.mute };
      msg = patch.mute ? 'All tabs muted' : 'Tabs unmuted';
      break;
    case 'headsUp':
      patch = { headsUp: { ...s.headsUp, on: !s.headsUp.on } };
      msg = patch.headsUp.on ? `Break reminders every ${s.headsUp.minutes} min` : 'Break reminders off';
      break;
  }
  state.settings = await saveSettings(patch);
  renderTiles();
  toast(msg);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function allKnownDomains() {
  const map = new Map();
  for (const s of state.data.sites) map.set(s.domain, s.time);
  for (const [d, v] of Object.entries(state.today.sites || {})) if (!map.has(d)) map.set(d, v.time);
  for (const d of Object.keys(state.settings.limits)) if (!map.has(d)) map.set(d, 0);
  for (const d of state.settings.distracting) if (!map.has(d)) map.set(d, 0);
  return [...map.entries()].map(([domain, time]) => ({ domain, time }));
}

function renderSearch() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#searchResults');
  if (!q) { box.hidden = true; return; }
  const matches = allKnownDomains()
    .filter(s => s.domain.includes(q))
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);
  box.replaceChildren();
  if (!matches.length) {
    const typed = normalizeDomain(q);
    if (typed) {
      box.append(el('button', { class: 'result', onclick: () => openLimitsFor(typed) },
        favicon(typed), el('span', { class: 'r-name', text: `Set a limit for ${typed}` })));
    } else {
      box.append(el('div', { class: 'empty', text: 'No matching sites yet' }));
    }
  }
  for (const m of matches) {
    box.append(el('button', { class: 'result', onclick: () => openLimitsFor(m.domain) },
      favicon(m.domain),
      el('span', { class: 'r-name', text: m.domain }),
      el('span', { class: 'r-time', text: m.time ? formatDuration(m.time, { short: true }) : '—' })
    ));
  }
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function showView(name) {
  $$('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}

function openLimitsFor(domain) {
  $('#search').value = '';
  $('#searchResults').hidden = true;
  showView('limits');
  const row = $(`.limit-row[data-domain="${CSS.escape(domain)}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    row.querySelector('select')?.focus();
  } else {
    $('#limitDomain').value = domain;
    $('#limitMinutes').focus();
  }
}

// ---------------------------------------------------------------------------
// Limits view
// ---------------------------------------------------------------------------
function limitSelect(current) {
  const sel = el('select', { 'aria-label': 'Daily limit' });
  sel.append(el('option', { value: '0', text: 'No limit' }));
  const opts = [...LIMIT_OPTIONS];
  if (current && !opts.includes(current)) opts.push(current), opts.sort((a, b) => a - b);
  for (const m of opts) {
    sel.append(el('option', { value: String(m), text: m < 60 ? `${m} min` : `${m / 60} hr` }));
  }
  sel.value = String(current || 0);
  return sel;
}

async function setLimit(domain, minutes) {
  const limits = { ...state.settings.limits };
  if (minutes > 0) limits[domain] = minutes;
  else delete limits[domain];
  state.settings = await saveSettings({ limits });
  renderLimits();
  renderStats();
}

function renderLimits() {
  const { settings, today } = state;
  const list = $('#limitList');
  list.replaceChildren();

  const todaySites = Object.entries(today.sites || {})
    .map(([domain, v]) => ({ domain, time: v.time || 0 }))
    .filter(s => s.time > 0)
    .sort((a, b) => b.time - a.time);

  const limited = Object.keys(settings.limits).map(domain => ({ domain, time: usageFor(today, domain) }))
    .sort((a, b) => b.time - a.time);
  const others = todaySites.filter(s => !findLimit(settings, s.domain)).slice(0, 15);

  if (!limited.length && !others.length) {
    list.append(el('div', { class: 'empty-note', text: 'Sites you use today will show up here so you can limit them.' }));
  }

  for (const s of [...limited, ...others]) {
    const minutes = settings.limits[s.domain] || 0;
    const sel = limitSelect(minutes);
    sel.addEventListener('change', () => {
      const m = Number(sel.value);
      setLimit(s.domain, m);
      toast(m ? `${s.domain}: ${sel.selectedOptions[0].text} a day` : `Limit removed for ${s.domain}`);
    });
    const over = minutes && s.time >= minutes * 60;
    const usage = minutes
      ? `${formatDuration(s.time)} of ${formatDuration(minutes * 60)} today${over ? ' · limit reached' : ''}`
      : `${formatDuration(s.time)} today`;
    const row = el('div', { class: 'limit-row' + (over ? ' over' : ''), 'data-domain': s.domain },
      favicon(s.domain),
      el('div', {},
        el('div', { class: 'limit-name', text: s.domain }),
        el('div', { class: 'limit-use', text: usage })
      ),
      sel
    );
    if (minutes) {
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = Math.min(100, (s.time / (minutes * 60)) * 100) + '%';
      fill.style.background = 'var(--accent)';
      row.append(el('span'), el('div', { class: 'bar-track' }, fill));
    }
    list.append(row);
  }

  // Distracting sites chips
  const chips = $('#distractList');
  chips.replaceChildren();
  if (!settings.distracting.length) {
    chips.append(el('div', { class: 'empty-note', text: 'No sites yet.' }));
  }
  for (const d of settings.distracting) {
    const remove = el('button', { title: `Remove ${d}`, 'aria-label': `Remove ${d}` });
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    remove.addEventListener('click', async () => {
      state.settings = await saveSettings({ distracting: settings.distracting.filter(x => x !== d) });
      renderLimits();
    });
    chips.append(el('span', { class: 'chip' }, favicon(d), el('span', { text: d }), remove));
  }
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------
function renderSettings() {
  const s = state.settings;
  const active = document.activeElement;
  const setIfIdle = (sel, prop, value) => { const n = $(sel); if (n !== active) n[prop] = value; };
  setIfIdle('#setBedtimeOn', 'checked', s.bedtime.enabled);
  setIfIdle('#setBedStart', 'value', s.bedtime.start);
  setIfIdle('#setBedEnd', 'value', s.bedtime.end);
  setIfIdle('#setFocusMinutes', 'value', String(s.focus.minutes));
  setIfIdle('#setHeadsUpMinutes', 'value', String(s.headsUp.minutes));
}

function armConfirm(button, label, action) {
  let armed = false;
  let timer;
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = 'Tap again to confirm';
      timer = setTimeout(() => { armed = false; button.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = label;
    await action();
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function exportCsv() {
  const rows = [['date', 'site', 'minutes', 'seconds', 'visits']];
  const dates = Object.keys(state.data.days).sort();
  for (const date of dates) {
    const sites = Object.entries(state.data.days[date].sites || {}).sort((a, b) => b[1].time - a[1].time);
    for (const [domain, v] of sites) {
      rows.push([date, domain, ((v.time || 0) / 60).toFixed(1), v.time || 0, v.visits || 0]);
    }
  }
  if (rows.length === 1) { toast('Nothing to export for this range yet'); return; }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = el('a', { href: url, download: `quietnet-${state.range}-${localDate()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exported CSV');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wire() {
  if (new URLSearchParams(location.search).has('tab')) document.documentElement.classList.add('in-tab');

  $$('.rail-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#statLimitsCard').addEventListener('click', () => showView('limits'));

  $('#themeToggle').addEventListener('click', async () => {
    const theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    state.settings = await saveSettings({ theme });
  });

  $('#openTab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') });
    window.close();
  });

  // Range menu
  const menu = $('#rangeMenu');
  $('#rangeBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    $('#rangeLabel').textContent = RANGES[state.range].label;
    $$('#rangeMenu button').forEach(b => b.classList.toggle('selected', b === btn));
    menu.hidden = true;
    await refreshAll();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.range')) menu.hidden = true;
    if (!e.target.closest('.search')) $('#searchResults').hidden = true;
  });

  $('#exportBtn').addEventListener('click', exportCsv);

  // Chart mode
  $$('.chart-toggle button').forEach(b => b.addEventListener('click', () => {
    state.chartMode = b.dataset.mode;
    $$('.chart-toggle button').forEach(x => x.classList.toggle('active', x === b));
    try { localStorage.setItem('qn-chart', state.chartMode); } catch {}
    renderChart();
  }));

  // Tiles
  $('#tileBedtime').addEventListener('click', () => toggle('bedtime'));
  $('#tileFocus').addEventListener('click', () => toggle('focus'));
  $('#tileDnd').addEventListener('click', () => toggle('dnd'));
  $('#tileMute').addEventListener('click', () => toggle('mute'));
  $('#tileHeadsUp').addEventListener('click', () => toggle('headsUp'));

  // Search
  const search = $('#search');
  search.addEventListener('input', renderSearch);
  search.addEventListener('focus', renderSearch);
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#searchResults .result')?.click();
    if (e.key === 'Escape') { search.value = ''; renderSearch(); search.blur(); }
  });

  // Limits
  const minutesSel = $('#limitMinutes');
  for (const m of LIMIT_OPTIONS) minutesSel.append(el('option', { value: String(m), text: m < 60 ? `${m} min` : `${m / 60} hr` }));
  minutesSel.value = '30';
  $('#addLimitForm').addEventListener('submit', async e => {
    e.preventDefault();
    const domain = normalizeDomain($('#limitDomain').value);
    if (!domain) { toast('Enter a site like youtube.com'); return; }
    await setLimit(domain, Number(minutesSel.value));
    $('#limitDomain').value = '';
    toast(`${domain}: ${minutesSel.selectedOptions[0].text} a day`);
  });
  $('#addDistractForm').addEventListener('submit', async e => {
    e.preventDefault();
    const domain = normalizeDomain($('#distractDomain').value);
    if (!domain) { toast('Enter a site like youtube.com'); return; }
    if (!state.settings.distracting.includes(domain)) {
      state.settings = await saveSettings({ distracting: [...state.settings.distracting, domain] });
    }
    $('#distractDomain').value = '';
    renderLimits();
  });

  // Settings
  $('#setBedtimeOn').addEventListener('change', async e => {
    state.settings = await saveSettings({ bedtime: { ...state.settings.bedtime, enabled: e.target.checked } });
    renderTiles();
  });
  const saveBedTimes = async () => {
    const start = $('#setBedStart').value || '23:00';
    const end = $('#setBedEnd').value || '06:00';
    state.settings = await saveSettings({ bedtime: { ...state.settings.bedtime, start, end } });
    renderTiles();
  };
  $('#setBedStart').addEventListener('change', saveBedTimes);
  $('#setBedEnd').addEventListener('change', saveBedTimes);
  $('#setFocusMinutes').addEventListener('change', async e => {
    state.settings = await saveSettings({ focus: { ...state.settings.focus, minutes: Number(e.target.value) } });
    renderTiles();
  });
  $('#setHeadsUpMinutes').addEventListener('change', async e => {
    state.settings = await saveSettings({ headsUp: { ...state.settings.headsUp, minutes: Number(e.target.value) } });
    renderTiles();
  });

  armConfirm($('#clearToday'), 'Clear today', async () => {
    await chrome.storage.local.remove(dayKey());
    toast("Today's data cleared");
  });
  armConfirm($('#clearAll'), 'Clear all data', async () => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('day:') || k === 'snooze'));
    toast('All browsing data cleared');
  });

  // Live updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') refreshSoon();
  });
  setInterval(() => chrome.runtime.sendMessage({ type: 'flush' }).catch(() => {}), 10000);
  setInterval(renderTiles, 15000);
}

(async function main() {
  try {
    const t = localStorage.getItem('qn-theme');
    if (t) document.documentElement.dataset.theme = t;
    const mode = localStorage.getItem('qn-chart');
    if (mode === 'bars' || mode === 'donut') {
      state.chartMode = mode;
      $$('.chart-toggle button').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
    }
  } catch {}

  wire();
  $$('#rangeMenu button')[0].classList.add('selected');
  await refreshAll();
  requestAnimationFrame(() => document.body.classList.remove('preload'));
  // Bring numbers up to the second, then redraw.
  chrome.runtime.sendMessage({ type: 'flush' }).then(refreshAll, () => {});
})();
