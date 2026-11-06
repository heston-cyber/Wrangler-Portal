// Settings' frame (P1 / Owner / Settings, page "S5 · Settings"): the breadcrumb, the section menu on the left and the
// section on the right. On phones the menu is its own page (/settings) and each section has a back link to it.
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useSignOutAsk } from "../../shell/SignOut";
import { Sep, TopBar } from "../../shell/Shell";
import { Icon, type IconName } from "../../ui/Icon";
import { linkProps } from "../../lib/router";
import { usePerms } from "../../lib/teamAccess";

export type SectionKey = "business" | "team" | "security" | "activity" | "payments" | "rates" | "brand" | "calendar" | "sitewatch" | "brief" | "tools" | "account" | "notifications" | "register" | "dropbox" | "connectors" | "sheet" | "clients" | "shares" | "help" | "calls";

export const SECTIONS: Array<{ key: SectionKey; label: string; icon: IconName }> = [
  { key: "business", label: "Business", icon: "users" },
  { key: "team", label: "Team", icon: "users" }, // Phase 5e (D146: after Business), the owner's only
  { key: "security", label: "Security", icon: "lock" }, // Phase 5e step 2 (D146: after Team): password, email, devices
  { key: "activity", label: "Activity", icon: "activity" }, // Phase 5e step 3: who changed what (owner only, kept 1 year)
  { key: "payments", label: "Payments", icon: "invoice" },
  { key: "rates", label: "Pricing", icon: "activity" }, // Phase 3 (263:1382), renamed Pricing in 3b (D76)
  { key: "brand", label: "Brand kit", icon: "folder" }, // Phase 3b (708:1235)
  { key: "calendar", label: "Calendar", icon: "calendar" }, // Phase 4 (741:1953)
  { key: "calls", label: "Booking calls", icon: "calendar" }, // Phase 5d step 1 (801:8966)
  { key: "sitewatch", label: "Site watch", icon: "activity" }, // Phase 5c screens (Nov 4): the portal's admins only
  { key: "brief", label: "Kickoff brief", icon: "note" }, // Phase 4 (Nov 2, option B)
  { key: "tools", label: "Tools", icon: "menu" }, // Nov 2 (Heston): your menu's order, tools on it, Dashboard widgets
  { key: "account", label: "Account", icon: "user" },
  { key: "notifications", label: "Notifications", icon: "bell" }, // Nov 2 (Heston): every email, with a switch
  { key: "register", label: "Register", icon: "register" },
  { key: "dropbox", label: "Dropbox drop folder", icon: "folder" },
  { key: "connectors", label: "Claude connectors", icon: "globe" },
  { key: "sheet", label: "Google Sheet copy", icon: "document" },
  { key: "clients", label: "Clients", icon: "users" },
  { key: "shares", label: "Shares", icon: "send" },
  { key: "help", label: "Help", icon: "info" }, // Phase 5d step 4 (Q59): the last item, the guides
];

// Old addresses still land on the right section: /register, /sign/connector, /settings#claude and the like, and
// Dropbox's return to /settings?dropbox=….
const HASH: Record<string, SectionKey> = { claude: "connectors", sign: "connectors", dropbox: "dropbox", sheet: "sheet", shares: "shares", clients: "clients", account: "account", notifications: "notifications", business: "business", register: "register", payments: "payments", calendar: "calendar", sitewatch: "sitewatch", brief: "brief", kickoff: "brief", tools: "tools", rates: "rates", pricing: "rates", brand: "brand" };
export function sectionOf(path: string, search: string, hash: string): SectionKey | null {
  if (path.startsWith("/register")) return "register";
  if (path.startsWith("/sign/connector")) return "connectors";
  const m = /^\/settings\/([a-z]+)/.exec(path);
  if (m && SECTIONS.some((s) => s.key === m[1])) return m[1] as SectionKey;
  if (m?.[1] === "pricing") return "rates"; // Settings › Pricing keeps /settings/rates (D76)
  if (new URLSearchParams(search).has("dropbox")) return "dropbox";
  if (new URLSearchParams(search).has("stripe")) return "payments";
  const h = HASH[hash.replace(/^#/, "")];
  return h ?? null;
}

/** Phase 5e: the sections a team member's Settings switch opens (the rest stay the owner's). */
const TEAM_SECTIONS: SectionKey[] = ["business", "brand", "calls"];

export function SectionMenu({ active, list }: { active: SectionKey | null; list?: boolean }) {
  const [signOut, signOutDialog] = useSignOutAsk();
  const admin = useQuery(api.siteWatch.summary); // null for anyone who isn't one of the portal's admins: Site watch stays out of their menu
  // Phase 5e: a team member sees Account, and with Settings on, the sections their switch opens.
  const { team, perms } = usePerms();
  const shown = SECTIONS.filter((s) => (s.key !== "sitewatch" || admin) && (!team || s.key === "account" || s.key === "security" || (perms.settings && TEAM_SECTIONS.includes(s.key))));
  return (
    <nav className={`wp-setmenu glass${list ? " list" : ""}`} aria-label="Settings">
      {shown.map((s) => (
        <a key={s.key} className="item" aria-current={active === s.key ? "page" : undefined} {...linkProps(`/settings/${s.key}`)}>
          <Icon name={s.icon} size={16} /><span>{s.label}</span>{list && <Icon name="chevron-right" size={16} className="go" />}
        </a>
      ))}
      <button type="button" className="item" onClick={signOut}><Icon name="sign-out" size={16} /><span>Sign out</span></button>
      {signOutDialog}
    </nav>
  );
}

export function SettingsFrame({ section, right, children }: { section: SectionKey; right?: React.ReactNode; children: React.ReactNode }) {
  const label = SECTIONS.find((s) => s.key === section)!.label;
  return (
    <>
      <TopBar right={right}><a {...linkProps("/settings")}>Settings</a><Sep /><span className="here">{label}</span></TopBar>
      <div className="wp-page wp-set">
        <a className="wp-setback" {...linkProps("/settings")}><Icon name="arrow-left" size={20} />Settings</a>
        <div className="wp-setgrid">
          <SectionMenu active={section} />
          <div className="wp-setbody">{children}</div>
        </div>
      </div>
    </>
  );
}

/** A section's heading: eyebrow, title and one line under it. */
export function SetHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: React.ReactNode }) {
  return (
    <header className="wp-sethead">
      <span className="wp-eyebrow">{eyebrow}</span>
      <h1 className="wp-h3">{title}</h1>
      {sub && <p className="wp-body">{sub}</p>}
    </header>
  );
}
