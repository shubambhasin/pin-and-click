// nativeclick — real OS-level mouse clicks via CoreGraphics (macOS).
// Posts to the HID event tap, so events arrive with isTrusted semantics: they
// work on file pickers, permission sheets, game canvases and anything else that
// ignores JS-synthesised clicks.
//
// Requires: System Settings → Privacy & Security → Accessibility → allow the
// terminal app you run this from.

import Foundation
import CoreGraphics
import ApplicationServices

// ---------- args ----------

struct Opts {
    var x: Double? = nil
    var y: Double? = nil
    var here = false          // click wherever the pointer currently is
    var cps = 50.0
    var burstSize = 25        // 0 = no bursting
    var burstPause = 500.0    // ms
    var jitter = false
    var duration: Double? = nil   // seconds; nil = until stopped
    var maxClicks: Int? = nil
    var countdown = 3.0
    var button: CGMouseButton = .left
    var moveAbort = true      // stop if the human nudges the mouse
    var abortDistance = 40.0  // px
    var pick = false
}

func usage() -> String { """
nativeclick — real OS-level auto clicker (macOS)

USAGE
  nativeclick pick                       print the pointer's screen coords (aim, then wait)
  nativeclick --here                     click repeatedly wherever the pointer is
  nativeclick --at X,Y                   click repeatedly at fixed screen coords

OPTIONS
  --cps N            clicks per second inside a burst (default 50)
  --burst N          clicks per burst, 0 disables bursting (default 25)
  --pause MS         idle gap between bursts (default 500)
  --jitter           randomise every gap by ±20%
  --for SECONDS      stop after this long
  --clicks N         stop after N clicks
  --countdown SEC    delay before starting (default 3)
  --right            click the right button instead of the left
  --no-abort         don't stop when the mouse is moved by hand
  --abort-dist PX    movement that counts as "moved by hand" (default 40)

STOPPING
  Move the mouse (unless --no-abort), or press Ctrl+C.

EXAMPLES
  nativeclick pick
  nativeclick --at 812,455 --cps 50 --burst 25 --pause 500 --jitter
  nativeclick --here --cps 20 --for 30
"""
}

func parse() -> Opts {
    var o = Opts()
    var a = Array(CommandLine.arguments.dropFirst())
    if a.first == "pick" { o.pick = true; return o }
    if a.isEmpty || a.contains("-h") || a.contains("--help") { print(usage()); exit(0) }

    while let arg = a.first {
        a.removeFirst()
        func next(_ label: String) -> String {
            guard let v = a.first else { FileHandle.standardError.write("missing value for \(label)\n".data(using: .utf8)!); exit(2) }
            a.removeFirst(); return v
        }
        switch arg {
        case "--here":       o.here = true
        case "--at":
            let parts = next("--at").split(separator: ",")
            guard parts.count == 2, let px = Double(parts[0]), let py = Double(parts[1]) else {
                FileHandle.standardError.write("--at expects X,Y\n".data(using: .utf8)!); exit(2)
            }
            o.x = px; o.y = py
        case "--cps":        o.cps = max(0.1, Double(next("--cps")) ?? 50)
        case "--burst":      o.burstSize = max(0, Int(next("--burst")) ?? 25)
        case "--pause":      o.burstPause = max(0, Double(next("--pause")) ?? 500)
        case "--jitter":     o.jitter = true
        case "--for":        o.duration = Double(next("--for"))
        case "--clicks":     o.maxClicks = Int(next("--clicks"))
        case "--countdown":  o.countdown = max(0, Double(next("--countdown")) ?? 3)
        case "--right":      o.button = .right
        case "--no-abort":   o.moveAbort = false
        case "--abort-dist": o.abortDistance = max(1, Double(next("--abort-dist")) ?? 40)
        default:
            FileHandle.standardError.write("unknown option: \(arg)\n\n".data(using: .utf8)!)
            print(usage()); exit(2)
        }
    }
    if !o.here && o.x == nil { FileHandle.standardError.write("need --at X,Y or --here (or run: nativeclick pick)\n".data(using: .utf8)!); exit(2) }
    return o
}

// ---------- permission ----------

