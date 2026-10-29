// Shared bits for the Wrangler Sign pages (Phase S1, Oct 27).
import type { Id } from "../../../../convex/_generated/dataModel";

export type DocStatus = "draft" | "approved" | "sent" | "completed" | "voided";

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Draft", approved: "Approved · ready to send", sent: "Sent", completed: "Signed", voided: "Voided",
};

export function StatusChip({ status }: { status: DocStatus }) {
  const cls = status === "approved" ? "chip ws-chip ok" : status === "completed" ? "chip ws-chip done" : status === "voided" ? "chip ws-chip void" : status === "sent" ? "chip ws-chip sent" : "chip ws-chip";
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

// Signer colours on the placement screen. Heston is always the brand red.
const PALETTE = ["#4ba3ff", "#5fd38a", "#f2c94c", "#c58bff", "#ff8f5a", "#38d6c4", "#ff6fae", "#a3c95b", "#9aa7ff"];
export function signerColor(key: string, order: string[]): string {
  if (key === "heston") return "var(--accent)";
  const i = order.filter((k) => k !== "heston").indexOf(key);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

export const KIND_LABEL = { sign: "Signature", initials: "Initials", name: "Name", date: "Date", title: "Title" } as const;

// Upload a file to Convex storage through a one-time URL; returns the storage id.
export async function uploadToStorage(uploadUrl: string, file: Blob): Promise<Id<"_storage">> {
  const r = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
  const j = (await r.json()) as { storageId: Id<"_storage"> };
  return j.storageId;
}

export const central = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// Same as the other pages: the message after "ConvexError: ", first line only.
export const errText = (e: unknown) => {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return String((e as Error)?.message ?? e).replace(/^.*ConvexError: /s, "").split("\n")[0].slice(0, 300);
};
