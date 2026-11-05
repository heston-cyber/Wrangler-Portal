// Nov 2 (Heston): Settings › Tools. The owner's own side menu: its order, which tools are on it, and which widgets the
// Dashboard (was Home) shows. Kept per login (users.tools); only that owner's menu changes, never a client's or a
// vendor's, and a tool taken off the menu still works by its address. New tools join at their default place.
export const TOOLS = ["dashboard", "clients", "messages", "production", "docs", "proposals", "payments", "vendors", "sent"] as const; // D150 (Nov 4): Review moved inside Production, which takes its place
export type ToolKey = (typeof TOOLS)[number];
export const TOOL_LABEL: Record<ToolKey, string> = { dashboard: "Dashboard", clients: "Clients", messages: "Messages", docs: "Docs", proposals: "Proposals", payments: "Payments", vendors: "Vendors", production: "Production", sent: "Sent" };
export const REQUIRED_TOOLS: ToolKey[] = ["dashboard"]; // always on the menu

export const WIDGETS = ["coming_up", "needs", "followups", "clients", "live_edits", "money", "activity", "recurring"] as const; // Phase 5b: Coming up, Live edits, Money this month
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
};

export type Tools = { order: ToolKey[]; hidden: ToolKey[]; widgets: Array<{ id: WidgetKey; on: boolean }> };
export const DEFAULT_TOOLS: Tools = { order: [...TOOLS], hidden: [], widgets: WIDGETS.map((id) => ({ id, on: true })) };

/** Whatever was saved, made whole: every known tool and widget exactly once (new ones at their default place). */
export function toolsOf(x: unknown): Tools {
  const t = (x && typeof x === "object" ? x : {}) as Partial<Tools>;
  const known = new Set<string>(TOOLS);
  // D150: Review is now inside Production. A menu saved with Review puts Production where Review was.
  const saved = (Array.isArray(t.order) ? t.order : []) as string[];
  const moved = saved.includes("review") ? saved.filter((k) => k !== "production").map((k) => (k === "review" ? "production" : k)) : saved;
  const order = [...new Set(moved.filter((k): k is ToolKey => known.has(k as string)))];
  // A missing tool goes right after the nearest tool that comes before it by default (or first, if none does).
  for (const k of TOOLS) if (!order.includes(k)) { const prev = TOOLS.slice(0, TOOLS.indexOf(k)).reverse().find((n) => order.includes(n)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k); }
  const hidden = [...new Set((Array.isArray(t.hidden) ? t.hidden : []).filter((k): k is ToolKey => known.has(k as string) && !REQUIRED_TOOLS.includes(k as ToolKey)))];
  const kw = new Set<string>(WIDGETS);
  const seen = new Set<string>();
  const widgets = (Array.isArray(t.widgets) ? t.widgets : []).filter((w) => w && kw.has(w.id) && !seen.has(w.id) && seen.add(w.id)).map((w) => ({ id: w.id as WidgetKey, on: !!w.on }));
  for (const id of WIDGETS) if (!seen.has(id)) widgets.push({ id, on: true });
  return { order, hidden, widgets };
}
