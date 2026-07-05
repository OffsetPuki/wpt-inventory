import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import QuoteBuilder from "@/quote/QuoteBuilder.jsx";
import "@/quote/quote.css";

// The builder ports the standalone CJM Quote app (plain JSX + its own scoped
// stylesheet — see client/src/quote/). This page only fetches the shared
// price book + shop identity before mounting it, so the builder can keep its
// original synchronous state model.

interface QuoteSettings {
  priceBook: Record<string, unknown>;
  shop: Record<string, unknown>;
}

export default function QuoteBuilderPage() {
  const { data, isLoading, error } = useQuery<QuoteSettings>({
    queryKey: ["quote-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/quotes/settings")).json(),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl">
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Could not load the quote builder's price book —{" "}
          {(error as Error | null)?.message ?? "no settings returned"}. Refresh to try again.
        </p>
      </div>
    );
  }

  return <QuoteBuilder initialSettings={data} />;
}
