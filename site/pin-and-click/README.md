# Pin & Click — fast auto clicker (Chrome MV3)

**→ [pin-and-click.vercel.app](https://pin-and-click.vercel.app)** — landing page with a live
in-browser demo of the click scheduler, and a one-click `.zip` download.

Pick an element once, then click it up to 100×/second. The target is re-resolved
on **every** tick, so it keeps working when the page re-renders the button as a
brand-new DOM node, or reloads entirely.

## Repo layout & deploys

| Path | What it is |
| --- | --- |
| `manifest.json`, `*.js`, `*.css`, `popup.html` | the extension itself |
| `native/` | the OS-level clicker (Swift + CoreGraphics) |
| `site/` | the landing page — the deploy's output directory |
| `scripts/build-zip.sh` | packages the extension into `site/pin-and-click.zip` |

The download offered on the landing page is **built at deploy time**, not committed:
Vercel is linked to this repo and runs `scripts/build-zip.sh` (per `vercel.json`) on every
push to `main`, so the zip can never drift from the source in that commit. Push and the
site updates itself; no token is stored anywhere. Run the same script locally to get an
identical zip for `Load unpacked`.

## Install
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Pin the extension to the toolbar

## Use
1. Open the popup → **🎯 Pick target on page** (popup closes, cursor becomes a crosshair)
2. Click the button you want. `Esc` cancels.
3. Set speed (default 50/s) → **Start clicking**
4. `Alt+Shift+C` toggles start/stop. Green pill bottom-right shows the live click count.

## Click a sequence, not just one button

Add more than one target and they're clicked **top to bottom, then looped** — enough to
drive a real flow (add to cart → checkout → confirm). Two things make it work without
any extra configuration:

- **It waits for a step.** If step 2 isn't on the page yet, it waits for it instead of
  skipping ahead — which is exactly what you want, since step 2 usually only appears
  *because* step 1 was clicked.
- **It gives up sanely.** If a step never shows up within 30s it stops and tells you
  which one it was stuck on, instead of spinning silently forever.

The HUD ring shows a numbered badge for the step being clicked right now.

## Knowing when to stop

Pick one from the **When to stop** dropdown:

| Option | Stops when |
| --- | --- |
| When I press stop | never — the default |
| After a number of clicks | the count is reached |
| After a number of seconds | the time is up |
| When some text appears | that text shows up anywhere on the page (`Sold out`, `Order placed`) |
| When the button disappears | no target can be resolved any more |

However it stops, the reason is shown in the popup and the on-page HUD.

## Sent vs skipped

The popup tallies **sent** clicks and **skipped** ones, with the reason. A click is
skipped when the element is there but a real click wouldn't have landed either:

- `covered` — something else (a modal, an overlay, a sticky header) is on top of it
- `disabled` — the element is `disabled` or `aria-disabled="true"`

That's the honest limit of what a page can tell you: whether the app actually *acted* on
a click isn't observable from the outside, so nothing here pretends to measure it. A
climbing `skipped` count is still the fastest way to see why nothing is happening.

## How the target survives page changes
Three fallbacks, in order, each tick:
1. stored CSS selector (prefers `id`, `data-testid`, `aria-label`, `name` over structural paths)
2. same tag + same visible text — catches re-renders with shuffled classes
3. last-known viewport position via `elementFromPoint`

State is saved per origin+path in `chrome.storage.local`, so a reload auto-resumes.

## Limits
Clicks are synthetic (`isTrusted: false`). Normal web UIs, React/Vue handlers and
`<button>`s all accept them; browser-native gates (file pickers, permission prompts,
some anti-cheat game canvases) require real OS input and will ignore them.

---

## Burst mode (avoid dropped clicks / API throttling)

A steady 50/s stream is often *worse* than a slower one: the page coalesces
handlers, and any request-per-click backend starts 429-ing. So clicks go out in
bursts — N clicks at full rate, then an idle gap.

- **Pause after every `N` clicks for `MS` ms** — default 25 clicks / 500ms
- **Jitter ±20%** — randomises every gap so the cadence isn't machine-perfect
- The popup shows the resulting **average** rate, e.g. 25 @ 50/s + 500ms → ≈25/s
- Uncheck the pause box for the old continuous behaviour
- Changing any of these mid-run applies immediately without resetting the click count

The HUD reads `cooling 500ms` during a pause, so you can see the rhythm.

---

## `native/nativeclick` — real OS-level clicks

The extension's clicks are JS events (`isTrusted: false`). For the things that
ignore those — file pickers, permission sheets, game canvases, anything outside
the browser — `native/nativeclick` posts **real** mouse events through
CoreGraphics' HID tap, indistinguishable from a physical click.

### Build
```sh
./native/build.sh
```

### One-time permission
macOS gates synthetic input behind Accessibility. Open **System Settings →
Privacy & Security → Accessibility** and enable the terminal app you run it from
(Terminal / iTerm / VS Code), then **quit and reopen that app**. Without this the
tool refuses to start and tells you so — it never half-works.

### Use
```sh
./native/nativeclick pick                  # aim the pointer, get its coords
./native/nativeclick --at 812,455 --cps 50 --burst 25 --pause 500 --jitter
./native/nativeclick --here --cps 20 --for 30    # click wherever the pointer is
```

Same burst/jitter options as the extension, plus `--for SECONDS`, `--clicks N`,
`--right`, `--countdown SEC`.

**Stopping:** move the mouse by hand (it aborts on any nudge over 40px — your
escape hatch when 50/s makes the UI unusable), or Ctrl+C. Disable with
`--no-abort`.

### The tradeoff vs the extension
OS-level clicks are inherently **coordinate**-based — there is no DOM down there,
so a button that moves is a target that's missed. The extension pins the
*element*; the native tool pins the *point*. Use the extension for web UIs that
re-render, the native tool for everything that won't accept synthetic events.

---

## Publishing to the Chrome Web Store

`store/LISTING.md` holds every dashboard field ready to paste — name, summary, detailed
description, single-purpose statement, permission justifications, and the privacy
declarations. Assets:

- `icons/icon{16,32,48,128}.png` — generated from `icons/icon.svg` (and `icon-small.svg`,
  a simplified version that stays legible at 16px)
- `store/shots/*.png` — five 1280x800 screenshots, regenerate with
  `python3 store/build-shots.py`. They are composed from the extension's real `popup.css`,
  so they can't drift into advertising a UI that doesn't exist.
- `site/pin-and-click.zip` — the upload, built by `./scripts/build-zip.sh`

Privacy policy lives at [/privacy.html](https://pin-and-click.vercel.app/privacy.html) —
the store requires a hosted URL.

Registering as a Chrome Web Store developer costs a one-time US$5 and needs a Google
account, so the final submit is a manual step.
