// Phase 2 Part A (Oct 29): pieces shared by the owner's and the client's project pages.
import { Icon } from "../../ui/Icon";
export { bytesText as bytes } from "../../lib/download";

export const STAGES = ["discovery", "strategy", "production", "polish", "delivery"] as const;
export type Stage = (typeof STAGES)[number];
export const stageName = (s: Stage) => s[0].toUpperCase() + s.slice(1);

/** "2026-11-07" → "Nov 7" (this year) or "Nov 7, 2027". */
export function dateText(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

/** The Wrangler Way bar: five segments, done ones filled with a tick, the current one named in full white. With
 *  onPick, each stage is a button (the owner moves the project there). */
export function StageBar({ stage, onPick }: { stage: Stage; onPick?: (s: Stage) => void }) {
  const at = STAGES.indexOf(stage);
  return (
    <ol className="wp-stagebar" aria-label={`Stage: ${stageName(stage)}, ${at + 1} of 5`}>
      {STAGES.map((s, i) => {
        const cls = i < at ? "done" : i === at ? "now" : "todo";
        const inner = <><span className="bar" /><span className="nm">{i < at && <Icon name="check" size={12} />}{stageName(s)}</span></>;
        return (
          <li key={s} className={cls} aria-current={i === at ? "step" : undefined}>
            {onPick ? <button type="button" onClick={() => onPick(s)} title={i === at ? `${stageName(s)} (now)` : `Move to ${stageName(s)}`}>{inner}</button> : inner}
          </li>
        );
      })}
    </ol>
  );
}
