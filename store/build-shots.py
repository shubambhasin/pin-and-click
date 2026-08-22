#!/usr/bin/env python3
"""Render the Chrome Web Store screenshots (1280x800 PNG).

The popup in each shot is built from the extension's real popup.css with static
markup mirroring popup.html, so the images can't drift into showing a UI that
doesn't exist. Run: python3 store/build-shots.py
"""
import os, subprocess, sys, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store', 'shots')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

SHELL = """
<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="../../popup.css">
<style>
  html,body {{ margin:0; width:1280px; height:800px; overflow:hidden;
    background:#0b0c0f; color:#f2f4f8;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif; }}
  .glow {{ position:absolute; top:-260px; left:50%; transform:translateX(-50%);
    width:1100px; height:620px; pointer-events:none;
    background:radial-gradient(closest-side,rgba(22,179,100,.20),transparent 70%); }}
  .stage {{ position:relative; height:800px; padding:32px 56px 24px; box-sizing:border-box;
    display:grid; grid-template-columns:292px 1fr; gap:24px; align-content:start; }}
  h1 {{ grid-column:1/-1; margin:0 0 6px; font-size:36px; line-height:1.08;
    letter-spacing:-1.2px; font-weight:800; }}
  h1 em {{ font-style:normal; color:#3ddc8c; }}
  p.sub {{ grid-column:1/-1; margin:0 0 22px; font-size:17px; color:#9ba3b0; max-width:940px; }}
  /* the popup, rendered with the extension's own stylesheet */
  /* transform, not zoom: zoom re-lays-out at fractional pixels and leaves seams
     where the panel borders fall outside the card background. */
  .chrome {{ border-radius:12px; background:#fff; width:302px; overflow:hidden;
    transform:scale(.92); transform-origin:top left;
    box-shadow:0 30px 60px -20px rgba(0,0,0,.75); align-self:start;
    color:#16181d; }}          /* stage text is near-white; the popup must not inherit it */
  /* 10px wider than the real 292px popup purely so nothing sits flush against
     the card edge in the screenshot */
  .chrome .wrap {{ width:302px; color:#16181d; }}
  .chrome b, .chrome output, .chrome .what b {{ color:#16181d; }}
  /* headless has no -apple-system, so digits run wider than on a Mac */
  .chrome input[type=number] {{ width:54px; }}
  .right {{ display:grid; gap:18px; align-content:start; }}
  /* mock web page */
  .page {{ background:#fff; border-radius:12px; padding:26px 28px; color:#16181d;
    box-shadow:0 30px 60px -20px rgba(0,0,0,.7); position:relative; }}
  .page h3 {{ margin:0 0 4px; font-size:19px; }}
  .page .muted {{ color:#6c7480; font-size:14px; margin:0 0 20px; }}
  .pbtn {{ display:inline-block; padding:12px 22px; border-radius:9px; font-weight:650;
    font-size:15px; background:#111318; color:#fff; position:relative; }}
  .pbtn.alt {{ background:#eef1f6; color:#16181d; }}
  .ring {{ position:absolute; inset:-7px; border:2px solid #16b364; border-radius:12px;
    background:rgba(22,179,100,.10); }}
  .ring[data-step]::after {{ content:attr(data-step); position:absolute; top:-11px; left:-11px;
    min-width:22px; height:22px; border-radius:11px; background:#16b364; color:#fff;
    font:700 13px/22px system-ui; text-align:center; }}
  .hud {{ display:inline-block; padding:8px 14px; border-radius:999px;
    background:rgba(17,17,17,.9); color:#fff; font:650 14px/1 system-ui; }}
  .hud.stopped {{ background:#25272c; }}
  .overlay {{ position:absolute; inset:0; background:rgba(10,12,16,.55); border-radius:12px;
    display:grid; place-items:center; }}
  .overlay div {{ background:#fff; border-radius:10px; padding:16px 20px; font-size:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.3); }}
  .note {{ font-size:14px; color:#6f7783; }}
  .tl {{ display:flex; align-items:center; gap:3px; flex-wrap:wrap; }}
  .tl i {{ width:7px; height:20px; border-radius:2px; background:#16b364; display:block; }}
  .tl .gap {{ width:54px; height:20px; border-radius:4px;
    background:repeating-linear-gradient(90deg,#2a2e36 0 6px,transparent 6px 12px); }}
</style>
<div class="glow"></div>
<div class="stage">
  <h1>{h1}</h1>
  <p class="sub">{sub}</p>
  <div class="chrome"><div class="wrap">{popup}</div></div>
  <div class="right">{right}</div>
</div>
"""

