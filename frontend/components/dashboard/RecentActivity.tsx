'use client';

import { PlayIcon, StopIcon, CameraIcon, PlusIcon } from '@heroicons/react/24/outline';

type ActivityType = 'stream_started' | 'recording_stopped' | 'snapshot_captured' | 'device_added';

interface Activity {
  action: string;
  stream: string;
  time: string;
  type: ActivityType;
}

const getActivityIcon = (type: ActivityType) => {
  switch (type) {
    case 'stream_started':
      return <PlayIcon className="h-4 w-4 text-green-600" />;
    case 'recording_stopped':
      return <StopIcon className="h-4 w-4 text-red-600" />;
    case 'snapshot_captured':
      return <CameraIcon className="h-4 w-4 text-blue-600" />;
    case 'device_added':
      return <PlusIcon className="h-4 w-4 text-purple-600" />;
  }
};

const getActivityBgColor = (type: ActivityType) => {
  switch (type) {
    case 'stream_started':
      return 'bg-green-100';
    case 'recording_stopped':
      return 'bg-red-100';
    case 'snapshot_captured':
      return 'bg-blue-100';
    case 'device_added':
      return 'bg-purple-100';
  }
};

export default function RecentActivity() {
  const activities: Activity[] = [
    { action: 'Stream Started', stream: 'Main Entrance Camera', time: '2 minutes ago', type: 'stream_started' },
    { action: 'Recording Stopped', stream: 'Parking Lot Camera', time: '15 minutes ago', type: 'recording_stopped' },
    { action: 'Snapshot Captured', stream: 'Back Door Camera', time: '32 minutes ago', type: 'snapshot_captured' },
    { action: 'Device Added', stream: 'Camera-12', time: '1 hour ago', type: 'device_added' },
    { action: 'Stream Started', stream: 'Reception Camera', time: '2 hours ago', type: 'stream_started' },
  ];

  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Recent Activity
          </h2>
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View All
          </button>
        </div>
      </div>
      <div className="p-6">
        <div className="flow-root">
          <ul className="-mb-8">
            {activities.map((activity, index) => (
              <li key={index}>
                <div className="relative pb-8">
                  {index !== activities.length - 1 && (
                    <span className="absolute left-4 top-8 -ml-px h-full w-0.5 bg-gray-200" />
                  )}
                  <div className="relative flex items-start space-x-3">
                    <div className={`flex-shrink-0 h-8 w-8 rounded-full ${getActivityBgColor(activity.type)} flex items-center justify-center`}>
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900">
                          {activity.action}
                        </p>
                        <p className="text-xs text-gray-500">{activity.time}</p>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {activity.stream}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}


