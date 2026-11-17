// D174 (Heston, Nov 12): the Dashboard's red button says "Create" and opens one menu of everything that can be made.
// Each item opens the page or small dialog that already makes that thing, so nothing here writes to the backend itself.
// A popup under the button on a computer, the same bottom sheet as the hold menus on a phone (MenuSurface). A team
// member sees only what their role allows (pathNeeds, the same rule as the side menu); with nothing allowed, no button.
import { Suspense, lazy, useRef, useState } from "react";
import { Backpack, ChevronDown, ClipboardList, Clapperboard, FileSignature, FileText, ListChecks, MapPin, NotebookText, Package, Palette, Receipt, ReceiptText, Shapes, SwatchBook, UserPlus } from "lucide-react";
import { Button } from "../../ui/wp";
import { MenuItem, MenuSep, useToast } from "../../ui/kit";
import { MenuSurface } from "../../ui/hold";
import { navigate } from "../../lib/router";
import { pathNeeds, usePerms } from "../../lib/teamAccess";
import { NewBriefing } from "../vendors/NewBriefing";

// The two dialogs live in big pages; load them only when picked.
const NewShoot = lazy(() => import("../production/Production").then((m) => ({ default: m.NewShoot })));
const NewClient = lazy(() => import("../review/Projects").then((m) => ({ default: m.NewClient })));

type Dialog = "shoot" | "briefing" | "client";
type Item = { key: string; label: string; icon: React.ReactNode; needs: string; to?: string; dialog?: Dialog; sep?: boolean };
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

// Nov 17 (Heston, 09:33): the Production page's Create: everything that's made inside Production, stage by stage
// (Creative planning · Pre-pro · Prin-pro · Delivery); a line between stages.
export const PRODUCTION_CREATE: Item[] = [
  { key: "doc", label: "Creative doc", icon: <FileText size={I} />, needs: "/creative/docs", to: "/creative/docs?new=1" },
  { key: "canvas", label: "Canvas", icon: <Shapes size={I} />, needs: "/creative/canvas", to: "/creative/canvas?new=1" },
  { key: "mood", label: "Mood board", icon: <Palette size={I} />, needs: "/creative/canvas", to: "/creative/canvas?new=mood" },
  { key: "place", label: "Location", icon: <MapPin size={I} />, needs: "/creative/locations", to: "/creative/locations?new=1" },
  { key: "kit", label: "Brand kit", icon: <SwatchBook size={I} />, needs: "/creative/kits", to: "/creative/kits?new=1" },
  { key: "shotlist", label: "Shot list", icon: <ListChecks size={I} />, needs: "/production/shot-lists", to: "/production/shot-lists?new=1", sep: true },
  { key: "callsheet", label: "Call sheet", icon: <ClipboardList size={I} />, needs: "/production/call-sheets", to: "/production/call-sheets/new" },
  { key: "briefing", label: "Briefing", icon: <NotebookText size={I} />, needs: "/vendors/briefings", dialog: "briefing" },
  { key: "shoot", label: "Shoot", icon: <Clapperboard size={I} />, needs: "/production/shoots", dialog: "shoot", sep: true },
  { key: "packing", label: "Packing list", icon: <Backpack size={I} />, needs: "/production/gear", to: "/production/gear/packing?new=1" },
  { key: "delivery", label: "Delivery", icon: <Package size={I} />, needs: "/delivery", to: "/delivery?new=1", sep: true },
];

export function CreateMenu({ items: list = CREATE_ITEMS }: { items?: Item[] } = {}) {
  const { perms, team, loading } = usePerms();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, show] = useToast();
  const btn = useRef<HTMLButtonElement>(null);
  const allowed = (path: string) => {
    const n = pathNeeds(path);
    return n === "any" || (n === "owner" ? !team : n.some((p) => perms[p]));
  };
  const items = list.filter((i) => allowed(i.needs));
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
          {items.map((i, k) => <span key={i.key} style={{ display: "contents" }}>{i.sep && k > 0 && <MenuSep />}<MenuItem icon={i.icon} onSelect={() => pick(i)}>{i.label}</MenuItem></span>)}
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
