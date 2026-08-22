/* Pin & Click — content script. Runs in every frame. */
(() => {
  if (window.__pinClickLoaded) return;
  window.__pinClickLoaded = true;

  const STORE_KEY = 'pinclick:' + location.origin + location.pathname;

  const state = {
    picking: false,
    running: false,
    cps: 50,
    target: null,      // { selector, tag, text, point: {x,y} }
    el: null,          // resolved element cache
    clicks: 0,
    timer: null,
    burst: true,       // pause every N clicks
    burstSize: 25,
    burstPause: 500,   // ms
    jitter: false,     // randomize gaps ±20%
    inBurst: 0,
    pausing: false,
  };

  /* ---------------- selector building ---------------- */

  const ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'aria-label', 'name', 'title'];

  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\\]\[#.:>+~ ]/g, '\\$&'));

  function unique(sel, el) {
    try {
      const found = document.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch { return false; }
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

    // structural path with nth-of-type, stopping early if it becomes unique
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift('#' + cssEsc(node.id));
        break;
      }
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

  function describe(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
      point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
    };
  }

  /* ---------------- re-resolving the target ---------------- */

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function resolve() {
    if (visible(state.el)) return state.el;
    const t = state.target;
    if (!t) return null;

    // 1. saved selector
    try {
      const hit = document.querySelector(t.selector);
      if (visible(hit)) return (state.el = hit);
    } catch {}

    // 2. same tag + same visible text (survives re-render / new selectors)
    if (t.text) {
      const cands = [...document.querySelectorAll(t.tag)].filter(
        (e) => visible(e) && (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 80) === t.text
      );
      if (cands.length) return (state.el = cands[0]);
    }

    // 3. last-known screen position
    if (t.point) {
      const hit = document.elementFromPoint(t.point.x, t.point.y);
      if (visible(hit)) return (state.el = hit);
    }
    return null;
  }

  /* ---------------- clicking ---------------- */

  function fire(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, detail: 1, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0.5 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0, pressure: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    } catch {
      el.click && el.click();
    }
  }

  // Clicks land in bursts: `burstSize` clicks at the target rate, then a
  // `burstPause` breather so the page's handlers / API can keep up. Without it,
  // a sustained 50/s stream gets coalesced by the page or rate-limited server-side.
  function nextDelay() {
    let d = Math.max(4, 1000 / state.cps);
    if (state.pausing) d = Math.max(0, state.burstPause);
    if (state.jitter) d *= 0.8 + Math.random() * 0.4;   // ±20%, so the cadence isn't machine-perfect
    return Math.max(1, Math.round(d));
  }

  function loop() {
    const el = resolve();
    if (el) {
      fire(el);
      state.clicks++;
      state.inBurst++;
      if (state.clicks % 5 === 0 || state.pausing) drawRing(el);
    } else {
      setBadge('target lost — retrying…');
    }

    // decide whether the *next* gap is a burst pause
    state.pausing = state.burst && state.inBurst >= state.burstSize;
    if (state.pausing) state.inBurst = 0;

    const d = nextDelay();
    if (state.pausing) setBadge(state.clicks + ' clicks · cooling ' + d + 'ms');
    else if (el && state.clicks % 5 === 0) setBadge(state.clicks + ' clicks · ' + state.cps + '/s' + (state.burst ? ' burst' : ''));

    state.timer = setTimeout(loop, d);
  }

  function start() {
    stopTimer();
    if (!state.target) return;
    state.running = true;
    state.inBurst = 0;
    state.pausing = false;
    ensureHud();
    persist();
    report();
    loop();
  }

  function stopTimer() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  function stop() {
    stopTimer();
    state.running = false;
    hideHud();
    persist();
    report();
  }

  /* ---------------- overlay / HUD ---------------- */

  let hud = null, ring = null, hover = null;

  function ensureHud() {
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'pinclick-hud';
      document.documentElement.appendChild(hud);
    }
    if (!ring) {
      ring = document.createElement('div');
      ring.className = 'pinclick-ring';
      document.documentElement.appendChild(ring);
    }
    hud.style.display = ring.style.display = 'block';
  }

  function hideHud() {
    if (hud) hud.style.display = 'none';
    if (ring) ring.style.display = 'none';
  }

  function setBadge(txt) { if (hud) hud.textContent = '⚡ ' + txt; }

  function drawRing(el) {
    if (!ring) return;
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  /* ---------------- picker ---------------- */

  function startPick() {
    if (state.picking) return;
    state.picking = true;
    if (!hover) {
      hover = document.createElement('div');
      hover.className = 'pinclick-hover';
      document.documentElement.appendChild(hover);
    }
    hover.style.display = 'block';
    document.documentElement.classList.add('pinclick-picking');
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onPick, true);
    addEventListener('keydown', onKey, true);
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

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelPick(); }
  }

  function onPick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target;
    state.target = describe(el);
    state.el = el;
    state.clicks = 0;
    cancelPick();
    persist();
    chrome.runtime.sendMessage({ type: 'picked', target: state.target });
  }

  /* ---------------- persistence + reporting ---------------- */

  function persist() {
    chrome.storage.local.set({
      [STORE_KEY]: {
        target: state.target, cps: state.cps, running: state.running,
        burst: state.burst, burstSize: state.burstSize, burstPause: state.burstPause, jitter: state.jitter,
      },
    });
  }

  function report() {
    chrome.runtime.sendMessage({
      type: 'status',
      status: {
        hasTarget: !!state.target, running: state.running, picking: state.picking,
        cps: state.cps, clicks: state.clicks, target: state.target,
        burst: state.burst, burstSize: state.burstSize, burstPause: state.burstPause, jitter: state.jitter,
      },
    });
  }

  chrome.storage.local.get(STORE_KEY, (data) => {
    const saved = data && data[STORE_KEY];
    if (!saved) return;
    state.target = saved.target || null;
    state.cps = saved.cps || 50;
    if (typeof saved.burst === 'boolean') state.burst = saved.burst;
    if (saved.burstSize) state.burstSize = saved.burstSize;
    if (typeof saved.burstPause === 'number') state.burstPause = saved.burstPause;
    if (typeof saved.jitter === 'boolean') state.jitter = saved.jitter;
    if (saved.running && state.target) start();   // auto-resume after reload / SPA nav
    report();
  });

  /* ---------------- messages ---------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg.type) {
      case 'pick:start': startPick(); break;
      case 'pick:cancel': cancelPick(); break;
      case 'start':
        if (typeof msg.cps === 'number') state.cps = msg.cps;
        if (state.target) start();
        break;
      case 'stop': stop(); break;
      case 'setCps':
        state.cps = msg.cps;
        persist();
        if (state.running) start();
        break;
      case 'setOpts': {
        const o = msg.opts || {};
        if (typeof o.cps === 'number') state.cps = o.cps;
        if (typeof o.burst === 'boolean') state.burst = o.burst;
        if (typeof o.burstSize === 'number') state.burstSize = Math.max(1, o.burstSize);
        if (typeof o.burstPause === 'number') state.burstPause = Math.max(0, o.burstPause);
        if (typeof o.jitter === 'boolean') state.jitter = o.jitter;
        persist();
        if (state.running) { state.inBurst = 0; state.pausing = false; }  // apply without losing the click count
        report();
        break;
      }
      case 'clear':
        stop();
        state.target = null; state.el = null; state.clicks = 0; state.inBurst = 0; state.pausing = false;
        persist(); report();
        break;
      case 'query':
        if (state.target || state.picking || window.top === window) report();
        break;
    }
    respond && respond({ ok: true, hasTarget: !!state.target });
    return false;
  });

  addEventListener('pagehide', stopTimer);
})();
