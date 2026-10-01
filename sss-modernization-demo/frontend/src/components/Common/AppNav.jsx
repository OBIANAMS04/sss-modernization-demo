import { NavLink, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../utils/tokenManager';
import { isStaffUser } from '../../utils/roles';

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition duration-200 ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-blue-700 hover:bg-gray-50'
  }`;

/** Shared top navigation. "Case Management" only appears for case managers and admins. */
export default function AppNav({ title, subtitle }) {
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
            <NavLink to="/profile" className={linkClass}>Profile &amp; Exemptions</NavLink>
            {isStaffUser(user) && (
              <NavLink to="/cases" end className={linkClass}>Case Management</NavLink>
            )}
            <button
              onClick={handleLogout}
              className="ml-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition duration-200"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
