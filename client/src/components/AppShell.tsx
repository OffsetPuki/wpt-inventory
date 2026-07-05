import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import Logo from "./Logo";
import SearchBar from "./SearchBar";
import { useTheme } from "./ThemeProvider";
import {
  LayoutDashboard,
  Search,
  Plus,
  Activity,
  FolderKanban,
  ClipboardList,
  Map,
  Users,
  Sparkles,
  Settings,
  ShieldCheck,
  Trash2,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronDown,
  BarChart3,
  UserPlus,
  Handshake,
  Contact,
  FileText,
  Package,
  Megaphone,
  Kanban,
  GanttChart,
  Timer,
  CalendarDays,
  BookOpen,
  Briefcase,
  Banknote,
  Receipt,
  CreditCard,
  Landmark,
  ClipboardCheck,
  Star,
  Clock4,
  Users2,
  PencilRuler,
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
  // "elevated" = manager + technician. "technician" = tech only.
  // Undefined = visible to everyone signed in.
  needs?: "elevated" | "technician";
}

interface NavGroup {
  key: string;
  label: string;
  needs?: "elevated" | "technician";
  entries: NavEntry[];
}

// The suite is organized by business function. Entry-level visibility mirrors
// the API: workers get the floor tools (sales, projects, inventory, their own
// HR self-service); managers add oversight (dashboard, marketing, finance);
// technicians add the operational knobs (settings, templates).
const NAV_GROUPS: NavGroup[] = [
  {
    key: "crm",
    label: "CRM & Sales",
    entries: [
      { to: "/crm", label: "Sales Overview", icon: BarChart3 },
      { to: "/crm/leads", label: "Leads", icon: UserPlus },
      { to: "/crm/deals", label: "Deals", icon: Handshake },
      { to: "/crm/clients", label: "Clients", icon: Contact },
      { to: "/crm/estimates", label: "Estimates", icon: FileText },
      { to: "/crm/quotes", label: "Quote Builder", icon: PencilRuler },
      { to: "/crm/products", label: "Products", icon: Package },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    needs: "elevated",
    entries: [{ to: "/marketing", label: "Control Center", icon: Megaphone }],
  },
  {
    key: "projects",
    label: "Projects",
    entries: [
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/pm/board", label: "Board", icon: Kanban },
      { to: "/pm/gantt", label: "Gantt", icon: GanttChart },
      { to: "/pm/time", label: "Time Tracking", icon: Timer },
      { to: "/pm/timesheets", label: "Timesheets", icon: CalendarDays },
      { to: "/pm/contracts", label: "Contracts & SOWs", icon: ClipboardCheck },
      { to: "/pm/kb", label: "Knowledge Base", icon: BookOpen },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    entries: [
      { to: "/home", label: "Find Items", icon: Search },
      { to: "/add", label: "Add Item", icon: Plus, needs: "technician" },
      { to: "/activity", label: "Activity", icon: Activity },
      { to: "/map", label: "Shop Map", icon: Map },
    ],
  },
  {
    key: "hr",
    label: "HR & Payroll",
    entries: [
      { to: "/hr", label: "Overview", icon: Briefcase, needs: "elevated" },
      { to: "/hr/employees", label: "Employees", icon: Users2, needs: "elevated" },
      { to: "/hr/attendance", label: "Attendance", icon: Clock4 },
      { to: "/hr/payroll", label: "Payroll", icon: Banknote },
      { to: "/hr/leave", label: "Leave", icon: CalendarDays },
      { to: "/hr/recruitment", label: "Recruitment", icon: UserPlus, needs: "elevated" },
      { to: "/hr/reviews", label: "Reviews", icon: Star, needs: "elevated" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    needs: "elevated",
    entries: [
      { to: "/finance", label: "Accounting", icon: Landmark },
      { to: "/finance/invoices", label: "Invoices", icon: Receipt },
      { to: "/finance/expenses", label: "Expenses", icon: Banknote },
      { to: "/finance/payments", label: "Payments", icon: CreditCard },
      { to: "/finance/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    needs: "elevated",
    entries: [
      { to: "/users", label: "Users", icon: Users, needs: "elevated" },
      { to: "/audit", label: "Audit Log", icon: ShieldCheck, needs: "elevated" },
      { to: "/trash", label: "Trash", icon: Trash2, needs: "elevated" },
      { to: "/admin/templates", label: "Job Templates", icon: Sparkles, needs: "technician" },
      { to: "/settings", label: "Settings", icon: Settings, needs: "technician" },
    ],
  },
];

function groupForLocation(location: string): string | null {
  for (const g of NAV_GROUPS) {
    if (g.entries.some((e) => location === e.to || (e.to !== "/home" && location.startsWith(e.to)))) {
      return g.key;
    }
  }
  return null;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isElevated, isTechnician } = useAuth();
  const [location] = useLocation();
  // Only the group for the screen you're on starts open — keeps the sidebar
  // short and scannable. Manual toggles stick for the session.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const active = groupForLocation(location);
    return active ? { [active]: true } : { crm: true };
  });

  // Navigating into a group (e.g. via a cross-link) opens it.
  useEffect(() => {
    const active = groupForLocation(location);
    if (active) setOpen((o) => (o[active] ? o : { ...o, [active]: true }));
  }, [location]);

  const canSee = (needs?: "elevated" | "technician") => {
    if (needs === "technician") return isTechnician;
    if (needs === "elevated") return isElevated;
    return true;
  };

  const linkCls = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-sidebar-primary text-sidebar-primary-foreground"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {/* Dashboard stands alone above the groups */}
      {isElevated && (
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={linkCls(location === "/dashboard")}
        >
          <LayoutDashboard className="h-[18px] w-[18px] shrink-0" />
          <span>Dashboard</span>
        </Link>
      )}

      {NAV_GROUPS.map((g) => {
        if (!canSee(g.needs)) return null;
        const entries = g.entries.filter((e) => canSee(e.needs));
        if (entries.length === 0) return null;
        const isOpen = !!open[g.key];
        const containsActive = groupForLocation(location) === g.key;
        return (
          <div key={g.key} className="mt-1.5">
            <button
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                containsActive && !isOpen
                  ? "text-sidebar-primary"
                  : "text-muted-foreground hover:text-sidebar-foreground"
              )}
            >
              {g.label}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")}
              />
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5">
                {entries.map((e) => {
                  // Exact match only — group routes share prefixes (/crm is a
                  // prefix of /crm/leads), so prefix matching would light up
                  // two entries at once. Detail pages (/project/:id …) use
                  // different path roots, so nothing is lost.
                  const active = location === e.to;
                  const Icon = e.icon;
                  return (
                    <Link key={e.to} href={e.to} onClick={onNavigate} className={linkCls(active)}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span>{e.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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

function UserChip() {
  const { user } = useAuth();
  const initials = (user?.name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {initials}
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-sm font-semibold leading-tight text-foreground">{user?.name}</p>
        <p className="text-xs capitalize leading-tight text-muted-foreground">{user?.role}</p>
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
        <div className="flex items-center px-5 py-5">
          <Logo size="md" />
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
            <div className="flex items-center justify-between px-5 py-5">
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

        {/* Desktop topbar — global search + theme + who's signed in */}
        <header className="hidden h-16 items-center gap-4 border-b border-border bg-sidebar px-6 lg:flex">
          <SearchBar />
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <UserChip />
          </div>
        </header>

        <main className="page-enter flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
