// The portal's frame (Figma "03 · Shell", approved Oct 29). Desktop: a 256 px glass sidebar, fixed, with layers:
// clicking a layer item opens its main page, the chevron opens its layer. Phone: the layers become chips under the
// top bar and a glass tab bar is fixed at the bottom. The back office and the client side share it; the client side
// wears its business's look (lib/brand.ts). Work surfaces (the review page) hide the sidebar and open it as a drawer.
import { BellButton } from "../modules/bell/BellButton";
import { Light } from "./Light";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useSignOutAsk } from "./SignOut";
import { sideWord, useSideSwitch } from "./SideSwitch";
import { DEFAULT_TOOLS, toolsOf, type ToolKey, type Tools } from "../../convex/lib/tools";
import { api } from "../../convex/_generated/api";
import { linkProps, navigate, useLocation } from "../lib/router";
import { useUploads } from "../lib/uploads";
import { canOpen, usePerms } from "../lib/teamAccess";
import { useBrand, type Brand } from "../lib/brand";
import { Menu, MenuItem, MenuSep, Modal, Thumb } from "../ui/kit";
import { Icon, type IconName } from "../ui/Icon";
import { Avatar, Badge, IconButton } from "../ui/wp";
import { projectLabel } from "../lib/format";
import wpLogo from "../assets/d1/wp-logo.png";
import lightBack from "../assets/portal/light-softblob.jpg";
import lightClient from "../assets/portal/light-elbow.jpg";

export type Side = "owner" | "client" | "vendor"; // Phase 3c: the vendor side
type Me = { name: string | null; email: string };
type ShellCtx = { openSidebar: () => void; peekSidebar: (on: boolean) => void; openSearch: () => void; overlay: boolean; side: Side };
const Ctx = createContext<ShellCtx>({ openSidebar: () => {}, peekSidebar: () => {}, openSearch: () => {}, overlay: false, side: "owner" });
export const useShell = () => useContext(Ctx);

// ---------- what goes where ----------
// D150 (Heston, Nov 4): a layer can be split into groups (Production's Pre-pro · Prin-pro · Post-pro · Delivery).
// D151 (Nov 4, 21:40): Docs (Proposals · Contracts) and People (Clients · Vendors) are grouped the same way.
// `only`: a group with no pages under it yet (Delivery): it names the group, and isn't listed itself.
type Sub = { to: string; label: string; match: (p: string) => boolean; group?: string; only?: boolean };
export type Item = { to: string; label: string; icon: IconName; match: (p: string) => boolean; tab?: (p: string) => boolean; layer?: Sub[]; layerHas?: (p: string) => boolean; badge?: number };

const starts = (p: string, ...pre: string[]) => pre.some((x) => p === x || p.startsWith(x + "/"));
const OWNER_DOCS: Sub[] = [
  { to: "/sign/new", label: "New document", match: (p) => starts(p, "/sign/new", "/sign/b") },
  { to: "/sign/docs", label: "All docs", match: (p) => starts(p, "/sign/docs", "/sign/d") },
  { to: "/sign/templates", label: "Templates", match: (p) => starts(p, "/sign/templates") },
  { to: "/sign/signature", label: "Your signature", match: (p) => starts(p, "/sign/signature") },
];
const OWNER_PAYMENTS: Sub[] = [{ to: "/payments", label: "Overview", match: (p) => p === "/payments" }, { to: "/payments/invoices", label: "Invoices", match: (p) => starts(p, "/payments/invoices") },
  { to: "/payments/quotes", label: "Quotes", match: (p) => starts(p, "/payments/quotes") }, // Phase 3b
  { to: "/payments/subscriptions", label: "Subscriptions", match: (p) => starts(p, "/payments/subscriptions") }, { to: "/payments/plans", label: "Plans", match: (p) => starts(p, "/payments/plans") },
  { to: "/payments/reports", label: "Reports", match: (p) => starts(p, "/payments/reports") }]; // Phase 5e step 5
