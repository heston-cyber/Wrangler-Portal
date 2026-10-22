import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useLocation } from "./lib/router";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import ActivityPage from "./pages/ActivityPage";
import Register from "./pages/Register";
import Settings from "./pages/Settings";
import VideoPage from "./pages/VideoPage";
import { Shell } from "./shell/Shell";
import { UploadProvider } from "./shell/UploadDialog";
import type { Id } from "../convex/_generated/dataModel";

const Loading = () => <div className="signin"><span className="label">Loading…</span></div>;

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const { path, search } = useLocation();
  if (me === undefined) return <Loading />;
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
  let page: React.ReactNode;
  if (video) page = <VideoPage key={video[1]} videoId={video[1] as Id<"videos">} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
  else if (project) page = <Projects key={project[1]} projectId={project[1] as Id<"projects">} />;
  else if (path.startsWith("/projects")) page = <Projects key="all" />;
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
