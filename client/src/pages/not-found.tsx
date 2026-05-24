import { useLocation } from "wouter";

export default function NotFoundPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-6xl font-bold text-gradient-primary">404</h1>
      <p className="text-lg text-muted-foreground">Page not found</p>
      <button
        onClick={() => setLocation("/")}
        className="mt-4 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-default hover:opacity-90"
      >
        Go Home
      </button>
    </div>
  );
}
