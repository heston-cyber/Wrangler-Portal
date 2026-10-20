// Uploads run outside React so they keep going when you move between pages.
import { useSyncExternalStore } from "react";
import * as tus from "tus-js-client";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type UploadState = {
  key: string;
  videoId: Id<"videos">;
  fileName: string;
  sent: number;
  total: number;
  status: "starting" | "uploading" | "done" | "failed";
  error?: string;
  versionNumber?: number;
};

let uploads: UploadState[] = [];
const listeners = new Set<() => void>();
const emit = () => { uploads = [...uploads]; listeners.forEach((l) => l()); };
const update = (key: string, patch: Partial<UploadState>) => {
  uploads = uploads.map((u) => (u.key === key ? { ...u, ...patch } : u));
  listeners.forEach((l) => l());
};

export function useUploads(videoId?: string) {
  const all = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => uploads,
  );
  return videoId ? all.filter((u) => u.videoId === videoId) : all;
}

window.addEventListener("beforeunload", (e) => {
  if (uploads.some((u) => u.status === "uploading" || u.status === "starting")) { e.preventDefault(); e.returnValue = ""; }
});

export async function startUpload(convex: ConvexReactClient, videoId: Id<"videos">, file: File) {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  uploads.push({ key, videoId, fileName: file.name, sent: 0, total: file.size, status: "starting" });
  emit();
  let versionId: Id<"versions"> | null = null;
  try {
    const t = await convex.action(api.uploads.startUpload, { videoId, fileName: file.name, fileSize: file.size });
    versionId = t.versionId;
    update(key, { status: "uploading", versionNumber: t.number });
    await new Promise<void>((resolve, reject) => {
      const up = new tus.Upload(file, {
        endpoint: t.endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
        chunkSize: 50 * 1024 * 1024,
        headers: {
          AuthorizationSignature: t.signature,
          AuthorizationExpire: String(t.expire),
          VideoId: t.videoId,
          LibraryId: String(t.libraryId),
        },
        metadata: { filetype: file.type || "video/mp4", title: file.name },
        onProgress: (sent, total) => update(key, { sent, total }),
        onError: (err) => reject(err),
        onSuccess: () => resolve(),
      });
      up.start();
    });
    await convex.action(api.uploads.uploadFinished, { versionId: t.versionId });
    update(key, { status: "done", sent: file.size });
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 200) || "Upload failed";
    update(key, { status: "failed", error: msg });
    if (versionId) await convex.action(api.uploads.uploadFailed, { versionId, error: msg }).catch(() => {});
  }
}

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|mxf|mkv|avi|webm|mts|m2ts)$/i.test(f.name);
