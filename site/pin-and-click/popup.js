const $ = (id) => document.getElementById(id);
let tabId = null;

let st = {
  steps: [], hasTarget: false, running: false, picking: false, waiting: false, current: 0,
  cps: 50, burst: true, burstSize: 25, burstPause: 500, jitter: false,
  stopMode: 'manual', stopClicks: 100, stopSeconds: 30, stopText: '',
  clicks: 0, skipped: 0, lastSkip: '', stopReason: '',
};

const send = (payload) => chrome.runtime.sendMessage({ type: 'popup', tabId, payload });
const focused = (id) => document.activeElement === $(id);
const num = (n) => n.toLocaleString();

/* ---------- render ---------- */

function renderSteps() {
  const ol = $('steps');
  ol.textContent = '';
  st.steps.forEach((s, i) => {
    const li = document.createElement('li');
    if (st.running && st.steps.length > 1 && i === st.current) li.className = 'now';

    const badge = document.createElement('span');
    badge.className = 'num';
    badge.textContent = i + 1;

    const what = document.createElement('span');
    what.className = 'what';
    const b = document.createElement('b');
    b.textContent = s.text || '<' + s.tag + '>';
    what.appendChild(b);
    if (s.text) { const i2 = document.createElement('i'); i2.textContent = '  <' + s.tag + '>'; what.appendChild(i2); }
    what.title = s.selector;

    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Remove this step';
    x.onclick = () => { st.steps.splice(i, 1); send({ type: 'removeStep', index: i }); render(); };

    li.append(badge, what, x);
    ol.appendChild(li);
  });

  $('seqHint').hidden = st.steps.length < 2;
  $('pickLabel').textContent = st.steps.length ? 'Add another button' : 'Pick a button on the page';
}

function renderStop() {
  $('stopMode').value = st.stopMode;
  const which = { clicks: 'stopClicks', seconds: 'stopSeconds', text: 'stopText' }[st.stopMode];
  ['stopClicks', 'stopSeconds', 'stopText'].forEach((id) => { $(id).hidden = id !== which; });
  $('extraWrap').hidden = !which;
  if (which && !focused(which)) $(which).value = st[which];
}

function effective() {
  if (!st.burst) return 'Steady ' + st.cps + '/s — the page may drop some.';
  const ms = (st.burstSize / st.cps) * 1000 + st.burstPause;
  return 'About ' + ((st.burstSize / ms) * 1000).toFixed(1) + ' clicks a second on average.';
}

function render() {
  renderSteps();
  renderStop();

  $('cps').value = st.cps;
  $('cpsOut').textContent = st.cps + '/s';
  $('burst').checked = !!st.burst;
  $('jitter').checked = !!st.jitter;
  if (!focused('burstSize')) $('burstSize').value = st.burstSize;
  if (!focused('burstPause')) $('burstPause').value = st.burstPause;
  $('burstSize').disabled = $('burstPause').disabled = !st.burst;
  $('eff').textContent = effective();

  $('toggle').disabled = !st.steps.length;
  $('toggle').textContent = st.running ? 'Stop' : st.steps.length > 1 ? 'Run the sequence' : 'Start clicking';
  $('toggle').classList.toggle('stop', !!st.running);

  $('dot').className = 'dot' + (st.running ? (st.waiting ? ' wait' : ' on') : st.picking ? ' pick' : '');
  $('state').textContent = st.running
    ? (st.waiting ? 'waiting for step ' + (st.current + 1) : num(st.clicks) + ' clicks')
    : st.picking ? 'click an element…'
    : st.stopReason ? 'stopped' : st.steps.length ? 'ready' : 'idle';

  // tally
  const t = $('tally');
  t.textContent = '';
  if (st.stopReason && !st.running) {
    const s = document.createElement('span');
    s.textContent = '■ Stopped: ' + st.stopReason;
    t.appendChild(s);
  } else if (st.clicks || st.skipped) {
    const sent = document.createElement('span');
    sent.append(document.createTextNode('Sent '));
    const b = document.createElement('b'); b.textContent = num(st.clicks);
    sent.append(b, document.createTextNode(st.clicks === 1 ? ' click' : ' clicks'));
    t.appendChild(sent);
    if (st.skipped) {
      const w = document.createElement('span');
      w.className = 'warn';
      w.textContent = '· ' + num(st.skipped) + ' skipped (' + (st.lastSkip || 'blocked') + ')';
      w.title = 'The button was covered by something else or disabled, so a real click would not have landed either.';
      t.appendChild(w);
    }
  }
  if (st.clicks || st.skipped) {
    const r = document.createElement('button');
    r.textContent = 'reset';
    r.onclick = () => { st.clicks = 0; st.skipped = 0; st.stopReason = ''; send({ type: 'resetCount' }); render(); };
    t.appendChild(r);
  }
}

/* ---------- wiring ---------- */

const push = (patch) => { st = { ...st, ...patch }; send({ type: 'setOpts', opts: patch }); render(); };

$('pick').onclick = () => { st.picking = true; render(); send({ type: 'pick:start' }); window.close(); };
$('toggle').onclick = () => {
  st.running = !st.running;
  if (st.running) { st.stopReason = ''; st.clicks = 0; st.skipped = 0; }
  send(st.running ? { type: 'start' } : { type: 'stop' });
  render();
};

$('cps').oninput = (e) => push({ cps: +e.target.value });
$('burst').onchange = (e) => push({ burst: e.target.checked });
$('jitter').onchange = (e) => push({ jitter: e.target.checked });
$('burstSize').oninput = (e) => push({ burstSize: Math.max(1, +e.target.value || 1) });
$('burstPause').oninput = (e) => push({ burstPause: Math.max(0, +e.target.value || 0) });

$('stopMode').onchange = (e) => push({ stopMode: e.target.value });
$('stopClicks').oninput = (e) => push({ stopClicks: Math.max(1, +e.target.value || 1) });
$('stopSeconds').oninput = (e) => push({ stopSeconds: Math.max(1, +e.target.value || 1) });
$('stopText').oninput = (e) => push({ stopText: e.target.value });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status:push' && msg.tabId === tabId && msg.status) { st = { ...st, ...msg.status }; render(); }
  if (msg.type === 'picked:push') { st.steps = [...st.steps, msg.step]; st.picking = false; render(); }
});

async function refresh() {
  const res = await send({ type: 'getStatus' });
  if (res && res.status) st = { ...st, ...res.status };
  render();
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  await refresh();
  setInterval(refresh, 700);
})();