HEAD = """
  <div class="head"><span class="dot {dot}"></span><b>Pin &amp; Click</b>
    <span class="state">{state}</span></div>
"""

def steps_block(steps, current=None, label='Add another button', hint=False):
    lis = ''
    for i, (text, tag) in enumerate(steps):
        now = ' class="now"' if current == i else ''
        lis += (f'<li{now}><span class="num">{i+1}</span>'
                f'<span class="what"><b>{text}</b><i>  &lt;{tag}&gt;</i></span>'
                f'<button class="x">&times;</button></li>')
    hintdiv = ('<div class="hint">Clicked top to bottom, then loops. If a step isn\'t on '
               'the page yet, it waits for it.</div>') if hint else ''
    return (f'<div class="block"><div class="blockHead">What to click</div>'
            f'<ol class="steps">{lis}</ol>'
            f'<button class="btn ghost">🎯 <span>{label}</span></button>{hintdiv}</div>')

def fast_block(cps=50, pause=500, size=25, jitter=False, avg='About 25.0 clicks a second on average.'):
    j = 'checked' if jitter else ''
    return (f'<div class="block"><div class="blockHead">How fast</div>'
            f'<label class="row"><span class="rowLabel">Speed</span>'
            f'<input type="range" min="1" max="100" value="{cps}"><output>{cps}/s</output></label>'
            f'<label class="chk"><input type="checkbox" checked>'
            f'<span>Pause <input type="number" value="{pause}">ms every '
            f'<input type="number" value="{size}">clicks</span></label>'
            f'<label class="chk"><input type="checkbox" {j}> <span>Vary the timing slightly</span></label>'
            f'<div class="sub">{avg}</div></div>')

def stop_block(selected='When I press stop', extra=None):
    ex = (f'<div class="row extra"><input type="text" value="{extra}"></div>') if extra else ''
    return (f'<div class="block"><div class="blockHead">When to stop</div>'
            f'<select><option>{selected}</option></select>{ex}</div>')

def button(label, cta, tally=''):
    cls = 'btn primary stop' if cta == 'Stop' else 'btn primary'
    t = f'<div class="tally">{tally}</div>' if tally else '<div class="tally"></div>'
    return f'<button class="{cls}">{cta}</button>{t}<div class="hint foot">{label}</div>'

FOOT = 'Esc cancels picking · Alt+Shift+C starts/stops'