func requireAccessibility() {
    guard !AXIsProcessTrusted() else { return }
    FileHandle.standardError.write("""
    ✗ Accessibility permission missing.

      This tool posts real mouse events, which macOS gates behind Accessibility.
      Open: System Settings → Privacy & Security → Accessibility
      Enable the app you're running this from (Terminal / iTerm / VS Code),
      then quit and reopen that app and run this again.

    """.data(using: .utf8)!)
    exit(1)
}

// ---------- clicking ----------

let src = CGEventSource(stateID: .hidSystemState)

func pointer() -> CGPoint {
    CGEvent(source: nil)?.location ?? .zero
}

func click(at p: CGPoint, button: CGMouseButton) {
    let (down, up): (CGEventType, CGEventType) = button == .right
        ? (.rightMouseDown, .rightMouseUp)
        : (.leftMouseDown, .leftMouseUp)
    // A move first, so hover/tracking state matches a human click.
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: button)?
        .post(tap: .cghidEventTap)
    for type in [down, up] {
        guard let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: button) else { continue }
        e.setIntegerValueField(.mouseEventClickState, value: 1)   // every event is click #1, not a double/triple
        e.post(tap: .cghidEventTap)
    }
}

// ---------- main ----------

let opts = parse()

if opts.pick {
    requireAccessibility()
    print("Move the pointer onto your target. Reading its position in 5s…")
    for i in stride(from: 5, through: 1, by: -1) {
        print("  \(i)…"); fflush(stdout)
        Thread.sleep(forTimeInterval: 1)
    }
    let p = pointer()
    print(String(format: "\nTarget: %.0f,%.0f", p.x, p.y))
    print(String(format: "Run:    nativeclick --at %.0f,%.0f --cps 50 --burst 25 --pause 500", p.x, p.y))
    exit(0)
}

requireAccessibility()

var running = true
signal(SIGINT)  { _ in print("\n■ stopped (Ctrl+C)"); exit(0) }
signal(SIGTERM) { _ in exit(0) }

if opts.countdown > 0 {
    let where_ = opts.here ? "the pointer's live position" : String(format: "%.0f,%.0f", opts.x!, opts.y!)
    print("Clicking \(where_) at \(Int(opts.cps))/s" +
          (opts.burstSize > 0 ? ", pausing \(Int(opts.burstPause))ms every \(opts.burstSize) clicks" : " continuously") +
          (opts.jitter ? ", jittered" : ""))
    print(opts.moveAbort ? "Move the mouse by hand to stop. Starting in…" : "Ctrl+C to stop. Starting in…")
    var left = opts.countdown
    while left > 0 {
        print("  \(Int(ceil(left)))…"); fflush(stdout)
        Thread.sleep(forTimeInterval: min(1, left))
        left -= 1
    }
}

let target = opts.here ? nil : CGPoint(x: opts.x!, y: opts.y!)
let started = Date()
var clicks = 0
var inBurst = 0
var lastSeen = pointer()

while running {
    let p = target ?? pointer()

    if opts.moveAbort, target != nil {
        let now = pointer()
        if hypot(now.x - lastSeen.x, now.y - lastSeen.y) > opts.abortDistance, clicks > 0 {
            print("\n■ stopped — mouse moved by hand (\(clicks) clicks)")
            exit(0)
        }
    }

    click(at: p, button: opts.button)
    clicks += 1
    inBurst += 1
    lastSeen = pointer()

    if clicks % 10 == 0 {
        print("\r  \(clicks) clicks…", terminator: ""); fflush(stdout)
    }
    if let m = opts.maxClicks, clicks >= m { break }
    if let d = opts.duration, Date().timeIntervalSince(started) >= d { break }

    var gap = 1.0 / opts.cps
    if opts.burstSize > 0, inBurst >= opts.burstSize {
        gap = opts.burstPause / 1000.0
        inBurst = 0
    }
    if opts.jitter { gap *= 0.8 + Double.random(in: 0...0.4) }
    Thread.sleep(forTimeInterval: gap)
}

print("\n✓ done — \(clicks) clicks in " + String(format: "%.1fs", Date().timeIntervalSince(started)))
