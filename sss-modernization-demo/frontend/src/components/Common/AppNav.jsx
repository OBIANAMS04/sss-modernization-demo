import { NavLink, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../utils/tokenManager';
import { isAdminUser, isLeadershipUser, isStaffUser } from '../../utils/roles';
import { authService } from '../../services/authService';
import usePageTitle from '../../utils/usePageTitle';
import SessionTimer from './SessionTimer';

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition duration-200 ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-blue-700 hover:bg-gray-50'
  }`;

/**
 * Shared top navigation. The staff pages (cases, compliance, freshness, audit, staff access) only appear for case managers and admins.
 * A case manager's Dashboard is My Work, so only admins get a separate My Work link; Leadership is for leadership and admins, Admin for admins.
 * `pageTitle` names the browser tab when the heading is not a good name for it (the dashboard's is the app name).
 */
export default function AppNav({ title, subtitle, pageTitle }) {
  const navigate = useNavigate();
  const user = getUser();
  usePageTitle(pageTitle || title);

  const handleLogout = () => {
    authService.logout(); // recorded in the audit log; sign-out does not wait for it
    clearAuth();
    navigate('/login');
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-blue-700 focus:font-medium focus:px-4 focus:py-2 focus:rounded-lg focus:ring-2 focus:ring-blue-600"
      >
        Skip to main content
      </a>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
          </div>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-2">
            <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
            <NavLink to="/profile" className={linkClass}>Profile &amp; Exemptions</NavLink>
            <NavLink to="/mfa" className={linkClass}>Sign-in security</NavLink>
            {isAdminUser(user) && <NavLink to="/my-work" className={linkClass}>My Work</NavLink>}
            {isStaffUser(user) && (
              <>
                <NavLink to="/cases" end className={linkClass}>Case Management</NavLink>
                <NavLink to="/compliance" className={linkClass}>Compliance</NavLink>
                <NavLink to="/freshness" className={linkClass}>Data Freshness</NavLink>
                <NavLink to="/audit" className={linkClass}>Audit Log</NavLink>
                <NavLink to="/staff" className={linkClass}>Staff Access</NavLink>
              </>
            )}
            {isLeadershipUser(user) && <NavLink to="/leadership" className={linkClass}>Leadership</NavLink>}
            {isAdminUser(user) && <NavLink to="/admin" className={linkClass}>Admin</NavLink>}
            <button
              onClick={handleLogout}
              className="ml-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition duration-200"
            >
              Logout
            </button>
          </nav>
        </div>
      </div>
      <SessionTimer />
    </header>
  );
}
