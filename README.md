<h1>
  <img src="icons/icon48.png" width="28" height="28" align="top" alt="">
  Pin &amp; Click — fast auto clicker (Chrome MV3)
</h1>

**→ [Add to Chrome](https://chromewebstore.google.com/detail/opdneecbdmlcmcmlkfggdjfhedkandop)** — live on the Chrome Web Store.
**→ [pin-and-click.vercel.app](https://pin-and-click.vercel.app)** — landing page with a live
in-browser demo of the click scheduler.

Pick an element once, then click it up to 100×/second. The target is re-resolved
on **every** tick, so it keeps working when the page re-renders the button as a
brand-new DOM node, or reloads entirely.

![Pins the element, not the pixel](store/shots/1-pins-the-element.png)

## What it looks like

<table>
  <tr>
    <td width="50%"><a href="store/shots/2-sequences.png"><img src="store/shots/2-sequences.png" alt="Chain buttons into a sequence"></a></td>
    <td width="50%"><a href="store/shots/3-burst-mode.png"><img src="store/shots/3-burst-mode.png" alt="Bursts, so the clicks actually land"></a></td>
  </tr>
  <tr>
    <td><b>Sequences.</b> Pin several buttons and they run top to bottom, then loop. A step
    that isn't on the page yet is waited for, not skipped.</td>
    <td><b>Burst mode.</b> A flat 50/s stream gets coalesced by the page and rate-limited by
    the backend, so clicks go out in batches with a breather between them.</td>
  </tr>
  <tr>
    <td><a href="store/shots/4-stop-conditions.png"><img src="store/shots/4-stop-conditions.png" alt="Tell it when to stop"></a></td>
    <td><a href="store/shots/5-sent-vs-skipped.png"><img src="store/shots/5-sent-vs-skipped.png" alt="See what didn't land"></a></td>
  </tr>
  <tr>
    <td><b>Stop conditions.</b> After N clicks or seconds, when text like <code>Sold out</code>
    appears, or when the button disappears — and it tells you which one ended it.</td>
    <td><b>Sent vs skipped.</b> When a button is covered by a modal or disabled, a real click
    wouldn't land either — so those are counted apart, with the reason.</td>
  </tr>
</table>

> The screenshots are generated from the extension's real `popup.css` by
> `python3 store/build-shots.py`, so they can't drift into showing a UI that doesn't exist.

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

**[Add to Chrome](https://chromewebstore.google.com/detail/opdneecbdmlcmcmlkfggdjfhedkandop)** — one click, no developer mode.

Or load it unpacked from source:
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
- `site/og.png` — the 1200x630 social card shown when the site is shared; regenerate with
  `python3 scripts/build-og.py`
- `store/shots/*.png` — five 1280x800 screenshots, regenerate with
  `python3 store/build-shots.py`. They are composed from the extension's real `popup.css`,
  so they can't drift into advertising a UI that doesn't exist.
- `site/pin-and-click.zip` — the upload, built by `./scripts/build-zip.sh`

Privacy policy lives at [/privacy.html](https://pin-and-click.vercel.app/privacy.html) —
the store requires a hosted URL.

## Publishing automatically

Releases are triggered by the **manifest version**, not by every commit — the store
rejects an upload that isn't higher than what's live, and every publish enters Google's
review queue. So:

```sh
npm run bump          # 1.0.0 -> 1.0.1  (or: npm run bump -- minor)
git commit -am "..." && git push
```

`.github/workflows/publish-extension.yml` sees the version change, builds the zip, uploads
it and submits for review. If the version is unchanged it skips with a note, so ordinary
commits are safe. You can also run it by hand from the Actions tab, with a **draft** option
that uploads without submitting.

Publishing locally works the same way: `npm run publish:store` (add `-- --draft` to hold it).

### One-time credentials

Four repo secrets (Settings → Secrets and variables → Actions):

| secret | where it comes from |
| --- | --- |
| `CWS_EXTENSION_ID` | `opdneecbdmlcmcmlkfggdjfhedkandop` |
| `CWS_CLIENT_ID` | Google Cloud OAuth client (Desktop app) |
| `CWS_CLIENT_SECRET` | same client |
| `CWS_REFRESH_TOKEN` | exchanged once, below |

1. [console.cloud.google.com](https://console.cloud.google.com) → new project → **APIs &
   Services → Library** → enable **Chrome Web Store API**.
2. **OAuth consent screen** → External → add yourself as a test user.
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → copy the id and
   secret.
4. Get a refresh token — open this in a browser (substituting your client id), approve, and
   copy the `code=` value out of the redirected URL:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent
   ```

   ```sh
   curl -s https://oauth2.googleapis.com/token      -d client_id=YOUR_CLIENT_ID -d client_secret=YOUR_CLIENT_SECRET      -d code=THE_CODE -d grant_type=authorization_code      -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

   The `refresh_token` in the response is `CWS_REFRESH_TOKEN`. It's long-lived, but Google
   expires refresh tokens for apps left in "Testing" after 7 days — publish the consent
   screen, or expect to redo this step.

### What "published" actually means

The API call submits for review; it does not make the new version live. Review can take
hours to days, and the previous version stays live until it passes. A rejection arrives by
email — the workflow will have reported success, because the upload and the submission both
succeeded.

Registering as a Chrome Web Store developer costs a one-time US$5 and needs a Google
account, so the *first* submit is a manual step.
