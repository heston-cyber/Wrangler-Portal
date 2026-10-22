// "Show details" (R2b, Oct 22): the fields that can sit next to each video in the library and the register,
// in the order Heston picks. The choice is saved to his account (prefs "details") and is the same on every device.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ago, lengthText, sizeText } from "./format";

type Overview = FunctionReturnType<typeof api.library.overview>;
export type Item = Overview["videos"][number];
type Project = Overview["projects"][number];

export type FieldKey = "number" | "client" | "project" | "latest" | "status" | "length" | "format" | "notes" | "activity" | "firstUpload" | "storage" | "transcript" | "source";

export const FIELDS: Array<{ key: FieldKey; label: string; hint: string }> = [
  { key: "number", label: "Video number", hint: "00001" },
  { key: "client", label: "Client", hint: "All 4 One" },
  { key: "project", label: "Project and job number", hint: "26122 Spirit Days" },
  { key: "latest", label: "Latest version", hint: "v3 of 3" },
  { key: "status", label: "Status", hint: "Ready, Converting, Final v3" },
  { key: "length", label: "Length", hint: "03:57" },
  { key: "format", label: "Resolution and frame rate", hint: "1920×804 · 24" },
  { key: "notes", label: "Notes", hint: "2 open of 5" },
  { key: "activity", label: "Last activity", hint: "2h ago" },
  { key: "firstUpload", label: "First upload", hint: "Oct 21" },
  { key: "storage", label: "Bunny storage", hint: "1.2 GB" },
  { key: "transcript", label: "Transcript", hint: "Done" },
  { key: "source", label: "Source", hint: "Dropbox or browser" },
];
export const DEFAULT_FIELDS: FieldKey[] = ["number", "latest", "length", "notes", "activity"];
const KNOWN = new Set(FIELDS.map((f) => f.key));

export const pad5 = (n: number) => String(n).padStart(5, "0");
const fpsOf = (x: Item) => ({ num: x.latest?.fpsNum ?? 24000, den: x.latest?.fpsDen ?? 1001 });
const fpsLabel = (x: Item) => {
  const f = fpsOf(x).num / fpsOf(x).den;
  return Math.abs(f - Math.round(f)) < 0.01 ? String(Math.round(f)) : f.toFixed(3).replace(/0+$/, "");
};
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function statusText(x: Item): { text: string; tone: "" | "warn" | "fail" | "final" } {
  if (x.final) return { text: `Final v${x.final.version}`, tone: "final" };
  if (!x.latest) return { text: "No versions", tone: "" };
  if (x.latest.status === "failed") return { text: "Failed", tone: "fail" };
  if (x.latest.status !== "ready") return { text: x.latest.encodeProgress > 0 ? `Converting ${x.latest.encodeProgress}%` : "Converting", tone: "warn" };
  return { text: "Ready", tone: "" };
}

// The text for one field (null = nothing to show for this video).
export function fieldText(key: FieldKey, x: Item, p: Project | undefined): string | null {
  switch (key) {
    case "number": return x.number ? pad5(x.number) : null;
    case "client": return p?.client ?? null;
    case "project": return p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : null;
    case "latest": return x.latest ? (x.versionCount > 1 ? `v${x.latest.number} of ${x.versionCount}` : `v${x.latest.number}`) : null;
    case "status": return statusText(x).text;
    case "length": return x.latest ? lengthText(x.latest.frameCount, fpsOf(x)) : null;
    case "format": return x.latest?.width && x.latest.height ? `${x.latest.width}×${x.latest.height} · ${fpsLabel(x)}` : null;
    case "notes": return x.noteCount ? (x.openNotes ? `${x.openNotes} open of ${x.noteCount}` : `${x.noteCount} done`) : null;
    case "activity": return ago(x.updatedAt);
    case "firstUpload": return x.firstUploadAt ? day(x.firstUploadAt) : null;
    case "storage": return x.storageBytes ? sizeText(x.storageBytes) : null;
    case "transcript": return x.latest?.transcript === "done" ? "Transcript" : x.latest?.transcript === "failed" ? "No transcript" : x.latest?.transcript ? "Transcribing" : null;
    case "source": return x.source;
  }
}

// Sorting on the same fields. Each returns a number where bigger sorts first, or a string for A → Z.
export type SortKey = "activity" | "created" | "az" | "number" | "storage" | "length" | "openNotes" | "firstUpload" | "versions";
export const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "activity", label: "Latest activity" },
  { key: "created", label: "Last created" },
  { key: "az", label: "A → Z" },
  { key: "number", label: "Video number" },
  { key: "storage", label: "Most storage" },
  { key: "length", label: "Longest" },
  { key: "openNotes", label: "Most open notes" },
  { key: "versions", label: "Most versions" },
  { key: "firstUpload", label: "First upload" },
];
export function sorter(key: SortKey) {
  const len = (x: Item) => (x.latest?.frameCount ?? 0) * ((x.latest?.fpsDen ?? 1001) / (x.latest?.fpsNum ?? 24000));
  const by = (f: (x: Item) => number) => (a: Item, b: Item) => f(b) - f(a) || b.updatedAt - a.updatedAt;
  switch (key) {
    case "az": return (a: Item, b: Item) => a.title.localeCompare(b.title);
    case "created": return by((x) => x.createdAt);
    case "number": return by((x) => x.number ?? -1);
    case "storage": return by((x) => x.storageBytes ?? -1);
    case "length": return by(len);
    case "openNotes": return by((x) => x.openNotes);
    case "versions": return by((x) => x.versionCount);
    case "firstUpload": return by((x) => x.firstUploadAt ?? 0);
    default: return by((x) => x.updatedAt);
  }
}

export type FilterKey = "all" | "notFinal" | "final" | "openNotes" | "converting";
export const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All videos" },
  { key: "notFinal", label: "Not final" },
  { key: "final", label: "Final" },
  { key: "openNotes", label: "With open notes" },
  { key: "converting", label: "Converting or failed" },
];
export function passes(f: FilterKey, x: Item) {
  switch (f) {
    case "notFinal": return !x.final;
    case "final": return Boolean(x.final);
    case "openNotes": return x.openNotes > 0;
    case "converting": return Boolean(x.latest && x.latest.status !== "ready");
    default: return true;
  }
}

// The account-wide settings: shown fields (in order) and the Approve final switch. Changes show at once.
export function useLibrarySettings() {
  const prefs = useQuery(api.prefs.mine, {});
  const save = useMutation(api.prefs.set);
  const [local, setLocal] = useState<{ fields?: FieldKey[]; approveFinal?: boolean }>({});
  useEffect(() => { setLocal({}); }, [prefs]);
  const stored = (prefs?.details as { fields?: string[] } | undefined)?.fields;
  const fields = local.fields ?? (Array.isArray(stored) ? (stored.filter((k) => KNOWN.has(k as FieldKey)) as FieldKey[]) : DEFAULT_FIELDS);
  const approveFinal = local.approveFinal ?? prefs?.approveFinal === true;
  return {
    loaded: prefs !== undefined,
    fields,
    approveFinal,
    setFields: (f: FieldKey[]) => { setLocal((l) => ({ ...l, fields: f })); void save({ key: "details", value: { fields: f } }); },
    setApproveFinal: (on: boolean) => { setLocal((l) => ({ ...l, approveFinal: on })); void save({ key: "approveFinal", value: on }); },
  };
}
