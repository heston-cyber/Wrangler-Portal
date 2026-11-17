// Nov 2 (Heston): Settings › Tools. The owner's own side menu: its order, which tools are on it, and which widgets the
// Dashboard (was Home) shows. Kept per login (users.tools); only that owner's menu changes, never a client's or a
// vendor's, and a tool taken off the menu still works by its address. New tools join at their default place.
// Nov 16 (How everything connects, D204–D206, Q133): ten tools in three groups. People splits into Clients and crew
// (Production); Docs and Payments merge into Sales and money; Sent folds into Messages; Calendar moves up; the stages
// become Creative planning, Production and Post. Every old address keeps working.
export const TOOLS = ["dashboard", "messages", "work", "calendar", "projects", "creative", "production", "post", "clients", "money"] as const;
export type ToolKey = (typeof TOOLS)[number];
export const TOOL_LABEL: Record<ToolKey, string> = {
  dashboard: "Dashboard", messages: "Messages", work: "Work", calendar: "Calendar", projects: "Projects", creative: "Creative planning",
  production: "Production", post: "Post", clients: "Clients", money: "Sales and money",
};
export const TOOL_GROUPS = [
  { label: "Every day", tools: ["dashboard", "messages", "work", "calendar"] },
  { label: "Making the work", tools: ["projects", "creative", "production", "post"] },
  { label: "Running the business", tools: ["clients", "money"] },
] as const satisfies ReadonlyArray<{ label: string; tools: readonly ToolKey[] }>;
export const groupOf = (k: ToolKey) => TOOL_GROUPS.findIndex((g) => (g.tools as readonly string[]).includes(k));
export const REQUIRED_TOOLS: ToolKey[] = ["dashboard"]; // always on the menu
// Tools from earlier menus, and where they are now.
const FOLDED: Record<string, ToolKey> = { review: "post", clients: "clients", vendors: "production", proposals: "money", people: "clients", docs: "money", payments: "money", sent: "messages" };

export const WIDGETS = ["coming_up", "needs", "followups", "clients", "live_edits", "money", "activity", "recurring", "revenue_year", "outstanding"] as const; // Phase 5b: Coming up, Live edits, Money this month; Phase 5e step 5: the Reports widgets
export type WidgetKey = (typeof WIDGETS)[number];
export const WIDGET_LABEL: Record<WidgetKey, { label: string; sub: string }> = {
  coming_up: { label: "Coming up", sub: "The next shoots, from Production" },
  live_edits: { label: "Live edits", sub: "Projects in Production or Polish" },
  money: { label: "Money this month", sub: "Paid, due and overdue (once Stripe is on)" },
  needs: { label: "Needs you today", sub: "Client notes, documents waiting, drafts to confirm" },
  followups: { label: "Follow-ups", sub: "Due today or overdue (only when there are some)" },
  clients: { label: "Your clients", sub: "The first five, the ones waiting on you first" },
  activity: { label: "Recent activity", sub: "Views, notes and signatures" },
  recurring: { label: "Recurring revenue", sub: "Subscriptions and past-due payments (once Stripe is on)" },
  revenue_year: { label: "Revenue this year", sub: "Paid by month, from Reports" },
  outstanding: { label: "Outstanding", sub: "Invoices not due yet and late, from Reports" },
};

export type Tools = { order: ToolKey[]; hidden: ToolKey[]; widgets: Array<{ id: WidgetKey; on: boolean }> };
export const DEFAULT_TOOLS: Tools = { order: [...TOOLS], hidden: [], widgets: WIDGETS.map((id) => ({ id, on: true })) };

/** Whatever was saved, made whole: every known tool and widget exactly once (new ones at their default place). */
export function toolsOf(x: unknown): Tools {
  const t = (x && typeof x === "object" ? x : {}) as Partial<Tools>;
  const known = new Set<string>(TOOLS);
  // Tools folded into others keep their place: the first of them in a saved menu becomes the tool that holds it now.
  const saved = (Array.isArray(t.order) ? t.order : []) as string[];
  const order = [...new Set(saved.map((k) => (known.has(k) ? k : FOLDED[k])).filter((k): k is ToolKey => !!k && known.has(k)))];
  // A missing tool goes right after the nearest tool that comes before it by default (or first, if none does).
  for (const k of TOOLS) if (!order.includes(k)) { const prev = TOOLS.slice(0, TOOLS.indexOf(k)).reverse().find((n) => order.includes(n)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k); }
  // The groups are fixed (Nov 16): the saved order counts inside each group.
  order.sort((a, b) => groupOf(a) - groupOf(b));
  // Only tools of this menu can be off it (a tool from an older menu that was off doesn't hide what it folded into).
  const hidden = [...new Set((Array.isArray(t.hidden) ? t.hidden : []).filter((k): k is ToolKey => known.has(k as string) && !REQUIRED_TOOLS.includes(k as ToolKey)))];
  const kw = new Set<string>(WIDGETS);
  const seen = new Set<string>();
  const widgets = (Array.isArray(t.widgets) ? t.widgets : []).filter((w) => w && kw.has(w.id) && !seen.has(w.id) && seen.add(w.id)).map((w) => ({ id: w.id as WidgetKey, on: !!w.on }));
  for (const id of WIDGETS) if (!seen.has(id)) widgets.push({ id, on: true });
  return { order, hidden, widgets };
}
