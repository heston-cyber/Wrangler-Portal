// Phase 5b step 3 (Nov 3): a call sheet as the people on it read it, from email 40's link: the client's people on the
// client side (/call-sheets/<id>) and booked vendors on the vendor side (/vendor/call-sheets/<id>). Opening it records
// "opened" for that person. No frame of its own: the client's Shoot page layout above the sheet itself (desktop and
// phone, like Detail's phone frame 769:7589).
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { ButtonLink, Card, EmptyState, SkeletonRows, StatusChip } from "../../ui/wp";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { clockOf, sheetDay } from "../../../convex/lib/callSheet";
import { pageOf } from "../../../convex/lib/wsBuilder";
import { SheetView } from "./callSheetParts";

type View = NonNullable<FunctionReturnType<typeof api.callSheets.forClient>>;

function Reader({ d, home, homeLabel }: { d: View; home: string; homeLabel: string }) {
  const mail = `mailto:${d.replyTo}?${new URLSearchParams({ subject: `Call sheet for ${sheetDay(d.date)}: ${d.title}` }).toString().replace(/\+/g, "%20")}`;
  return (
    <>
      <TopBar><a {...linkProps(home)}>{homeLabel}</a><Sep /><span className="here">Call sheet · {sheetDay(d.date).replace(/^\w+ /, "")}</span></TopBar>
      <div className="wp-page cs-read">
        <header className="pj-head sh-head">
          <span className="wp-eyebrow">Call sheet · {d.business}</span>
          <h1 className="wp-h2">{d.title}</h1>
          <span className="sh-sub"><span className="secondary">{sheetDay(d.date)}{d.me.call ? ` · Your call ${clockOf(d.me.call)}` : ""}</span>
            {d.updated ? <StatusChip tone="warning">Updated {new Date(d.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</StatusChip> : null}</span>
        </header>
        <SheetView page={pageOf(d.page)} values={d.values} accent={d.accent} />
        <p className="wp-small secondary cs-askline">Questions about the day? <a href={mail} className="cs-link">Email {d.owner}</a>, or reply to the email it came with.</p>
      </div>
    </>
  );
}

function useOpen(id: string, ok: boolean, open: (a: { callSheetId: string }) => Promise<unknown>) {
  const done = useRef(false);
  useEffect(() => { if (ok && !done.current) { done.current = true; void open({ callSheetId: id }).catch(() => undefined); } }, [ok, id, open]);
}

const Missing = ({ home, label }: { home: string; label: string }) => (
  <div className="wp-page"><EmptyState icon="document" title="This call sheet isn't here." body="It may be for a shoot you're no longer on. Ask whoever sent it." actions={<ButtonLink to={home}>{label}</ButtonLink>} /></div>
);

/** The client side. */
export function ClientCallSheetPage({ callSheetId }: { callSheetId: string }) {
  const d = useQuery(api.callSheets.forClient, { callSheetId });
  const open = useMutation(api.callSheets.opened);
  useOpen(callSheetId, !!d, open);
  if (d === undefined) return <><TopBar><span className="here">Call sheet</span></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (d === null) return <><TopBar><span className="here">Call sheet</span></TopBar><Missing home="/inbox" label="Back to your Inbox" /></>;
  return <Reader d={d} home={`/projects/${d.project._id}`} homeLabel={d.project.label} />;
}

/** The vendor side. */
export function VendorCallSheetPage({ callSheetId }: { callSheetId: string }) {
  const d = useQuery(api.vendorPortal.callSheet, { callSheetId });
  const open = useMutation(api.vendorPortal.openCallSheet);
  useOpen(callSheetId, !!d, open);
  if (d === undefined) return <><TopBar><span className="here">Call sheet</span></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (d === null) return <><TopBar><span className="here">Call sheet</span></TopBar><Missing home="/vendor/bookings" label="Your bookings" /></>;
  return <Reader d={d} home="/vendor/bookings" homeLabel="Bookings" />;
}
