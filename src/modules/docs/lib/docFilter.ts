// Contracts › Docs (B1): which documents show, in what order. Pure, so it's tested on its own (tests/docFilter.test.ts).
export type DocRow = {
  _id: string; label: string; number: number; title: string; status: "draft" | "approved" | "sent" | "completed" | "voided";
  signers: string[]; emails: string[]; createdAt: number; updatedAt: number; sentAt: number | null; completedAt: number | null;
  hidden?: boolean;
};
export type StatusTab = "all" | "draft" | "approved" | "sent" | "completed" | "voided" | "hidden";
export type SortKey = "updated" | "created" | "number" | "title" | "client";
export type DateRange = "any" | "7d" | "30d" | "90d" | "year";
export type DocQuery = { status: StatusTab; q: string; sort: SortKey; dir: "asc" | "desc"; range: DateRange };

export const TABS: Array<{ key: StatusTab; label: string }> = [
  { key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "approved", label: "Approved" },
  { key: "sent", label: "Out for signature" }, { key: "completed", label: "Signed" }, { key: "voided", label: "Cancelled" },
  { key: "hidden", label: "Hidden" },
];
export const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "updated", label: "Last updated" }, { key: "created", label: "Created" }, { key: "number", label: "Number" },
  { key: "title", label: "Title" }, { key: "client", label: "Client" },
];
export const RANGES: Array<{ key: DateRange; label: string }> = [
  { key: "any", label: "Any time" }, { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" }, { key: "year", label: "This year" },
];
export const DEFAULT_QUERY: DocQuery = { status: "all", q: "", sort: "updated", dir: "desc", range: "any" };

function since(range: DateRange, now: number): number {
  const day = 86_400_000;
  if (range === "7d") return now - 7 * day;
  if (range === "30d") return now - 30 * day;
  if (range === "90d") return now - 90 * day;
  if (range === "year") return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  return 0;
}

const client = (d: DocRow) => (d.signers[0] ?? "").toLowerCase();

export function filterDocs<T extends DocRow>(docs: T[], q: DocQuery, now = Date.now()): T[] {
  const words = q.q.toLowerCase().split(/\s+/).filter(Boolean);
  const from = since(q.range, now);
  const out = docs.filter((d) => {
    // Hidden documents only show under "Hidden"; every other tab leaves them out.
    if (q.status === "hidden") { if (!d.hidden) return false; }
    else if (d.hidden || (q.status !== "all" && d.status !== q.status)) return false;
    if (from && d.updatedAt < from) return false;
    if (!words.length) return true;
    const hay = `${d.label} ${d.number} ${d.title} ${d.signers.join(" ")} ${d.emails.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const key = (d: T): string | number => q.sort === "created" ? d.createdAt : q.sort === "number" ? d.number : q.sort === "title" ? d.title.toLowerCase() : q.sort === "client" ? client(d) : d.updatedAt;
  out.sort((a, b) => {
    const x = key(a), y = key(b);
    const c = x < y ? -1 : x > y ? 1 : b.updatedAt - a.updatedAt;
    return q.dir === "asc" ? c : -c;
  });
  return out;
}

export function countByStatus(docs: DocRow[]): Record<StatusTab, number> {
  const c: Record<StatusTab, number> = { all: 0, draft: 0, approved: 0, sent: 0, completed: 0, voided: 0, hidden: 0 };
  for (const d of docs) { if (d.hidden) { c.hidden++; continue; } c.all++; c[d.status]++; }
  return c;
}

/** The query in the address (?status=sent&q=…), so a filtered list can be bookmarked and Back works. */
export function readQuery(search: string): DocQuery {
  const p = new URLSearchParams(search);
  const pick = <K extends string>(v: string | null, ok: readonly K[], d: K): K => (v && (ok as readonly string[]).includes(v) ? (v as K) : d);
  return {
    status: pick(p.get("status"), TABS.map((t) => t.key), "all"),
    q: (p.get("q") ?? "").slice(0, 100),
    sort: pick(p.get("sort"), SORTS.map((t) => t.key), "updated"),
    dir: pick(p.get("dir"), ["asc", "desc"] as const, "desc"),
    range: pick(p.get("range"), RANGES.map((t) => t.key), "any"),
  };
}
export function writeQuery(q: DocQuery): string {
  const p = new URLSearchParams();
  if (q.status !== "all") p.set("status", q.status);
  if (q.q) p.set("q", q.q);
  if (q.sort !== "updated") p.set("sort", q.sort);
  if (q.dir !== "desc") p.set("dir", q.dir);
  if (q.range !== "any") p.set("range", q.range);
  const s = p.toString();
  return s ? `?${s}` : "";
}
