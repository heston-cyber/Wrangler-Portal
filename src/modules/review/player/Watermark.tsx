// Phase 2 Part A (Oct 29, D24): the business's logo over review copies, for clients and guests (not the owner),
// unless it's switched off on the client. The look (corner, size, opacity) is set in Settings › Business.
import wpLogo from "../../../assets/d1/wp-logo.png";

export type WatermarkLook = { corner: "tl" | "tr" | "bl" | "br"; size: "small" | "large"; opacity: number; logoUrl?: string | null };

export function Watermark({ look, className }: { look: WatermarkLook; className?: string }) {
  return (
    <span className={`wp-watermark ${look.corner} ${look.size}${className ? ` ${className}` : ""}`} style={{ opacity: look.opacity }} aria-hidden>
      {look.logoUrl ? <img src={look.logoUrl} alt="" draggable={false} /> : <><i className="rec" /><img src={wpLogo} alt="" draggable={false} /></>}
    </span>
  );
}
