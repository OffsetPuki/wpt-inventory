import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import Logo from "./Logo";
import { useTheme } from "./ThemeProvider";
import {
  LayoutDashboard,
  Search,
  Plus,
  Activity,
  FolderKanban,
  Map,
  Users,
  Sparkles,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
} from "lucide-react";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="rounded-lg p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Search;
  // "elevated" = manager + technician (oversight). "technician" = tech only.
  // Undefined = visible to everyone signed in.
  needs?: "elevated" | "technician";
}

// Managers see a curated subset: oversight (dashboard, projects, users) plus
// read-only floor screens (find items, map). Add Item and operational
// settings are hidden so the UI doesn't drown them in detail-level controls.
const NAV: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, needs: "elevated" },
  { to: "/home", label: "Find Items", icon: Search },
  { to: "/add", label: "Add Item", icon: Plus, needs: "technician" },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/map", label: "Shop Map", icon: Map },
  { to: "/users", label: "Users", icon: Users, needs: "elevated" },
  { to: "/admin/templates", label: "Job Templates", icon: Sparkles, needs: "technician" },
  { to: "/settings", label: "Settings", icon: Settings, needs: "technician" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isElevated, isTechnician } = useAuth();
  const [location] = useLocation();

  const entries = NAV.filter((e) => {
    if (e.needs === "technician") return isTechnician;
    if (e.needs === "elevated") return isElevated;
    return true;
  });

  return (
    <nav className="flex flex-col gap-1 px-3">
      {entries.map((e) => {
        const active =
          location === e.to ||
          (e.to !== "/home" && location.startsWith(e.to));
        const Icon = e.icon;
        return (
          <Link
            key={e.to}
            href={e.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{e.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">
            {user?.name}
          </p>
          <p className="text-xs capitalize text-muted-foreground">{user?.role}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center justify-between px-5 py-6">
          <Logo size="md" />
          <ThemeToggle />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks />
        </div>
        <UserFooter />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex items-center justify-between px-5 py-6">
              <Logo size="md" />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-sidebar-foreground hover:bg-sidebar-accent"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <UserFooter />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile topbar */}
        <header className="flex items-center gap-3 border-b border-border bg-sidebar px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-foreground hover:bg-accent"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Logo size="sm" />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="page-enter flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
