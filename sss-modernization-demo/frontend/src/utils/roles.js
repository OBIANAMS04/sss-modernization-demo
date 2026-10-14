// Mirror backend roleService (isStaff, isAdmin, isLeadership). They only control what the UI shows; the API enforces access.
// Staff do case work: case managers and admins. Leadership reads aggregate dashboards only, so it is not staff.
export const isStaffUser = (user) => user?.role === 'case_manager' || user?.role === 'admin';
export const isAdminUser = (user) => user?.role === 'admin';
// The leadership dashboard is for leadership, and for admins, who may see everything leadership can
export const isLeadershipUser = (user) => user?.role === 'leadership' || user?.role === 'admin';
