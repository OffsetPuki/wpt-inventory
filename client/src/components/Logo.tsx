import { Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Settings } from "@shared/schema";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export default function Logo({ size = "md", showText = true }: LogoProps) {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await apiRequest("GET", "/api/settings")).json(),
    staleTime: 60_000,
    refetchInterval: false,
  });

  const name = settings?.companyName || "CJM Metals";
  const logoUrl = settings?.logoUrl;

  const iconSize = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const textSize = size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl";

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative shrink-0">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            className={`${iconSize} rounded-lg border border-border object-contain`}
          />
        ) : (
          <Layers className={`${iconSize} text-primary`} />
        )}
      </div>
      {showText && (
        <div className="flex min-w-0 flex-col">
          <span className={`${textSize} truncate font-bold leading-tight tracking-tight text-foreground`}>
            {name}
          </span>
          <span className="text-[10px] uppercase leading-none tracking-[0.2em] text-muted-foreground">
            {settings?.companyTagline || "Custom Metalwork"}
          </span>
        </div>
      )}
    </div>
  );
}
