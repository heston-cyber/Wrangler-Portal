// A built document as a PDF (B2; the page model since E1), with @react-pdf/renderer, in the browser. The same lines
// and blocks the builder shows,
// in the document's style, with its fonts embedded.
//
// Signature, initials, name, title and date spots carry a marker ({{sign:client}} …) written in the page colour, so it
// can't be seen; Wrangler Sign's marker finder reads it and places the box exactly there. Nothing else about signing
// changes: the PDF is the record, hashed at approval.
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  PAGE_PT, fieldValues, fill, money, nodesOf, totals,
  type BuildDoc, type ItemRow, type LineAttrs, type PNode, type TextSize,
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

export const SIZE: Record<TextSize, number> = { title: 2.3, subtitle: 1.35, heading: 1.3, strong: 1, body: 1, caption: 0.85 };
const HEADINGS = new Set<TextSize>(["title", "subtitle", "heading"]);

export function DocPdf({ d, assets, label }: { d: BuildDoc; assets: Assets; label?: string }) {
  const st = d.style;
  const have = registerFonts(assets.fonts);
  const fam = (f: { family: string }) => (have.has(f.family) ? `WS ${f.family}` : "Helvetica");
  const H = fam(st.fonts.heading), B = fam(st.fonts.body);
  const values = fieldValues(d.fields, d.page);
  const t = totals(d.page);
  const size = PAGE_PT[st.pageSize];
  const base = st.baseSize;
  const s = StyleSheet.create({
    page: { backgroundColor: st.page, color: st.text, fontFamily: B, fontSize: base, lineHeight: 1.45, paddingTop: st.margin, paddingBottom: st.margin + (st.footer ? 14 : 0), paddingHorizontal: st.margin },
    muted: { color: st.muted },
    footer: { position: "absolute", bottom: st.margin / 2, left: st.margin, right: st.margin, flexDirection: "row", justifyContent: "space-between", fontSize: base * 0.75, color: st.muted },
  });
  const accent = st.accent;
  const colour = (c: unknown) => (!c ? undefined : c === "accent" ? accent : String(c));

  const marker = (kind: string, key: string) => <Text style={{ color: st.page, fontSize: base * 0.9, fontFamily: B }}>{`{{${kind}:${key}}}`}</Text>;

  // One line: its text style, then what the line sets (alignment, colour, font, decoration).
  const runs = (nodes: PNode[] | undefined, k: string): ReactNode[] => (nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return <Text key={`${k}${i}`}>{"\n"}</Text>;
    if (n.type !== "text") return null;
    const m = new Set((n.marks ?? []).map((x) => x.type));
    const deco = [m.has("underline") && "underline", m.has("strike") && "line-through"].filter(Boolean).join(" ") || undefined;
    return <Text key={`${k}${i}`} style={{ fontWeight: m.has("bold") ? 700 : undefined, fontStyle: m.has("italic") ? "italic" : undefined, textDecoration: deco as "underline" | undefined }}>{fill(n.text ?? "", values)}</Text>;
  });
  const lineView = (n: PNode, k: string, inList = false): ReactNode => {
    const a = (n.attrs ?? {}) as LineAttrs;
    const z = (a.size ?? "body") as TextSize;
    const head = HEADINGS.has(z);
    const style = {
      fontSize: base * SIZE[z],
      fontFamily: a.font === "heading" ? H : a.font === "body" ? B : head ? H : B,
      fontWeight: z === "subtitle" ? 400 : head || z === "strong" ? 700 : undefined,
      color: colour(a.color) ?? (head ? st.heading : z === "caption" ? st.muted : undefined),
      textAlign: (a.align ?? "left") as "left",
      marginBottom: inList ? base * 0.2 : z === "title" ? base * 0.5 : base * 0.45,
      marginTop: !inList && (z === "heading" || z === "subtitle") ? base * 0.35 : 0,
      lineHeight: head ? 1.25 : 1.45,
    };
    const text = <Text key={k} minPresenceAhead={head ? base * 4 : undefined} style={style}>{runs(n.content, `${k}r`)}{(n.content ?? []).length ? "" : " "}</Text>;
    if (a.deco === "focus") return <View key={k} style={{ borderLeftWidth: 2.5, borderLeftColor: accent, paddingLeft: 10, marginBottom: base * 0.3 }}>{text}</View>;
    if (a.deco === "block") return <View key={k} style={{ backgroundColor: tint(accent, st.page, 0.08), padding: 8, borderRadius: 6, marginBottom: base * 0.4 }}>{text}</View>;
    return text;
  };
  const list = (n: PNode, k: string, depth = 0): ReactNode => (
    <View key={k} style={{ marginBottom: base * 0.4 }}>{(n.content ?? []).map((li, j) => (
      <View key={j} style={{ flexDirection: "row", marginLeft: depth * 12 }}>
        <Text style={{ width: 16 }}>{n.type === "bulletList" ? "•" : `${j + 1}.`}</Text>
        <View style={{ flex: 1 }}>{(li.content ?? []).map((c, i) => c.type === "paragraph" ? lineView(c, `${k}-${j}-${i}`, true) : c.type === "bulletList" || c.type === "orderedList" ? list(c, `${k}-${j}-${i}`, depth + 1) : null)}</View>
      </View>
    ))}</View>
  );

  const separator = (k: string) => st.separator === "none" ? <View key={k} style={{ height: base }} />
    : st.separator === "dots" ? <Text key={k} style={{ textAlign: "center", color: st.muted, marginVertical: base * 0.6, letterSpacing: 4 }}>• • •</Text>
    : <View key={k} style={{ borderBottomWidth: st.separator === "thick" ? 2 : 0.6, borderBottomColor: st.separator === "thick" ? accent : st.muted, marginVertical: base * 0.8 }} />;

  const who = (key: string) => key === "heston"
    ? { label: d.fields.business.name || "Business", name: d.fields.business.contact, title: d.fields.business.title }
    : key === "client" ? { label: d.fields.client.company || "Client", name: d.fields.client.name, title: "" }
    : (() => { const x = d.signers.find((y) => y.key === key); return { label: x?.title || `Signer ${key.replace("client", "")}`, name: x?.name ?? "", title: x?.title ?? "" }; })();
  const clientKeys = [...new Set(nodesOf(d.page, "signatures").flatMap((n) => (n.attrs?.signers as string[]) ?? []).filter((k) => k !== "heston"))];
  const initialKeys = clientKeys.length ? clientKeys : ["client"];

  const initialsRow = (k: string) => (
    <View key={k} wrap={false} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 2, marginBottom: base * 0.4 }}>
      {initialKeys.map((x) => <View key={x} style={{ width: 90, paddingTop: 14 }}>{marker("initials", x)}<View style={{ borderBottomWidth: 0.6, borderBottomColor: st.muted }} /><Text style={{ fontSize: base * 0.75, color: st.muted }}>Initials{initialKeys.length > 1 ? ` (${who(x).name || x})` : ""}</Text></View>)}
    </View>
  );

  const node = (n: PNode, k: string): ReactNode => {
    const a = (n.attrs ?? {}) as Record<string, unknown>;
    switch (n.type) {
      case "paragraph": return lineView(n, k);
      case "bulletList": case "orderedList": return list(n, k);
      case "section": {
        const card = a.look === "card";
        return <View key={k} style={{ marginBottom: base * 0.7, ...(card ? { backgroundColor: tint(accent, st.page, 0.07), padding: 10, borderRadius: 6 } : {}) }}>
          {(n.content ?? []).map((c, i) => node(c, `${k}.${i}`))}
          {!!a.initials && initialsRow(`${k}i`)}
        </View>;
      }
      case "parties": {
        const f = d.fields;
        const col = (head: string, lines: string[]) => (
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: base * 0.8, color: st.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{head}</Text>
            {lines.filter(Boolean).map((l, i) => <Text key={i} style={{ fontWeight: i === 0 ? 700 : undefined }}>{l}</Text>)}
          </View>
        );
        return <View key={k} wrap={false} style={{ flexDirection: "row", gap: 24, marginBottom: base * 0.9 }}>
          {col("Business", [`${f.business.legalName}${f.business.name ? `, dba ${f.business.name}` : ""}`, f.business.contact, f.business.email, f.business.phone, f.business.address])}
          {col("Client", [f.client.company || f.client.name || "_____", f.client.company ? f.client.name : "", f.client.email, f.client.phone, f.client.address])}
        </View>;
      }
      case "items": {
        const rows = (a.rows as ItemRow[]) ?? [];
        const cell = (x: string, w: number | string, right = false, bold = false) => <Text style={{ width: w, textAlign: right ? "right" : "left", fontWeight: bold ? 700 : undefined }}>{x}</Text>;
        const sum = rows.reduce((acc, r) => acc + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
        return <View key={k} style={{ marginBottom: base * 0.9 }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: st.muted, paddingBottom: 3, fontSize: base * 0.8, color: st.muted }}>
            {cell("Description", "58%")}{cell("Qty", "10%", true)}{cell("Rate", "16%", true)}{cell("Amount", "16%", true)}
          </View>
          {rows.map((r) => (
            <View key={r.id} wrap={false} style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.4, borderBottomColor: tint(st.muted, st.page, 0.4) }}>
              {cell(fill(r.description, values) || "—", "58%")}{cell(String(r.qty), "10%", true)}{cell(money(Number(r.rate) || 0), "16%", true)}{cell(money((Number(r.qty) || 0) * (Number(r.rate) || 0)), "16%", true)}
            </View>
          ))}
          <View style={{ flexDirection: "row", paddingTop: 5 }}>{cell("Total", "84%", true, true)}{cell(money(sum), "16%", true, true)}</View>
        </View>;
      }
      case "payment":
        return <View key={k}>
          {t.total > 0 && <View wrap={false} style={{ marginTop: 4, marginBottom: base * 0.5, padding: 8, borderRadius: 5, backgroundColor: tint(accent, st.page, 0.07), flexDirection: "row", gap: 18 }}>
            <Text>Total <Text style={{ fontWeight: 700 }}>{money(t.total)}</Text></Text>
            {t.depositPct > 0 && <Text>Deposit on signing ({t.depositPct}%) <Text style={{ fontWeight: 700 }}>{money(t.deposit)}</Text></Text>}
            {t.depositPct < 100 && <Text>Balance <Text style={{ fontWeight: 700 }}>{money(t.balance)}</Text></Text>}
          </View>}
          {!!a.initials && initialsRow(`${k}i`)}
        </View>;
      case "signatures": {
        const signers = (a.signers as string[]) ?? [];
        return <View key={k} wrap={false} style={{ flexDirection: "row", flexWrap: "wrap", gap: 24, marginBottom: base * 0.9 }}>
          {signers.map((x) => {
            const w = who(x);
            // The marker sits right on the line (the signature image's bottom lands on it); the space above leaves room
            // for the signature itself.
            const ln = (kind: string, lab: string) => (
              <View style={{ paddingTop: kind === "sign" ? 26 : 8 }}>
                {marker(kind, x)}
                <View style={{ borderBottomWidth: 0.7, borderBottomColor: st.text }} />
                <Text style={{ fontSize: base * 0.75, color: st.muted, marginTop: 2 }}>{lab}</Text>
              </View>
            );
            return (
              <View key={x} style={{ width: "46%" }}>
                <Text style={{ fontSize: base * 0.8, color: st.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>{w.label}</Text>
                {ln("sign", "Signature")}
                {ln("name", "Name")}
                {a.showTitle !== false && ln("title", "Title")}
                {a.showDate !== false && ln("date", "Date")}
              </View>
            );
          })}
        </View>;
      }
      case "divider": return separator(k);
      case "pagebreak": return <View key={k} break />;
      case "spacer": return <View key={k} style={{ height: Number(a.size) || 18 }} />;
      default: return null;
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
        {(d.page.content ?? []).map((n, i) => node(n, `n${i}`))}
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
