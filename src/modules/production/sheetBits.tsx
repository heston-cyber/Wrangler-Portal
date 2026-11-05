// Phase 5b step 3 (Nov 3): a shoot's call sheet as a chip and a button (NO CALL SHEET · Write it, DRAFT · Finish it,
// SENT · N OF M OPENED, Today · Open sheet), shared by Production (760:637, 763:2708) and the Dashboard's Coming up.
import { Button, StatusChip } from "../../ui/wp";
import { navigate } from "../../lib/router";

/** A shoot's call sheet: its chip, and the button for what's next (760:637, 763:2708; the Dashboard's Coming up). */
export type Sheet = { _id: string; state: "draft" | "sent"; built?: boolean; opened: number; of: number; people: number } | null;
const goTo = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); navigate(to); };
export function sheetBits(s: { _id: string; date: string; sheet: Sheet }, today: string, short = false) {
  const c = s.sheet;
  if (s.date < today && (!c || c.state === "draft")) return { href: c ? `/production/call-sheets/${c._id}` : "", chip: <StatusChip tone="neutral">{c ? "Not sent" : "No call sheet"}</StatusChip>, action: undefined, sent: false };
  const href = !c ? `/production/call-sheets/new?shoot=${s._id}` : c.state === "sent" ? `/production/call-sheets/${c._id}` : c.built ? `/production/call-sheets/${c._id}/edit` : `/production/call-sheets/${c._id}/questions`;
  const chip = s.date === today ? <StatusChip tone="accent">Today</StatusChip>
    : !c ? <StatusChip tone="warning">No call sheet</StatusChip>
    : c.state === "draft" ? <StatusChip tone="neutral">Draft</StatusChip>
    : <StatusChip tone="success">{short ? "Sent" : `Sent · ${c.opened} of ${c.of} opened`}</StatusChip>;
  const action = s.date === today ? <Button size="sm" onClick={goTo(href)}>{c ? "Open sheet" : "Write it"}</Button>
    : !c ? <Button size="sm" onClick={goTo(href)}>Write it</Button>
    : c.state === "draft" ? <Button size="sm" onClick={goTo(href)}>Finish it</Button> : undefined;
  return { href, chip, action, sent: c?.state === "sent" && s.date !== today };
}

