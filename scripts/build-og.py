#!/usr/bin/env python3
"""Render the social preview card (1200x630 PNG) that WhatsApp, Slack, X and
iMessage show when someone shares the site.

Built from the same palette as the landing page, with the real extension icon,
so a share looks like the product rather than a bare link. Regenerate with:

    python3 scripts/build-og.py
"""
import base64, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'site', 'og.png')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

with open(os.path.join(ROOT, 'icons', 'icon128.png'), 'rb') as f:
    icon = base64.b64encode(f.read()).decode()

HTML = f"""
<!doctype html><meta charset="utf-8">
<style>
  html,body {{ margin:0; width:1200px; height:630px; overflow:hidden;
    background:#0b0c0f; color:#f2f4f8;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif; }}
  .glow {{ position:absolute; top:-280px; left:50%; transform:translateX(-50%);
    width:1200px; height:700px;
    background:radial-gradient(closest-side,rgba(22,179,100,.22),transparent 70%); }}
  .wrap {{ position:relative; height:630px; padding:70px 78px; box-sizing:border-box;
    display:flex; flex-direction:column; }}
  .top {{ display:flex; align-items:center; gap:18px; }}
  .top img {{ width:74px; height:74px; border-radius:17px; }}
  .name {{ font-size:27px; font-weight:750; letter-spacing:-.5px; }}
  .badge {{ margin-left:auto; font-size:15px; color:#3ddc8c; border:1px solid #1f6b45;
    background:#0f2419; padding:8px 16px; border-radius:999px; font-weight:600; }}
  h1 {{ margin:44px 0 0; font-size:66px; line-height:1.03; letter-spacing:-2.4px;
    font-weight:800; max-width:1000px; }}
  h1 em {{ font-style:normal; color:#3ddc8c; }}
  p {{ margin:26px 0 0; font-size:25px; color:#9ba3b0; max-width:900px; line-height:1.45; }}
  .feet {{ margin-top:auto; display:flex; align-items:center; gap:14px;
    font-size:19px; color:#6f7783; }}
  .dot {{ width:5px; height:5px; border-radius:50%; background:#3a4152; }}
  .url {{ color:#cfd6df; font-weight:600; }}
</style>
<div class="glow"></div>
<div class="wrap">
  <div class="top">
    <img src="data:image/png;base64,{icon}" alt="">
    <span class="name">Pin &amp; Click</span>
    <span class="badge">Chrome Web Store</span>
  </div>
  <h1>The auto clicker that<br><em>doesn't lose the button</em></h1>
  <p>Pins the element, not the pixel — so it keeps clicking through re-renders,
     sequences and reloads.</p>
  <div class="feet">
    <span class="url">pin-and-click.vercel.app</span>
    <span class="dot"></span><span>up to 100 clicks/sec</span>
    <span class="dot"></span><span>free &amp; open source</span>
  </div>
</div>
"""

def main():
    if not os.path.exists(CHROME):
        sys.exit('✗ Google Chrome not found at ' + CHROME)
    page = os.path.join(ROOT, 'site', '_og.html')
    with open(page, 'w') as f:
        f.write(HTML)
    subprocess.run([CHROME, '--headless', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', '--screenshot=' + OUT,
                    '--window-size=1200,630', 'file://' + page], capture_output=True)
    os.remove(page)
    size = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    if not size:
        sys.exit('✗ render failed')
    print(f'✓ site/og.png ({size:,} bytes)')

if __name__ == '__main__':
    main()
