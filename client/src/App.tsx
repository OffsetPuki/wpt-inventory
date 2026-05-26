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
const NotFoundPage = lazy(() => import("./pages/not-found"));

// ─── Loading spinner ────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// ─── Route guard: Manager ───────────────────────────────────────────────────

function ManagerRoute({ children }: { children: ReactNode }) {
  const { isManager } = useAuth();

  if (!isManager) {
    return <Redirect to="/home" />;
  }

  return <>{children}</>;
}

// ─── Root redirect based on role ────────────────────────────────────────────

function RoleRedirect() {
  const { isManager } = useAuth();
  return <Redirect to={isManager ? "/dashboard" : "/home"} />;
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

          {/* Add item — available to workers and managers */}
          <Route path="/add">
            <AddItemPage />
          </Route>

          {/* Manager routes */}
          <Route path="/dashboard">
            <ManagerRoute>
              <DashboardPage />
            </ManagerRoute>
          </Route>

          <Route path="/users">
            <ManagerRoute>
              <UsersPage />
            </ManagerRoute>
          </Route>

          <Route path="/settings">
            <ManagerRoute>
              <SettingsPage />
            </ManagerRoute>
          </Route>

          <Route path="/admin/templates">
            <ManagerRoute>
              <AdminTemplatesPage />
            </ManagerRoute>
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
