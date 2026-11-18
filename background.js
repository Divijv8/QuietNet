importScripts('shared.js');

// ---------------------------------------------------------------------------
// Serial queue: every storage read-modify-write goes through here so that
// overlapping Chrome events can't overwrite each other's changes.
// ---------------------------------------------------------------------------
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(err => console.error('[QuietNet]', err));
  return run;
}

chrome.idle.setDetectionInterval(IDLE_SECONDS);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function updateToday(mutator) {
  const key = dayKey();
  const stored = (await chrome.storage.local.get(key))[key];
  const day = stored || emptyDay();
  day.sites = day.sites || {};
  mutator(day);
  await chrome.storage.local.set({ [key]: day });
  return day;
}

async function getToday() {
  const key = dayKey();
  return (await chrome.storage.local.get(key))[key] || emptyDay();
}

async function getSnooze() {
  return (await chrome.storage.local.get('snooze')).snooze || {};
}

// ---------------------------------------------------------------------------
// Time tracking
// session = { domain, tabId, lastTick } lives in session storage so it
// survives the service worker being suspended.
// ---------------------------------------------------------------------------
async function flush() {
  const { session } = await chrome.storage.session.get('session');
  if (!session) return;

  const now = Date.now();
  const elapsed = now - session.lastTick;

  // A huge gap means the computer slept or the worker was frozen;
  // don't credit that time to the site.
  if (elapsed > 5 * 60 * 1000 || elapsed < 0) {
    session.lastTick = now;
  } else {
    const secs = Math.floor(elapsed / 1000);
    if (secs > 0) {
      await updateToday(day => {
        const s = (day.sites[session.domain] ||= { time: 0, visits: 0 });
        s.time += secs;
      });
      session.lastTick += secs * 1000; // keep the leftover milliseconds
    }
  }
  await chrome.storage.session.set({ session });
}

// Which site (if any) is the user actually looking at right now?
async function currentTarget() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return null;
  const domain = getDomain(tab.url);
  if (!domain) return null;

  const state = await chrome.idle.queryState(IDLE_SECONDS);
  // Watching a video counts even when the mouse doesn't move.
  if (state === 'locked' || (state === 'idle' && !tab.audible)) return null;

  return { domain, tabId: tab.id };
}

async function refresh() {
  await flush();

  const target = await currentTarget();
  const { session, lastDomain } = await chrome.storage.session.get(['session', 'lastDomain']);

  if (!target) {
    if (session) await chrome.storage.session.remove('session');
    return;
  }

  if (!session || session.domain !== target.domain || session.tabId !== target.tabId) {
    if (target.domain !== lastDomain) {
      await updateToday(day => {
        const s = (day.sites[target.domain] ||= { time: 0, visits: 0 });
        s.visits += 1;
      });
    }
    await chrome.storage.session.set({
      session: { domain: target.domain, tabId: target.tabId, lastTick: Date.now() },
      lastDomain: target.domain
    });
  }
}

// ---------------------------------------------------------------------------
// Blocking (Focus mode, Bedtime, daily limits)
// ---------------------------------------------------------------------------
function blockedPageUrl(domain, reason, originalUrl) {
  const params = new URLSearchParams({ d: domain, r: reason, u: originalUrl });
  return chrome.runtime.getURL('blocked.html') + '?' + params.toString();
}

async function enforceTabs(tabs) {
  const [settings, day, snooze] = await Promise.all([getSettings(), getToday(), getSnooze()]);
  let blocked = 0;
  for (const tab of tabs) {
    const domain = getDomain(tab.url);
    const reason = blockReason(domain, settings, day, snooze);
    if (!reason) continue;
    try {
      await chrome.tabs.update(tab.id, { url: blockedPageUrl(domain, reason, tab.url) });
      blocked++;
    } catch {
      // tab closed in the meantime
    }
  }
  if (blocked) await updateToday(d => { d.blocked = (d.blocked || 0) + blocked; });
}

async function enforceAll() {
  await enforceTabs(await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }));
}

async function expireFocus() {
  const settings = await getSettings();
  const f = settings.focus;
  if (f.on && f.until && f.until <= Date.now()) {
    await saveSettings({ focus: { ...f, on: false, until: null } });
    notify('focus-done', 'Focus session complete', 'Nice work! Distracting sites are unblocked again.');
  }
}

