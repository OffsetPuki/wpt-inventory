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

  const name = (!settings?.companyName || settings.companyName === "CJM Metals") ? "CJM Trades" : settings.companyName;
  const tagline = !settings?.companyTagline || settings.companyTagline === "Custom metalwork. No shortcuts." ? "Metals · Concrete · Insulation" : settings.companyTagline;
  const logoUrl = settings?.logoUrl;

  const iconSize = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const textSize = size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl";

  return (
    // min-w-0 so the block can actually shrink in a flex row: the tagline below
    // is `truncate` (white-space:nowrap), which otherwise sets a min-content width
    // wide enough to shove the topbar theme toggle off the right edge of a phone.
    <div className="flex min-w-0 items-center gap-2.5">
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
          <span className="text-[9px] uppercase leading-tight tracking-wide text-muted-foreground">
            {tagline}
          </span>
        </div>
      )}
    </div>
  );
}
