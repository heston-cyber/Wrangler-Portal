import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "@fontsource/saira/latin-400.css";
import "@fontsource/saira/latin-500.css";
import "@fontsource/saira/latin-600.css";
import "@fontsource/saira/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/instrument-serif/latin-400.css";
import "./styles.css";
import "./d1.css";
import { applyTheme } from "./lib/theme";

applyTheme();

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = new ConvexReactClient(url || "https://handsome-hummingbird-11.convex.cloud");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <ErrorBoundary><App /></ErrorBoundary>
    </ConvexAuthProvider>
  </React.StrictMode>,
);
