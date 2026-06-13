import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useAuth } from "./lib/auth";
import { Suspense, lazy, type ReactNode } from "react";

// ─── Page imports ────────────────────────────────────────────────────────────
// Pages are lazy so each route ships its own chunk — the initial bundle stays
// small and the user only downloads code for the screens they actually open.

import AppShell from "./components/AppShell";
const LoginPage = lazy(() => import("./pages/login"));
const HomePage = lazy(() => import("./pages/home"));
const AddItemPage = lazy(() => import("./pages/add"));
const ItemDetailPage = lazy(() => import("./pages/item-detail"));
const ItemEditPage = lazy(() => import("./pages/item-edit"));
const DashboardPage = lazy(() => import("./pages/dashboard"));
const ActivityPage = lazy(() => import("./pages/activity"));
const ProjectsPage = lazy(() => import("./pages/projects"));
const ProjectDetailPage = lazy(() => import("./pages/project-detail"));
const MapPage = lazy(() => import("./pages/map"));
const UsersPage = lazy(() => import("./pages/users"));
const SettingsPage = lazy(() => import("./pages/settings"));
const AdminTemplatesPage = lazy(() => import("./pages/admin-templates"));
const AuditLogPage = lazy(() => import("./pages/audit-log"));
const TrashPage = lazy(() => import("./pages/trash"));
const PurchaseOrdersPage = lazy(() => import("./pages/pos"));
const QuickBooksPage = lazy(() => import("./pages/qb"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

// ─── Loading spinner ────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// ─── Route guards ───────────────────────────────────────────────────────────

// Dashboard, users, projects (and other oversight screens) — visible to both
// the new Manager role and Technicians.
function ElevatedRoute({ children }: { children: ReactNode }) {
  const { isElevated } = useAuth();
  if (!isElevated) return <Redirect to="/home" />;
  return <>{children}</>;
}

// Settings, job templates (and other low-level operational screens) — kept
// out of the manager's nav to avoid overwhelming them with technical knobs.
function TechnicianRoute({ children }: { children: ReactNode }) {
  const { isTechnician } = useAuth();
  if (!isTechnician) return <Redirect to="/home" />;
  return <>{children}</>;
}

// ─── Root redirect based on role ────────────────────────────────────────────

function RoleRedirect() {
  const { isElevated } = useAuth();
  return <Redirect to={isElevated ? "/dashboard" : "/home"} />;
}

// ─── Root app component ─────────────────────────────────────────────────────

export default function App() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return (
      <Router hook={useHashLocation}>
        <Suspense fallback={<LoadingSpinner />}>
          <Switch>
            <Route path="/">
              <LoginPage />
            </Route>
            <Route>
              <Redirect to="/" />
            </Route>
          </Switch>
        </Suspense>
      </Router>
    );
  }

  return (
    <Router hook={useHashLocation}>
      <AppShell>
        <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          {/* Root redirect */}
          <Route path="/">
            <RoleRedirect />
          </Route>

          {/* Worker routes */}
          <Route path="/home">
            <HomePage />
          </Route>

          <Route path="/item/:id/edit">
            {(params) => <ItemEditPage id={params.id} />}
          </Route>

          <Route path="/item/:id">
            {(params) => <ItemDetailPage id={params.id} />}
          </Route>

          <Route path="/activity">
            <ActivityPage />
          </Route>

          <Route path="/projects">
            <ProjectsPage />
          </Route>

          <Route path="/project/:id">
            {(params) => <ProjectDetailPage id={params.id} />}
          </Route>

          <Route path="/map">
            <MapPage />
          </Route>

          <Route path="/pos">
            <PurchaseOrdersPage />
          </Route>

          {/* Add item — available to workers and technicians; nav hides it
              for managers (kept reachable by direct URL for now). */}
          <Route path="/add">
            <AddItemPage />
          </Route>

          {/* Manager + Technician routes */}
          <Route path="/dashboard">
            <ElevatedRoute>
              <DashboardPage />
            </ElevatedRoute>
          </Route>

          <Route path="/users">
            <ElevatedRoute>
              <UsersPage />
            </ElevatedRoute>
          </Route>

          <Route path="/audit">
            <ElevatedRoute>
              <AuditLogPage />
            </ElevatedRoute>
          </Route>

          <Route path="/trash">
            <ElevatedRoute>
              <TrashPage />
            </ElevatedRoute>
          </Route>

          {/* Technician-only routes */}
          <Route path="/settings">
            <TechnicianRoute>
              <SettingsPage />
            </TechnicianRoute>
          </Route>

          <Route path="/admin/templates">
            <TechnicianRoute>
              <AdminTemplatesPage />
            </TechnicianRoute>
          </Route>

          <Route path="/qb">
            <TechnicianRoute>
              <QuickBooksPage />
            </TechnicianRoute>
          </Route>

          {/* 404 fallback */}
          <Route>
            <NotFoundPage />
          </Route>
        </Switch>
        </Suspense>
      </AppShell>
    </Router>
  );
}
