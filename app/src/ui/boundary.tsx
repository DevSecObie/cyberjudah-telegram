import { Component, type ReactNode } from "react";

/**
 * When a screen fails to draw, the app must not go black. A stale screen file (a new release went
 * out while the app was open) reloads once to pick up the new one; anything else shows what happened
 * and a way on, and the next navigation tries again.
 */
const CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

export class ScreenBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    if (CHUNK.test(error.message)) {
      try { if (!sessionStorage.getItem("cj:reloaded")) { sessionStorage.setItem("cj:reloaded", "1"); location.reload(); return; } } catch { /* ignore */ }
    }
    console.error(error);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen crash" role="alert">
        <h1 className="title">This screen didn't open</h1>
        <p className="hint">Something went wrong drawing it. Your highlights, notes and tabs are safe.</p>
        <div className="crash__actions">
          <button type="button" className="crash__btn crash__btn--main" onClick={() => { const at = location.href; history.back(); window.setTimeout(() => { if (location.href === at) location.assign(import.meta.env.BASE_URL); }, 400); }}>Go back</button>
          <button type="button" className="crash__btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
