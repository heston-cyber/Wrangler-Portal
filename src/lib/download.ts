// Downloads on the client's side (C3, Oct 23). Bunny's files live on another domain, so a plain link only plays
// them; these fetch the bytes and hand the browser a real download. One file saves as it is; a project saves as a
// zip built here (stored, not compressed: video doesn't shrink), streamed straight to disk where the browser allows
// it (Chrome, Edge) and gathered in memory elsewhere (Safari, Firefox).
import { Zip, ZipPassThrough } from "fflate";

export type Progress = { done: number; total: number; file: string; files: number; ofFiles: number };
type Sink = { write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "file";

// Where the bytes go: a file on disk picked up front (streams; no memory limit), or a Blob at the end.
async function openSink(name: string, mime: string): Promise<Sink> {
  const w = window as unknown as { showSaveFilePicker?: (o: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<{ write: (c: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    const ext = name.includes(".") ? "." + name.split(".").pop()! : "";
    const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: mime, accept: { [mime]: [ext] } }] });
    const ws = await handle.createWritable();
    return { write: (c) => ws.write(c), close: () => ws.close(), abort: () => ws.abort() };
  }
  const chunks: Uint8Array[] = [];
  return {
    write: async (c) => { chunks.push(c); },
    close: async () => {
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mime }));
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort: async () => { chunks.length = 0; },
  };
}

async function pump(url: string, onChunk: (c: Uint8Array) => Promise<void>, onBytes: (n: number) => void): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The file couldn't be fetched (${res.status}).`);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await onChunk(value);
    got += value.byteLength;
    onBytes(got);
  }
  return got;
}

/** Saves one file. `onProgress` gets bytes so far and the total when known. Returns false when the user cancelled the save box. */
export async function downloadOne(url: string, name: string, total: number | null, onProgress: (p: Progress) => void): Promise<boolean> {
  let sink: Sink;
  try { sink = await openSink(safeName(name), "video/mp4"); } catch (e) { if ((e as Error).name === "AbortError") return false; throw e; }
  try {
    await pump(url, (c) => sink.write(c), (n) => onProgress({ done: n, total: total ?? 0, file: name, files: 1, ofFiles: 1 }));
    await sink.close();
    return true;
  } catch (e) { await sink.abort().catch(() => {}); throw e; }
}

/** Saves several files as one zip. Each entry is stored as it is (no compression). */
export async function downloadZip(files: Array<{ url: string; name: string; bytes: number | null }>, zipName: string, onProgress: (p: Progress) => void): Promise<boolean> {
  let sink: Sink;
  try { sink = await openSink(safeName(zipName), "application/zip"); } catch (e) { if ((e as Error).name === "AbortError") return false; throw e; }
  const total = files.every((f) => f.bytes) ? files.reduce((a, f) => a + (f.bytes ?? 0), 0) : 0;
  let written = Promise.resolve();
  let failed: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) { failed = err; return; }
    written = written.then(() => sink.write(chunk));
  });
  try {
    const seen = new Set<string>();
    let before = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let name = safeName(f.name);
      for (let n = 2; seen.has(name.toLowerCase()); n++) name = name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      seen.add(name.toLowerCase());
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      const got = await pump(f.url, async (c) => { entry.push(c); await written; }, (n) => onProgress({ done: before + n, total, file: f.name, files: i + 1, ofFiles: files.length }));
      entry.push(new Uint8Array(0), true);
      before += got;
      if (failed) throw failed;
    }
    zip.end();
    await written;
    if (failed) throw failed;
    await sink.close();
    return true;
  } catch (e) { await sink.abort().catch(() => {}); throw e; }
}

export const bytesText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
