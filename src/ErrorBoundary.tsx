// If the page throws, show what happened instead of going black (Oct 23), and offer a reload.
import { Component, type ReactNode } from "react";
import { SystemPage } from "./shell/SignIn";
import { Button } from "./ui/wp";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) { console.error("Page error", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <SystemPage icon="alert" eyebrow="Wrangler Review" title="Something broke on this page." body="Reloading usually fixes it. If it keeps happening, send Heston this line:">
        <code className="wp-errline">{e.name}: {e.message}{"\n"}{(e.stack ?? "").split("\n").slice(1, 4).join("\n")}</code>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="primary" size="sm" onClick={() => location.reload()}>Reload</Button>
          <Button size="sm" onClick={() => { location.href = "/"; }}>Home</Button>
        </div>
      </SystemPage>
    );
  }
}
