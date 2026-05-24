import { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export default function Header({ title, description, children }: HeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2 mt-3 sm:mt-0 flex-wrap">{children}</div>
      )}
    </div>
  );
}
