import StatsGrid from "@/components/dashboard/StatsGrid";
import RecentActivity from "@/components/dashboard/RecentActivity";
import SystemHealth from "@/components/dashboard/SystemHealth";
import StreamResources from "@/components/dashboard/StreamResources";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Overview of your video streaming system
        </p>
      </div>

      {/* Statistics Grid */}
      <StatsGrid />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stream Resources - takes 2 columns */}
        <div className="lg:col-span-2">
          <StreamResources />
        </div>

        {/* System Health */}
        <div>
          <SystemHealth />
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <RecentActivity />
      </div>
    </div>
  );
}
