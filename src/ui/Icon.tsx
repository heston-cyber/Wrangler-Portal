// The portal's icons (Figma "02 · Components › Icons", 49 red wireframe icons: 1.5 px strokes on a 24 px grid,
// square anchor points, a soft glow). The files in assets/icons are the Figma exports with the red turned into
// currentColor, so an icon takes the business accent; see docs/ICONS.md for how they are refreshed from Figma.
const files = import.meta.glob("../assets/icons/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const SVG: Record<string, string> = {};
for (const [path, raw] of Object.entries(files)) SVG[path.slice(path.lastIndexOf("/") + 1, -4)] = raw;

export type IconName =
  | "activity" | "alert" | "arrow-down" | "arrow-left" | "arrow-right" | "arrow-up-right" | "arrow-up" | "bell" | "calendar"
  | "check-circle" | "check" | "chevron-down" | "chevron-right" | "clock" | "close" | "document" | "download" | "edit" | "external"
  | "eye" | "folder" | "globe" | "home" | "inbox" | "info" | "invoice" | "lock" | "mail" | "map-pin" | "menu" | "minus"
  | "more" | "note" | "pause" | "phone" | "play" | "plus" | "quote" | "register" | "review" | "search" | "send"
  | "settings" | "sign-out" | "sign" | "stage" | "upload" | "user" | "users" | "video";

export const ICON_NAMES = Object.keys(SVG).sort() as IconName[];

/** One icon. size in px (the design uses 12–24); label makes it announced, otherwise it's decorative. */
export function Icon({ name, size = 24, label, className, plain, style }: {
  name: IconName; size?: number; label?: string; className?: string; plain?: boolean; style?: React.CSSProperties;
}) {
  return (
    <span
      className={`wp-icon${plain ? " plain" : ""}${className ? " " + className : ""}`}
      style={{ width: size, height: size, ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: SVG[name] ?? "" }}
    />
  );
}
