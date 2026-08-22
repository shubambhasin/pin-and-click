/* Pin & Click — service worker: routes popup <-> frames, caches per-tab status. */
const cache = new Map(); // tabId -> Map(frameId -> status)

function best(tabId) {
  const frames = cache.get(tabId);
  if (!frames) return null;
  const all = [...frames.values()];
  return all.find((s) => s.running) || all.find((s) => s.hasTarget) || all.find((s) => s.picking) || all[0] || null;
}

function paint(tabId) {
  const s = best(tabId);
  const on = s && s.running;
  chrome.action.setBadgeText({ tabId, text: on ? String(s.cps) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#16b364' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  // ---- from content scripts ----
  if (msg.type === 'status' && sender.tab) {
    const tabId = sender.tab.id;
    if (!cache.has(tabId)) cache.set(tabId, new Map());
    cache.get(tabId).set(sender.frameId ?? 0, msg.status);
    paint(tabId);
    chrome.runtime.sendMessage({ type: 'status:push', tabId, status: best(tabId) }).catch(() => {});
    return false;
  }

  if (msg.type === 'picked' && sender.tab) {
    // whichever frame captured the click wins; stop picking everywhere else
    chrome.tabs.sendMessage(sender.tab.id, { type: 'pick:cancel' }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'picked:push', target: msg.target }).catch(() => {});
    return false;
  }

  // ---- from popup ----
  if (msg.type === 'popup') {
    const { tabId, payload } = msg;
    if (payload.type === 'getStatus') {
      chrome.tabs.sendMessage(tabId, { type: 'query' }).catch(() => {});
      respond({ status: best(tabId) });
      return true;
    }
    chrome.tabs.sendMessage(tabId, payload).catch(() => {});
    respond({ ok: true });
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => cache.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') { cache.delete(tabId); paint(tabId); }
});

chrome.commands && chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-clicking') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const s = best(tab.id);
  chrome.tabs.sendMessage(tab.id, s && s.running ? { type: 'stop' } : { type: 'start' }).catch(() => {});
});
