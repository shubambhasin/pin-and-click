# Pin & Click — fast auto clicker (Chrome MV3)

Pick an element once, then click it up to 100×/second. The target is re-resolved
on **every** tick, so it keeps working when the page re-renders the button as a
brand-new DOM node, or reloads entirely.

## Install
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Pin the extension to the toolbar

## Use
1. Open the popup → **🎯 Pick target on page** (popup closes, cursor becomes a crosshair)
2. Click the button you want. `Esc` cancels.
3. Set speed (default 50/s) → **Start clicking**
4. `Alt+Shift+C` toggles start/stop. Green pill bottom-right shows the live click count.

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
