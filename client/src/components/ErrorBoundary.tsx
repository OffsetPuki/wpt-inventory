import { Component, type ReactNode, type ErrorInfo } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; stale:boolean }
> {
  state = { failed: false, stale:false };
  static getDerivedStateFromError(error:Error) {
    return { failed:true,stale:/dynamically imported module|Loading chunk|Importing a module script|Failed to fetch/i.test(error.message) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to render", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">{this.state.stale ? "A newer app version is available" : "This page could not open"}</h1>
        <p className="my-4 text-muted-foreground">
          {this.state.stale ? "Reload to get the current version. Saved records are safe; unsaved edits on this page may need to be entered again." : "Reload to try again. Your saved records are still in the suite."}
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