const inPayments = (p: string) => starts(p, "/payments");
// Phase 3b (D69): Proposals is its own item with a layer.
const OWNER_PROPOSALS: Sub[] = [
  { to: "/proposals/new", label: "New proposal", match: (p) => starts(p, "/proposals/new") },
  { to: "/proposals", label: "All proposals", match: (p) => starts(p, "/proposals") && !starts(p, "/proposals/overview", "/proposals/new", "/proposals/templates", "/proposals/questionnaire") },
  { to: "/proposals/templates", label: "Templates", match: (p) => starts(p, "/proposals/templates") },
  { to: "/proposals/questionnaire", label: "Questionnaire", match: (p) => starts(p, "/proposals/questionnaire") },
];
const inProposals = (p: string) => starts(p, "/proposals");
// Phase 3c (D95): Vendors is its own layer after Payments. Bookings, Briefings and Payments join as they're built.
const OWNER_VENDORS: Sub[] = [
  { to: "/vendors", label: "All vendors", match: (p) => starts(p, "/vendors") && !starts(p, "/vendors/overview", "/vendors/bookings", "/vendors/briefings", "/vendors/payments") },
  { to: "/vendors/payments", label: "Payments", match: (p) => starts(p, "/vendors/payments") }, // step 5
];
// D150: Bookings and Briefings moved to Production › Pre-pro (their addresses stay).
const inVendors = (p: string) => starts(p, "/vendors") && !starts(p, "/vendors/bookings", "/vendors/briefings");
// Phase 5b (D126): Production after Vendors: Overview · Shoots, then Call sheets (step 3) and Calendar (step 5).
// D150 (Heston, Nov 4): Production holds the whole pipeline, in four stages. Projects and Review (cuts) moved in from
// Review, Bookings and Briefings from Vendors; every address stays as it was, so links already sent keep working.
const OWNER_PRODUCTION: Sub[] = [
  { to: "/production", label: "Overview", match: (p) => p === "/production" || p === "/production/" },
  { group: "Pre-pro", to: "/projects", label: "Projects", match: (p) => starts(p, "/projects") },
  { group: "Pre-pro", to: "/vendors/bookings", label: "Bookings", match: (p) => starts(p, "/vendors/bookings") },
  { group: "Pre-pro", to: "/vendors/briefings", label: "Briefings", match: (p) => starts(p, "/vendors/briefings") },
  { group: "Pre-pro", to: "/production/call-sheets", label: "Call sheets", match: (p) => starts(p, "/production/call-sheets") },
  { group: "Prin-pro", to: "/production/shoots", label: "Shoots", match: (p) => starts(p, "/production/shoots") },
  { group: "Prin-pro", to: "/production/calendar", label: "Calendar", match: (p) => starts(p, "/production/calendar") },
  { group: "Prin-pro", to: "/production/gear", label: "Gear", match: (p) => starts(p, "/production/gear") },
  { group: "Post-pro", to: "/review/overview", label: "Review", match: (p) => starts(p, "/review", "/v") },
  { group: "Post-pro", to: "/activity", label: "Activity", match: (p) => starts(p, "/activity") },
  { group: "Delivery", to: "/production/delivery", label: "Delivery", match: (p) => starts(p, "/production/delivery"), only: true },
];
// Heston (Nov 4, 21:01): each stage folds with an arrow, and its name opens the stage's own overview. Delivery is only
// its "Coming soon" page for now, so it has no pages under it.
// D151: the same for Docs (Proposals · Contracts) and People (Clients · Vendors): each name opens that tool's overview.
export const STAGE_TO: Record<string, string> = { "Pre-pro": "/production/pre-pro", "Prin-pro": "/production/prin-pro", "Post-pro": "/production/post-pro", Delivery: "/production/delivery",
  Proposals: "/proposals/overview", Contracts: "/sign/overview", Clients: "/clients/overview", Vendors: "/vendors/overview" };
const groupsOf = (layer: Sub[]) => [...new Set(layer.map((s) => s.group).filter((g): g is string => !!g))];
const stageItems = (layer: Sub[], g: string) => layer.filter((s) => s.group === g && !s.only);
const inStage = (layer: Sub[], g: string, p: string) => starts(p, STAGE_TO[g]) || stageItems(layer, g).some((s) => s.match(p));
const inProduction = (p: string) => starts(p, "/production", "/projects", "/review", "/activity", "/v", "/vendors/bookings", "/vendors/briefings");
// Phase 3 (Heston, Oct 29): Clients becomes a layer: Pipeline · Companies · Follow-ups. Companies is the client list.
const CRM = ["/clients/overview", "/clients/pipeline", "/clients/follow-ups", "/clients/deals", "/clients/estimates", "/clients/testimonials"];
const OWNER_CLIENTS: Sub[] = [
  { to: "/clients/pipeline", label: "Pipeline", match: (p) => starts(p, "/clients/pipeline", "/clients/deals", "/clients/estimates") },
  { to: "/clients", label: "Companies", match: (p) => starts(p, "/clients") && !CRM.some((x) => starts(p, x)) },
  { to: "/clients/follow-ups", label: "Follow-ups", match: (p) => starts(p, "/clients/follow-ups") },
  { to: "/clients/testimonials", label: "Testimonials", match: (p) => starts(p, "/clients/testimonials") }, // Phase 5 (D99)
];
const inClients = (p: string) => starts(p, "/clients");
const inDocs = (p: string) => starts(p, "/sign", "/docs");
// D151 (Heston, Nov 4): Docs holds Proposals and Contracts (what Docs was); People holds Clients and Vendors.
const OWNER_DOCS_ALL: Sub[] = [...OWNER_PROPOSALS.map((x) => ({ ...x, group: "Proposals" })), ...OWNER_DOCS.map((x) => ({ ...x, label: x.label === "All docs" ? "All contracts" : x.label === "New document" ? "New contract" : x.label, group: "Contracts" }))];
const inDocsAll = (p: string) => inDocs(p) || inProposals(p);
const OWNER_PEOPLE: Sub[] = [...OWNER_CLIENTS.map((x) => ({ ...x, group: "Clients" })), ...OWNER_VENDORS.map((x) => ({ ...x, group: "Vendors" }))];
const inPeople = (p: string) => inClients(p) || inVendors(p);

