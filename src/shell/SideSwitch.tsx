// Nov 2 (Heston): one login can be a client and a vendor (replacing D102). The switch between the two sides, in the
// account menu and on More, and the invite links' ?side= that lands someone on the side the invite was for.
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { navigate, useLocation } from "../lib/router";

export type SideName = "client" | "vendor";
export const sideWord = (s: SideName) => (s === "vendor" ? "vendor side" : "client side");

/** The other side this login can switch to, and the switch itself (back to Home on the new side). */
export function useSideSwitch() {
  const me = useQuery(api.users.me);
  const sw = useMutation(api.users.switchSide);
  const sides = (me?.sides ?? []) as SideName[];
  const other = me && !me.allowed && sides.length > 1 ? (sides.find((s) => s !== me.role) ?? null) : null;
  const go = async (side?: SideName) => { const s = side ?? other; if (!s) return; await sw({ side: s }); navigate("/"); };
  return { other, go, sides };
}

/** An invite link's ?side=vendor or ?side=client: switch to it once, if this login has that side. */
export function SideFromLink() {
  const me = useQuery(api.users.me);
  const sw = useMutation(api.users.switchSide);
  const { search } = useLocation();
  const done = useRef(false);
  useEffect(() => {
    const want = new URLSearchParams(search).get("side");
    if (done.current || !me || me.allowed || (want !== "vendor" && want !== "client")) return;
    done.current = true;
    const clean = () => { const u = new URL(window.location.href); u.searchParams.delete("side"); u.searchParams.delete("invited"); window.history.replaceState(null, "", u.toString()); };
    if (me.role === want || !(me.sides ?? []).includes(want)) { clean(); return; }
    void sw({ side: want }).then(clean, clean);
  }, [me, search, sw]);
  return null;
}
