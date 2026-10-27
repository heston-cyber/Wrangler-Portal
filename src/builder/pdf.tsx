// A built document as a PDF (B2), with @react-pdf/renderer, in the browser. The same blocks the builder shows,
// in the document's style, with its fonts embedded.
//
// Signature, initials, name, title and date spots carry a marker ({{sign:client}} …) written in the page colour, so it
// can't be seen; Wrangler Sign's marker finder reads it and places the box exactly there. Nothing else about signing
// changes: the PDF is the record, hashed at approval.
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  PAGE_PT, fieldValues, fill, totals, money,
  type Block, type BuildDoc, type Fmt, type Rich, type RichNode, type Style, type TextSize,
} from "../../convex/lib/wsBuilder";
import type { FontRow } from "./fonts";

export type Assets = { fonts: FontRow[]; files: Record<string, string | null> };

// Fonts: register every stored face once per family; a family with no files falls back to Helvetica.
const registered = new Set<string>();
function registerFonts(rows: FontRow[]) {
  const by = new Map<string, FontRow[]>();
  for (const r of rows) if (r.url) by.set(r.family, [...(by.get(r.family) ?? []), r]);
  for (const [family, faces] of by) {
    const key = `${family}:${faces.map((f) => f._id).join(",")}`;
    if (registered.has(key)) continue;
    registered.add(key);
    Font.register({ family: `WS ${family}`, fonts: faces.map((f) => ({ src: f.url!, fontWeight: f.weight, fontStyle: f.italic ? "italic" : "normal" })) });
  }
  return new Set(by.keys());
}
Font.registerHyphenationCallback((w) => [w]); // no hyphenation: contract words stay whole

const SIZE: Record<TextSize, number> = { title: 2.3, subtitle: 1.35, heading: 1.3, strong: 1, body: 1, caption: 0.85 };

