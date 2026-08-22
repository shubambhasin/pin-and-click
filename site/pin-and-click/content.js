/* Pin & Click — content script. Runs in every frame. */
(() => {
  if (window.__pinClickLoaded) return;
  window.__pinClickLoaded = true;

  const STORE_KEY = 'pinclick:' + location.origin + location.pathname;
  const STUCK_MS = 30000;   // give up waiting for a step that never appears

  const state = {
    picking: false,
    running: false,

    // cadence
    cps: 50,
    burst: true,
    burstSize: 25,
    burstPause: 500,
    jitter: false,

    // targets — a list, clicked in order and looped. One entry = plain auto clicker.
    steps: [],            // [{ selector, tag, text, point }]

    // when to stop
    stopMode: 'manual',   // manual | clicks | seconds | text | gone
    stopClicks: 100,
    stopSeconds: 30,
    stopText: '',

    // runtime
    idx: 0,
    clicks: 0,
    skipped: 0,
    lastSkip: '',
    inBurst: 0,
    pausing: false,
    waitingSince: 0,
    startedAt: 0,
    stopReason: '',
    timer: null,
  };

  const els = new Map();   // step index -> last resolved element

  /* ---------------- selector building ---------------- */

  const ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'aria-label', 'name', 'title'];
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\\]\[#.:>+~ ]/g, '\\$&'));

  function unique(sel, el) {
    try { const f = document.querySelectorAll(sel); return f.length === 1 && f[0] === el; } catch { return false; }
  }

  function buildSelector(el) {
    if (el.id && unique('#' + cssEsc(el.id), el)) return '#' + cssEsc(el.id);
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) {
        const sel = `${el.tagName.toLowerCase()}[${a}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(sel, el)) return sel;
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + cssEsc(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (unique(sel, el)) return sel;
      node = parent;
    }
    return parts.join(' > ');
  }

  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);

  function describe(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: label(el),
      point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
    };
  }

  /* ---------------- resolving a step ---------------- */

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function resolve(i) {
    const cached = els.get(i);
    if (visible(cached)) return cached;
    const t = state.steps[i];
    if (!t) return null;

    try {                                   // 1. saved selector
      const hit = document.querySelector(t.selector);
      if (visible(hit)) { els.set(i, hit); return hit; }
    } catch {}

    if (t.text) {                           // 2. same tag + same visible text (survives re-render)
      const c = [...document.querySelectorAll(t.tag)].filter((e) => visible(e) && label(e) === t.text);
      if (c.length) { els.set(i, c[0]); return c[0]; }
    }

    if (t.point) {                          // 3. last-known screen position
      const hit = document.elementFromPoint(t.point.x, t.point.y);
      if (visible(hit)) { els.set(i, hit); return hit; }
    }
    return null;
  }

  // Why a click would silently do nothing even though the element exists.
  function blocked(el) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null;   // offscreen: can't hit-test, events still fire
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) return 'covered';
    return null;
  }

  /* ---------------- clicking ---------------- */

  function fire(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, detail: 1, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0.5 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0, pressure: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    } catch { el.click && el.click(); }
  }

  /* ---------------- stop conditions ---------------- */

  function shouldStop() {
    switch (state.stopMode) {
      case 'clicks':
        if (state.clicks >= state.stopClicks) return state.stopClicks + ' clicks reached';
        break;
      case 'seconds': {
        const s = (Date.now() - state.startedAt) / 1000;
        if (s >= state.stopSeconds) return state.stopSeconds + 's elapsed';
        break;
      }
      case 'text': {
        const needle = (state.stopText || '').trim().toLowerCase();
        if (needle && (document.body.innerText || '').toLowerCase().includes(needle))
          return '“' + state.stopText.trim() + '” appeared';
        break;
      }
      case 'gone':
        if (state.clicks > 0 && !state.steps.some((_, i) => resolve(i))) return 'target disappeared';
        break;
    }
    return '';
  }

  /* ---------------- the loop ---------------- */

  function nextDelay() {
    let d = Math.max(4, 1000 / state.cps);
    if (state.pausing) d = Math.max(0, state.burstPause);
    if (state.jitter) d *= 0.8 + Math.random() * 0.4;
    return Math.max(1, Math.round(d));
  }

  function loop() {
    const reason = shouldStop();
    if (reason) return stop(reason);

    const i = state.idx % Math.max(1, state.steps.length);
    const el = resolve(i);

    if (!el) {
      // Wait for it instead of skipping ahead: in a sequence, the next button
      // often doesn't exist until the previous click has done its work.
      if (!state.waitingSince) state.waitingSince = Date.now();
      const waited = Date.now() - state.waitingSince;
      if (waited > STUCK_MS) return stop('step ' + (i + 1) + ' never appeared (' + Math.round(STUCK_MS / 1000) + 's)');
      setBadge('waiting for step ' + (i + 1) + '…');
      state.timer = setTimeout(loop, 120);
      return;
    }
    state.waitingSince = 0;

    const why = blocked(el);
    if (why) {
      state.skipped++;
      state.lastSkip = why;
      setBadge('skipped — ' + why);
      state.timer = setTimeout(loop, Math.max(60, nextDelay()));
      return;
    }

    fire(el);
    state.clicks++;
    state.inBurst++;
    state.idx = (i + 1) % Math.max(1, state.steps.length);
    drawRing(el, state.steps.length > 1 ? i + 1 : 0);

    state.pausing = state.burst && state.inBurst >= state.burstSize;
    if (state.pausing) state.inBurst = 0;

    const d = nextDelay();
    if (state.pausing) setBadge(state.clicks + ' clicks · cooling ' + d + 'ms');
    else if (state.clicks % 5 === 0) setBadge(hudText());
    if (state.clicks % 10 === 0) report();

    state.timer = setTimeout(loop, d);
  }

  function hudText() {
    let t = state.clicks + ' clicks · ' + state.cps + '/s';
    if (state.steps.length > 1) t += ' · step ' + ((state.idx || state.steps.length)) + '/' + state.steps.length;
    if (state.skipped) t += ' · ' + state.skipped + ' skipped';
    return t;
  }

  function start() {
    stopTimer();
    if (!state.steps.length) return;
    state.running = true;
    state.stopReason = '';
    state.idx = 0;
    state.inBurst = 0;
    state.pausing = false;
    state.waitingSince = 0;
    state.startedAt = Date.now();
    ensureHud();
    persist();
    report();
    loop();
  }

  function stopTimer() { if (state.timer) clearTimeout(state.timer); state.timer = null; }

  function stop(reason) {
    stopTimer();
    state.running = false;
    state.stopReason = reason || '';
    if (reason) { ensureHud(); setBadge('■ stopped — ' + reason); setTimeout(hideHud, 4000); }
    else hideHud();
    persist();
    report();
  }

  /* ---------------- overlay / HUD ---------------- */

  let hud = null, ring = null, hover = null;

  function ensureHud() {
    if (!hud) { hud = document.createElement('div'); hud.className = 'pinclick-hud'; document.documentElement.appendChild(hud); }
    if (!ring) { ring = document.createElement('div'); ring.className = 'pinclick-ring'; document.documentElement.appendChild(ring); }
    hud.style.display = ring.style.display = 'block';
  }
  function hideHud() { if (hud) hud.style.display = 'none'; if (ring) ring.style.display = 'none'; }
  function setBadge(txt) { if (hud) hud.textContent = '⚡ ' + txt; }
  function drawRing(el, step) {
    if (!ring) return;
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
    ring.setAttribute('data-step', step ? String(step) : '');
  }

  /* ---------------- picker ---------------- */

  function startPick() {
    if (state.picking) return;
    state.picking = true;
    if (!hover) { hover = document.createElement('div'); hover.className = 'pinclick-hover'; document.documentElement.appendChild(hover); }
    hover.style.display = 'block';
    document.documentElement.classList.add('pinclick-picking');
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onPick, true);
    addEventListener('keydown', onKey, true);
    report();
  }

  function cancelPick() {
    if (!state.picking) return;
    state.picking = false;
    if (hover) hover.style.display = 'none';
    document.documentElement.classList.remove('pinclick-picking');
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onPick, true);
    removeEventListener('keydown', onKey, true);
    report();
  }

  function onMove(e) {
    const el = e.target;
    if (!el || el === hover) return;
    const r = el.getBoundingClientRect();
    Object.assign(hover.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelPick(); } }

  function onPick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const step = describe(e.target);
    state.steps.push(step);
    els.set(state.steps.length - 1, e.target);
    cancelPick();
    persist();
    chrome.runtime.sendMessage({ type: 'picked', step });
  }

  /* ---------------- persistence + reporting ---------------- */

  function persist() {
    chrome.storage.local.set({
      [STORE_KEY]: {
        steps: state.steps, running: state.running,
        cps: state.cps, burst: state.burst, burstSize: state.burstSize, burstPause: state.burstPause, jitter: state.jitter,
        stopMode: state.stopMode, stopClicks: state.stopClicks, stopSeconds: state.stopSeconds, stopText: state.stopText,
      },
    });
  }

  function report() {
    chrome.runtime.sendMessage({
      type: 'status',
      status: {
        steps: state.steps, hasTarget: state.steps.length > 0,
        running: state.running, picking: state.picking,
        cps: state.cps, burst: state.burst, burstSize: state.burstSize, burstPause: state.burstPause, jitter: state.jitter,
        stopMode: state.stopMode, stopClicks: state.stopClicks, stopSeconds: state.stopSeconds, stopText: state.stopText,
        clicks: state.clicks, skipped: state.skipped, lastSkip: state.lastSkip,
        waiting: !!state.waitingSince, current: state.steps.length > 1 ? state.idx : 0,
        stopReason: state.stopReason,
      },
    });
  }

  chrome.storage.local.get(STORE_KEY, (data) => {
    const s = data && data[STORE_KEY];
    if (!s) return;
    state.steps = Array.isArray(s.steps) ? s.steps : (s.target ? [s.target] : []);   // migrate single-target saves
    if (s.cps) state.cps = s.cps;
    if (typeof s.burst === 'boolean') state.burst = s.burst;
    if (s.burstSize) state.burstSize = s.burstSize;
    if (typeof s.burstPause === 'number') state.burstPause = s.burstPause;
    if (typeof s.jitter === 'boolean') state.jitter = s.jitter;
    if (s.stopMode) state.stopMode = s.stopMode;
    if (s.stopClicks) state.stopClicks = s.stopClicks;
    if (s.stopSeconds) state.stopSeconds = s.stopSeconds;
    if (typeof s.stopText === 'string') state.stopText = s.stopText;
    if (s.running && state.steps.length) start();     // auto-resume after reload
    report();
  });

  /* ---------------- messages ---------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg.type) {
      case 'pick:start': startPick(); break;
      case 'pick:cancel': cancelPick(); break;
      case 'start': if (state.steps.length) start(); break;
      case 'stop': stop(''); break;

      case 'removeStep': {
        state.steps.splice(msg.index, 1);
        els.clear();
        state.idx = 0;
        if (!state.steps.length) stop('');
        persist(); report();
        break;
      }
      case 'clear':
        stop('');
        state.steps = []; els.clear();
        state.clicks = 0; state.skipped = 0; state.lastSkip = ''; state.idx = 0; state.stopReason = '';
        persist(); report();
        break;

      case 'setOpts': {
        const o = msg.opts || {};
        if (typeof o.cps === 'number') state.cps = o.cps;
        if (typeof o.burst === 'boolean') state.burst = o.burst;
        if (typeof o.burstSize === 'number') state.burstSize = Math.max(1, o.burstSize);
        if (typeof o.burstPause === 'number') state.burstPause = Math.max(0, o.burstPause);
        if (typeof o.jitter === 'boolean') state.jitter = o.jitter;
        if (typeof o.stopMode === 'string') state.stopMode = o.stopMode;
        if (typeof o.stopClicks === 'number') state.stopClicks = Math.max(1, o.stopClicks);
        if (typeof o.stopSeconds === 'number') state.stopSeconds = Math.max(1, o.stopSeconds);
        if (typeof o.stopText === 'string') state.stopText = o.stopText;
        persist();
        if (state.running) { state.inBurst = 0; state.pausing = false; }
        report();
        break;
      }
      case 'resetCount':
        state.clicks = 0; state.skipped = 0; state.lastSkip = ''; state.startedAt = Date.now();
        report();
        break;

      case 'query':
        if (state.steps.length || state.picking || window.top === window) report();
        break;
    }
    respond && respond({ ok: true, hasTarget: state.steps.length > 0 });
    return false;
  });

  addEventListener('pagehide', stopTimer);
})();
