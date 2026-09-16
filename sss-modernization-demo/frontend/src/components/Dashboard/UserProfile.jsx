export default function UserProfile({ user }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-center mb-4">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
          <span className="text-white text-2xl font-bold">
            {user?.fullName?.charAt(0).toUpperCase()}
          </span>
        </div>
      </div>

      <h3 className="text-lg font-bold text-center mb-4">{user?.fullName || 'User'}</h3>

      <div className="space-y-4">
        <div className="border-b pb-3">
          <p className="text-gray-600 text-sm">Email</p>
          <p className="font-medium text-gray-900 break-all">{user?.email || 'N/A'}</p>
        </div>

        <div>
          <p className="text-gray-600 text-sm">Status</p>
          <p className="font-medium">
            <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
              Active
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