SHOTS = [
  dict(
    name='1-pins-the-element',
    h1='Pins the <em>element</em>, not the pixel',
    sub='Pick a button once. When the page re-renders it, swaps its class names, or reloads '
        'entirely, Pin &amp; Click is still clicking the right thing.',
    popup=HEAD.format(dot='on', state='1,240 clicks')
          + steps_block([('Add to cart', 'button')], label='Add another button')
          + fast_block() + stop_block() + button(FOOT, 'Stop', 'Sent <b>1,240</b> clicks'),
    right='<div class="page"><h3>Checkout</h3><p class="muted">2 items in your cart</p>'
          '<span class="pbtn">Add to cart<span class="ring"></span></span></div>'
          '<span class="hud">⚡ 1,240 clicks · 50/s</span>'
          '<div class="note">The green ring follows the button — even after the page rebuilds it.</div>',
  ),
  dict(
    name='2-sequences',
    h1='Chain buttons into a <em>sequence</em>',
    sub='Pin several buttons and they run top to bottom, then loop. A step that is not on '
        'the page yet is waited for, not skipped.',
    popup=HEAD.format(dot='on', state='step 2 of 3')
          + steps_block([('Add to cart', 'button'), ('Checkout', 'a'), ('Place order', 'button')],
                        current=1, hint=True)
          + fast_block(cps=8, pause=900, size=1, avg='About 1.2 clicks a second on average.')
          + stop_block() + button(FOOT, 'Stop', 'Sent <b>36</b> clicks'),
    right='<div class="page"><h3>Your basket</h3><p class="muted">Step 2 — review and continue</p>'
          '<span class="pbtn alt">Add to cart</span> &nbsp; '
          '<span class="pbtn">Checkout<span class="ring" data-step="2"></span></span></div>'
          '<span class="hud">⚡ 36 clicks · step 2/3</span>'
          '<div class="note">The badge on the ring shows which step is being clicked right now.</div>',
  ),
  dict(
    name='3-burst-mode',
    h1='Bursts, so the clicks <em>actually land</em>',
    sub='A flat 50/s stream gets coalesced by the page and rate-limited by the backend. '
        'Send a burst, pause, repeat — and land more real clicks than a faster stream does.',
    popup=HEAD.format(dot='on', state='2,450 clicks')
          + steps_block([('Refresh results', 'button')])
          + fast_block(jitter=True) + stop_block()
          + button(FOOT, 'Stop', 'Sent <b>2,450</b> clicks'),
    right='<div class="page"><h3>What the page receives</h3>'
          '<p class="muted">25 clicks at full speed, then a 500ms breather</p>'
          '<div class="tl">' + ('<i></i>' * 25) + '<span class="gap"></span>'
          + ('<i></i>' * 25) + '<span class="gap"></span>' + ('<i></i>' * 12) + '</div></div>'
          '<span class="hud">⚡ 2,450 clicks · cooling 500ms</span>'
          '<div class="note">“Vary the timing slightly” jitters every gap by ±20%.</div>',
  ),
  dict(
    name='4-stop-conditions',
    h1='Tell it <em>when to stop</em>',
    sub='After a number of clicks or seconds, when text like “Sold out” appears, or when the '
        'button disappears. However it ends, it tells you why.',
    popup=HEAD.format(dot='', state='stopped')
          + steps_block([('Buy tickets', 'button')])
          + fast_block(cps=20, avg='About 20.0 clicks a second on average.')
          + stop_block('When some text appears', extra='Sold out')
          + button(FOOT, 'Start clicking', '■ Stopped: “Sold out” appeared'),
    right='<div class="page"><h3>Tickets</h3><p class="muted">General admission</p>'
          '<span class="pbtn alt">Buy tickets</span>'
          '<p style="margin:18px 0 0;color:#c0392b;font-weight:650">Sold out</p></div>'
          '<span class="hud stopped">■ stopped — “Sold out” appeared</span>'
          '<div class="note">No more clicking into a page that has already answered you.</div>',
  ),
  dict(
    name='5-sent-vs-skipped',
    h1='See what <em>didn’t</em> land',
    sub='When a button is covered by a modal or is disabled, a real click would not land '
        'either — so those are counted separately, with the reason.',
    popup=HEAD.format(dot='on', state='840 clicks')
          + steps_block([('Submit order', 'button')])
          + fast_block() + stop_block()
          + button(FOOT, 'Stop',
                   'Sent <b>840</b> clicks <span class="warn">· 96 skipped (covered)</span>'),
    right='<div class="page"><h3>Order</h3><p class="muted">Confirm your details</p>'
          '<span class="pbtn">Submit order<span class="ring"></span></span>'
          '<div class="overlay"><div>Session expired — please sign in again</div></div></div>'
          '<span class="hud">⚡ skipped — covered</span>'
          '<div class="note">A climbing “skipped” count is the fastest way to see why nothing is happening.</div>',
  ),
]

def main():
    if not os.path.exists(CHROME):
        sys.exit('✗ Google Chrome not found at ' + CHROME)
    os.makedirs(OUT, exist_ok=True)
    for shot in SHOTS:
        html = SHELL.format(h1=shot['h1'], sub=shot['sub'], popup=shot['popup'], right=shot['right'])
        page = os.path.join(OUT, shot['name'] + '.html')
        with open(page, 'w') as f:
            f.write(html)
        png = os.path.join(OUT, shot['name'] + '.png')
        subprocess.run([CHROME, '--headless', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=1', '--screenshot=' + png,
                        '--window-size=1280,800', 'file://' + page],
                       capture_output=True)
        size = os.path.getsize(png) if os.path.exists(png) else 0
        print(('✓ ' if size else '✗ ') + os.path.basename(png) + f' ({size:,} bytes)')
        os.remove(page)

if __name__ == '__main__':
    main()
