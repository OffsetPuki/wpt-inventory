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

// Business-suite modules
const CrmOverviewPage = lazy(() => import("./pages/crm/index"));
const CrmLeadsPage = lazy(() => import("./pages/crm/leads"));
const CrmDealsPage = lazy(() => import("./pages/crm/deals"));
const CrmClientsPage = lazy(() => import("./pages/crm/clients"));
const CrmEstimatesPage = lazy(() => import("./pages/crm/estimates"));
const CrmQuoteBuilderPage = lazy(() => import("./pages/crm/quotes"));
const CrmProductsPage = lazy(() => import("./pages/crm/products"));
const MarketingPage = lazy(() => import("./pages/marketing/index"));
const HrOverviewPage = lazy(() => import("./pages/hr/index"));
const HrEmployeesPage = lazy(() => import("./pages/hr/employees"));
const HrAttendancePage = lazy(() => import("./pages/hr/attendance"));
const HrPayrollPage = lazy(() => import("./pages/hr/payroll"));
const HrLeavePage = lazy(() => import("./pages/hr/leave"));
const HrRecruitmentPage = lazy(() => import("./pages/hr/recruitment"));
const HrReviewsPage = lazy(() => import("./pages/hr/reviews"));
const PmBoardPage = lazy(() => import("./pages/pm/board"));
const PmGanttPage = lazy(() => import("./pages/pm/gantt"));
const PmTimePage = lazy(() => import("./pages/pm/time"));
const PmTimesheetsPage = lazy(() => import("./pages/pm/timesheets"));
const PmContractsPage = lazy(() => import("./pages/pm/contracts"));
const PmKbPage = lazy(() => import("./pages/pm/kb"));
const FinanceOverviewPage = lazy(() => import("./pages/finance/index"));
const FinanceInvoicesPage = lazy(() => import("./pages/finance/invoices"));
const FinanceExpensesPage = lazy(() => import("./pages/finance/expenses"));
const FinancePaymentsPage = lazy(() => import("./pages/finance/payments"));
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

          {/* CRM & Sales — the whole team works leads and estimates */}
          <Route path="/crm">
            <CrmOverviewPage />
          </Route>
          <Route path="/crm/leads">
            <CrmLeadsPage />
          </Route>
          <Route path="/crm/deals">
            <CrmDealsPage />
          </Route>
          <Route path="/crm/clients">
            <CrmClientsPage />
          </Route>
          <Route path="/crm/estimates">
            <CrmEstimatesPage />
          </Route>
          <Route path="/crm/quotes">
            <CrmQuoteBuilderPage />
          </Route>
          <Route path="/crm/products">
            <CrmProductsPage />
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
          <Route path="/pm/gantt">
            <PmGanttPage />
          </Route>
          <Route path="/pm/time">
            <PmTimePage />
          </Route>
          <Route path="/pm/timesheets">
            <PmTimesheetsPage />
          </Route>
          <Route path="/pm/contracts">
            <PmContractsPage />
          </Route>
          <Route path="/pm/kb">
            <PmKbPage />
          </Route>

          {/* HR & Payroll — self-service pages open to everyone; the
              oversight pages are elevated */}
          <Route path="/hr">
            <ElevatedRoute>
              <HrOverviewPage />
            </ElevatedRoute>
          </Route>
          <Route path="/hr/employees">
            <ElevatedRoute>
              <HrEmployeesPage />
            </ElevatedRoute>
          </Route>
          <Route path="/hr/attendance">
            <HrAttendancePage />
          </Route>
          <Route path="/hr/payroll">
            <HrPayrollPage />
          </Route>
          <Route path="/hr/leave">
            <HrLeavePage />
          </Route>
          <Route path="/hr/recruitment">
            <ElevatedRoute>
              <HrRecruitmentPage />
            </ElevatedRoute>
          </Route>
          <Route path="/hr/reviews">
            <ElevatedRoute>
              <HrReviewsPage />
            </ElevatedRoute>
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
          <Route path="/finance/payments">
            <ElevatedRoute>
              <FinancePaymentsPage />
            </ElevatedRoute>
          </Route>
          <Route path="/finance/purchase-orders">
            <ElevatedRoute>
              <FinancePurchaseOrdersPage />
            </ElevatedRoute>
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
