// The page's background light, with the glass layer on the cactus scene (src/lib/glass.ts).
import { useEffect, useRef } from "react";
import { startGlass } from "../lib/glass";

export function Light({ className, src }: { className: string; src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; let stop = () => {}; const t = requestAnimationFrame(() => { stop = startGlass(el); }); return () => { cancelAnimationFrame(t); stop(); }; }, []);
  return <div ref={ref} className={className} aria-hidden><i style={{ backgroundImage: `url(${src})` }} /></div>;
}
