import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useAuth } from "./lib/auth";
import { type ReactNode } from "react";

// ─── Page imports ────────────────────────────────────────────────────────────

import AppShell from "./components/AppShell";
import LoginPage from "./pages/login";
import HomePage from "./pages/home";
import AddItemPage from "./pages/add";
import ItemDetailPage from "./pages/item-detail";
import ItemEditPage from "./pages/item-edit";
import DashboardPage from "./pages/dashboard";
import ActivityPage from "./pages/activity";
import ProjectsPage from "./pages/projects";
import ProjectDetailPage from "./pages/project-detail";
import MapPage from "./pages/map";
import UsersPage from "./pages/users";
import SettingsPage from "./pages/settings";
import AdminPresetsPage from "./pages/admin-presets";
import AdminTemplatesPage from "./pages/admin-templates";
import NotFoundPage from "./pages/not-found";

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
        <Switch>
          <Route path="/">
            <LoginPage />
          </Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Router>
    );
  }

  return (
    <Router hook={useHashLocation}>
      <AppShell>
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
            {(params) => (
              <ManagerRoute>
                <ItemEditPage id={params.id} />
              </ManagerRoute>
            )}
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

          <Route path="/admin/presets">
            <ManagerRoute>
              <AdminPresetsPage />
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
      </AppShell>
    </Router>
  );
}
