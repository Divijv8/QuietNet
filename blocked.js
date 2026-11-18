const params = new URLSearchParams(location.search);
const domain = params.get('d') || 'this site';
const reason = params.get('r') || 'limit';
const originalUrl = params.get('u');

const ICONS = {
  focus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  bedtime: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  limit: '<svg viewBox="0 0 24 24"><path d="M9 3h6M12 3v3"/><circle cx="12" cy="14" r="7"/><path d="M12 10.5V14l2.5 1.5"/></svg>'
};

async function init() {
  const settings = await getSettings();
  document.documentElement.dataset.theme = settings.theme;

  const icon = document.getElementById('icon');
  icon.innerHTML = ICONS[reason] || ICONS.limit;
  document.getElementById('site').textContent = domain;

  const title = document.getElementById('title');
  const message = document.getElementById('message');

  if (reason === 'focus') {
    title.textContent = 'Stay focused';
    message.textContent = settings.focus.until
      ? `Focus Mode is on for another ${Math.max(1, Math.ceil((settings.focus.until - Date.now()) / 60000))} min. This site is on your distracting list:`
      : 'Focus Mode is on. This site is on your distracting list:';
    document.getElementById('endFocus').hidden = false;
    document.getElementById('snooze').hidden = true;
  } else if (reason === 'bedtime') {
    title.textContent = "It's bedtime";
    message.textContent = `Bedtime Mode runs from ${format12h(settings.bedtime.start)} to ${format12h(settings.bedtime.end)}. Time to wind down instead of opening:`;
  } else {
    const key = findLimit(settings, domain) || domain;
    const minutes = settings.limits[key] || 0;
    title.textContent = 'Daily limit reached';
    message.textContent = `You've used your ${formatDuration(minutes * 60)} for today on:`;
  }
}

function continueToSite() {
  if (originalUrl && /^https?:/i.test(originalUrl)) location.replace(originalUrl);
}

document.getElementById('goBack').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
});

document.getElementById('snooze').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'snooze', domain, minutes: 5 });
  continueToSite();
});

document.getElementById('endFocus').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ focus: { ...settings.focus, on: false, until: null } });
  continueToSite();
});

init();
