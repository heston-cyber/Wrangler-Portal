// Phase 2 Part A (Oct 29, D24): the business's logo over review copies, for clients and guests (not the owner),
// unless it's switched off on the client. The look (corner, size, opacity) is set in Settings › Business.
// Nov 2 (Heston): a center position, and your own text: the logo, the text, or both. Text with nothing typed shows the logo.
import wpLogo from "../../../assets/d1/wp-logo.png";

export type WatermarkLook = { corner: "tl" | "tr" | "bl" | "br" | "c"; size: "small" | "large"; opacity: number; mark?: "logo" | "text" | "both"; text?: string; logoUrl?: string | null };

export function Watermark({ look, className }: { look: WatermarkLook; className?: string }) {
  const text = (look.text ?? "").trim();
  const mark = text ? look.mark ?? "logo" : "logo";
  const logo = look.logoUrl ? <img src={look.logoUrl} alt="" draggable={false} /> : <><i className="rec" /><img src={wpLogo} alt="" draggable={false} /></>;
  return (
    <span className={`wp-watermark ${look.corner} ${look.size}${className ? ` ${className}` : ""}`} style={{ opacity: look.opacity }} aria-hidden>
      {mark !== "text" && logo}
      {mark !== "logo" && <span className="wm-text">{text}</span>}
    </span>
  );
}
