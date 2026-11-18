// Shared helpers used by the background service worker, the dashboard popup
// and the "blocked" page. Loaded with importScripts() in the worker and a
// plain <script> tag in the pages.

const DEFAULT_SETTINGS = {
  theme: 'light',
  focus: { on: false, until: null, minutes: 25 }, // minutes: 0 = until turned off
  bedtime: { enabled: false, start: '23:00', end: '06:00' },
  dnd: false,      // block web notifications on every site
  mute: false,     // mute every tab
  headsUp: { on: true, minutes: 45 }, // break reminders
  distracting: [
    'youtube.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com',
    'reddit.com', 'tiktok.com', 'netflix.com'
  ],
  limits: {} // domain -> minutes per day
};

const RETENTION_DAYS = 30;
const IDLE_SECONDS = 60;

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayKey(d = new Date()) {
  return 'day:' + localDate(d);
}

function emptyDay() {
  return { sites: {}, blocked: 0 };
}

function getDomain(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// Normalise whatever the user typed ("https://www.YouTube.com/watch") to "youtube.com"
function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = 'https://' + s;
  const d = getDomain(s);
  return d && d.includes('.') ? d : null;
}

// "m.youtube.com" matches the pattern "youtube.com"
function matchesDomain(domain, pattern) {
  return domain === pattern || domain.endsWith('.' + pattern);
}

function mergeSettings(s) {
  s = s || {};
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...s,
    focus: { ...d.focus, ...(s.focus || {}) },
    bedtime: { ...d.bedtime, ...(s.bedtime || {}) },
    headsUp: { ...d.headsUp, ...(s.headsUp || {}) },
    distracting: Array.isArray(s.distracting) ? s.distracting : [...d.distracting],
    limits: s.limits && typeof s.limits === 'object' ? s.limits : {}
  };
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeSettings(settings);
}

// Shallow-merge a patch into the stored settings (nested objects are replaced
// as a whole, so pass the full nested object when changing one).
async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isBedtimeNow(bedtime, date = new Date()) {
  if (!bedtime || !bedtime.enabled) return false;
  const start = timeToMinutes(bedtime.start);
  const end = timeToMinutes(bedtime.end);
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function isFocusActive(settings, now = Date.now()) {
  const f = settings.focus;
  return !!(f && f.on && (!f.until || f.until > now));
}

// Seconds spent today on every site matching `pattern`
function usageFor(day, pattern) {
  let total = 0;
  for (const [domain, v] of Object.entries((day && day.sites) || {})) {
    if (matchesDomain(domain, pattern)) total += v.time || 0;
  }
  return total;
}

function findLimit(settings, domain) {
  return Object.keys(settings.limits).find(p => matchesDomain(domain, p)) || null;
}

// Returns 'focus' | 'bedtime' | 'limit' | null
function blockReason(domain, settings, day, snooze, now = Date.now()) {
  if (!domain) return null;
  const snoozed = Object.entries(snooze || {}).some(
    ([p, until]) => until > now && matchesDomain(domain, p)
  );
  if (snoozed) return null;

  const distracting = settings.distracting.some(p => matchesDomain(domain, p));
  if (distracting && isFocusActive(settings, now)) return 'focus';
  if (distracting && isBedtimeNow(settings.bedtime, new Date(now))) return 'bedtime';

  const limitKey = findLimit(settings, domain);
  if (limitKey) {
    const minutes = Number(settings.limits[limitKey]) || 0;
    if (minutes > 0 && usageFor(day, limitKey) >= minutes * 60) return 'limit';
  }
  return null;
}

function formatDuration(seconds, { short = false } = {}) {
  seconds = Math.max(0, Math.round(seconds || 0));
  if (seconds < 60) return seconds === 0 ? '0 min' : `${seconds} sec`;
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (short) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function format12h(hhmm) {
  const total = timeToMinutes(hhmm);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
