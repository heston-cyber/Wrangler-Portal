// D174 (Heston, Nov 12): the Dashboard's red button says "Create" and opens one menu of everything that can be made.
// Each item opens the page or small dialog that already makes that thing, so nothing here writes to the backend itself.
// A popup under the button on a computer, the same bottom sheet as the hold menus on a phone (MenuSurface). A team
// member sees only what their role allows (pathNeeds, the same rule as the side menu); with nothing allowed, no button.
import { Suspense, lazy, useRef, useState } from "react";
import { ChevronDown, ClipboardList, Clapperboard, FileSignature, FileText, NotebookText, Receipt, ReceiptText, UserPlus } from "lucide-react";
import { Button } from "../../ui/wp";
import { MenuItem, useToast } from "../../ui/kit";
import { MenuSurface } from "../../ui/hold";
import { navigate } from "../../lib/router";
import { pathNeeds, usePerms } from "../../lib/teamAccess";
import { NewBriefing } from "../vendors/NewBriefing";

// The two dialogs live in big pages; load them only when picked.
const NewShoot = lazy(() => import("../production/Production").then((m) => ({ default: m.NewShoot })));
const NewClient = lazy(() => import("../review/Projects").then((m) => ({ default: m.NewClient })));

type Dialog = "shoot" | "briefing" | "client";
type Item = { key: string; label: string; icon: React.ReactNode; needs: string; to?: string; dialog?: Dialog };
const I = 16;

// Heston's order, then the rest. `needs` is a path whose access rule decides who sees the item.
export const CREATE_ITEMS: Item[] = [
  { key: "invoice", label: "Invoice", icon: <Receipt size={I} />, needs: "/payments/invoices/new", to: "/payments/invoices/new" },
  { key: "proposal", label: "Proposal", icon: <FileText size={I} />, needs: "/proposals/new", to: "/proposals/new" },
  { key: "quote", label: "Quote", icon: <ReceiptText size={I} />, needs: "/payments/quotes/new", to: "/payments/quotes/new" },
  { key: "contract", label: "Contract", icon: <FileSignature size={I} />, needs: "/sign/new", to: "/sign/new" },
  { key: "shoot", label: "Shoot", icon: <Clapperboard size={I} />, needs: "/production/shoots", dialog: "shoot" },
  { key: "callsheet", label: "Call sheet", icon: <ClipboardList size={I} />, needs: "/production/call-sheets", to: "/production/call-sheets/new" },
  { key: "briefing", label: "Briefing", icon: <NotebookText size={I} />, needs: "/vendors/briefings", dialog: "briefing" },
  { key: "client", label: "Client", icon: <UserPlus size={I} />, needs: "/clients", dialog: "client" },
];

export function CreateMenu() {
  const { perms, team, loading } = usePerms();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, show] = useToast();
  const btn = useRef<HTMLButtonElement>(null);
  const allowed = (path: string) => {
    const n = pathNeeds(path);
    return n === "any" || (n === "owner" ? !team : n.some((p) => perms[p]));
  };
  const items = CREATE_ITEMS.filter((i) => allowed(i.needs));
  if (loading || !items.length) return null;
  const close = () => setAt(null);
  const pick = (i: Item) => { close(); if (i.to) navigate(i.to); else if (i.dialog) setDialog(i.dialog); };
  const open = () => { const r = btn.current?.getBoundingClientRect(); setAt(r ? { x: r.left, y: r.bottom + 6 } : { x: 16, y: 120 }); };
  return (
    <>
      <Button ref={btn} variant="primary" className="create-btn" aria-haspopup="menu" aria-expanded={!!at} onClick={() => (at ? close() : open())}>
        Create <ChevronDown size={16} aria-hidden />
      </Button>
      {at && (
        <MenuSurface at={at} onClose={close} label="Create" title="Create">
          {items.map((i) => <MenuItem key={i.key} icon={i.icon} onSelect={() => pick(i)}>{i.label}</MenuItem>)}
        </MenuSurface>
      )}
      <Suspense fallback={null}>
        {dialog === "shoot" && <NewShoot onClose={() => setDialog(null)} />}
        {dialog === "client" && <NewClient onClose={() => setDialog(null)} onDone={(name) => { setDialog(null); show(`Added ${name}.`); }} />}
      </Suspense>
      {dialog === "briefing" && <NewBriefing onClose={() => setDialog(null)} />}
      {toast}
    </>
  );
}
