import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import { drawShapesOnCanvas, type Shape } from "./Drawing";

// Grab the frame on screen (plus any drawing) as a JPEG and upload it. Returns its URL.
export async function captureAndUpload(convex: ConvexReactClient, video: HTMLVideoElement, shapes: Shape[] = [], maxW = 1600): Promise<string> {
  const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
  const s = Math.min(1, maxW / vw);
  const W = Math.round(vw * s), H = Math.round(vh * s);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, W, H);
  if (shapes.length) drawShapesOnCanvas(ctx, shapes, W, H);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't grab the frame."))), "image/jpeg", 0.86));
  const dataBase64 = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  return await convex.action(api.stills.upload, { dataBase64, contentType: "image/jpeg" });
}
