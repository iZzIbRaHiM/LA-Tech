import { Routes, Route, Navigate } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Departments from './pages/Departments';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import { FinanceOverview, FinanceLedger } from './pages/Finance';

function Gate() {
  const { user, loading } = useAuth();
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
        {/* Finance routes render only for the CEO; the API enforces it regardless. */}
        {user.isCeo && <Route path="finance" element={<FinanceOverview />} />}
        {user.isCeo && <Route path="finance/:projectId" element={<FinanceLedger />} />}
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}

export default function PortalApp() {
  return (
    <AuthProvider>
      <Gate />
      <Toaster position="bottom-right" />
    </AuthProvider>
  );
}
