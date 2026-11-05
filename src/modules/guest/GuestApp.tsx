// Phase 5b step 4 (Nov 3) · call-sheet guests (D127): everything a guest sees. Frames (S5 · Phase 5b): Sign in · Before
// code 768:6282, Code sent 768:6309 (phone 768:6342), Call sheet 769:6274 (phone 769:6466), Access ended 768:6374 (phone
// 768:6403). The list of their sheets (more than one) has no frame of its own: the sheet page's look.
//   /guest/<token>  the link in email 41: sign in with an emailed code, then that sheet (or Access ended)
//   /guest          signed in: their sheets (one goes straight to it), or Access ended when none is active
// A guest login sees only these pages, whatever address it opens (App.tsx); the server checks every call again.
import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandImg } from "../../ui/BrandImg";
import { Icon } from "../../ui/Icon";
import { Avatar, Button, Spinner } from "../../ui/wp";
import { Menu, MenuItem } from "../../ui/kit";
import { linkProps } from "../../lib/router";
import smear from "../../assets/portal/light-smear.jpg";
import softblob from "../../assets/portal/light-softblob.jpg";
import { clockOf, sheetDay } from "../../../convex/lib/callSheet";
import { SheetReader } from "../production/SheetReader";
import { errText } from "../docs/pages/common";

type Me = { name: string | null; email: string; role: string | null };
type Intro = FunctionReturnType<typeof api.guests.intro>;
type Home = FunctionReturnType<typeof api.guests.home>;
type Biz = { name: string; legalName: string | null };
// Q88 (Nov 4): the access wording Heston approved.
const ACCESS_LINE = "You can read this call sheet until the day after its shoot.";
const mdOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const legalLine = (b: Biz | null) => (b ? (b.legalName ? `${b.name}, a DBA of ${b.legalName}` : b.name) : "WranglerPortal");
const errMsg = (e: unknown) => { const t = errText(e); return /^Uncaught|\[CONVEX|Server Error/.test(t) || !t ? "Something went wrong. Try again." : t; };

export default function GuestApp({ token }: { token: string | null }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip") as Me | null | undefined;
  useEffect(() => { document.title = "Call sheet · WranglerPortal"; }, []);
  if (isLoading || (isAuthenticated && me === undefined)) return <Center><p className="wsx-wait"><Spinner /> Opening…</p></Center>;
  const guest = isAuthenticated && me?.role === "guest";
  if (token && guest) return <GuestSheet key={token} token={token} me={me!} />;
  if (token) return <GuestSignIn key={token} token={token} signedInAs={isAuthenticated ? me ?? null : null} />;
  if (guest) return <GuestHome me={me!} />;
  return <Center><Notice icon="mail" title="Open the call sheet link from your email." text="Each call sheet has its own link. Open it from the email that brought you here." /></Center>;
}

// ---------- the sign-in and system pages (the signer pages' look: smear light, glass card) ----------

function Center({ children, biz = null }: { children: React.ReactNode; biz?: Biz | null }) {
  return (
    <div className="wsx gst">
      <div className="wp-light signing" aria-hidden><i style={{ backgroundImage: `url(${smear})` }} /></div>
      <header className="wsx-top"><BrandImg name="wordmark" alt="WranglerPortal" /><span className="wsx-secure"><Icon name="lock" size={14} />Secure sign-in</span></header>
      <main className="wsx-main">{children}</main>
      <footer className="wsx-foot">{legalLine(biz)} · Questions? Reply to the email that brought you here.</footer>
    </div>
  );
}

function Notice({ icon, title, sub, text, children }: { icon: "clock" | "alert" | "mail"; title: string; sub?: string; text?: string; children?: React.ReactNode }) {
  return <div className="wsx-card glass"><span className="gst-ico"><Icon name={icon} size={24} /></span><h1 className="headline">{title}</h1>{sub && <p className="caption secondary">{sub}</p>}{text && <p className="caption">{text}</p>}{children}</div>;
}

/** Access ended (768:6374, 768:6403). */
function Ended({ title, date, biz, children }: { title?: string | null; date?: string | null; biz?: Biz | null; children?: React.ReactNode }) {
  return <Center biz={biz ?? null}><Notice icon="clock" title="This call sheet is no longer available." sub={[title, date ? sheetDay(date) : null].filter(Boolean).join(" · ") || undefined} text="Your access to it has ended. Questions? Reply to the email that brought you here.">{children}</Notice></Center>;
}
const BackToList = () => <p className="caption"><a className="wp-link" {...linkProps("/guest")}>All your call sheets</a></p>;

/** Sign in · Before code (768:6282) and Code sent (768:6309, 768:6342). */
function GuestSignIn({ token, signedInAs }: { token: string; signedInAs: Me | null }) {
  const intro = useQuery(api.guests.intro, { token }) as Intro | undefined;
  const sendCode = useAction(api.guests.sendCode);
  const { signIn, signOut } = useAuthActions();
  const [sent, setSent] = useState<{ to: string; minutes: number } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (intro === undefined) return <Center><p className="wsx-wait"><Spinner /> Opening…</p></Center>;
  if (intro.state === "missing") return <Center><Notice icon="alert" title="This link doesn't go anywhere." text="Open the newest email about the call sheet, or reply to it and ask for a new link." /></Center>;
  if (intro.state === "ended") return <Ended title={intro.title} date={intro.date} biz={intro.business} />;
  const ask = async (again: boolean) => {
    setBusy("send"); setErr(null); setNote(null);
    try { const r = await sendCode({ token }); setSent(r); setCode(""); if (again) setNote("A new code is on its way."); setTimeout(() => input.current?.focus(), 50); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };
  const check = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6) return;
    setBusy("check"); setErr(null);
    try { await signIn("guest", { token, code }); }
    catch (x) { setErr(errMsg(x)); setBusy(null); }
  };
  const from = intro.business.owner ? `${intro.business.owner} at ${intro.business.name}` : intro.business.name;
  return (
    <Center biz={intro.business}>
      <form className="wsx-card glass gst-card" onSubmit={(e) => void check(e)}>
        <span className="wp-eyebrow">Call sheet</span>
        <h1 className="headline">{intro.title}</h1>
        {signedInAs && <p className="caption secondary">You’re signed in as {signedInAs.email}. This link is for {intro.name}. <button type="button" className="wp-link" onClick={() => void signOut()}>Sign out</button></p>}
        {!sent ? <>
          <p className="caption">{from} added you to the call sheet for {intro.dayLong}, {intro.name}.</p>
          <p className="caption">First, confirm it’s you: we’ll email a 6-digit code to {intro.email}.</p>
          {err && <p className="wsx-err" role="alert">{err}</p>}
          <div className="wsx-btns"><Button variant="primary" loading={busy === "send"} onClick={() => void ask(false)}>Email me a code</Button></div>
        </> : <>
          <p className="caption">We sent a 6-digit code to {sent.to}. It works for {sent.minutes} minutes.</p>
          {note && <p className="caption secondary" role="status">{note}</p>}
          <div className="wp-field">
            <label className="wp-field-label" htmlFor="gst-code">Code</label>
            <input ref={input} id="gst-code" className="input wsx-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
              onChange={(e) => { const c = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(c); }} aria-invalid={err ? true : undefined} />
          </div>
          {err && <p className="wsx-err" role="alert">{err}</p>}
          <div className="wsx-btns">
            <Button variant="primary" type="submit" loading={busy === "check"} disabled={code.length !== 6}>Continue</Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => void ask(true)}>Send another code</Button>
          </div>
        </>}
        <p className="caption secondary gst-small">{ACCESS_LINE}</p>
      </form>
    </Center>
  );
}

