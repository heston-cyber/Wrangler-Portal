// If the page throws, show what happened instead of going black (Oct 23), and offer a reload.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) { console.error("Page error", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <div className="signin">
        <div style={{ width: "min(520px, 100%)", display: "grid", gap: 14, position: "relative" }}>
          <span className="eyebrow">Wrangler Review</span>
          <h1 className="title" style={{ margin: 0 }}>Something broke on this page.</h1>
          <p className="caption" style={{ margin: 0 }}>Reloading usually fixes it. If it keeps happening, send Heston this line:</p>
          <code style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: 10, borderRadius: 10, background: "var(--surface-raised)" }}>{e.name}: {e.message}{"\n"}{(e.stack ?? "").split("\n").slice(1, 4).join("\n")}</code>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
            <button className="btn" onClick={() => { location.href = "/"; }}>Home</button>
          </div>
        </div>
      </div>
    );
  }
}
