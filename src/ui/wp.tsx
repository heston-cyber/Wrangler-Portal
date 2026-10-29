// The portal's components (Figma "02 · Components"), built on the classes in portal.css. Pages use these instead
// of raw markup so every screen matches the approved design. Copy on the components comes from the page.
import { forwardRef, useId, useState } from "react";
import { linkProps } from "../lib/router";
import { Icon, type IconName } from "./Icon";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Button ----------
type ButtonStyle = "primary" | "secondary" | "ghost" | "danger";
type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  variant?: ButtonStyle; size?: "md" | "sm"; loading?: boolean; icon?: IconName; style?: React.CSSProperties;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx("btn", variant !== "secondary" && variant, size === "sm" && "sm", loading && "loading", className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
      {loading && <span className="wp-spin" aria-hidden />}
    </button>
  );
});

/** A link that looks like a button (goes through the app's router). */
export function ButtonLink({ to, variant = "secondary", size = "md", icon, children, className }: { to: string; variant?: ButtonStyle; size?: "md" | "sm"; icon?: IconName; children: React.ReactNode; className?: string }) {
  return (
    <a {...linkProps(to)} className={cx("btn", variant !== "secondary" && variant, size === "sm" && "sm", className)}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}{children}
    </a>
  );
}

// ---------- Icon button ----------
export const IconButton = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: IconName; label: string; touch?: boolean; on?: boolean; bare?: boolean; iconSize?: number }>(
  function IconButton({ icon, label, touch, on, bare, iconSize = 20, className, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={cx("icon-btn", touch && "touch", on && "on", bare && "bare", className)} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : on} {...rest}>
        <Icon name={icon} size={iconSize} />
      </button>
    );
  },
);

// ---------- Fields ----------
export function Field({ label, hint, error, children, className }: { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: (id: string, describedBy?: string) => React.ReactNode; className?: string }) {
  const id = useId();
  const desc = error || hint ? `${id}-d` : undefined;
  return (
    <div className={cx("wp-field", className)}>
      {label && <label className="wp-field-label" htmlFor={id}>{label}</label>}
      {children(id, desc)}
      {error ? <span id={desc} className="wp-field-error" role="alert">{error}</span> : hint ? <span id={desc} className="wp-field-hint">{hint}</span> : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode };
export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField({ label, hint, error, className, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => <input ref={ref} id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={d} {...rest} />}
    </Field>
  );
});

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; compact?: boolean };
export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ label, hint, error, className, compact, rows, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => <textarea ref={ref} id={id} className="input" rows={rows ?? (compact ? 3 : 4)} aria-invalid={error ? true : undefined} aria-describedby={d} {...rest} />}
    </Field>
  );
});

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="wp-toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden /><span className="knob" aria-hidden />
    </span>
  );
}

export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="check" style={{ alignItems: "flex-start" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" aria-hidden>{checked && <Icon name="check" size={14} plain style={{ color: "var(--on-accent)", ["--icon-ground" as string]: "var(--accent)" }} />}</span>
      <span style={{ display: "grid", gap: 2 }}>
        <span>{label}</span>
        {hint && <span className="wp-small" style={{ fontWeight: 400 }}>{hint}</span>}
      </span>
    </label>
  );
}

// ---------- Tabs ----------
export type TabItem<K extends string> = { key: K; label: React.ReactNode; count?: number | string };
/** Underline tabs (Tab). */
export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="wp-utabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} role="tab" type="button" className="wp-utab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="secondary">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
/** Filter pills (Pill tab). */
export function PillTabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} role="tab" type="button" className="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
/** Segmented control (Segment). */
export function Segmented<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="wp-seg" role="group" aria-label={label}>
      {items.map((t) => <button key={t.key} type="button" aria-pressed={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>)}
    </div>
  );
}

// ---------- Chips, badges ----------
export type Tone = "accent" | "success" | "warning" | "neutral" | "danger";
export function StatusChip({ tone = "accent", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`wp-status ${tone}`}>{children}</span>;
}
export function Badge({ n, label }: { n: number; label?: string }) {
  if (n <= 0) return null;
  return <span className="wp-badge" aria-label={label ?? `${n} unread`}>{n > 99 ? "99+" : n}</span>;
}
export const UnreadDot = ({ label = "Unread" }: { label?: string }) => <span className="wp-dot" role="img" aria-label={label} />;
/** "Maya Brooks" → "MB" (two), "M" (one). Email addresses use the part before the @. */
export function initials(name: string | null | undefined, two = false) {
  const words = (name || "?").trim().replace(/@.*/, "").split(/[\s._-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const first = (w: string | undefined) => [...(w ?? "")].find((c) => /[\p{L}\p{N}]/u.test(c))?.toUpperCase() ?? "";
  if (!words.length) return "?";
  return two && words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]) || "?";
}
export function Avatar({ name, size = 32, two }: { name: string | null | undefined; size?: number; two?: boolean }) {
  return <span className="avatar" style={{ width: size, height: size, flexBasis: size, fontSize: size >= 30 ? 12 : 11 }} aria-hidden>{initials(name, two)}</span>;
}