// Nov 2 (Heston): Settings › Tools sets this owner's menu: the order, which tools are on it, and Home is now Dashboard.
// Phones: the first four tools on the menu, then More (the rest, then Settings).
function ownerItems(payments = false, saved: Tools = DEFAULT_TOOLS, msgs = 0): { main: Item[]; tabs: Item[] } {
  const tools = toolsOf(saved); // D150: a menu saved with Review shows Production in its place, even before the server re-saves it
  const home: Item = { to: "/", label: "Dashboard", icon: "home", match: (p) => p === "/" };
  const people: Item = { to: "/clients/overview", label: "People", icon: "users", match: () => false, tab: inPeople, layer: OWNER_PEOPLE, layerHas: inPeople };
  // Phase 5d step 2 (D144/58): Messages is its own item, after Clients.
  const messages: Item = { to: "/messages", label: "Messages", icon: "mail", match: (p) => starts(p, "/messages"), badge: msgs };
  const docs: Item = { to: "/sign/overview", label: "Docs", icon: "document", match: () => false, tab: inDocsAll, layer: OWNER_DOCS_ALL, layerHas: inDocsAll };
  const production: Item = { to: "/production", label: "Production", icon: "video", match: () => false, tab: inProduction, layer: OWNER_PRODUCTION, layerHas: inProduction };
  const sent: Item = { to: "/sent", label: "Sent", icon: "send", match: (p) => starts(p, "/sent") };
  // Phase 2 Part B: Payments › Invoices once the business has connected Stripe (D45).
  const pay: Item = { to: "/payments", label: "Payments", icon: "invoice", match: () => false, tab: inPayments, layer: OWNER_PAYMENTS, layerHas: inPayments };
  const byKey: Record<ToolKey, Item | null> = { dashboard: home, people, messages, docs, payments: payments ? pay : null, production, sent };
  const main = tools.order.filter((k) => !tools.hidden.includes(k)).map((k) => byKey[k]).filter((x): x is Item => !!x);
  const tabbed = main.slice(0, 4);
  const rest = main.slice(4);
  const inRest = (p: string) => rest.some((it) => (it.tab ?? it.match)(p));
  const more: Item = { to: "/more", label: "More", icon: "menu", match: (p) => starts(p, "/more", "/settings") || inRest(p) };
  return { main, tabs: [...tabbed, more] };
}

/**
 * Phase 5e (Design Log › Role views): a team member's menu is the owner's, keeping only what their switches open (nothing
 * greyed). A tool whose own page they can't use opens their first page inside it. An Editor (D157) gets Dashboard and
 * Review.
 */
function teamItems(can: (p: string) => boolean, role: string | null, payments = false, saved: Tools = DEFAULT_TOOLS, msgs = 0): { main: Item[]; tabs: Item[] } {
  const home: Item = { to: "/", label: "Dashboard", icon: "home", match: (p) => p === "/" };
  if (role === "editor") {
    const review: Item = { to: "/review", label: "Review", icon: "review", match: (p) => starts(p, "/review", "/v") };
    return { main: [home, review], tabs: [home, review] };
  }
  const own = ownerItems(payments, saved, msgs);
  const main: Item[] = [];
  for (const it of own.main) {
    if (it.to === "/") { main.push(it); continue; }
    const layer = it.layer?.filter((x) => can(x.to));
    if (it.layer && !layer?.length) continue;
    if (!it.layer && !can(it.to)) continue;
    main.push({ ...it, to: can(it.to) ? it.to : layer![0].to, ...(layer ? { layer } : {}) });
  }
  const tabbed = main.slice(0, 4);
  const rest = main.slice(4);
  const inRest = (p: string) => rest.some((it) => (it.tab ?? it.match)(p));
  const more: Item = { to: "/more", label: "More", icon: "menu", match: (p) => starts(p, "/more", "/settings") || inRest(p) };
  return { main, tabs: [...tabbed, more] };
}

type SharedProject = { to: string; label: string };
const CLIENT_PAYMENTS: Sub[] = [{ to: "/payments/invoices", label: "Invoices", match: (p) => starts(p, "/payments/invoices", "/i") },
  { to: "/payments/subscriptions", label: "Subscriptions", match: (p) => starts(p, "/payments/subscriptions", "/sub") }];
function clientItems(shared: SharedProject[], unread: number, payments = false, msgs = 0): { main: Item[]; tabs: Item[] } {
  const layer: Sub[] = [...shared.map((s) => ({ to: s.to, label: s.label, match: (p: string) => starts(p, s.to) })), { to: "/review", label: "All shared", match: (p: string) => p === "/review" }];
  const home: Item = { to: "/", label: "Home", icon: "home", match: (p) => p === "/" };
  const inbox: Item = { to: "/inbox", label: "Inbox", icon: "inbox", match: (p) => starts(p, "/inbox"), badge: unread };
  const review: Item = { to: "/review", label: "Review", icon: "review", match: () => false, tab: (p) => starts(p, "/review", "/s", "/projects"), layer, layerHas: (p) => starts(p, "/review", "/s", "/projects") };
  const docs: Item = { to: "/docs", label: "Docs", icon: "document", match: (p) => starts(p, "/docs") };
  const messages: Item = { to: "/messages", label: "Messages", icon: "mail", match: (p) => starts(p, "/messages"), badge: msgs }; // Phase 5d step 2
  const more: Item = { to: "/more", label: "More", icon: "menu", match: (p) => starts(p, "/more", "/settings", "/payments", "/i", "/sub") };
  // Part B step 3: Payments › Invoices once something has been billed to them (2b: or a subscription started for them).
  const inPay = (p: string) => starts(p, "/payments", "/i", "/sub");
  const pay: Item = { to: "/payments/invoices", label: "Payments", icon: "invoice", match: (p) => p === "/payments", tab: inPay, layer: CLIENT_PAYMENTS, layerHas: inPay };
  return { main: payments ? [home, inbox, messages, review, docs, pay] : [home, inbox, messages, review, docs], tabs: [home, inbox, review, docs, more] };
}

