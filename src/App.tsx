import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useLocation } from "./lib/router";
import SignIn, { SystemPage } from "./shell/SignIn";
import { Button } from "./ui/wp";
import ClientHome from "./modules/clients/ClientHome";
import Home from "./modules/review/Home";
import Projects from "./modules/review/Projects";
import ActivityPage from "./modules/review/ActivityPage";
import Settings from "./modules/settings/Settings";
import VideoPage from "./modules/review/VideoPage";
import SharePage from "./modules/review/SharePage";
import { lazy, Suspense } from "react";
import { MorePage, Shell } from "./shell/Shell";
import { UploadProvider } from "./shell/UploadDialog";
import type { Id } from "../convex/_generated/dataModel";

// Wrangler Sign (S1): its own chunk, so pdf.js only loads on those pages.
const SignHome = lazy(() => import("./modules/docs/pages/SignHome"));
const SignDocs = lazy(() => import("./modules/docs/pages/SignDocs"));
const SignNew = lazy(() => import("./modules/docs/pages/SignNew"));
const SignTemplates = lazy(() => import("./modules/docs/pages/SignTemplates"));
const Builder = lazy(() => import("./modules/docs/builder/Builder"));
const SignDoc = lazy(() => import("./modules/docs/pages/SignDoc"));
const SignSignature = lazy(() => import("./modules/docs/pages/SignSignature"));
// S2: the client's signing page. sign.wranglerportal.com/<token>, or /x/<token> on any host (a fallback).
const SignerApp = lazy(() => import("./modules/docs/signer/SignerApp"));
const VerifyPage = lazy(() => import("./modules/docs/signer/VerifyPage"));
// Dev only: the component page (never part of the live build).
const KIT_ON = import.meta.env.DEV || import.meta.env.VITE_KIT === "1";
const Kit = KIT_ON ? lazy(() => import("./dev/Kit")) : null;
const KitApp = KIT_ON ? lazy(() => import("./dev/KitApp")) : null;
// ?kit=owner or ?kit=client: the real pages with sample data (dev only); ?kit=off ends it.
function kitSide(): "owner" | "client" | null {
  if (!KIT_ON) return null;
  try {
    const q = new URLSearchParams(location.search).get("kit");
    if (q === "owner" || q === "client") sessionStorage.setItem("wr.kit", q);
    if (q === "off") sessionStorage.removeItem("wr.kit");
    const s = sessionStorage.getItem("wr.kit");
    return s === "owner" || s === "client" ? s : null;
  } catch { return null; }
}
const isSignHost = () => /^sign\./i.test(location.hostname);

const Loading = () => <div className="signin"><span className="label">Loading…</span></div>;

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { path, search } = useLocation();
  if (/^(www\.)?wranglerportal\.com$/i.test(location.hostname)) return <HoldingPage />;
  if (Kit && path.startsWith("/__kit")) return <Suspense fallback={<Loading />}><Kit /></Suspense>;
  const kit = kitSide();
  if (KitApp && kit) {
    const sh = /^\/s\/([^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
    return <Suspense fallback={<Loading />}><KitApp side={kit}>{sh ? <SharePage token={sh[1]} videoId={(sh[2] as Id<"videos"> | undefined) ?? null} versionNumber={null} noteId={null} /> : <SignedIn />}</KitApp></Suspense>;
  }
  const signer = (isSignHost() ? /^\/(?:x\/)?([A-Za-z0-9_-]{16,64})\/?$/ : /^\/x\/([A-Za-z0-9_-]{16,64})\/?$/).exec(path);
  if ((isSignHost() && /^\/verify\/?$/.test(path)) || /^\/x\/verify\/?$/.test(path)) return <Suspense fallback={<Loading />}><VerifyPage /></Suspense>;
  if (signer) return <Suspense fallback={<Loading />}><SignerApp key={signer[1]} token={signer[1]} /></Suspense>;
  if (isSignHost()) return <SignHostHome />;
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
  const signer = (isSignHost() ? /^\/(?:x\/)?([A-Za-z0-9_-]{16,64})\/?$/ : /^\/x\/([A-Za-z0-9_-]{16,64})\/?$/).exec(path);
  if ((isSignHost() && /^\/verify\/?$/.test(path)) || /^\/x\/verify\/?$/.test(path)) return <Suspense fallback={<Loading />}><VerifyPage /></Suspense>;
  if (signer) return <Suspense fallback={<Loading />}><SignerApp key={signer[1]} token={signer[1]} /></Suspense>;
  if (isSignHost()) return <SignHostHome />;
  if (me === undefined) return <Loading />;
  // Clients (C1): their own page, nothing of the owner's side.
  if (me && !me.allowed && me.role === "client") {
    return (
      <Shell me={me} side="client" overlay={false}>
        {/^\/more\/?$/.test(path) ? <MorePage me={me} side="client" /> : <ClientHome me={me} />}
      </Shell>
    );
  }
  if (!me || !me.allowed) {
    return (
      <SystemPage icon="lock" eyebrow="Wrangler Review" title="Not allowed." body="This account isn't on Wrangler Review's list.">
        <Button style={{ alignSelf: "flex-start" }} onClick={() => void signOut()}>Sign out</Button>
      </SystemPage>
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
  else if (path.startsWith("/sign/connector")) page = <Settings me={me} />; // now Settings › Claude connectors
  else if (/^\/sign\/docs\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignDocs /></Suspense>;
  else if (/^\/sign\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignNew /></Suspense>;
  else if (/^\/sign\/b\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsBuilds">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "build", buildId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsTemplates">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "template", templateId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignTemplates /></Suspense>;
  else if (path.startsWith("/sign")) page = <Suspense fallback={<Loading />}><SignHome /></Suspense>;
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else if (path.startsWith("/register")) page = <Settings me={me} />; // now Settings › Register
  else if (path.startsWith("/settings")) page = <Settings me={me} />;
  else if (/^\/more\/?$/.test(path)) page = <MorePage me={me} side="owner" />;
  else page = <Home />; // "/" and "/review" (Review's main page) until the new Home lands
  // Work surfaces get no background light, so nothing competes with the video or the document.
  const workSurface = Boolean(video) || /^\/sign\/(b|d)\//.test(path) || /^\/sign\/templates\/[^/]+/.test(path);
  return (
    <UploadProvider>
      <Shell me={me} overlay={Boolean(video)} light={!workSurface}>{page}</Shell>
    </UploadProvider>
  );
}

// The bare wranglerportal.com (D14, Oct 28): a holding page with Sign in.
function HoldingPage() {
  return (
    <SystemPage title="Wrangler Portal" body="Client sign-in for Wrangler Productions.">
      <a className="btn primary" href="https://app.wranglerportal.com/" style={{ width: "100%" }}>Sign in</a>
    </SystemPage>
  );
}

// sign.wranglerportal.com without a token: nothing to see.
function SignHostHome() {
  return (
    <SystemPage eyebrow="Wrangler Sign" title="Open the signing link from your email." body={<>Open the signing link from your email to review and sign a document from Wrangler Productions. To check a signed copy, go to <a href="/verify" style={{ textDecoration: "underline" }}>sign.wranglerportal.com/verify</a>.</>} />
  );
}

