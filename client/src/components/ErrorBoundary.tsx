import { Component, type ReactNode, type ErrorInfo } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to render", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">This page could not open</h1>
        <p className="my-4 text-muted-foreground">
          Reload to try again. Your saved records are still in the suite.
        </p>
        <button
          className="rounded-xl bg-primary px-4 py-3 text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
        <a
          className="ml-4 underline"
          href="/#/dashboard"
          onClick={() => this.setState({ failed: false })}
        >
          Return to dashboard
        </a>
      </main>
    );
  }
}