// ---------- the shell ----------
export type Recent = { _id: string; title: string; thumb: string | null };
export function Shell({ me, side = "owner", overlay, light = true, subtitle, children }: {
  me: Me; side?: Side; overlay: boolean; light?: boolean; subtitle?: string | null; children: React.ReactNode;
}) {
  const brands = useQuery(api.business.brand);
  const brand: Brand | null = brands?.[0] ?? null;
  useBrand(brand);
  const mine = useQuery(api.shares.mine, side === "client" ? {} : "skip");
  const unread = useQuery(api.inbox.unreadCount, side === "client" ? {} : "skip") ?? 0;
  const msgs = useQuery(api.messages.unread, side !== "vendor" ? {} : "skip") ?? 0; // Phase 5d step 2
  const { perms, team, role } = usePerms(); // Phase 5e: a team member's switches
  const overview = useQuery(api.library.overview, side === "owner" && (!team || perms.review) ? {} : "skip");
  const pay = useQuery(api.payments.settings, side === "owner" && (!team || perms.payments) ? {} : "skip");
  const billed = useQuery(api.invoicePay.mine, side === "client" ? {} : "skip");
  const subs = useQuery(api.subscriptions.mine, side === "client" ? {} : "skip");
  const tools = useQuery(api.users.me)?.tools as Tools | undefined; // the owner's Settings › Tools
  // Phase 2: the client's Review layer lists their projects (each opens its project page), then any other shared
  // collection that isn't one of those projects.
  const myProjects = useQuery(api.projects.mine, side === "client" ? {} : "skip");
  const shared = useMemo(() => {
    const projects = (myProjects ?? []).map((p) => ({ to: `/projects/${p._id}`, label: p.label }));
    const labels = new Set(projects.map((p) => p.label));
    return [...projects, ...(mine ?? []).filter((s) => s.kind !== "video" && !labels.has(s.label)).map((s) => ({ to: `/s/${s.token}`, label: s.label }))];
  }, [mine, myProjects]);
  const recent: Recent[] = side === "owner"
    ? (overview?.videos ?? []).filter((x) => x.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 4).map((x) => ({ _id: x._id, title: x.title, thumb: x.latest?.thumbUrl ?? null }))
    : [];
  return (
    <ShellFrame me={me} side={side} overlay={overlay} light={light} subtitle={subtitle} logo={brand?.logoUrl ?? wpLogo} bizName={brand?.name ?? "Wrangler Productions"}
      shared={shared} unread={unread} msgs={msgs} recent={recent} search={side === "owner" && !team} tools={tools} payments={side === "owner" ? !!pay?.stripe : !!billed?.length || !!subs?.length}
      team={team ? { can: (p: string) => canOpen(p, perms, true, role), role } : undefined}>
      {children}
    </ShellFrame>
  );
}

