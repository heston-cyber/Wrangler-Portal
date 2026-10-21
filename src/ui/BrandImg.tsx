// Wrangler artwork in the right colour for the theme.
// The wordmark is one solid colour: white on dark, black on light (Heston, Oct 21). The spark is cream on dark, ink on light.
import { asset } from "../config";
import { useTheme } from "../lib/theme";

const FILES = {
  wordmark: { dark: "/brand/wordmark-cream.png", light: "/brand/wordmark-cream.png" }, // tinted solid by .brand-mono
  spark: { dark: "/brand/spark-cream.png", light: "/brand/spark-ink.png" },
  watermark: { dark: "/brand/spark-watermark.png", light: "/brand/spark-watermark-ink.png" },
} as const;

export function BrandImg({ name, className, alt = "", hidden }: { name: keyof typeof FILES; className?: string; alt?: string; hidden?: boolean }) {
  const { theme } = useTheme();
  const cls = [className, name === "wordmark" ? "brand-mono" : null].filter(Boolean).join(" ") || undefined;
  return <img className={cls} src={asset(FILES[name][theme])} alt={alt} aria-hidden={hidden || undefined} />;
}
