import { getUser } from '../../utils/tokenManager';
import { isAdminUser, isLeadershipUser, isStaffUser } from '../../utils/roles';
import AdminDashboard from './AdminDashboard';
import CaseManagerDashboard from './CaseManagerDashboard';
import CitizenDashboard from './CitizenDashboard';
import LeadershipDashboard from './LeadershipDashboard';

// Each role's own dashboard: STORY-012 citizen, STORY-013 case manager, STORY-014 admin, STORY-015 leadership.
// Admins are checked first because they are staff and leadership as well.
export default function Dashboard() {
  const user = getUser();
  if (isAdminUser(user)) return <AdminDashboard />;
  if (isLeadershipUser(user)) return <LeadershipDashboard />;
  if (isStaffUser(user)) return <CaseManagerDashboard />;
  return <CitizenDashboard />;
}
