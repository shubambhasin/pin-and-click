const $ = (id) => document.getElementById(id);
let tabId = null;
let st = { hasTarget: false, running: false, picking: false, cps: 50, clicks: 0, target: null,
           burst: true, burstSize: 25, burstPause: 500, jitter: false };

const send = (payload) => chrome.runtime.sendMessage({ type: 'popup', tabId, payload });

function render() {
  $('cps').value = st.cps;
  $('cpsOut').textContent = st.cps + '/s';
  $('toggle').disabled = !st.hasTarget;
  $('toggle').textContent = st.running ? 'Stop' : 'Start clicking';
  $('toggle').classList.toggle('stop', !!st.running);
  $('dot').className = 'dot' + (st.running ? ' on' : st.picking ? ' pick' : '');
  $('state').textContent = st.running ? st.clicks + ' clicks' : st.picking ? 'click an element…' : st.hasTarget ? 'ready' : 'idle';
  const t = st.target;
  $('target').textContent = t ? `<${t.tag}>${t.text ? ' “' + t.text + '”' : ''}\n${t.selector}` : 'No target selected';

  $('burst').checked = !!st.burst;
  $('jitter').checked = !!st.jitter;
  if (document.activeElement !== $('burstSize')) $('burstSize').value = st.burstSize;
  if (document.activeElement !== $('burstPause')) $('burstPause').value = st.burstPause;
  $('burstSize').disabled = $('burstPause').disabled = !st.burst;
  $('eff').textContent = st.burst
    ? `≈ ${effective().toFixed(1)} clicks/s average (${st.burstSize} at ${st.cps}/s, then ${st.burstPause}ms idle)`
    : `steady ${st.cps} clicks/s — may get throttled or coalesced`;
}

function effective() {
  const burstMs = (st.burstSize / st.cps) * 1000 + st.burstPause;
  return burstMs > 0 ? (st.burstSize / burstMs) * 1000 : st.cps;
}

async function refresh() {
  const res = await send({ type: 'getStatus' });
  if (res && res.status) { st = { ...st, ...res.status }; }
  render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status:push' && msg.tabId === tabId && msg.status) { st = { ...st, ...msg.status }; render(); }
  if (msg.type === 'picked:push') { st.hasTarget = true; st.picking = false; st.target = msg.target; render(); }
});

$('pick').onclick = () => { st.picking = true; render(); send({ type: 'pick:start' }); window.close(); };
$('toggle').onclick = () => {
  st.running = !st.running;
  send(st.running ? { type: 'start', cps: st.cps } : { type: 'stop' });
  render();
};
$('clear').onclick = () => { st = { ...st, hasTarget: false, running: false, target: null }; send({ type: 'clear' }); render(); };
const pushOpts = (patch) => { st = { ...st, ...patch }; send({ type: 'setOpts', opts: patch }); render(); };

$('cps').oninput = (e) => pushOpts({ cps: +e.target.value });
$('burst').onchange = (e) => pushOpts({ burst: e.target.checked });
$('jitter').onchange = (e) => pushOpts({ jitter: e.target.checked });
$('burstSize').oninput = (e) => { const v = Math.max(1, +e.target.value || 1); pushOpts({ burstSize: v }); };
$('burstPause').oninput = (e) => { const v = Math.max(0, +e.target.value || 0); pushOpts({ burstPause: v }); };
document.querySelectorAll('.presets button').forEach((b) => {
  b.onclick = () => pushOpts({ cps: +b.dataset.cps });
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  await refresh();
  setInterval(refresh, 700);
})();
