import { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export default function Header({ title, description, children }: HeaderProps) {
  return (
    <div className="suite-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>
        )}
      </div>
      {children && (
        <div className="suite-page-actions flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
