import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { linkProps, useLocation } from "./lib/router";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import VideoPage from "./pages/VideoPage";
import type { Id } from "../convex/_generated/dataModel";

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <div className="signin"><p className="label">Loading…</p></div>;
  if (!isAuthenticated) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const { path, search } = useLocation();
  if (me === undefined) return <div className="signin"><p className="label">Loading…</p></div>;
  if (!me || !me.allowed) {
    return (
      <div className="signin">
        <div style={{ display: "grid", gap: 14, maxWidth: 380 }}>
          <h1 style={{ fontFamily: "var(--display)", color: "var(--white)", margin: 0 }}>Not allowed</h1>
          <p className="muted">This account isn't on Wrangler Review's list.</p>
          <button className="btn" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  const m = /^\/v\/([^/]+)\/?$/.exec(path);
  const versionParam = Number(new URLSearchParams(search).get("version")) || null;
  return (
    <>
      <header className="topbar">
        <a className="brand" {...linkProps("/")}>
          <b>WP</b>
          <span>Wrangler Review</span>
        </a>
        <nav className="topnav" aria-label="Main">
          <a {...linkProps("/")}><span className="idx">[00]</span>Projects</a>
          <button className="linklike" onClick={() => void signOut()}><span className="idx">[01]</span>Sign out</button>
        </nav>
      </header>
      {m ? <VideoPage key={m[1]} videoId={m[1] as Id<"videos">} versionNumber={versionParam} /> : <Home />}
    </>
  );
}
