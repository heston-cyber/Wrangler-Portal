// Slack alerts through an incoming webhook (Convex env var SLACK_WEBHOOK_URL). Skipped quietly if unset.
import { internal } from "./_generated/api";
import { internalAction } from "./lib/functions";
import { v } from "convex/values";
import { frameTc } from "./lib/frames";
import { SITE } from "./lib/site";


async function post(payload: unknown) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) console.error("Slack", res.status, await res.text());
  return res.ok;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const versionReady = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || !row.video) return;
    if (row.project?.name === "Tests") return; // Claude's test videos never ping Slack
    const link = `${SITE()}/v/${row.video._id}?version=${row.version.number}`;
    const where = row.project ? `${row.project.jobNumber ? row.project.jobNumber + " " : ""}${row.project.name} · ` : "";
    await post({
      text: `${where}${row.video.title} v${row.version.number} is ready to review`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${esc(where + row.video.title)} v${row.version.number}* is ready to review.\n<${link}|Open in Wrangler Review>` } }],
    });
  },
});

export const newNotes = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const notes = await ctx.runQuery(internal.notes.unnotified, { versionId });
    if (!notes.length) return;
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || !row.video) return;
    const fps = { num: row.version.fpsNum ?? 24000, den: row.version.fpsDen ?? 1001 };
    const tc = (f?: number) => (f === undefined ? "" : frameTc(f, row.version.startTimecode, fps));
    const link = `${SITE()}/v/${row.video._id}?version=${row.version.number}`;
    const blocks: unknown[] = [
      { type: "section", text: { type: "mrkdwn", text: `*${notes.length} new note${notes.length === 1 ? "" : "s"}* on *${esc(row.video.title)} v${row.version.number}* · <${link}|Open>` } },
    ];
    for (const n of notes.slice(0, 10)) {
      const when = n.kind === "general" ? "Whole video" : n.kind === "range" ? `${tc(n.inFrame)} → ${tc(n.outFrame)}` : tc(n.inFrame);
      const text = `*${when}* · ${esc(n.authorName)}\n${esc(n.text || "(drawing)").slice(0, 500)}`;
      const section: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text } };
      if (n.still) section.accessory = { type: "image", image_url: n.still, alt_text: "Frame" };
      blocks.push(section);
    }
    if (notes.length > 10) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `and ${notes.length - 10} more` }] });
    const sent = await post({ text: `${notes.length} new notes on ${row.video.title} v${row.version.number}`, blocks });
    // Mark them handled even if Slack isn't set up, so a later setup doesn't replay old notes.
    if (sent || !process.env.SLACK_WEBHOOK_URL) await ctx.runMutation(internal.notes.markNotified, { noteIds: notes.map((n) => n._id) });
  },
});