// ---------- signed in ----------

/** The signed-in pages' frame (769:6274): the softblob light, the logo, who's signed in, Sign out. */
function Page({ me, children, back, switcher }: { me: Me; children: React.ReactNode; back?: boolean; switcher?: React.ReactNode }) {
  const { signOut } = useAuthActions();
  const [menu, setMenu] = useState(false);
  const out = () => void signOut();
  return (
    <div className="gst-page">
      <div className="wp-light back" aria-hidden><i style={{ backgroundImage: `url(${softblob})` }} /></div>
      <header className="gst-top">
        <span className="gst-brand"><a {...linkProps("/guest")} aria-label="Your call sheets"><BrandImg name="wordmark" alt="WranglerPortal" /></a>{switcher && <span className="gst-wide">{switcher}</span>}</span>
        <span className="gst-who gst-wide">{back && <a {...linkProps("/guest")} className="gst-backlink">All your call sheets</a>}<span>{me.name ?? me.email} · Guest</span><button type="button" className="wp-link" onClick={out}>Sign out</button></span>
        <span className="gst-avatar gst-narrow">
          <button type="button" aria-label={`${me.name ?? me.email} · Guest`} aria-expanded={menu} onClick={() => setMenu(!menu)}><Avatar name={me.name ?? me.email} size={32} /></button>
          {menu && <span className="gst-menu glass" role="menu">
            <span className="secondary">{me.name ?? me.email} · Guest</span>
            {back && <a {...linkProps("/guest")} role="menuitem">All your call sheets</a>}
            <button type="button" role="menuitem" className="wp-link" onClick={out}>Sign out</button>
          </span>}
        </span>
      </header>
      {switcher && <div className="gst-narrow gst-swphone">{switcher}</div>}
      {children}
    </div>
  );
}

/** "Sheets from" (859:9250, phone 859:9572): the vendor switcher's menu, only when more than one business has sent them
 *  a sheet; "N new" is how many of that business's sheets they haven't opened yet. */
