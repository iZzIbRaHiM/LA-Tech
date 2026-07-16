import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from './AuthContext';
import PortalErrorBoundary from './components/PortalErrorBoundary';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Departments from './pages/Departments';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Audit from './pages/Audit';
import People from './pages/People';
import Settings from './pages/Settings';
import Salary from './pages/Salary';
import Chat from './pages/Chat';
import Meetings from './pages/Meetings';
import MeetingRoom from './pages/MeetingRoom';
import { FinanceOverview, FinanceLedger } from './pages/Finance';

// React Flow + dagre are a meaningful bundle addition and only the CEO ever
// opens this page — lazy-load it so nobody else pays for it.
const OrgChart = lazy(() => import('./pages/OrgChart'));

const TITLES: Array<[string, string]> = [
  ['/portal/org', 'Org Chart'],
  ['/portal/meetings', 'Meetings'],
  ['/portal/people', 'People'],
  ['/portal/departments', 'Departments'],
  ['/portal/tasks', 'Tasks'],
  ['/portal/projects', 'Projects'],
  ['/portal/attendance', 'Attendance'],
  ['/portal/leave', 'Leave'],
  ['/portal/chat', 'Chat'],
  ['/portal/finance', 'Finance'],
  ['/portal/salary', 'Salary'],
  ['/portal/audit', 'Audit Log'],
  ['/portal/settings', 'Settings'],
];

function Gate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // The tab otherwise shows the marketing site's SEO title on every portal
  // page — set a proper per-section title instead.
  useEffect(() => {
    const section = TITLES.find(([prefix]) => location.pathname.startsWith(prefix))?.[1];
    document.title = section ? `${section} · LATech Portal` : 'LATech Portal';
  }, [location.pathname]);
  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center text-sm text-[#71717A]">
        Loading…
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="departments" element={<Departments />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="leave" element={<Leave />} />
        <Route path="chat" element={<Chat />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingRoom />} />
        {/* Role-gated routes render conditionally; the API enforces access regardless. */}
        {(user.isCeo || user.financeAccess) && <Route path="finance" element={<FinanceOverview />} />}
        {(user.isCeo || user.financeAccess) && <Route path="finance/:projectId" element={<FinanceLedger />} />}
        {user.isCeo && (
          <Route
            path="org"
            element={
              <Suspense fallback={<div className="p-8 text-sm text-[#71717A]">Loading…</div>}>
                <OrgChart />
              </Suspense>
            }
          />
        )}
        {user.isCeo && <Route path="audit" element={<Audit />} />}
        {user.isCeo && <Route path="people" element={<People />} />}
        {user.isCeo && <Route path="settings" element={<Settings />} />}
        {user.isCeo && <Route path="salary" element={<Salary />} />}
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}

export default function PortalApp() {
  return (
    <PortalErrorBoundary>
      <AuthProvider>
        <Gate />
        <Toaster position="bottom-right" />
      </AuthProvider>
    </PortalErrorBoundary>
  );
}
