// Nov 4 (Q88): a call sheet as the people on it read it, shared by the client side, the vendor side and guests. Frames
// (S5 · Phase 5b): client 857:8881, vendor 857:9240, phone 857:9610 and 857:9736 (the guest's own 769:6274 / 769:6466).
// The sheet as sent on the left; on the right "Updated today" (only on the day of the update, Central time), Your call
// and Producer. On a phone: the parts as cards, then the whole sheet behind "Read the whole sheet".
import { Icon } from "../../ui/Icon";
import { clockOf, locationOf, rowsOf, sheetDay, type ContactRow, type CrewRow, type ScheduleRow } from "../../../convex/lib/callSheet";
import { fill, nodesOf, pageOf, type Page } from "../../../convex/lib/wsBuilder";
import { SheetView } from "./callSheetParts";

export type ReaderData = {
  title: string; date: string; page: unknown; values: Record<string, string>; accent: string | null;
  business: string; owner: string; replyTo: string; me: { call: string };
  updatedToday: boolean; change: { at: number; text: string } | null;
};

/** The sheet and its side cards. `head` shows the page heading on wide screens too (the client and vendor pages). */
export function SheetReader({ d, head = false }: { d: ReaderData; head?: boolean }) {
  const page = pageOf(d.page) as Page;
  const loc = locationOf(nodesOf(page, "location")[0]);
  const t = (s: string) => fill(s ?? "", d.values, "");
  const schedule = nodesOf(page, "schedule").flatMap((n) => rowsOf<ScheduleRow>(n));
  const crew = nodesOf(page, "crew").flatMap((n) => rowsOf<CrewRow>(n));
  const contacts = nodesOf(page, "contacts").flatMap((n) => rowsOf<ContactRow>(n));
  const producer = contacts.find((c) => /producer/i.test(c.label));
  const phone = producer?.phone ? t(producer.phone) : "";
  const place = t(loc.name) || "";
  const day = sheetDay(d.date);
  const mail = `mailto:${d.replyTo}?${new URLSearchParams({ subject: `Call sheet for ${day}: ${d.title}` }).toString().replace(/\+/g, "%20")}`;
  const dl = (rows: Array<[string, React.ReactNode]>) => <dl className="gst-dl">{rows.filter(([, v]) => v).map(([k, v], i) => <div key={`${k}${i}`}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
  // Only on the day of the update; the next day the sheet reads as it is, with no banner.
  const updated = d.updatedToday && d.change && (
    <section className="gst-card glass" role="status"><span className="wp-eyebrow">Updated today</span>
      <p>{/[.!?]$/.test(d.change.text) ? d.change.text : `${d.change.text}.`}{d.me.call ? (d.change.text.includes(clockOf(d.me.call)) ? " That’s your call time." : ` Your call is ${clockOf(d.me.call)}.`) : ""}</p>
    </section>
  );
  const yours = (
    <section className="gst-card glass gst-yours"><span className="wp-eyebrow">Your call</span>
      {dl([["Call", d.me.call ? <b className="big">{clockOf(d.me.call)}</b> : "See the sheet"], ["Wrap", loc.wrap ? clockOf(loc.wrap) : ""], ["Where", place]])}
    </section>
  );
  const producerCard = (
    <section className="gst-card glass"><span className="wp-eyebrow">Producer</span>
      {dl([[producer ? t(producer.name) || d.owner : d.owner, d.business]])}
      <div className="gst-btns"><a className="btn outline sm" href={mail}>Email</a>{phone && <a className="btn outline sm" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>Call</a>}</div>
    </section>
  );
  return (
    <main className={`gst-main${head ? " csr" : ""}`}>
      <header className={`gst-head${head ? " csr-head" : " gst-narrow"}`}>
        <span className="wp-eyebrow">Call sheet</span>
        <h1 className="wp-h2">{d.title}</h1>
        <span className="secondary">{[day, place].filter(Boolean).join(" · ")}{head ? <span className="gst-wide">. You are reading it as {d.business} last sent it.</span> : null}</span>
      </header>
      <div className="gst-paper gst-wide"><SheetView page={page} values={d.values} accent={d.accent} /></div>
      <aside className="gst-side">
        {updated}{yours}
        {schedule.length > 0 && <section className="gst-card glass gst-narrow"><span className="wp-eyebrow">Schedule</span>{dl(schedule.map((r) => [clockOf(r.time) || "·", t(r.what)] as [string, string]))}</section>}
        {(place || loc.address || loc.parking) && <section className="gst-card glass gst-narrow"><span className="wp-eyebrow">Where</span>{dl([[place || "Location", t(loc.address)], ["Parking", t(loc.parking)]])}</section>}
        {crew.length > 0 && <section className="gst-card glass gst-narrow"><span className="wp-eyebrow">Who’s on it</span>{dl(crew.map((r) => [t(r.name), t(r.role).replace(/ \(guest\)$/, "")] as [string, string]))}</section>}
        {producerCard}
        <details className="gst-card glass gst-narrow gst-whole">
          <summary><span className="wp-eyebrow">The whole sheet</span>
            <span className="csr-whole"><Icon name="document" size={18} /><span className="txt"><b>Read the whole sheet</b><span className="secondary">The call sheet as a page, as {d.business} last sent it.</span></span><Icon name="chevron-down" size={18} /></span>
          </summary>
          <SheetView page={page} values={d.values} accent={d.accent} />
        </details>
      </aside>
    </main>
  );
}
