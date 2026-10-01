// Mirrors backend roleService.isStaff. Only controls what the UI shows; the API enforces access.
export const isStaffUser = (user) => user?.role === 'case_manager' || user?.role === 'admin';
