// Heston (Oct 29): "ask to verify sign out". Every Sign out button in the app (the account menu, Settings, More,
// the client's Settings) asks first. The two pages whose only purpose is to sign out (Not allowed, and a link
// shared with a different email) sign out straight away.
import { useAuthActions } from "@convex-dev/auth/react";
import { useConfirm } from "../ui/kit";

export function useSignOutAsk(): [() => void, React.ReactNode] {
  const { signOut } = useAuthActions();
  const [confirm, dialog] = useConfirm();
  const ask = () => {
    void confirm({ title: "Sign out?", body: "You'll need to sign in again on this device.", yes: "Sign out", no: "Stay signed in", danger: false })
      .then((ok) => { if (ok) void signOut(); });
  };
  return [ask, dialog];
}