/** The frame itself, fed by Shell (or by the dev-only component page with sample data). */
export function ShellFrame({ me, side, overlay, light, subtitle, logo, bizName, shared, unread, msgs = 0, recent, search: canSearch, payments, nav: navIn, top, tools, team, children }: {
  me: Me; side: Side; overlay: boolean; light: boolean; subtitle?: string | null; logo: string; bizName: string; tools?: Tools;
  team?: { can: (p: string) => boolean; role: string | null }; // Phase 5e: a team member's menu
  shared: SharedProject[]; unread: number; msgs?: number; recent: Recent[]; search: boolean; payments?: boolean; children: React.ReactNode;
  nav?: { main: Item[]; tabs: Item[] }; top?: React.ReactNode; // Phase 3c: the vendor side's own items and its "Working for" switcher
}) {
  // The drawer on work surfaces: "open" from a click (stays until closed); "peek" from hovering the menu button with a
  // mouse (Heston, Oct 29): it slides out, and slides back once the pointer leaves it.
  const [drawer, setDrawerState] = useState<false | "peek" | "open">(false);
  const setDrawer = (on: boolean) => setDrawerState(on ? "open" : false);
  const peekTimer = useRef<number | null>(null);
  const peek = useCallback((on: boolean) => {
    if (peekTimer.current) { clearTimeout(peekTimer.current); peekTimer.current = null; }
    if (on) { if (matchMedia("(pointer: fine)").matches) setDrawerState((d) => d || "peek"); return; }
    peekTimer.current = window.setTimeout(() => setDrawerState((d) => (d === "peek" ? false : d)), 280);
  }, []);
  const [search, setSearch] = useState(false);
  const { path } = useLocation();
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!canSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch((s) => !s); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch]);
  const nav = navIn ?? (side === "owner" ? (team ? teamItems(team.can, team.role, payments, tools, msgs) : ownerItems(payments, tools, msgs)) : clientItems(shared, unread, payments, msgs));
  const ctx = useMemo(() => ({ openSidebar: () => setDrawerState("open"), peekSidebar: peek, openSearch: () => setSearch(true), overlay, side }), [overlay, side]);
  const showSidebar = !overlay || drawer;
  const lightSrc = side === "owner" ? lightBack : lightClient;
  const onSearch = canSearch ? () => setSearch(true) : undefined;
  const bell = side === "owner" && !navIn; // Phase 5e step 4: the owner's and the team's bell
  return (
    <Ctx.Provider value={ctx}>
      <div className={`wp-shell${overlay ? " overlay" : ""}${side !== "owner" ? " client-side" : ""}`}>
        {light && !overlay && <Light className={`wp-light ${side === "owner" ? "back" : "client"}`} src={lightSrc} />}
        {showSidebar && (
          <Sidebar me={me} side={side} items={nav.main} logo={logo} bizName={bizName} subtitle={subtitle} recent={recent} top={top}
            drawer={overlay && !!drawer} onClose={() => setDrawer(false)} onSearch={onSearch} bell={bell}
            onHover={overlay && drawer === "peek" ? peek : undefined} />
        )}
        {overlay && drawer && <div className="wp-scrim" onClick={() => setDrawer(false)} />}
        <PhoneTop me={me} side={side} items={[...nav.main, ...nav.tabs]} logo={logo} bizName={bizName} onSearch={onSearch} bell={bell} />
        <div className="main">{children}</div>
        <TabBar items={nav.tabs} />
      </div>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </Ctx.Provider>
  );
}

function LastOpened({ recent, path }: { recent: Recent[]; path: string }) {
  return (
    <>
      <div className="wp-layerlabel"><span className="wp-label">Last opened</span></div>
      {recent.map((x) => (
        <a key={x._id} className="wp-recent" aria-current={path === `/v/${x._id}` ? "page" : undefined} {...linkProps(`/v/${x._id}`)} title={x.title}>
          <Thumb src={x.thumb} className="th" /><span>{x.title}</span>
        </a>
      ))}
    </>
  );
}

function Logo({ src, name }: { src: string; name: string }) {
  return <span className="wp-logo"><span className="rec" aria-hidden /><img src={src} alt={name} /></span>;
}

