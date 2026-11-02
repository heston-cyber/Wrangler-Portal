// Phase 3c step 3 · the briefings card on a vendor's page (730:1153).
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card, Divider, ListRow, SectionHead, SkeletonRows, StatusChip, type Tone } from "../../ui/wp";
import { dateShort } from "../payments/common";

type State = "draft" | "sent" | "read";
const CHIP: Record<State, [Tone, string]> = { draft: ["neutral", "Draft"], sent: ["danger", "Sent"], read: ["success", "Read"] };
export const BriefChip = ({ state }: { state: State }) => <StatusChip tone={CHIP[state][0]}>{CHIP[state][1]}</StatusChip>;
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
export const where = (x: { state: State; sentAt: number | null; readAt: number | null }) =>
  x.state === "draft" ? "draft" : [x.sentAt ? `sent ${when(x.sentAt)}` : null, x.readAt ? `read ${when(x.readAt)}` : null].filter(Boolean).join(" · ");

// ---------- a vendor's briefings ----------

export function VendorBriefings({ vendorId, first }: { vendorId: Id<"vendors">; first: string }) {
  const rows = useQuery(api.briefings.forVendor, { vendorId });
  return (
    <Card label="Briefings" head={<SectionHead label="Briefings" count={rows?.length ?? 0} />}>
      {rows === undefined ? <SkeletonRows n={2} /> : !rows || rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title={`No briefings for ${first} yet.`} />
        : rows.slice(0, 6).map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
          <ListRow className="ilead" lead={{ icon: "note" }} to={`/vendors/briefings/${x._id}`} title={x.title} meta={where(x)} chip={<BriefChip state={x.state} />} chevron /></div>)}
    </Card>
  );
}
