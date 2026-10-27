import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useLocation } from "./lib/router";
import SignIn from "./pages/SignIn";
import ClientHome from "./pages/ClientHome";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import ActivityPage from "./pages/ActivityPage";
import Register from "./pages/Register";
import Settings from "./pages/Settings";
import VideoPage from "./pages/VideoPage";
import SharePage from "./pages/SharePage";
import { lazy, Suspense } from "react";
import { Shell } from "./shell/Shell";
import { UploadProvider } from "./shell/UploadDialog";
import type { Id } from "../convex/_generated/dataModel";

// Wrangler Sign (S1): its own chunk, so pdf.js only loads on those pages.
const SignList = lazy(() => import("./pages/sign/SignList"));
const SignDoc = lazy(() => import("./pages/sign/SignDoc"));
const SignSignature = lazy(() => import("./pages/sign/SignSignature"));

const Loading = () => <div className="signin"><span className="label">Loading…</span></div>;

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { path, search } = useLocation();
  // A share link (C3) works signed in or out; the page decides what the link shows.
  const share = /^\/s\/([^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
  if (share) {
    if (isLoading) return <Loading />;
    const params = new URLSearchParams(search);
    return <SharePage key={share[1]} token={share[1]} videoId={(share[2] as Id<"videos"> | undefined) ?? null} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
  }
  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <SignIn invitedEmail={new URLSearchParams(location.search).get("invited")} />;
  return <SignedIn />;
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const { path, search } = useLocation();
  if (me === undefined) return <Loading />;
  // Clients (C1): their own page, nothing of the owner's side.
  if (me && !me.allowed && me.role === "client") return <ClientHome me={me} />;
  if (!me || !me.allowed) {
    return (
      <div className="signin">
        <div style={{ display: "grid", gap: 14, maxWidth: 380 }}>
          <span className="eyebrow">Wrangler Review</span>
          <h1 className="title">Not allowed.</h1>
          <p className="caption">This account isn't on Wrangler Review's list.</p>
          <button className="btn" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  const params = new URLSearchParams(search);
  const video = /^\/v\/([^/]+)\/?$/.exec(path);
  const project = /^\/projects\/([^/]+)\/?$/.exec(path);
  const signDoc = /^\/sign\/d\/([^/]+)\/?$/.exec(path);
  let page: React.ReactNode;
  if (video) page = <VideoPage key={video[1]} videoId={video[1] as Id<"videos">} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
  else if (project) page = <Projects key={project[1]} projectId={project[1] as Id<"projects">} />;
  else if (path.startsWith("/projects")) page = <Projects key="all" />;
  else if (signDoc) page = <Suspense fallback={<Loading />}><SignDoc key={signDoc[1]} documentId={signDoc[1] as Id<"wsDocuments">} versionNumber={Number(params.get("v")) || null} /></Suspense>;
  else if (path.startsWith("/sign/signature")) page = <Suspense fallback={<Loading />}><SignSignature /></Suspense>;
  else if (path.startsWith("/sign")) page = <Suspense fallback={<Loading />}><SignList /></Suspense>;
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else if (path.startsWith("/register")) page = <Register />;
  else if (path.startsWith("/settings")) page = <Settings me={me} />;
  else page = <Home />;
  return (
    <UploadProvider>
      <Shell me={me} overlay={Boolean(video)}>{page}</Shell>
    </UploadProvider>
  );
}
