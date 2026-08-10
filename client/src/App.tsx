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
const EmailsPage = lazy(() => import("./pages/emails"));
const TrashPage = lazy(() => import("./pages/trash"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

// Business-suite modules
const CrmOverviewPage = lazy(() => import("./pages/crm/index"));
const CrmLeadsPage = lazy(() => import("./pages/crm/leads"));
const CrmClientsPage = lazy(() => import("./pages/crm/clients"));
const CrmQuoteBuilderPage = lazy(() => import("./pages/crm/quotes"));
const MarketingPage = lazy(() => import("./pages/marketing/index"));
const HrEmployeesPage = lazy(() => import("./pages/hr/employees"));
const HrPayrollPage = lazy(() => import("./pages/hr/payroll"));
const HrLeavePage = lazy(() => import("./pages/hr/leave"));
const PmBoardPage = lazy(() => import("./pages/pm/board"));
const PmSchedulePage = lazy(() => import("./pages/pm/schedule"));
const PmTimePage = lazy(() => import("./pages/pm/time"));
const PmContractsPage = lazy(() => import("./pages/pm/contracts"));
const FinanceOverviewPage = lazy(() => import("./pages/finance/index"));
const FinanceInvoicesPage = lazy(() => import("./pages/finance/invoices"));
const FinanceExpensesPage = lazy(() => import("./pages/finance/expenses"));
const FinancePurchaseOrdersPage = lazy(() => import("./pages/finance/purchase-orders"));

// ─── Loading spinner ────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// ─── Route guards ───────────────────────────────────────────────────────────

// Oversight / operational screens (dashboard, users, settings, templates…) —
// owner-only; workers are redirected to the floor tools.
function ElevatedRoute({ children }: { children: ReactNode }) {
  const { isElevated } = useAuth();
  if (!isElevated) return <Redirect to="/home" />;
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

          <Route path="/add">
            <AddItemPage />
          </Route>

          {/* CRM & Sales — the whole team works leads and quotes */}
          <Route path="/crm">
            <CrmOverviewPage />
          </Route>
          <Route path="/crm/leads">
            <CrmLeadsPage />
          </Route>
          <Route path="/crm/clients">
            <CrmClientsPage />
          </Route>
          <Route path="/crm/quotes">
            <CrmQuoteBuilderPage />
          </Route>

          {/* Marketing control center — management view */}
          <Route path="/marketing">
            <ElevatedRoute>
              <MarketingPage />
            </ElevatedRoute>
          </Route>

          {/* Project management */}
          <Route path="/pm/board">
            <PmBoardPage />
          </Route>
          <Route path="/pm/schedule">
            <PmSchedulePage />
          </Route>
          <Route path="/pm/time">
            <PmTimePage />
          </Route>
          <Route path="/pm/contracts">
            <PmContractsPage />
          </Route>

          {/* HR — self-service pages open to everyone; the oversight pages
              are elevated */}
          <Route path="/hr/employees">
            <ElevatedRoute>
              <HrEmployeesPage />
            </ElevatedRoute>
          </Route>
          <Route path="/hr/payroll">
            <ElevatedRoute>
              <HrPayrollPage />
            </ElevatedRoute>
          </Route>
          <Route path="/hr/leave">
            <HrLeavePage />
          </Route>

          {/* Finance — management only */}
          <Route path="/finance">
            <ElevatedRoute>
              <FinanceOverviewPage />
            </ElevatedRoute>
          </Route>
          <Route path="/finance/invoices">
            <ElevatedRoute>
              <FinanceInvoicesPage />
            </ElevatedRoute>
          </Route>
          <Route path="/finance/expenses">
            <ElevatedRoute>
              <FinanceExpensesPage />
            </ElevatedRoute>
          </Route>
          <Route path="/finance/purchase-orders">
            <ElevatedRoute>
              <FinancePurchaseOrdersPage />
            </ElevatedRoute>
          </Route>

          {/* Owner routes */}
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

          <Route path="/emails">
            <ElevatedRoute>
              <EmailsPage />
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

          <Route path="/settings">
            <ElevatedRoute>
              <SettingsPage />
            </ElevatedRoute>
          </Route>

          <Route path="/admin/templates">
            <ElevatedRoute>
              <AdminTemplatesPage />
            </ElevatedRoute>
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
