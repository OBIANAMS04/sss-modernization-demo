import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { isAuthenticated } from './utils/tokenManager';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import MfaSetup from './components/Auth/MfaSetup';
import MfaVerify from './components/Auth/MfaVerify';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Dashboard from './components/Dashboard/Dashboard';
import CaseManagerDashboard from './components/Dashboard/CaseManagerDashboard';
import LeadershipDashboard from './components/Dashboard/LeadershipDashboard';
import AdminDashboard from './components/Dashboard/AdminDashboard';
import Profile from './components/Profile/Profile';
import CaseList from './components/Cases/CaseList';
import CaseDetail from './components/Cases/CaseDetail';
import ComplianceDashboard from './components/Compliance/ComplianceDashboard';
import ComplianceAudit from './components/Compliance/ComplianceAudit';
import FreshnessDashboard from './components/Freshness/FreshnessDashboard';
import AuditLog from './components/Audit/AuditLog';
import StaffAccess from './components/Staff/StaffAccess';
import AccessPolicies from './components/Admin/AccessPolicies';
import Assistant from './components/Assistant/Assistant';
import ReviewQueue from './components/Assistant/ReviewQueue';
import AiQuality from './components/AiQuality/AiQuality';
import Observability from './components/Observability/Observability';
import './App.css';

// A signed-in person is sent on to the dashboard. The check is made each time the route renders, not once when the app
// loads (useAuth): when a session ends or someone signs out, /login has to be reachable from any state, otherwise the
// redirects bounce between /login and /dashboard forever and the page stays blank.
const SignedOutOnly = ({ children }) => (isAuthenticated() ? <Navigate to="/dashboard" replace /> : children);

function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading application...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={<SignedOutOnly><Navigate to="/login" replace /></SignedOutOnly>}
        />
        <Route
          path="/login"
          element={<SignedOutOnly><Login /></SignedOutOnly>}
        />
        <Route
          path="/register"
          element={<SignedOutOnly><Register /></SignedOutOnly>}
        />
        <Route
          path="/mfa/verify"
          element={<SignedOutOnly><MfaVerify /></SignedOutOnly>}
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mfa"
          element={
            <ProtectedRoute>
              <MfaSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cases"
          element={
            <ProtectedRoute>
              <CaseList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <ProtectedRoute>
              <CaseDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance"
          element={
            <ProtectedRoute>
              <ComplianceDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/compliance/audit"
          element={
            <ProtectedRoute>
              <ComplianceAudit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/freshness"
          element={
            <ProtectedRoute>
              <FreshnessDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute>
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff"
          element={
            <ProtectedRoute>
              <StaffAccess />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-work"
          element={
            <ProtectedRoute>
              <CaseManagerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/leadership"
          element={
            <ProtectedRoute>
              <LeadershipDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/policies"
          element={
            <ProtectedRoute>
              <AccessPolicies />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assistant"
          element={
            <ProtectedRoute>
              <Assistant />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assistant/reviews"
          element={
            <ProtectedRoute>
              <ReviewQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-quality"
          element={
            <ProtectedRoute>
              <AiQuality />
            </ProtectedRoute>
          }
        />
        <Route
          path="/observability"
          element={
            <ProtectedRoute>
              <Observability />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
