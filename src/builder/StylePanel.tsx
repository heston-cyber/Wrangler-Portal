// The builder's Style tab (B2), after Craft's: a Style Gallery (built-in looks and yours, one set as the default for
// new documents), colours, backdrop (colour or image, also behind the pages on the signing page), cover image, logo,
// separator, fonts (Default / Serif / Mono / Rounded, any Google font, a font file, or one installed on this computer)
// and the page itself.
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Image as ImageIcon, Laptop, Palette, Star, Trash2, Upload, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Modal, Spinner, useConfirm } from "../ui/kit";
import { BUILTIN_FONTS, type FontRef, type Style } from "../../convex/lib/wsBuilder";
import { GOOGLE_PICKS, canReadLocalFonts, cssFamily, localFonts, styleOf, type FontRow, type LocalFont } from "./fonts";
import { errText, uploadToStorage } from "../pages/sign/common";

export function StylePanel({ style, onChange, fonts, files, show }: { style: Style; onChange: (s: Style) => void; fonts: FontRow[]; files: Record<string, string | null>; show: (m: string) => void }) {
  const styles = useQuery(api.builder.listStyles);
  const saveStyle = useMutation(api.builder.saveStyle);
  const setDefault = useMutation(api.builder.setDefaultStyle);
  const deleteStyle = useMutation(api.builder.deleteStyle);
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const checkImage = useAction(api.builder.checkImage);
  const [gallery, setGallery] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<Style>) => onChange({ ...style, ...p });
  const saved = styles?.saved.find((s) => s.name === style.name);

  const image = async (f: File | undefined, apply: (id: string) => void) => {
    if (!f) return;
    setBusy("image");
    try { const id = await uploadToStorage(await uploadUrl({}), f); await checkImage({ storageId: id }); apply(id); }
    catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const color = (label: string, k: "backdrop" | "page" | "text" | "heading" | "accent" | "muted") => (
    <label className="wsb-colorrow"><span>{label}</span><input type="color" value={style[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Style>)} /></label>
  );
  const picker = (ref: React.RefObject<HTMLInputElement>, apply: (id: string) => void) => <input ref={ref} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void image(f, apply); }} />;
  const logoIn = useRef<HTMLInputElement>(null), coverIn = useRef<HTMLInputElement>(null), backIn = useRef<HTMLInputElement>(null);

  return (
    <div className="wsb-pane">
      <button className="wsb-stylecard big" onClick={() => setGallery(true)} style={cardBg(style, files)}>
        <span className="wsb-mini" style={{ background: style.page, color: style.heading, fontFamily: cssFamily(style.fonts.heading.family) }}>{style.name}</span>
      </button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn ghost sm" onClick={() => setGallery(true)}><Palette size={13} />All styles</button>
        <button className="btn ghost sm" disabled={busy === "save"} onClick={async () => {
          const name = saved ? style.name : window.prompt("Name this style", style.name === "Wrangler" ? "My style" : `${style.name} (mine)`)?.trim();
          if (!name) return;
          setBusy("save");
          try { await saveStyle({ styleId: saved?._id as Id<"wsStyles"> | undefined, name, style: { ...style, name } }); set({ name }); show(saved ? `Updated "${name}"` : `Saved "${name}" to your styles`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
        }}>{busy === "save" ? <Spinner /> : <Check size={13} />}{saved ? `Update "${style.name}"` : "Save as my style"}</button>
      </div>

      <span className="label">Colour</span>
      {color("Backdrop", "backdrop")}{color("Page", "page")}{color("Text", "text")}{color("Headings", "heading")}{color("Accent", "accent")}{color("Muted", "muted")}

      <span className="label">Backdrop image</span>
      <p className="caption secondary">Behind the page here, and behind the pages on the client's signing page. Not in the PDF.</p>
      {picker(backIn, (id) => set({ backdropImage: { fileId: id } }))}
      <div className="wsb-imgrow">{style.backdropImage ? <><img src={files[style.backdropImage.fileId] ?? undefined} alt="" /><button className="btn ghost sm" onClick={() => set({ backdropImage: null })}><X size={13} />Remove</button></> : <button className="btn ghost sm" onClick={() => backIn.current?.click()} disabled={busy === "image"}><ImageIcon size={13} />Add an image</button>}</div>

      <span className="label">Cover</span>
      {picker(coverIn, (id) => set({ cover: { fileId: id, height: 140 } }))}
      <div className="wsb-imgrow">{style.cover ? <><img src={files[style.cover.fileId] ?? undefined} alt="" /><label className="wsb-num">Height <input type="number" min={40} max={400} value={style.cover.height} onChange={(e) => set({ cover: { ...style.cover!, height: Math.max(40, Math.min(400, Number(e.target.value) || 140)) } })} /></label><button className="btn ghost sm" onClick={() => set({ cover: null })}><X size={13} />Remove</button></> : <button className="btn ghost sm" onClick={() => coverIn.current?.click()} disabled={busy === "image"}><ImageIcon size={13} />Add a cover image</button>}</div>

      <span className="label">Logo</span>
      {picker(logoIn, (id) => set({ logo: { fileId: id, width: 120, align: "left" } }))}
      <div className="wsb-imgrow">{style.logo ? <>
        <img src={files[style.logo.fileId] ?? undefined} alt="" />
        <label className="wsb-num">Width <input type="number" min={30} max={400} value={style.logo.width} onChange={(e) => set({ logo: { ...style.logo!, width: Math.max(30, Math.min(400, Number(e.target.value) || 120)) } })} /></label>
        <select className="input sm" value={style.logo.align} onChange={(e) => set({ logo: { ...style.logo!, align: e.target.value as "left" } })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select>
        <button className="btn ghost sm" onClick={() => set({ logo: null })}><X size={13} />Remove</button>
      </> : <button className="btn ghost sm" onClick={() => logoIn.current?.click()} disabled={busy === "image"}><Upload size={13} />Upload your logo</button>}</div>

      <span className="label">Separator</span>
      <p className="caption secondary">How Divider blocks look (add one from Insert).</p>
      <div className="ws-seg">{(["line", "thick", "dots", "none"] as const).map((x) => <button key={x} className={style.separator === x ? "on" : ""} onClick={() => set({ separator: x })}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>

      <span className="label">Fonts</span>
      <FontPicker label="Headings" value={style.fonts.heading} fonts={fonts} onChange={(f) => set({ fonts: { ...style.fonts, heading: f } })} show={show} />
      <FontPicker label="Body" value={style.fonts.body} fonts={fonts} onChange={(f) => set({ fonts: { ...style.fonts, body: f } })} show={show} />

      <span className="label">Page</span>
      <div className="ws-row2">
        <label className="field"><span className="ws-flabel">Size</span><select className="input sm" value={style.pageSize} onChange={(e) => set({ pageSize: e.target.value as "LETTER" })}><option value="LETTER">US Letter</option><option value="A4">A4</option></select></label>
        <label className="field"><span className="ws-flabel">Margins (pt)</span><input className="input sm" type="number" min={24} max={120} value={style.margin} onChange={(e) => set({ margin: Math.max(24, Math.min(120, Number(e.target.value) || 60)) })} /></label>
        <label className="field"><span className="ws-flabel">Text size (pt)</span><input className="input sm" type="number" min={8} max={16} step={0.5} value={style.baseSize} onChange={(e) => set({ baseSize: Math.max(8, Math.min(16, Number(e.target.value) || 10.5)) })} /></label>
        <label className="wsb-check" style={{ alignSelf: "end" }}><input type="checkbox" checked={style.footer} onChange={(e) => set({ footer: e.target.checked })} />Page numbers</label>
      </div>

      {gallery && styles && (
        <Modal onClose={() => setGallery(false)} label="Style gallery" width={760}>
          <div style={{ display: "grid", gap: 14 }}>
            <div className="dhead"><h2 className="headline">Style gallery</h2><button className="icon-btn" onClick={() => setGallery(false)} aria-label="Close"><X size={18} /></button></div>
            {styles.saved.length > 0 && <><span className="label">Your styles</span><div className="wsb-gallery">
              {styles.saved.map((s) => <StyleCard key={s._id} s={s.style} files={files} isDefault={s.isDefault} onPick={() => { onChange(s.style); setGallery(false); }}
                onDefault={() => void setDefault({ styleId: s._id as Id<"wsStyles"> }).then(() => show(`New documents start with "${s.name}"`))}
                onDelete={async () => { if (await confirm({ title: `Delete the style "${s.name}"?`, body: "Documents already using it keep their look." })) void deleteStyle({ styleId: s._id as Id<"wsStyles"> }); }} />)}
            </div></>}
            <span className="label">Wrangler's styles</span>
            <div className="wsb-gallery">
              {styles.presets.map((p) => <StyleCard key={p.index} s={p.style} files={files} isDefault={p.isDefault} onPick={() => { onChange({ ...p.style, logo: style.logo, cover: style.cover }); setGallery(false); }} onDefault={() => void setDefault({ preset: p.index }).then(() => show(`New documents start with "${p.style.name}"`))} />)}
            </div>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}

function cardBg(s: Style, files: Record<string, string | null>): React.CSSProperties {
  const img = s.backdropImage ? files[s.backdropImage.fileId] : null;
  return { background: img ? `center / cover url(${img})` : s.backdrop };
}

function StyleCard({ s, files, isDefault, onPick, onDefault, onDelete }: { s: Style; files: Record<string, string | null>; isDefault: boolean; onPick: () => void; onDefault: () => void; onDelete?: () => void }) {
  return (
    <div className="wsb-stylecard" style={cardBg(s, files)}>
      <button className="wsb-mini" onClick={onPick} style={{ background: s.page, color: s.heading, fontFamily: cssFamily(s.fonts.heading.family), borderTop: `3px solid ${s.accent}` }}>{s.name}</button>
      <div className="wsb-cardtools">
        <button className={`icon-btn${isDefault ? " on" : ""}`} title={isDefault ? "New documents start with this" : "Use for new documents"} aria-label="Use for new documents" onClick={onDefault}><Star size={13} /></button>
        {onDelete && <button className="icon-btn" title="Delete style" aria-label="Delete style" onClick={onDelete}><Trash2 size={13} /></button>}
      </div>
    </div>
  );
}

// ---------- fonts ----------

function FontPicker({ label, value, fonts, onChange, show }: { label: string; value: FontRef; fonts: FontRow[]; onChange: (f: FontRef) => void; show: (m: string) => void }) {
  const ensure = useAction(api.builder.ensureGoogleFont);
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const addFont = useAction(api.builder.addFont);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LocalFont[] | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const yours = [...new Set(fonts.filter((f) => f.source !== "google").map((f) => f.family))];
  const google = async (family: string) => {
    setBusy(true);
    try { await ensure({ family }); onChange({ family, source: "google" }); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const upload = async (file: File, family: string, weight: number, italic: boolean, source: "upload" | "local") => {
    const id = await uploadToStorage(await uploadUrl({}), file);
    await addFont({ storageId: id, family, weight, italic, fileName: file.name, source });
  };
  const fromFile = async (files: FileList | null) => {
    if (!files?.length) return;
    const family = window.prompt("Font family name (as it should appear)", files[0].name.replace(/[-_ ]?(regular|bold|italic|bolditalic|medium|light)?\.(ttf|otf)$/i, ""))?.trim();
    if (!family) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) { const s = styleOf(f.name.replace(/\.(ttf|otf)$/i, "")); await upload(f, family, s.weight, s.italic, "upload"); }
      onChange({ family, source: "custom" }); show(`Added ${family}`);
    } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const fromComputer = async () => {
    try { setLocal(await localFonts()); } catch (e) { show(`This browser didn't share its fonts: ${errText(e)}`); }
  };
  const pickLocal = async (family: string) => {
    if (!local) return;
    setBusy(true);
    try {
      // Regular, bold, italic and bold italic, if the family has them.
      const faces = local.filter((f) => f.family === family);
      const want = (w: number, i: boolean) => faces.find((f) => { const s = styleOf(f.style); return s.weight === w && s.italic === i; });
      const chosen = [want(400, false) ?? faces[0], want(700, false), want(400, true), want(700, true)].filter((x, i, a): x is LocalFont => !!x && a.indexOf(x) === i);
      for (const f of chosen) { const s = styleOf(f.style); const blob = await f.blob(); await upload(new File([blob], `${f.postscriptName}.ttf`), family, s.weight, s.italic, "local"); }
      onChange({ family, source: "custom" }); setLocal(null); show(`Added ${family} from this computer`);
    } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="wsb-font">
      <span className="ws-flabel">{label} · <span style={{ fontFamily: cssFamily(value.family) }}>{value.family}</span> {busy && <Spinner />}</span>
      <div className="wsb-fontquick">{Object.entries(BUILTIN_FONTS).map(([k, fam]) => <button key={k} className={`btn sm ${value.family === fam ? "primary" : "ghost"}`} onClick={() => void google(fam)} style={{ fontFamily: cssFamily(fam) }}>{k === "Default" ? "Aa Default" : k === "Serif" ? "Ss" : k === "Mono" ? "00" : "Rr"}</button>)}</div>
      <select className="input sm" value="" onChange={(e) => { const v = e.target.value; if (!v) return; if (v === "__other") { const fam = window.prompt("Google Fonts family (e.g. Playfair Display)")?.trim(); if (fam) void google(fam); } else if (v.startsWith("yours:")) onChange({ family: v.slice(6), source: "custom" }); else void google(v); }}>
        <option value="">More fonts…</option>
        {yours.length > 0 && <optgroup label="Your fonts">{yours.map((f) => <option key={f} value={`yours:${f}`}>{f}</option>)}</optgroup>}
        <optgroup label="Google Fonts">{GOOGLE_PICKS.map((f) => <option key={f} value={f}>{f}</option>)}<option value="__other">Another Google font…</option></optgroup>
      </select>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input ref={fileIn} type="file" accept=".ttf,.otf,font/ttf,font/otf" multiple hidden onChange={(e) => { void fromFile(e.target.files); e.target.value = ""; }} />
        <button className="btn ghost sm" onClick={() => fileIn.current?.click()} disabled={busy}><Upload size={13} />Upload a font file</button>
        {canReadLocalFonts() && <button className="btn ghost sm" onClick={() => void fromComputer()} disabled={busy}><Laptop size={13} />From this computer</button>}
      </div>
      {local && <LocalFonts list={local} onClose={() => setLocal(null)} onPick={(f) => void pickLocal(f)} busy={busy} />}
    </div>
  );
}

function LocalFonts({ list, onClose, onPick, busy }: { list: LocalFont[]; onClose: () => void; onPick: (family: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const families = [...new Set(list.map((f) => f.family))].sort().filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal onClose={onClose} label="Fonts on this computer" width={480}>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="dhead"><h2 className="headline">Fonts on this computer</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <p className="caption secondary">The one you pick is uploaded (regular, bold and italics) so the PDF can embed it. Check the font's licence allows embedding in documents.</p>
        <input className="input sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="wsb-locallist">{families.slice(0, 300).map((f) => <button key={f} className="wsb-libitem" disabled={busy} onClick={() => onPick(f)}>{f}</button>)}</div>
      </div>
    </Modal>
  );
}

