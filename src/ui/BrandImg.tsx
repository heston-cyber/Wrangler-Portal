// Wrangler artwork. Phase 1 (Oct 29): the wordmark is the approved Logo component (the business-accent REC dot and
// the WP mark, Figma 02 · Components › Logo); the spark and watermark files stay for the few places that use them.
import { asset } from "../config";
import wpLogo from "../assets/d1/wp-logo.png";

const FILES = {
  spark: "/brand/spark-cream.png",
  watermark: "/brand/spark-watermark.png",
} as const;

export function BrandImg({ name, className, alt = "", hidden }: { name: "wordmark" | keyof typeof FILES; className?: string; alt?: string; hidden?: boolean }) {
  if (name === "wordmark") {
    return (
      <span className={`wp-logo${className ? " " + className : ""}`} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={hidden || !alt || undefined}>
        <span className="rec" aria-hidden /><img src={wpLogo} alt="" />
      </span>
    );
  }
  return <img className={className} src={asset(FILES[name])} alt={alt} aria-hidden={hidden || undefined} />;
}