export function DocPdf({ d, assets, label }: { d: BuildDoc; assets: Assets; label?: string }) {
  const st = d.style;
  const have = registerFonts(assets.fonts);
  const fam = (f: { family: string }) => (have.has(f.family) ? `WS ${f.family}` : "Helvetica");
  const H = fam(st.fonts.heading), B = fam(st.fonts.body);
  const values = fieldValues(d.fields, d.blocks);
  const t = totals(d.blocks);
  const size = PAGE_PT[st.pageSize];
  const base = st.baseSize;
  const s = StyleSheet.create({
    page: { backgroundColor: st.page, color: st.text, fontFamily: B, fontSize: base, lineHeight: 1.45, paddingTop: st.margin, paddingBottom: st.margin + (st.footer ? 14 : 0), paddingHorizontal: st.margin },
    p: { marginBottom: base * 0.55 },
    h: { fontFamily: H, color: st.heading, fontWeight: 700 },
    muted: { color: st.muted },
    footer: { position: "absolute", bottom: st.margin / 2, left: st.margin, right: st.margin, flexDirection: "row", justifyContent: "space-between", fontSize: base * 0.75, color: st.muted },
  });
  const accent = st.accent;
  const colorOf = (f?: Fmt) => (!f?.color ? undefined : f.color === "accent" ? accent : f.color);
  const wrapFmt = (f: Fmt | undefined, children: ReactNode, key: string, wrap = true) => {
    const deco = f?.deco === "focus" ? { borderLeftWidth: 2.5, borderLeftColor: accent, paddingLeft: 10 } : f?.deco === "block" ? { backgroundColor: tint(accent, st.page, 0.08), padding: 10, borderRadius: 6 } : {};
    return <View key={key} wrap={wrap} style={{ marginBottom: base * 0.9, ...deco }}>{children}</View>;
  };
  // Only what the block sets: an unset colour must not wipe the heading colour it's spread over.
  const txt = (f?: Fmt) => ({ textAlign: f?.align ?? "left", ...(colorOf(f) ? { color: colorOf(f) } : {}), ...(f?.font === "heading" ? { fontFamily: H } : {}) });

  const marker = (kind: string, key: string) => <Text style={{ color: st.page, fontSize: base * 0.9, fontFamily: B }}>{`{{${kind}:${key}}}`}</Text>;

  const richView = (r: Rich, f?: Fmt, sizeK: TextSize = "body") => {
    const fs = base * SIZE[sizeK];
    const runs = (nodes: RichNode[] | undefined, k: string): ReactNode[] => (nodes ?? []).map((n, i) => {
      if (n.type === "hardBreak") return <Text key={`${k}${i}`}>{"\n"}</Text>;
      if (n.type !== "text") return null;
      const m = new Set((n.marks ?? []).map((x) => x.type));
      return <Text key={`${k}${i}`} style={{ fontWeight: m.has("bold") ? 700 : undefined, fontStyle: m.has("italic") ? "italic" : undefined, textDecoration: m.has("underline") ? "underline" : undefined }}>{fill(n.text ?? "", values)}</Text>;
    });
    const nodes = (list: RichNode[] | undefined, k: string, depth = 0): ReactNode[] => (list ?? []).map((n, i) => {
      if (n.type === "paragraph") return <Text key={`${k}${i}`} style={{ ...s.p, fontSize: fs, fontWeight: sizeK === "strong" ? 700 : undefined, ...(sizeK === "caption" ? s.muted : {}), ...txt(f) }}>{runs(n.content, `${k}${i}r`)}{(n.content ?? []).length ? "" : " "}</Text>;
      if (n.type === "bulletList" || n.type === "orderedList") {
        return <View key={`${k}${i}`} style={{ marginBottom: base * 0.4 }}>{(n.content ?? []).map((li, j) => (
          <View key={j} style={{ flexDirection: "row", marginLeft: depth * 12 }}>
            <Text style={{ width: 16, fontSize: fs }}>{n.type === "bulletList" ? "•" : `${j + 1}.`}</Text>
            <View style={{ flex: 1 }}>{nodes(li.content, `${k}${i}-${j}`, depth + 1)}</View>
          </View>
        ))}</View>;
      }
      return null;
    });
    return nodes(r.content, "n");
  };

  const separator = (k: string) => st.separator === "none" ? <View key={k} style={{ height: base }} />
    : st.separator === "dots" ? <Text key={k} style={{ textAlign: "center", color: st.muted, marginVertical: base * 0.6, letterSpacing: 4 }}>• • •</Text>
    : <View key={k} style={{ borderBottomWidth: st.separator === "thick" ? 2 : 0.6, borderBottomColor: st.separator === "thick" ? accent : st.muted, marginVertical: base * 0.8 }} />;

  const sectionTitle = (title: string | undefined, f?: Fmt) => title ? <Text minPresenceAhead={base * 4} style={{ ...s.h, fontSize: base * SIZE.heading, marginBottom: base * 0.5, ...txt(f), fontFamily: H }}>{fill(title, values)}</Text> : null;

  const who = (key: string) => key === "heston"
    ? { label: d.fields.business.name || "Business", name: d.fields.business.contact, title: d.fields.business.title }
    : key === "client" ? { label: d.fields.client.company || "Client", name: d.fields.client.name, title: "" }
    : (() => { const x = d.signers.find((y) => y.key === key); return { label: x?.title || `Signer ${key.replace("client", "")}`, name: x?.name ?? "", title: x?.title ?? "" }; })();
  const clientKeys = [...new Set(d.blocks.flatMap((b) => (b.type === "signatures" ? b.signers : [])).filter((k) => k !== "heston"))];
  const initialKeys = clientKeys.length ? clientKeys : ["client"];

  const initialsRow = () => (
    <View wrap={false} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 2 }}>
      {initialKeys.map((k) => <View key={k} style={{ width: 90, paddingTop: 14 }}>{marker("initials", k)}<View style={{ borderBottomWidth: 0.6, borderBottomColor: st.muted }} /><Text style={{ fontSize: base * 0.75, color: st.muted }}>Initials{initialKeys.length > 1 ? ` (${who(k).name || k})` : ""}</Text></View>)}
    </View>
  );
  const block = (b: Block): ReactNode => {
    switch (b.type) {
      case "heading":
        return wrapFmt(b.fmt, <Text style={{ ...s.h, fontSize: base * SIZE[b.size], fontWeight: b.size === "subtitle" ? 400 : 700, ...txt(b.fmt), fontFamily: b.fmt?.font === "body" ? B : H }}>{fill(b.text, values)}</Text>, b.id);
      case "text":
        return wrapFmt(b.fmt, richView(b.rich, b.fmt, b.size ?? "body"), b.id);
      case "parties": {
        const f = d.fields;
        const col = (head: string, lines: string[]) => (
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: base * 0.8, color: st.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{head}</Text>
            {lines.filter(Boolean).map((l, i) => <Text key={i} style={{ fontWeight: i === 0 ? 700 : undefined }}>{l}</Text>)}
          </View>
        );
        return wrapFmt(b.fmt, <>{sectionTitle(b.title, b.fmt)}<View style={{ flexDirection: "row", gap: 24 }}>
          {col("Business", [`${f.business.legalName}${f.business.name ? `, dba ${f.business.name}` : ""}`, f.business.contact, f.business.email, f.business.phone, f.business.address])}
          {col("Client", [f.client.company || f.client.name || "_____", f.client.company ? f.client.name : "", f.client.email, f.client.phone, f.client.address])}
        </View></>, b.id, false);
      }
      case "items": {
        const cell = (x: string, w: number | string, right = false, bold = false) => <Text style={{ width: w, textAlign: right ? "right" : "left", fontWeight: bold ? 700 : undefined }}>{x}</Text>;
        const sum = b.rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
        return wrapFmt(b.fmt, <>{sectionTitle(b.title, b.fmt)}<View>
          <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: st.muted, paddingBottom: 3, fontSize: base * 0.8, color: st.muted }}>
            {cell("Description", "58%")}{cell("Qty", "10%", true)}{cell("Rate", "16%", true)}{cell("Amount", "16%", true)}
          </View>
          {b.rows.map((r) => (
            <View key={r.id} wrap={false} style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.4, borderBottomColor: tint(st.muted, st.page, 0.4) }}>
              {cell(fill(r.description, values) || "—", "58%")}{cell(String(r.qty), "10%", true)}{cell(money(Number(r.rate) || 0), "16%", true)}{cell(money((Number(r.qty) || 0) * (Number(r.rate) || 0)), "16%", true)}
            </View>
          ))}
          <View style={{ flexDirection: "row", paddingTop: 5 }}>{cell("Total", "84%", true, true)}{cell(money(sum), "16%", true, true)}</View>
        </View></>, b.id);
      }
      case "payment":
        return wrapFmt(b.fmt, <>{sectionTitle(b.title, b.fmt)}{richView(b.terms, b.fmt)}{b.initials && initialsRow()}
          {t.total > 0 && <View wrap={false} style={{ marginTop: 4, padding: 8, borderRadius: 5, backgroundColor: tint(accent, st.page, 0.07), flexDirection: "row", gap: 18 }}>
            <Text>Total <Text style={{ fontWeight: 700 }}>{money(t.total)}</Text></Text>
            {t.depositPct > 0 && <Text>Deposit on signing ({t.depositPct}%) <Text style={{ fontWeight: 700 }}>{money(t.deposit)}</Text></Text>}
            {t.depositPct < 100 && <Text>Balance <Text style={{ fontWeight: 700 }}>{money(t.balance)}</Text></Text>}
          </View>}</>, b.id);
      case "clause":
        return wrapFmt(b.fmt, <>
          {sectionTitle(b.title, b.fmt)}{richView(b.rich, b.fmt)}
          {b.initials && initialsRow()}
        </>, b.id);
      case "signatures":
        return wrapFmt(b.fmt, <>{sectionTitle(b.title, b.fmt)}<View wrap={false} style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }}>
          {b.signers.map((k) => {
            const w = who(k);
            // The marker sits right on the line (the signature image's bottom lands on it); the space above leaves room
            // for the signature itself.
            const line = (kind: string, label: string) => (
              <View style={{ paddingTop: kind === "sign" ? 26 : 8 }}>
                {marker(kind, k)}
                <View style={{ borderBottomWidth: 0.7, borderBottomColor: st.text }} />
                <Text style={{ fontSize: base * 0.75, color: st.muted, marginTop: 2 }}>{label}</Text>
              </View>
            );
            return (
              <View key={k} style={{ width: "46%" }}>
                <Text style={{ fontSize: base * 0.8, color: st.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>{w.label}</Text>
                {line("sign", "Signature")}
                {line("name", "Name")}
                {b.showTitle && line("title", "Title")}
                {b.showDate && line("date", "Date")}
              </View>
            );
          })}
        </View></>, b.id, false);
      case "divider": return separator(b.id);
      case "pagebreak": return <View key={b.id} break />;
      case "spacer": return <View key={b.id} style={{ height: b.size }} />;
    }
  };

  const logo = st.logo && assets.files[st.logo.fileId];
  const cover = st.cover && assets.files[st.cover.fileId];
  return (
    <Document title={d.title} author={d.fields.business.name} creator="Wrangler Sign" producer="Wrangler Sign">
      <Page size={st.pageSize} style={s.page}>
        {cover && <Image src={cover} style={{ position: "absolute", top: 0, left: 0, width: size.w, height: st.cover!.height, objectFit: "cover" }} />}
        {cover && <View style={{ height: Math.max(0, st.cover!.height - st.margin + 18) }} />}
        {logo && <View style={{ flexDirection: "row", justifyContent: st.logo!.align === "center" ? "center" : st.logo!.align === "right" ? "flex-end" : "flex-start", marginBottom: base * 1.2 }}><Image src={logo} style={{ width: st.logo!.width }} /></View>}
        {d.blocks.map(block)}
        {st.footer && <View fixed style={s.footer}>
          <Text>{label ? `${label} · ` : ""}{d.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>}
      </Page>
    </Document>
  );
}

/** Mix a colour toward the page colour (for tints on any background). */
export function tint(hex: string, page: string, amount: number): string {
  const p = (h: string) => { const x = h.replace("#", ""); const n = parseInt(x.length === 3 ? x.split("").map((c) => c + c).join("") : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  try {
    const a = p(hex), b = p(page);
    const c = a.map((v, i) => Math.round(b[i] + (v - b[i]) * amount));
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch { return page; }
}

export async function renderPdf(d: BuildDoc, assets: Assets, label?: string): Promise<Blob> {
  return pdf(<DocPdf d={d} assets={assets} label={label} />).toBlob();
}
