import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useLocation } from "./lib/router";
import SignIn, { SystemPage } from "./shell/SignIn";
import { Button } from "./ui/wp";
import ClientHome from "./modules/clients/ClientHome";
import ClientInbox from "./modules/clients/ClientInbox";
import ClientDocuments, { type DocTab } from "./modules/clients/ClientDocuments";
import ClientReview from "./modules/clients/ClientReview";
import ClientProject, { type ClientProjectTab } from "./modules/projects/ClientProject";
import { ClientShootPage } from "./modules/projects/Shoots";
import { ClientRequestPage } from "./modules/projects/Requests";
import { ClientBriefPage } from "./modules/projects/Brief";
import { ClientTestimonialPage } from "./modules/clients/Testimonials";
import { ClientSidePrompt, SideFromLink } from "./shell/SideSwitch";
import ClientSettings from "./modules/clients/ClientSettings";
import Home from "./modules/review/Home";
import OwnerHome from "./modules/home/OwnerHome";
import ClientsPage from "./modules/clients/ClientsPage";
import ClientPage, { type ClientTab } from "./modules/clients/ClientPage";
import PostNote from "./modules/sent/PostNote";
import SentPage, { SentNote } from "./modules/sent/SentPage";
import Projects from "./modules/review/Projects";
import ProjectPage, { type ProjectTab } from "./modules/projects/ProjectPage";
import ActivityPage from "./modules/review/ActivityPage";
import Settings from "./modules/settings/Settings";
import VideoPage from "./modules/review/VideoPage";
import SharePage from "./modules/review/SharePage";
import { lazy, Suspense } from "react";
import { MorePage, Shell } from "./shell/Shell";
import { UploadProvider } from "./shell/UploadDialog";
import type { Id } from "../convex/_generated/dataModel";

