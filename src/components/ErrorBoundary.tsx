import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // PRODUCTION INTEGRATION: forward to error monitoring (Sentry, etc.). Never include form values.
    console.error('[rr:error]', error.message, info.componentStack?.slice(0, 400));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state-page" role="alert">
        <div className="state-card stack">
          <h1 style={{ fontSize: 'var(--step-4)' }}>This page didn’t load.</h1>
          <p className="muted">Your progress and any purchase are safe. Reload the page, or return to your access page.</p>
          <div className="cta-row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => location.reload()}>Reload page</button>
            <a className="btn btn-outline" href="/access">Go to my access</a>
          </div>
        </div>
      </div>
    );
  }
}
