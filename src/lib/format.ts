// Display helpers: relative times, lengths, statuses.
import { frameDuration, type Fps } from "../../convex/lib/frames";

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "02:11" (or "1:02:11") from a frame count.
export function lengthText(frameCount: number | null | undefined, fps: Fps) {
  if (!frameCount) return null;
  const total = Math.round(frameCount * frameDuration(fps));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// "0:16" style clock for the transport's time view.
export function clockText(seconds: number) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// busy = still working on it (uploading or converting): the chip shows a spinner.
export function statusChip(status: string, progress: number): { text: string; tone: "" | "warn" | "fail"; busy?: boolean } | null {
  if (status === "ready") return null;
  if (status === "failed") return { text: "Failed", tone: "fail" };
  if (status === "uploading") return { text: "Uploading", tone: "warn", busy: true };
  return { text: progress > 0 ? `Converting ${progress}%` : "Converting", tone: "warn", busy: true };
}

export function uploadText(status: string, sent: number, total: number, error?: string) {
  if (status === "failed") return `Upload failed: ${error ?? ""}`;
  if (status === "starting") return "Starting upload…";
  if (status === "done") return "Uploaded. Bunny is converting it.";
  const pct = total ? Math.floor((100 * sent) / total) : 0;
  return `Uploading ${pct}% · ${(sent / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB · keep this tab open`;
}

export function sizeText(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// Grouping buckets for "Latest activity".
export function dayBucket(t: number, now = Date.now()) {
  const d = new Date(t), n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(n) - start(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Earlier";
}

export const projectLabel = (p: { name: string; jobNumber: string | null } | null | undefined) =>
  p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : "";

// The transcript's state, as a chip: only while it's being made, or when it failed.
export function transcriptChip(status: string | null | undefined): { text: string; busy: boolean } | null {
  if (status === "pending" || status === "running") return { text: "Transcribing", busy: true };
  if (status === "failed") return { text: "No transcript", busy: false };
  return null;
}
