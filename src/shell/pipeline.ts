// Nov 17 (Heston, approved 09:00): Production is the hub of the pipeline, in five stages, in this order. The Production
// page's stage cards and the phone's hold panel on the Production tab both read this list.
import type { IconName } from "../ui/Icon";

export const PIPELINE: Array<{ to: string; name: string; short: string; icon: IconName }> = [
  { to: "/creative", name: "Creative planning", short: "Creative planning", icon: "creative" },
  { to: "/production/pre-pro", name: "Pre-production", short: "Pre-pro", icon: "clipboard" },
  { to: "/production/prin-pro", name: "Principal production", short: "Prin-pro", icon: "camera" },
  { to: "/production/post-pro", name: "Post-production", short: "Post-pro", icon: "scissors" },
  { to: "/delivery", name: "Delivery", short: "Delivery", icon: "package" },
];
