// Phase 5e step 4: shared by the bell's panel, the See all page and Settings › Notifications.
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { BellKind } from "../../../convex/lib/bell";
import { StatusChip, type Tone } from "../../ui/wp";
import type { IconName } from "../../ui/Icon";
import { navigate } from "../../lib/router";

export type Row = { _id: string; kind: BellKind; title: string; link: string | null; at: number; unread: boolean };
export const ICON: Record<BellKind, IconName> = { quotes: "check-circle", contracts: "edit", payments: "invoice", vendors: "invoice", notes: "review", messages: "send", uploads: "upload", sitewatch: "alert" };
export const TONE: Record<BellKind, Tone> = { quotes: "accent", contracts: "accent", payments: "accent", vendors: "neutral", notes: "accent", messages: "accent", uploads: "neutral", sitewatch: "accent" };
export const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} ${Math.round(m / 60) === 1 ? "hour" : "hours"} ago` : m < 2880 ? "Yesterday" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
export const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export function dayHead(t: number) {
  const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toDateString() === now.toDateString() ? `Today · ${md}` : d.toDateString() === y.toDateString() ? `Yesterday · ${md}` : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export const NEW = <StatusChip tone="accent">New</StatusChip>;

export function useOpenRow() {
  const markRead = useMutation(api.bell.markRead);
  return (r: Row, after?: () => void) => {
    if (r.unread) void markRead({ itemId: r._id as never }).catch(() => {});
    after?.();
    if (r.link) navigate(r.link);
  };
}