function Sidebar({ me, side, items, logo, bizName, subtitle, recent, drawer, onClose, onSearch, onHover, top, bell }: {
  me: Me; side: Side; items: Item[]; logo: string; bizName: string; subtitle?: string | null; recent: Recent[]; drawer: boolean; onClose: () => void; onSearch?: () => void; top?: React.ReactNode; bell?: boolean;
  onHover?: (on: boolean) => void;
}) {
  const { path } = useLocation();
  const uploads = useUploads().filter((u) => u.status === "starting" || u.status === "uploading");
  const [signOut, signOutDialog] = useSignOutAsk();
  const sideSwitch = useSideSwitch();
  // A layer opens by itself on its own pages; the chevron opens or closes it anywhere.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (it: Item) => open[it.to] ?? !!it.layerHas?.(path);
  const settingsOn = starts(path, "/settings");
  return (
    <nav className={`wp-side${drawer ? " drawer" : ""}`} aria-label="Main" onMouseEnter={onHover && (() => onHover(true))} onMouseLeave={onHover && (() => onHover(false))}>
      <div className={`wp-brand${side === "client" ? " client" : ""}`}>
        <a {...linkProps("/")} aria-label={`${bizName} home`}><Logo src={logo} name={bizName} /></a>
        <span style={{ display: "flex", gap: 4 }}>
          {bell && <BellButton />}
          {onSearch && <IconButton icon="search" label="Search (⌘K)" onClick={onSearch} />}
          {drawer && <IconButton icon="close" label="Close menu" onClick={onClose} />}
        </span>
      </div>
      {top}
      <div className="scroll">
        {items.map((it) => (
          <div key={it.to} style={{ display: "contents" }}>
            <div className={`wp-navwrap${it.layer ? " has-layer" : ""}`}>
              <a className="wp-nav" aria-current={it.match(path) ? "page" : undefined} {...linkProps(it.to)}>
                <Icon name={it.icon} size={24} />
                <span className="t">{it.label}</span>
                {it.badge ? <Badge n={it.badge} label={`${it.badge} unread`} /> : null}
              </a>
              {it.layer && (
                <button type="button" className="layer-toggle" aria-expanded={isOpen(it)} aria-label={`${isOpen(it) ? "Close" : "Open"} the ${it.label} layer`}
                  onClick={() => setOpen((o) => ({ ...o, [it.to]: !isOpen(it) }))}>
                  <Icon name={isOpen(it) ? "chevron-down" : "chevron-right"} size={16} />
                </button>
              )}
            </div>
            {it.layer && isOpen(it) && (
              <>
                {it.layer.filter((s) => !s.group).map((s) => (
                  <a key={s.to} className={`wp-sub${it.layer!.some((x) => x.group) ? " wp-stage wp-stagetop" : ""}`} aria-current={s.match(path) ? "page" : undefined} {...linkProps(s.to)} title={s.label}><span>{s.label}</span></a>
                ))}
                {it.layer.some((s) => s.group) && groupsOf(it.layer).map((g) => {
                  const kids = stageItems(it.layer!, g);
                  const key = `${it.to}#${g}`;
                  const on = open[key] ?? inStage(it.layer!, g, path);
                  return (
                    <Fragment key={g}>
                      <div className="wp-stagewrap">
                        <a className={`wp-sub wp-stage${kids.length ? "" : " soon"}`} aria-current={starts(path, STAGE_TO[g]) ? "page" : undefined} {...linkProps(STAGE_TO[g])} title={`${g} overview`}>
                          <span>{g}</span>{!kids.length && <span className="wp-soon">Soon</span>}
                        </a>
                        {kids.length > 0 && (
                          <button type="button" className="layer-toggle stage-toggle" aria-expanded={on} aria-label={`${on ? "Close" : "Open"} ${g}`} onClick={() => setOpen((o) => ({ ...o, [key]: !on }))}>
                            <Icon name={on ? "chevron-down" : "chevron-right"} size={14} />
                          </button>
                        )}
                      </div>
                      {on && kids.map((s) => (
                        <Fragment key={s.to}>
                          <a className="wp-sub wp-stagesub" aria-current={s.match(path) ? "page" : undefined} {...linkProps(s.to)} title={s.label}><span>{s.label}</span></a>
                          {/* D150: the last-opened cuts sit under Post-pro, while you're in Post-pro */}
                          {s.to === "/activity" && side === "owner" && starts(path, "/review", "/v", "/activity") && recent.length > 0 && <LastOpened recent={recent} path={path} />}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
                {it.to === "/review" && recent.length > 0 && <LastOpened recent={recent} path={path} />}
              </>
            )}
          </div>
        ))}
      </div>
      {uploads.length > 0 && (
        <div className="wp-upload" aria-live="polite">
          <span className="wp-label">Uploading</span>
          {uploads.map((u) => {
            const pct = u.total ? Math.round((100 * u.sent) / u.total) : 0;
            return (
              <div key={u.key} style={{ display: "grid", gap: 6 }}>
                <span className="f">{u.fileName} · {pct}%</span>
                <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${u.fileName}`}><i style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
      <a className="wp-nav" aria-current={settingsOn ? "page" : undefined} {...linkProps("/settings")}><Icon name="settings" size={24} /><span className="t">Settings</span></a>
      <Menu side="top" label="Account" trigger={(p) => (
        <button {...p} className="wp-acct">
          <Avatar name={me.name || me.email} />
          <span className="who"><span className="nm">{me.name || me.email}</span>{side === "client" && <span className="sub">{subtitle ?? bizName}</span>}{side === "vendor" && <span className="sub">Vendor</span>}</span>
          {side !== "owner" && <Icon name="chevron-down" size={16} />}
        </button>
      )}>
        <div className="mlabel" style={{ textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-body)", fontSize: 12 }}>{me.email}</div>
        <MenuItem icon={<Icon name="settings" size={18} />} onSelect={() => navigate("/settings")}>Settings</MenuItem>
        {sideSwitch.other && <MenuItem icon={<Icon name="users" size={18} />} onSelect={() => void sideSwitch.go()}>Switch to the {sideWord(sideSwitch.other)}</MenuItem>}
        <MenuSep />
        <MenuItem icon={<Icon name="sign-out" size={18} />} onSelect={signOut}>Sign out</MenuItem>
      </Menu>
      {signOutDialog}
    </nav>
  );
}

// Phones: logo, search and the account; under it the current section's layer as chips.
function PhoneTop({ me, side, items, logo, bizName, onSearch, bell }: { me: Me; side: Side; items: Item[]; logo: string; bizName: string; onSearch?: () => void; bell?: boolean }) {
  const { path } = useLocation();
  const section = items.find((it) => (it.tab ?? it.match)(path));
  const grouped = !!section?.layer?.some((s) => s.group);
  // D150: a grouped layer (Production) shows its stages as chips, and the current stage's pages in a second row.
  const stages = grouped ? groupsOf(section!.layer!) : [];
  const stageOf = (g: string) => stageItems(section!.layer!, g);
  const current = stages.find((g) => inStage(section!.layer!, g, path)) ?? null;
  const chips = !section?.layer ? null : grouped
    ? [...section.layer.filter((s) => !s.group), ...stages.map((g) => ({ to: STAGE_TO[g], label: g, match: (p: string) => inStage(section!.layer!, g, p) }))]
    : [{ to: section.to, label: section.label, match: section.match }, ...section.layer.filter((s) => !(side === "client" && s.to === "/review"))];
  const second = current && stageOf(current).length > 1 ? stageOf(current) : null;
  // the client's "All shared" is the Review chip itself
  return (
    <div className="wp-ptop">
      <div className="bar">
        <a {...linkProps("/")} aria-label={`${bizName} home`}><Logo src={logo} name={bizName} /></a>
        <span className="sp" />
        {bell && <BellButton phone />}
        {onSearch && <IconButton icon="search" label="Search" iconSize={22} onClick={onSearch} />}
        <a {...linkProps("/more")} aria-label="Account and more"><Avatar name={me.name || me.email} /></a>
      </div>
      {chips && (
        <nav className="wp-chips" aria-label={`${section!.label} pages`}>
          {chips.map((c) => <a key={c.to} className="wp-layerchip" aria-current={c.match(path) || (c.to === section!.to && side === "client" && path === "/review") ? "page" : undefined} {...linkProps(c.to)}>{c.label}</a>)}
        </nav>
      )}
      {second && (
        <nav className="wp-chips wp-chips2" aria-label={`${current} pages`}>
          {second.map((c) => <a key={c.to} className="wp-layerchip" aria-current={c.match(path) ? "page" : undefined} {...linkProps(c.to)}>{c.label}</a>)}
        </nav>
      )}
    </div>
  );
}

function TabBar({ items }: { items: Item[] }) {
  const { path } = useLocation();
  return (
    <nav className="wp-tabbar" aria-label="Sections">
      {items.map((it) => (
        <a key={it.to} className="wp-tab" aria-current={(it.tab ?? it.match)(path) ? "page" : undefined} {...linkProps(it.to)}>
          <Icon name={it.icon} size={24} />
          {it.label}
          {it.badge ? <Badge n={it.badge} /> : null}
        </a>
      ))}
    </nav>
  );
}

/** The More page on phones: what doesn't fit in the tab bar. */
export function MorePage({ me, side }: { me: Me; side: Side }) {
  const [signOut, signOutDialog] = useSignOutAsk();
  const sideSwitch = useSideSwitch();
  // Phones: Payments lives here (the tab bar has five places).
  const pay = useQuery(api.payments.settings, side === "owner" ? {} : "skip");
  const billed = useQuery(api.invoicePay.mine, side === "client" ? {} : "skip");
  const subs = useQuery(api.subscriptions.mine, side === "client" ? {} : "skip");
  const payRow = side === "owner" ? (pay?.stripe ? [{ to: "/payments", icon: "invoice" as IconName, title: "Payments", sub: "Overview, invoices and subscriptions" }] : [])
    : [...(billed?.length ? [{ to: "/payments/invoices", icon: "invoice" as IconName, title: "Payments", sub: "Your invoices" }] : []),
      ...(subs?.length ? [{ to: "/payments/subscriptions", icon: "activity" as IconName, title: "Subscriptions", sub: "Your plans" }] : [])];
  // The owner's: the tools on their menu that don't fit the tab bar (Settings › Tools sets which and in what order).
  const tools = useQuery(api.users.me, side === "owner" ? {} : "skip")?.tools as Tools | undefined;
  const TOOL_SUB: Record<string, string> = { "/messages": "Conversations with clients and leads", "/": "Today, clients and activity", "/clients/overview": "Pipeline, companies, follow-ups", "/review": "Projects and activity", "/review/overview": "Projects and activity", "/sign/overview": "Documents and templates",
    "/proposals/overview": "Written pitches, templates", "/payments": "Overview, invoices and subscriptions", "/vendors/overview": "Shooters, editors and crew you hire", "/sent": "Notes and items you sent" };
  const rest = side === "owner" ? ownerItems(!!pay?.stripe, tools).main.slice(4) : [];
  const rows: { to?: string; icon: IconName; title: string; sub?: string; onClick?: () => void }[] = side === "owner"
    ? [
      ...rest.map((it) => ({ to: it.to, icon: it.icon, title: it.label, sub: TOOL_SUB[it.to] })),
      { to: "/settings", icon: "settings", title: "Settings", sub: "Business, Register, Dropbox, connectors…" },
      { to: "/settings/account", icon: "user", title: "Account", sub: `${me.name ?? ""}${me.name ? " · " : ""}${me.email}` },
      { icon: "sign-out", title: "Sign out", onClick: signOut },
    ]
    : [
      ...payRow,
      { to: "/messages", icon: "mail" as IconName, title: "Messages", sub: "Conversations about your projects" },
      { to: "/settings", icon: "settings", title: "Settings", sub: `${me.name ?? ""}${me.name ? " · " : ""}${me.email}` },
      ...(sideSwitch.other ? [{ icon: "users" as IconName, title: `Switch to the ${sideWord(sideSwitch.other)}`, sub: "Same login, your work as a vendor", onClick: () => void sideSwitch.go() }] : []),
      { icon: "sign-out", title: "Sign out", onClick: signOut },
    ];
  return (
    <>
      {signOutDialog}
      <TopBar><span className="here">More</span></TopBar>
      <div className="wp-page">
        <div className="wp-morelist">
          {rows.map((r, i) => (
            <div key={r.title} style={{ display: "contents" }}>
              {i > 0 && <hr className="wp-divider" style={{ background: "var(--border-faint)" }} />}
              {r.to ? (
                <a className="wp-row" {...linkProps(r.to)}><Icon name={r.icon} size={22} className="lead-icon" /><span className="txt"><span className="ttl"><span>{r.title}</span></span>{r.sub && <span className="meta">{r.sub}</span>}</span><Icon name="chevron-right" size={16} className="chev" /></a>
              ) : (
                <button type="button" className="wp-row" onClick={r.onClick}><Icon name={r.icon} size={22} className="lead-icon" /><span className="txt"><span className="ttl"><span>{r.title}</span></span></span><Icon name="chevron-right" size={16} className="chev" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// The bar at the top of the main area: breadcrumb on the left, actions on the right. On a work surface it also
// holds the button that opens the sidebar.
//
// Phase 5f (Design Log "Handoff ready: Phase 5f (glass)"): on a desktop it is a glass bar floating over the page. Once the
// page scrolls, its content fades under the bar (the main area's data-scrolled); a page whose breadcrumb is one crumb
// shows an empty bar until its own title has scrolled up under it, then its name fades in (.titled).
export function TopBar({ children, right, className }: { children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  const { openSidebar, peekSidebar, overlay } = useShell();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current, main = bar?.parentElement, page = bar?.nextElementSibling as HTMLElement | null;
    if (!bar || !main || !page || overlay) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const scrolled = page.scrollTop > 0;
      if (scrolled) main.dataset.scrolled = "1"; else delete main.dataset.scrolled;
      const head = page.querySelector<HTMLElement>(".wp-pagehead, .wp-sethead");
      const under = !!head && head.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom;
      bar.classList.toggle("titled", under);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    page.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); page.removeEventListener("scroll", onScroll); delete main.dataset.scrolled; };
  }, [overlay]);
  return (
    <header className={`topbar${className ? " " + className : ""}`} ref={ref}>
      {overlay && <IconButton icon="menu" label="Open menu" onClick={openSidebar} onMouseEnter={() => peekSidebar(true)} onMouseLeave={() => peekSidebar(false)} />}
      <div className="crumbs">{children}</div>
      {right && <div className="right">{right}</div>}
    </header>
  );
}
export const Sep = () => <span className="sep" aria-hidden>›</span>;

// ⌘K: find a video or a project.
function SearchPalette({ onClose }: { onClose: () => void }) {
  const overview = useQuery(api.library.overview);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "videos" | "projects">("all");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const projects = overview?.projects ?? [];
  const pmap = new Map(projects.map((p) => [p._id as string, p]));
  const needle = q.trim().toLowerCase();
  type Row = { key: string; to: string; kind: "video" | "project"; title: string; sub: string; thumb?: string | null };
  const vids: Row[] = (overview?.videos ?? [])
    .filter((x) => !needle || `${x.title} ${projectLabel(pmap.get(x.projectId))}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.updatedAt - a.updatedAt)
    .map((x) => ({ key: x._id, to: `/v/${x._id}`, kind: "video", title: x.title, sub: projectLabel(pmap.get(x.projectId)), thumb: x.latest?.thumbUrl ?? null }));
  const projs: Row[] = projects
    .filter((p) => !needle || projectLabel(p).toLowerCase().includes(needle) || (p.client ?? "").toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ key: p._id, to: `/projects/${p._id}`, kind: "project", title: projectLabel(p), sub: `${p.videoCount} video${p.videoCount === 1 ? "" : "s"}` }));
  const rows = (tab === "videos" ? vids : tab === "projects" ? projs : [...vids.slice(0, needle ? 8 : 5), ...projs.slice(0, needle ? 6 : 4)]).slice(0, 14);
  const go = (r: Row | undefined) => { if (!r) return; onClose(); navigate(r.to); };

  return (
    <Modal onClose={onClose} label="Search" width={560}>
      <div style={{ display: "grid", gap: 12, margin: -8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
          <Icon name="search" size={18} />
          <input ref={inputRef} className="input" style={{ background: "transparent", border: 0, boxShadow: "none", padding: 0, height: 40, fontSize: 16 }}
            placeholder="Search videos and projects…" value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(rows.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(rows[i]); }
            }} />
          <span className="kbd">esc</span>
        </div>
        <div className="tabs" role="tablist">
          {(["all", "videos", "projects"] as const).map((k) => (
            <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { setTab(k); setI(0); }}>{k === "all" ? "All" : k === "videos" ? "Videos" : "Projects"}</button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 2, maxHeight: "50vh", overflowY: "auto" }}>
          {!needle && tab === "all" && vids.length > 0 && <div className="mlabel">Recent</div>}
          {rows.length === 0 && <p className="caption" style={{ padding: "8px 10px" }}>{overview === undefined ? "Loading…" : "Nothing matches."}</p>}
          {rows.map((r, n) => (<span key={r.key} style={{ display: "contents" }}>
            {tab === "all" && r.kind === "project" && rows[n - 1]?.kind !== "project" && <div className="mlabel" style={{ marginTop: 6 }}>Projects</div>}
            <button className="mitem" style={{ background: n === i ? "var(--surface-block-hover)" : undefined }} onMouseEnter={() => setI(n)} onClick={() => go(r)}>
              {r.kind === "video" ? <Thumb src={r.thumb ?? null} className="thumb" /> : <span className="thumb ph" style={{ display: "grid" }}><Icon name="folder" size={16} /></span>}
              <span style={{ display: "grid", minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.sub}</span>
              </span>
            </button>
          </span>))}
        </div>
      </div>
    </Modal>
  );
}