// Payments (Phase 2 Part B): its own chunk.
const InvoicesPage = lazy(() => import("./modules/payments/InvoicesPage"));
const InvoiceEditor = lazy(() => import("./modules/payments/InvoiceEditor"));
const InvoiceDetail = lazy(() => import("./modules/payments/InvoiceDetail"));
const PaymentsOverview = lazy(() => import("./modules/payments/PaymentsOverview"));
const PlansPage = lazy(() => import("./modules/payments/PlansPage"));
// Phase 3: the CRM (Clients › Pipeline · Companies · Follow-ups), estimates and contacts.
const Pipeline = lazy(() => import("./modules/crm/Pipeline"));
const DealPage = lazy(() => import("./modules/crm/DealPage"));
const FollowUps = lazy(() => import("./modules/crm/FollowUps"));
const TestimonialsPage = lazy(() => import("./modules/clients/Testimonials"));
const EstimatePage = lazy(() => import("./modules/crm/EstimatePage"));
const ContactPage = lazy(() => import("./modules/crm/ContactPage"));
const SubscriptionsPage = lazy(() => import("./modules/payments/SubscriptionsPage"));
const StartSubscription = lazy(() => import("./modules/payments/SubscriptionsPage").then((m) => ({ default: m.StartSubscription })));
const SubscriptionDetail = lazy(() => import("./modules/payments/SubscriptionsPage").then((m) => ({ default: m.SubscriptionDetail })));
const ClientSubscription = lazy(() => import("./modules/payments/ClientSubscription"));
const ClientSubscriptions = lazy(() => import("./modules/payments/ClientSubscription").then((m) => ({ default: m.ClientSubscriptions })));
const PlanEditor = lazy(() => import("./modules/payments/PlansPage").then((m) => ({ default: m.PlanEditor })));
const ClientInvoice = lazy(() => import("./modules/payments/ClientInvoice"));
// Phase 3b: Quick quotes (Payments › Quotes) and the no-account quote page /q/<token> (D81).
const QuotesPage = lazy(() => import("./modules/payments/Quotes"));
const QuoteEditor = lazy(() => import("./modules/payments/Quotes").then((m) => ({ default: m.QuoteEditor })));
const QuoteDetail = lazy(() => import("./modules/payments/Quotes").then((m) => ({ default: m.QuoteDetail })));
const ClientQuote = lazy(() => import("./modules/payments/ClientQuote"));
const ClientInvoices = lazy(() => import("./modules/payments/ClientInvoices"));
// Phase 3b: Proposals (D69) in their own chunk with the builder, and the no-account proposal page /p/<token> (D73).
const ProposalsPage = lazy(() => import("./modules/proposals/Proposals"));
const NewProposal = lazy(() => import("./modules/proposals/Proposals").then((m) => ({ default: m.NewProposal })));
const ProposalTemplates = lazy(() => import("./modules/proposals/Proposals").then((m) => ({ default: m.ProposalTemplates })));
const ProposalBuilder = lazy(() => import("./modules/proposals/Proposals").then((m) => ({ default: m.ProposalBuilder })));
const ClientProposal = lazy(() => import("./modules/proposals/ClientProposal"));
// D147: a briefing's no-login page /b/<token> (email 58, or a copied link).
const BriefingLink = lazy(() => import("./modules/vendors/BriefingLink"));
const CallBookingPage = lazy(() => import("./modules/calls/Calls").then((m) => ({ default: m.BookingPage }))); // Phase 5d step 1
const OwnerMessages = lazy(() => import("./modules/messages/Messages").then((m) => ({ default: m.OwnerMessages }))); // Phase 5d step 2
const ClientMessages = lazy(() => import("./modules/messages/Messages").then((m) => ({ default: m.ClientMessages })));
const LeadMessages = lazy(() => import("./modules/messages/Messages").then((m) => ({ default: m.LeadMessages })));
const CallPage = lazy(() => import("./modules/calls/Calls").then((m) => ({ default: m.CallPage })));
// Phase 3c: Vendors (D95: its own layer).
const VendorsPage = lazy(() => import("./modules/vendors/Vendors"));
// Phase 5b: Production (D126).
const ClientsOverview = lazy(() => import("./modules/overviews/Overviews").then((m) => ({ default: m.ClientsOverview })));
const ReviewOverview = lazy(() => import("./modules/overviews/Overviews").then((m) => ({ default: m.ReviewOverview })));
const DocsOverview = lazy(() => import("./modules/overviews/Overviews").then((m) => ({ default: m.DocsOverview })));
const ProposalsOverview = lazy(() => import("./modules/overviews/Overviews").then((m) => ({ default: m.ProposalsOverview })));
const VendorsOverview = lazy(() => import("./modules/overviews/Overviews").then((m) => ({ default: m.VendorsOverview })));
const ProductionOverview = lazy(() => import("./modules/production/Production"));
const ProductionStage = lazy(() => import("./modules/production/Production").then((m) => ({ default: m.ProductionStage })));
const ProductionDelivery = lazy(() => import("./modules/production/Production").then((m) => ({ default: m.ProductionDelivery }))); // D150
const ProductionShoots = lazy(() => import("./modules/production/Production").then((m) => ({ default: m.ProductionShoots })));
// Phase 5b step 3: call sheets (the owner's pages), and the readers' page on the client side.
const CallSheetsPage = lazy(() => import("./modules/production/CallSheets"));
const GearPage = lazy(() => import("./modules/production/Gear")); // Phase 5d step 3
const GearItem = lazy(() => import("./modules/production/Gear").then((m) => ({ default: m.GearItem })));
const CalendarPage = lazy(() => import("./modules/production/Calendar")); // Phase 5b step 5
const NewCallSheet = lazy(() => import("./modules/production/CallSheets").then((m) => ({ default: m.NewCallSheet })));
const CallSheetQuestions = lazy(() => import("./modules/production/CallSheets").then((m) => ({ default: m.CallSheetQuestions })));
const CallSheetEditor = lazy(() => import("./modules/production/CallSheets").then((m) => ({ default: m.CallSheetEditor })));
const CallSheetTemplate = lazy(() => import("./modules/production/CallSheets").then((m) => ({ default: m.CallSheetTemplate })));
const CallSheetDetail = lazy(() => import("./modules/production/CallSheets").then((m) => ({ default: m.CallSheetDetail })));
// Phase 5b step 4 (D127): call-sheet guests, signed in or out (their link, the code, their sheets).
const GuestApp = lazy(() => import("./modules/guest/GuestApp"));
const ClientCallSheetPage = lazy(() => import("./modules/production/CallSheetRead").then((m) => ({ default: m.ClientCallSheetPage })));
const VendorPage = lazy(() => import("./modules/vendors/Vendors").then((m) => ({ default: m.VendorPage })));
const BookingsPage = lazy(() => import("./modules/vendors/Bookings"));
const VendorPaymentsPage = lazy(() => import("./modules/vendors/Payments"));
const VendorInvoicePage = lazy(() => import("./modules/vendors/Payments").then((m) => ({ default: m.VendorInvoicePage })));
const BookingPage = lazy(() => import("./modules/vendors/Bookings").then((m) => ({ default: m.BookingPage })));
const BriefingsPage = lazy(() => import("./modules/vendors/Briefings"));
const VendorApp = lazy(() => import("./modules/vendor/VendorApp"));
const BriefingBuilder = lazy(() => import("./modules/vendors/Briefings").then((m) => ({ default: m.BriefingBuilder })));
const BriefingTemplateBuilder = lazy(() => import("./modules/vendors/Briefings").then((m) => ({ default: m.BriefingTemplateBuilder })));
const QuestionnaireEditor = lazy(() => import("./modules/proposals/Questionnaire").then((m) => ({ default: m.QuestionnaireEditor })));
const QuestionnaireRunner = lazy(() => import("./modules/proposals/Questionnaire").then((m) => ({ default: m.QuestionnaireRunner })));
// Wrangler Sign (S1): its own chunk, so pdf.js only loads on those pages.
const SignHome = lazy(() => import("./modules/docs/pages/SignHome"));
const SignDocs = lazy(() => import("./modules/docs/pages/SignDocs"));
const SignNew = lazy(() => import("./modules/docs/pages/SignNew"));
const SignTemplates = lazy(() => import("./modules/docs/pages/SignTemplates"));
const Builder = lazy(() => import("./modules/docs/builder/Builder"));
const HelpScreen = lazy(() => import("./modules/help/Help").then((m) => ({ default: m.HelpScreen }))); // Phase 5d step 4
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
// Phone pass (Nov 4): also ?kit=guest (a signed-in call-sheet guest), ?kit=guestout (the same, signed out), ?kit=empty (an
// owner with nothing yet) and ?kit=loading (an owner whose queries never answer, so every page shows its loading state).
const KIT_SIDES = ["owner", "client", "vendor", "guest", "guestout", "empty", "loading"] as const;
type KitSide = (typeof KIT_SIDES)[number];
function kitSide(): KitSide | null {
  if (!KIT_ON) return null;
  try {
    const q = new URLSearchParams(location.search).get("kit");
    if (KIT_SIDES.includes(q as KitSide)) sessionStorage.setItem("wr.kit", q!);
    if (q === "off") sessionStorage.removeItem("wr.kit");
    const s = sessionStorage.getItem("wr.kit");
    return KIT_SIDES.includes(s as KitSide) ? (s as KitSide) : null;
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
    const guestKit = /^\/guest(?:\/([A-Za-z0-9_-]{16,64}))?\/?$/.exec(path);
    if (guestKit && (kit === "guest" || kit === "guestout")) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><GuestApp key={guestKit[1] ?? "home"} token={guestKit[1] ?? null} /></Suspense></KitApp></Suspense>;
    const sh = /^\/s\/([^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
    const qk = /^\/q\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path); // D149: the no-account quote page
    if (qk) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><ClientQuote token={qk[1]} /></Suspense></KitApp></Suspense>;
    const brief = /^\/b\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path); // D147: the no-login briefing page
    const bk = /^\/book\/([a-z0-9-]{1,64})\/?$/.exec(path), ck = /^\/call\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path); // Phase 5d: booking calls
    if (bk) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><CallBookingPage slug={bk[1]} /></Suspense></KitApp></Suspense>;
    if (ck) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><CallPage token={ck[1]} /></Suspense></KitApp></Suspense>;
    const mk = /^\/m\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
    if (mk) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><LeadMessages token={mk[1]} /></Suspense></KitApp></Suspense>;
    if (brief) return <Suspense fallback={<Loading />}><KitApp side={kit}><Suspense fallback={<Loading />}><BriefingLink token={brief[1]} /></Suspense></KitApp></Suspense>;
    const inv = /^\/i\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
    if (inv) {
      const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientInvoice token={inv[1]} inShell={inShell} /></Suspense>;
      return <Suspense fallback={<Loading />}><KitApp side={kit}>{new URLSearchParams(search).has("out") ? page(false) : <ShareForMember video={false} page={page} />}</KitApp></Suspense>;
    }
    return <Suspense fallback={<Loading />}><KitApp side={kit}>{sh ? <ShareForMember video={!!sh[2]} page={(inShell) => <SharePage inShell={inShell} token={sh[1]} videoId={(sh[2] as Id<"videos"> | undefined) ?? null} versionNumber={null} noteId={null} />} /> : <SignedIn />}</KitApp></Suspense>;
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
    const page = (inShell: boolean) => <SharePage key={share[1]} inShell={inShell} token={share[1]} videoId={(share[2] as Id<"videos"> | undefined) ?? null} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
    return isAuthenticated ? <ShareForMember video={!!share[2]} page={page} /> : page(false);
  }
  // Phase 2b: a subscription link (email 13's "Add payment method") works signed in or out too.
  const subLink = /^\/sub\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (subLink) {
    if (isLoading) return <Loading />;
    const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientSubscription key={subLink[1]} token={subLink[1]} inShell={inShell} /></Suspense>;
    return isAuthenticated ? <ShareForMember video={false} page={page} /> : page(false);
  }
  // Phase 3b: a quote link (email 18's "View and accept"), no account needed; the same page signed in or out.
  const quoteLink = /^\/q\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (quoteLink) return <Suspense fallback={<Loading />}><ClientQuote key={quoteLink[1]} token={quoteLink[1]} /></Suspense>;
  // Phase 3b: a proposal link (email 19's "View proposal"), no account needed; the same page signed in or out.
  const proposalLink = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (proposalLink) return <Suspense fallback={<Loading />}><ClientProposal key={proposalLink[1]} token={proposalLink[1]} /></Suspense>;
  // Phase 5d step 1: the booking page (/book/<business>) and a lead's own call (/call/<token>, email 43). No account.
  const bookLink = /^\/book\/([a-z0-9-]{1,64})\/?$/.exec(path);
  if (bookLink) return <Suspense fallback={<Loading />}><CallBookingPage key={bookLink[1]} slug={bookLink[1]} /></Suspense>;
  const callLink = /^\/call\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (callLink) return <Suspense fallback={<Loading />}><CallPage key={callLink[1]} token={callLink[1]} /></Suspense>;
  // Phase 5d step 2: a lead's conversation (/m/<token>, email 44). No account.
  const leadMsg = /^\/m\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (leadMsg) return <Suspense fallback={<Loading />}><LeadMessages key={leadMsg[1]} token={leadMsg[1]} /></Suspense>;
  // D147: a briefing link (email 58's "Read the briefing", or a copied link), no account needed; the same page signed in or out.
  const briefingLink = /^\/b\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (briefingLink) return <Suspense fallback={<Loading />}><BriefingLink key={briefingLink[1]} token={briefingLink[1]} /></Suspense>;
  // An invoice link (Part B step 3, the "View and pay" button in email 08) works signed in or out too.
  const invoice = /^\/i\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (invoice) {
    if (isLoading) return <Loading />;
    const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientInvoice key={invoice[1]} token={invoice[1]} inShell={inShell} /></Suspense>;
    return isAuthenticated ? <ShareForMember video={false} page={page} /> : page(false);
  }
  // Phase 5b step 4: a call-sheet guest's link (email 41), signed in or out; the page decides.
  const guestLink = /^\/guest(?:\/([A-Za-z0-9_-]{16,64}))?\/?$/.exec(path);
  if (guestLink) return <Suspense fallback={<Loading />}><GuestApp key={guestLink[1] ?? "home"} token={guestLink[1] ?? null} /></Suspense>;
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
  // Phase 5b step 4 (D127): a call-sheet guest sees their call sheets and nothing else, whatever address they open.
  if (me && me.role === "guest") return <Suspense fallback={<Loading />}><GuestApp token={null} /></Suspense>;
  // Phase 3c step 4: vendors get the vendor side (their bookings, briefings and invoices), nothing else.
  if (me && !me.allowed && me.role === "vendor") {
    // A client page's address (from a client email) on the vendor side: offer the switch.
    if ((me.sides ?? []).includes("client") && /^\/(projects|requests|shoots|call-sheets|briefs|words|inbox|docs|payments|sub)(\/|$)/.test(path) && !new URLSearchParams(search).get("side")) return <ClientSidePrompt />;
    return <><SideFromLink /><Suspense fallback={<Loading />}><VendorApp me={me} /></Suspense></>;
  }
  // Clients (C1): their own page, nothing of the owner's side.
  if (me && !me.allowed && me.role === "client") {
    return (
      <><SideFromLink /><ClientShell me={me} /></>
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
  const clientRec = /^\/clients\/([^/]+)\/?$/.exec(path);
  const sentNote = /^\/sent\/([^/]+)\/?$/.exec(path);
  let page: React.ReactNode;
  const overview = /^\/(clients|review|sign|proposals|vendors)\/overview\/?$/.exec(path); // Phase 5b step 2: a tool's overview, before the pages that would read "overview" as an id
  const OVERVIEW = { clients: ClientsOverview, review: ReviewOverview, sign: DocsOverview, proposals: ProposalsOverview, vendors: VendorsOverview } as const;
  if (overview) { const Page = OVERVIEW[overview[1] as keyof typeof OVERVIEW]; page = <Suspense fallback={<Loading />}><Page /></Suspense>; }
  else if (video) page = <VideoPage key={video[1]} videoId={video[1] as Id<"videos">} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
  else if (project) { const t = params.get("tab"); page = <Suspense fallback={<Loading />}><ProjectPage key={project[1]} projectId={project[1] as Id<"projects">} tab={(["cuts", "documents", "invoices", "delivery", "ledger"].includes(t ?? "") ? t : "overview") as ProjectTab} /></Suspense>; }
  else if (path.startsWith("/projects")) page = <Projects key="all" />;
  else if (/^\/payments\/invoices\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><InvoiceEditor key={search} clientId={params.get("client")} projectId={params.get("project")} /></Suspense>;
  else if (/^\/payments\/invoices\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><InvoiceDetail key={id} invoiceId={id} /></Suspense>; }
  else if (/^\/payments\/invoices\/?$/.test(path)) page = <Suspense fallback={<Loading />}><InvoicesPage key={search} /></Suspense>;
  else if (/^\/payments\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PaymentsOverview /></Suspense>;
  else if (/^\/payments\/subscriptions\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SubscriptionsPage /></Suspense>;
  else if (/^\/payments\/subscriptions\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><StartSubscription key={search} clientId={params.get("client")} /></Suspense>;
  else if (/^\/payments\/subscriptions\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><SubscriptionDetail key={id} subscriptionId={id} /></Suspense>; }
  else if (/^\/payments\/quotes\/?$/.test(path)) page = <Suspense fallback={<Loading />}><QuotesPage /></Suspense>;
  else if (/^\/payments\/quotes\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><QuoteEditor key={search} clientId={params.get("client")} dealId={params.get("deal")} /></Suspense>;
  else if (/^\/payments\/quotes\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><QuoteDetail key={id} quoteId={id} /></Suspense>; }
  else if (/^\/payments\/plans\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PlansPage /></Suspense>;
  else if (/^\/payments\/plans\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PlanEditor key="new" /></Suspense>;
  else if (/^\/payments\/plans\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><PlanEditor key={id} planId={id} /></Suspense>; }
  else if (signDoc) page = <Suspense fallback={<Loading />}><SignDoc key={signDoc[1]} documentId={signDoc[1] as Id<"wsDocuments">} versionNumber={Number(params.get("v")) || null} /></Suspense>;
  else if (path.startsWith("/sign/signature")) page = <Suspense fallback={<Loading />}><SignSignature /></Suspense>;
  else if (path.startsWith("/sign/connector")) page = <Settings me={me} />; // now Settings › Claude connectors
  else if (/^\/sign\/docs\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignDocs /></Suspense>;
  else if (/^\/sign\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignNew /></Suspense>;
  else if (/^\/sign\/b\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsBuilds">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "build", buildId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsTemplates">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "template", templateId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignTemplates /></Suspense>;
  else if (path.startsWith("/sign")) page = <Suspense fallback={<Loading />}><SignHome /></Suspense>;
  else if (/^\/production\/?$/.test(path)) page = <Suspense fallback={<Loading />}><ProductionOverview /></Suspense>;
  else if (/^\/production\/shoots\/?$/.test(path)) page = <Suspense fallback={<Loading />}><ProductionShoots key={search} /></Suspense>;
  else if (/^\/messages\/?$/.test(path)) page = <Suspense fallback={<Loading />}><OwnerMessages /></Suspense>;
  else if (/^\/production\/(pre-pro|prin-pro|post-pro)\/?$/.test(path)) { const k = path.split("/")[2] as "pre-pro" | "prin-pro" | "post-pro"; page = <Suspense fallback={<Loading />}><ProductionStage key={k} stage={k} /></Suspense>; }
  else if (/^\/production\/delivery\/?$/.test(path)) page = <Suspense fallback={<Loading />}><ProductionDelivery /></Suspense>;
  else if (/^\/production\/gear\/?$/.test(path)) page = <Suspense fallback={<Loading />}><GearPage /></Suspense>;
  else if (/^\/production\/gear\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><GearItem key={id} gearId={id} /></Suspense>; }
  else if (/^\/production\/calendar\/?$/.test(path)) page = <Suspense fallback={<Loading />}><CalendarPage /></Suspense>;
  else if (/^\/production\/call-sheets\/?$/.test(path)) page = <Suspense fallback={<Loading />}><CallSheetsPage key={search} /></Suspense>;
  else if (/^\/production\/call-sheets\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><NewCallSheet key={search} shootId={params.get("shoot")} templateId={params.get("template")} /></Suspense>;
  else if (/^\/production\/call-sheets\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[4]; page = <Suspense fallback={<Loading />}><CallSheetTemplate key={id} templateId={id} /></Suspense>; }
  else if (/^\/production\/call-sheets\/[^/]+\/questions\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><CallSheetQuestions key={id} callSheetId={id} /></Suspense>; }
  else if (/^\/production\/call-sheets\/[^/]+\/edit\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><CallSheetEditor key={id} callSheetId={id} /></Suspense>; }
  else if (/^\/production\/call-sheets\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><CallSheetDetail key={id} callSheetId={id} /></Suspense>; }
  else if (/^\/vendors\/?$/.test(path)) page = <Suspense fallback={<Loading />}><VendorsPage /></Suspense>;
  else if (/^\/vendors\/briefings\/?$/.test(path)) page = <Suspense fallback={<Loading />}><BriefingsPage /></Suspense>;
  else if (/^\/vendors\/briefings\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[4]; page = <Suspense fallback={<Loading />}><BriefingTemplateBuilder key={id} templateId={id} /></Suspense>; }
  else if (/^\/vendors\/briefings\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><BriefingBuilder key={id} briefingId={id} /></Suspense>; }
  else if (/^\/vendors\/payments\/?$/.test(path)) page = <Suspense fallback={<Loading />}><VendorPaymentsPage /></Suspense>;
  else if (/^\/vendors\/payments\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><VendorInvoicePage key={id} invoiceId={id} /></Suspense>; }
  else if (/^\/vendors\/bookings\/?$/.test(path)) page = <Suspense fallback={<Loading />}><BookingsPage /></Suspense>;
  else if (/^\/vendors\/bookings\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><BookingPage key={id} bookingId={id} /></Suspense>; }
  else if (/^\/vendors\/[^/]+\/?$/.test(path)) { const id = path.split("/")[2]; page = <Suspense fallback={<Loading />}><VendorPage key={id} vendorId={id} /></Suspense>; }
  else if (/^\/proposals\/?$/.test(path)) page = <Suspense fallback={<Loading />}><ProposalsPage /></Suspense>;
  else if (/^\/proposals\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><NewProposal key={search} clientId={params.get("client")} dealId={params.get("deal")} /></Suspense>;
  else if (/^\/proposals\/questionnaire\/?$/.test(path)) page = <Suspense fallback={<Loading />}><QuestionnaireEditor /></Suspense>;
  else if (/^\/proposals\/questionnaire\/preview\/?$/.test(path)) page = <Suspense fallback={<Loading />}><QuestionnaireRunner key="preview" preview /></Suspense>;
  else if (/^\/proposals\/[^/]+\/questions\/?$/.test(path)) { const id = path.split("/")[2]; page = <Suspense fallback={<Loading />}><QuestionnaireRunner key={id} proposalId={id} /></Suspense>; }
  else if (/^\/proposals\/templates\/?$/.test(path)) page = <Suspense fallback={<Loading />}><ProposalTemplates /></Suspense>;
  else if (/^\/proposals\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsTemplates">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "template", templateId: id, proposal: true }} /></Suspense>; }
  else if (/^\/proposals\/[^/]+\/?$/.test(path)) { const id = path.split("/")[2]; page = <Suspense fallback={<Loading />}><ProposalBuilder key={id} proposalId={id} /></Suspense>; }
  else if (/^\/clients\/pipeline\/?$/.test(path)) page = <Suspense fallback={<Loading />}><Pipeline /></Suspense>;
  else if (/^\/clients\/follow-ups\/?$/.test(path)) page = <Suspense fallback={<Loading />}><FollowUps /></Suspense>;
  else if (/^\/clients\/testimonials\/?$/.test(path)) page = <Suspense fallback={<Loading />}><TestimonialsPage /></Suspense>;
  else if (/^\/clients\/deals\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><DealPage key={id} dealId={id} /></Suspense>; }
  else if (/^\/clients\/people\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><ContactPage key={id} personId={id} /></Suspense>; }
  else if (/^\/clients\/estimates\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><EstimatePage key={search} dealId={params.get("deal")} clientId={params.get("client")} projectId={params.get("project")} briefId={params.get("brief")} /></Suspense>;
  else if (/^\/clients\/estimates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><EstimatePage key={id} estimateId={id} /></Suspense>; }
  else if (/^\/clients\/?$/.test(path)) page = <ClientsPage />;
  else if (/^\/sent\/?$/.test(path)) page = <SentPage />;
  else if (sentNote && sentNote[1] !== "new") page = <SentNote key={sentNote[1]} noteId={sentNote[1] as Id<"inboxNotes">} sent={Number(params.get("sent")) || null} />;
  else if (/^\/sent\/new\/?$/.test(path)) page = <PostNote key={params.get("note") ?? "new"} noteId={(params.get("note") as Id<"inboxNotes"> | null) ?? null} clientId={(params.get("client") as Id<"clients"> | null) ?? null} />;
  else if (clientRec) { const t = params.get("tab"); page = <ClientPage key={clientRec[1]} clientId={clientRec[1] as Id<"clients">} tab={(["projects", "shared", "documents", "inbox", "brand", "settings"].includes(t ?? "") ? t : "overview") as ClientTab} />; }
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else if (path.startsWith("/register")) page = <Settings me={me} />; // now Settings › Register
  else if (/^\/settings\/help\/edit\/[^/]+\/?$/.test(path)) { const id = path.split("/")[4]; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "template", templateId: id as Id<"wsTemplates">, guide: params.get("guide") ?? "" }} /></Suspense>; }
  else if (/^\/settings\/brief\/questions\/?$/.test(path)) page = <Suspense fallback={<Loading />}><QuestionnaireEditor kind="kickoff" /></Suspense>;
  else if (/^\/settings\/brief\/preview\/?$/.test(path)) page = <ClientBriefPage key="preview" preview />;
  else if (path.startsWith("/settings")) page = <Settings me={me} />;
  else if (/^\/more\/?$/.test(path)) page = <MorePage me={me} side="owner" />;
  else if (/^\/review\/?$/.test(path)) page = <Home />; // Review's main page
  else page = <OwnerHome />; // "/": the back-office Home
  // Work surfaces get no background light, so nothing competes with the video or the document.
  const workSurface = Boolean(video) || /^\/sign\/(b|d)\//.test(path) || /^\/sign\/templates\/[^/]+/.test(path) || /^\/production\/call-sheets\/([^/]+\/edit|templates\/[^/]+)/.test(path) || /^\/settings\/help\/edit\//.test(path);
  return (
    <UploadProvider>
      <Shell me={me} overlay={Boolean(video)} light={!workSurface}>{page}</Shell>
    </UploadProvider>
  );
}

type MeRow = NonNullable<ReturnType<typeof useQuery<typeof api.users.me>>>;
function ClientShell({ me, overlay = false, children }: { me: MeRow; overlay?: boolean; children?: React.ReactNode }) {
  const mine = useQuery(api.shares.mine, {});
  const client = (mine ?? []).find((s) => s.client)?.client ?? null;
  return <Shell me={me} side="client" overlay={overlay} subtitle={client}>{children ?? <ClientRoutes me={me} />}</Shell>;
}

// A share link opened by a signed-in client: inside their portal (P1 / Client / Review › project); the video page
// fills the screen with the menu button (overlay). Owners and guests see the share page on its own, as before.
function ShareForMember({ video, page }: { video: boolean; page: (inShell: boolean) => React.ReactNode }) {
  const me = useQuery(api.users.me);
  if (me === undefined) return <Loading />;
  if (me && !me.allowed && me.role === "client") return <ClientShell me={me} overlay={video}>{page(true)}</ClientShell>;
  // On the vendor side with a client side too: offer the switch rather than a sign-in or "not allowed" (review, Nov 2).
  if (me && !me.allowed && me.role === "vendor" && (me.sides ?? []).includes("client")) return <ClientSidePrompt />;
  return <>{page(false)}</>;
}

// The client side (P1 / Client): Home, Inbox, Review, Docs, Settings, and More on phones.
function ClientRoutes({ me }: { me: { name: string | null; email: string } }) {
  const { path, search } = useLocation();
  const params = new URLSearchParams(search);
  if (/^\/more\/?$/.test(path)) return <MorePage me={me as never} side="client" />;
  if (/^\/messages\/?$/.test(path)) return <Suspense fallback={<Loading />}><ClientMessages /></Suspense>; // Phase 5d step 2
  if (/^\/inbox\/?$/.test(path)) return <ClientInbox itemId={params.get("item")} />;
  if (/^\/(docs|documents)\/?$/.test(path)) { const t = params.get("tab"); return <ClientDocuments tab={(t === "signed" || t === "cancelled" ? t : "to_sign") as DocTab} />; }
  if (/^\/review\/?$/.test(path)) return <ClientReview me={me} />;
  if (/^\/payments(\/invoices)?\/?$/.test(path)) return <Suspense fallback={<Loading />}><ClientInvoices /></Suspense>;
  if (/^\/payments\/subscriptions\/?$/.test(path)) return <Suspense fallback={<Loading />}><ClientSubscriptions /></Suspense>;
  const shoot = /^\/shoots\/([^/]+)\/?$/.exec(path);
  if (shoot) return <ClientShootPage key={shoot[1]} shootId={shoot[1]} />;
  const sheet = /^\/call-sheets\/([^/]+)\/?$/.exec(path); // Phase 5b step 3: a call sheet sent to them
  if (sheet) return <Suspense fallback={<Loading />}><ClientCallSheetPage key={sheet[1]} callSheetId={sheet[1]} /></Suspense>;
  const req = /^\/requests\/([^/]+)\/?$/.exec(path);
  if (req) return <ClientRequestPage key={req[1]} requestId={req[1]} />;
  const brief = /^\/briefs\/([^/]+)\/?$/.exec(path);
  if (brief) return <ClientBriefPage key={brief[1]} briefId={brief[1]} />;
  const words = /^\/words\/([^/]+)\/?$/.exec(path); // Phase 5 (D139): the testimonial form, from the request note
  if (words) return <ClientTestimonialPage key={words[1]} noteId={words[1]} />;
  const proj = /^\/projects\/([^/]+)\/?$/.exec(path);
  if (proj) { const t = params.get("tab"); return <ClientProject key={proj[1]} projectId={proj[1]} tab={(t === "videos" || t === "documents" ? t : "overview") as ClientProjectTab} />; }
  const help = /^\/help(?:\/([a-z0-9-]+))?\/?$/.exec(path);
  if (help) return <Suspense fallback={<Loading />}><HelpScreen key={help[1] ?? ""} base="/help" slug={help[1]} /></Suspense>;
  if (path.startsWith("/settings")) return <ClientSettings me={me} />;
  return <ClientHome />;
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