// ---------- Cards and lists ----------
/** A glass card holding rows, with an optional Section head. */
export function Card({ children, className, label, head }: { children: React.ReactNode; className?: string; label?: string; head?: React.ReactNode }) {
  return (
    <section className={cx("wp-card glass", className)} aria-label={label}>
      <div className="wp-rows">{head}{children}</div>
    </section>
  );
}
export function SectionHead({ label, count, action }: { label: string; count?: number | string; action?: React.ReactNode }) {
  return (
    <div className="wp-sechead">
      <span className="l">{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
      <span className="sp" />
      {action}
    </div>
  );
}
export const Divider = () => <hr className="wp-divider" />;

/** A row's picture; a still that fails to load shows the empty frame instead of a broken image. */
function LeadThumb({ cls, src }: { cls: string; src: string | null }) {
  const [bad, setBad] = useState<string | null>(null);
  return src && bad !== src ? <img className={cls} src={src} alt="" loading="lazy" onError={() => setBad(src)} /> : <span className={cls} aria-hidden />;
}
type Lead = { icon: IconName } | { thumb: string | null; size?: 96 | 72 | 64 | 56 } | { avatar: string | null; size?: number; two?: boolean } | null;
function LeadView({ lead }: { lead: Lead }) {
  if (!lead) return null;
  if ("icon" in lead) return <Icon name={lead.icon} size={20} className="lead-icon" />;
  if ("thumb" in lead) {
    const cls = cx("lead-thumb", lead.size && lead.size !== 96 && `t${lead.size}`);
    return <LeadThumb cls={cls} src={lead.thumb} />;
  }
  return <Avatar name={lead.avatar} size={lead.size ?? 32} two={lead.two} />;
}

/** List row. Give it `to` (a link), `onClick` (a button), or neither (static). */
export function ListRow({ lead = null, title, titleChip, meta, trailing, chip, action, chevron, to, onClick, selected, className, label }: {
  lead?: Lead; title: React.ReactNode; titleChip?: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode; chip?: React.ReactNode;
  action?: React.ReactNode; chevron?: boolean; to?: string; onClick?: () => void; selected?: boolean; className?: string; label?: string;
}) {
  const body = (
    <>
      <LeadView lead={lead} />
      <span className="txt">
        <span className="ttl"><span>{title}</span>{titleChip}</span>
        {meta && <span className="meta">{meta}</span>}
      </span>
      {trailing && <span className="trail">{trailing}</span>}
      {chip}
      {action}
      {chevron && <Icon name="chevron-right" size={16} className="chev" />}
    </>
  );
  const cls = cx("wp-row", className);
  if (to) return <a {...linkProps(to)} className={cls} aria-current={selected ? "page" : undefined} aria-label={label}>{body}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-selected={selected || undefined} aria-label={label}>{body}</button>;
  return <div className={cls} aria-selected={selected || undefined}>{body}</div>;
}

/** Inbox item: an icon, title and detail, an optional status and button, the time, and the unread dot. */
export function InboxItem({ icon, title, detail, status, action, time, unread, to, onClick, selected }: {
  icon: IconName; title: React.ReactNode; detail?: React.ReactNode; status?: React.ReactNode; action?: React.ReactNode; time?: React.ReactNode;
  unread?: boolean; to?: string; onClick?: () => void; selected?: boolean;
}) {
  const body = (
    <>
      <Icon name={icon} size={20} className="lead-icon" />
      <span className="txt">
        <span className="ttl"><span style={{ whiteSpace: "normal" }}>{title}</span></span>
        {detail && <span className="meta">{detail}</span>}
      </span>
      {action}
      {status && <span className="trail">{status}</span>}
      {time && <span className="time">{time}</span>}
      <span className="unread">{unread && <UnreadDot />}</span>
    </>
  );
  const cls = "wp-row inbox";
  if (to) return <a {...linkProps(to)} className={cls} aria-current={selected ? "page" : undefined}>{body}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-selected={selected || undefined}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function SkeletonRows({ n = 3, label = "Loading" }: { n?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="wp-skel" aria-hidden><span className="a" /><span className="ls"><span className="l1" /><span className="l2" /></span><span className="t" /></div>
      ))}
    </div>
  );
}

// ---------- Page header, empty state, dialog header ----------
export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="wp-pagehead">
      <div className="txt">
        {eyebrow && <span className="wp-eyebrow">{eyebrow}</span>}
        <h1 className="wp-h2">{title}</h1>
        {sub && <p className="wp-body">{sub}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon = "check-circle", title, body, actions }: { icon?: IconName; title: React.ReactNode; body?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="wp-empty glass">
      <span className="ring"><Icon name={icon} size={26} /></span>
      <h2 className="wp-h4">{title}</h2>
      {body && <p className="wp-body">{body}</p>}
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

export function DialogHeader({ eyebrow, title, body, onClose }: { eyebrow?: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="wp-dhead">
      <div className="txt">
        {eyebrow && <span className="wp-eyebrow">{eyebrow}</span>}
        <h2 className="wp-h4">{title}</h2>
        {body && <p className="wp-body">{body}</p>}
      </div>
      {onClose && <IconButton icon="close" label="Close" bare iconSize={18} className="x" onClick={onClose} />}
    </div>
  );
}

export const Spinner = ({ size = 16, label }: { size?: number; label?: string }) => (
  <span className="wp-spin" style={{ width: size, height: size }} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
);