function SheetsFrom({ d, onPick }: { d: Home; onPick: (b: Id<"businesses">) => void }) {
  const current = d.businesses.find((b) => b.businessId === d.businessId);
  if (d.businesses.length < 2 || !current) return null;
  return (
    <Menu label="Businesses you work for" trigger={(p) => (
      <button {...p} className="vp-switch gst-switch" type="button"><span className="wp-label">Sheets from</span><b>{current.name}</b><Icon name="chevron-down" size={16} /></button>
    )}>
      <div className="mlabel">Businesses you work for</div>
      {d.businesses.map((b) => (
        <MenuItem key={b.businessId} onSelect={() => onPick(b.businessId)}>
          <span className="vp-swrow"><span>{b.name}</span>{b.businessId === d.businessId ? <Icon name="check" size={14} plain /> : b.fresh ? <span className="secondary">{b.fresh} new</span> : null}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** /guest (858:94294, phone 859:9381): their sheets in Today, Upcoming and Ended (Q88: ended ones stay, dimmed, and open
 *  Access ended). Just one active sheet and nothing else goes straight to it. */
function GuestHome({ me }: { me: Me }) {
  const [biz, setBiz] = useState<Id<"businesses"> | undefined>(undefined);
  const d = useQuery(api.guests.home, biz ? { businessId: biz } : {});
  const one = d && d.sheets.length === 1 && d.sheets[0].state !== "ended" && d.businesses.length <= 1 ? d.sheets[0].token : null;
  useEffect(() => { if (one) { history.replaceState(null, "", `/guest/${one}`); window.dispatchEvent(new Event("wr:navigate")); } }, [one]);
  if (d === undefined || one) return <Center><p className="wsx-wait"><Spinner /> Opening…</p></Center>;
  const switcher = <SheetsFrom d={d} onPick={setBiz} />;
  if (!d.sheets.length) return <Ended>{d.businesses.length > 1 && switcher}</Ended>;
  const groups = ([["today", "Today"], ["upcoming", "Upcoming"], ["ended", "Ended"]] as const).map(([k, label]) => [label, d.sheets.filter((x) => x.state === k)] as const).filter(([, xs]) => xs.length);
  return (
    <Page me={me} switcher={d.businesses.length > 1 ? switcher : undefined}>
      <main className="gst-list">
        <h1 className="wp-h2">Your call sheets</h1>
        <p className="secondary gst-lede">Every shoot you have been added to.<span className="gst-wide"> Each sheet opens until the day after its shoot.</span></p>
        {groups.map(([label, xs]) => (
          <section key={label} className="gst-group glass" aria-label={label}>
            <span className="wp-eyebrow">{label} <span className="n">{xs.length}</span></span>
            {xs.map((s) => {
              const ended = s.state === "ended";
              const sub = ended
                ? [sheetDay(s.date), s.endedOn ? `access ended ${mdOf(s.endedOn)}` : "access ended"]
                : [sheetDay(s.date), s.place, s.call ? `your call ${clockOf(s.call)}` : null];
              return (
                <a key={s.token} {...linkProps(`/guest/${s.token}`)} className={`gst-item${ended ? " ended" : ""}`}>
                  <Icon name="document" size={20} />
                  <span className="txt"><span className="t"><b>{s.title}</b>{s.updatedToday && <span className="gst-chip warn">Updated today</span>}{ended && <span className="gst-chip">Ended</span>}</span>
                    <span className="secondary">{sub.filter(Boolean).join(" · ")}</span></span>
                  <Icon name="chevron-right" size={18} />
                </a>
              );
            })}
          </section>
        ))}
        <p className="wp-small secondary">You can read each call sheet until the day after its shoot.</p>
      </main>
    </Page>
  );
}

/** /guest/<token> signed in: the sheet (769:6274 desktop, 769:6466 phone), or Access ended. */
function GuestSheet({ token, me }: { token: string; me: Me }) {
  const d = useQuery(api.guests.sheet, { token });
  const open = useMutation(api.guests.opened);
  const done = useRef(false);
  const many = useQuery(api.guests.home, {});
  useEffect(() => { if (d && !d.ended && !done.current) { done.current = true; void open({ token }).catch(() => undefined); } }, [d, token, open]);
  useEffect(() => { if (d && !d.ended) document.title = `Call sheet · ${d.title}`; }, [d]);
  if (d === undefined) return <Center><p className="wsx-wait"><Spinner /> Opening…</p></Center>;
  if (d === null) return <GuestSignIn token={token} signedInAs={me} />; // someone else's link: sign in as them, or not at all
  if (d.ended) return <Ended title={d.title} date={d.date} biz={d.business}>{(many?.sheets.length ?? 0) > 1 && <BackToList />}</Ended>;
  return <Page me={me} back={(many?.sheets.length ?? 0) > 1}><SheetReader d={d} /><p className="gst-foot gst-footline">{ACCESS_LINE}</p></Page>;
}
