// Nov 17 (Heston, 10:46: "Still no haptic feedback"): a small test page to find out what this phone and browser allow.
// Three ways, each started by a plain tap: (1) the phone's own switch (tapped directly), (2) a hidden switch flipped by
// the page (what the hold menus use on iPhone), (3) the Vibration API (Android). Nothing is saved.
import { useState } from "react";
import { TopBar } from "../../shell/Shell";
import { Button, PageHeader } from "../../ui/wp";
import { hapticRelease } from "../../lib/haptic";

export default function HapticTest() {
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} · ${s}`, ...l].slice(0, 8));
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const ios = /OS (\d+)_/.exec(ua)?.[1];
  return (
    <>
      <TopBar><span className="here">Haptics test</span></TopBar>
      <div className="wp-page">
        <PageHeader title="Haptics test." sub={`This phone: ${ios ? `iOS ${ios}` : "not an iPhone"} · ${/CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "another browser"} · Vibration API ${typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? "yes" : "no"}`} />
        <div className="wp-card glass" style={{ display: "grid", gap: 18, padding: 20, borderRadius: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17 }}>
            {/* @ts-expect-error: "switch" is Safari's own attribute (iOS 17.4+) */}
            <input type="checkbox" switch="" style={{ width: 52, height: 32 }} onChange={() => add("1 · the switch, tapped directly")} />
            1 · Tap this switch
          </label>
          <Button onClick={() => { hapticRelease(); add("2 · a hidden switch, flipped by the page"); }}>2 · Tap for the page's tap</Button>
          <Button onClick={() => { const ok = typeof navigator.vibrate === "function" && navigator.vibrate(30); add(`3 · Vibration API: ${ok ? "sent" : "not here"}`); }}>3 · Tap to vibrate</Button>
          <p className="secondary" style={{ margin: 0 }}>Tell Claude which numbers you felt.</p>
          {log.map((l) => <span key={l} className="secondary wp-small">{l}</span>)}
        </div>
      </div>
    </>
  );
}
