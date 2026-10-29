import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-offwhite px-6 text-center">
        <h1 className="text-[26px] font-semibold text-navy-900">Something went wrong</h1>
        <p className="mt-2 text-charcoal/70">Please refresh the page to continue exploring.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 h-11 rounded-full bg-gold px-6 font-semibold text-navy-900">
          Refresh
        </button>
      </div>
    );
  }
}