// ---------------------------------------------------------------------------
// Heads Up: remind the user to take a break after continuous browsing
// ---------------------------------------------------------------------------
async function headsUpCheck() {
  const state = await chrome.idle.queryState(IDLE_SECONDS);
  const { activeSince } = await chrome.storage.session.get('activeSince');
  const now = Date.now();

  if (state !== 'active') {
    if (activeSince) await chrome.storage.session.remove('activeSince');
    return;
  }
  if (!activeSince) {
    await chrome.storage.session.set({ activeSince: now });
    return;
  }
  const settings = await getSettings();
  if (settings.headsUp.on && now - activeSince >= settings.headsUp.minutes * 60 * 1000) {
    notify(
      'heads-up',
      'Time for a quick break',
      `You've been browsing for ${settings.headsUp.minutes} minutes. Stretch, look away from the screen, drink some water.`
    );
    await chrome.storage.session.set({ activeSince: now });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id + '-' + Date.now(), {
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title,
    message,
    priority: 1
  });
}

// ---------------------------------------------------------------------------
// Do Not Disturb (block site notifications) and Mute Tabs
// ---------------------------------------------------------------------------
async function applyDnd(on) {
  try {
    if (on) {
      await chrome.contentSettings.notifications.set({
        primaryPattern: '<all_urls>',
        setting: 'block'
      });
    } else {
      await chrome.contentSettings.notifications.clear({});
    }
  } catch (e) {
    console.error('[QuietNet] DND failed', e);
  }
}

async function applyMute(on) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const mutedByUs = tab.mutedInfo && tab.mutedInfo.reason === 'extension' &&
      tab.mutedInfo.extensionId === chrome.runtime.id;
    if (on && !tab.mutedInfo?.muted) {
      chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    } else if (!on && mutedByUs) {
      chrome.tabs.update(tab.id, { muted: false }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
async function pruneOldDays() {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = dayKey(cutoff);
  const stale = Object.keys(all).filter(k => k.startsWith('day:') && k < cutoffKey);
  // Data from the very first version of the extension (all-time totals)
  if ('websiteData' in all) stale.push('websiteData');
  if (stale.length) await chrome.storage.local.remove(stale);

  // Drop expired snoozes
  const snooze = all.snooze || {};
  const now = Date.now();
  const live = Object.fromEntries(Object.entries(snooze).filter(([, t]) => t > now));
  if (Object.keys(live).length !== Object.keys(snooze).length) {
    await chrome.storage.local.set({ snooze: live });
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get('tick');
  if (!existing) chrome.alarms.create('tick', { periodInMinutes: 0.5 });
}

async function init() {
  await ensureAlarm();
  const settings = await getSettings();
  await chrome.storage.local.set({ settings }); // write defaults on first run
  await pruneOldDays();
  await applyDnd(settings.dnd);
  if (settings.mute) await applyMute(true);
  await refresh();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => serial(init));
chrome.runtime.onStartup.addListener(() => serial(init));
ensureAlarm();

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'tick') return;
  serial(async () => {
    await expireFocus();
    await refresh();
    await enforceAll();
    await headsUpCheck();
  });
});

chrome.tabs.onActivated.addListener(() => serial(refresh));
chrome.tabs.onRemoved.addListener(() => serial(refresh));
chrome.windows.onFocusChanged.addListener(() => serial(refresh));
chrome.idle.onStateChanged.addListener(() => serial(refresh));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    serial(async () => {
      await enforceTabs([tab]);
      if (tab.active) await refresh();
    });
  } else if (tab.active && 'audible' in changeInfo) {
    serial(refresh);
  }
});

chrome.tabs.onCreated.addListener(async tab => {
  const settings = await getSettings();
  if (settings.mute) chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
});

// React to settings changed from the popup / blocked page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = mergeSettings(changes.settings.oldValue);
  const after = mergeSettings(changes.settings.newValue);
  if (before.dnd !== after.dnd) applyDnd(after.dnd);
  if (before.mute !== after.mute) applyMute(after.mute);
  serial(enforceAll);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'flush') {
    serial(refresh).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'snooze' && msg.domain) {
    serial(async () => {
      const snooze = await getSnooze();
      snooze[msg.domain] = Date.now() + (msg.minutes || 5) * 60 * 1000;
      await chrome.storage.local.set({ snooze });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
