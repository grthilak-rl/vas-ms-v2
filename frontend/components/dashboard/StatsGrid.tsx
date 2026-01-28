'use client';

import { useEffect, useState } from 'react';
import { getSystemStats, SystemStats } from '@/lib/api-v2';

interface StatItem {
  name: string;
  value: string;
  subValue?: string;
  changeType: 'positive' | 'negative' | 'neutral' | 'warning' | 'critical';
  icon: string;
}

export default function StatsGrid() {
  const [stats, setStats] = useState<StatItem[]>([
    { name: 'Total Cameras', value: '-', changeType: 'neutral', icon: 'camera' },
    { name: 'Active Streams', value: '-', changeType: 'neutral', icon: 'stream' },
    { name: 'Storage Used', value: '-', changeType: 'neutral', icon: 'storage' },
    { name: 'Recordings', value: '-', changeType: 'neutral', icon: 'recording' },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await getSystemStats();

        // Format storage display
        const diskPercent = data.resources.disk.filesystem_percent;
        const diskUsedGB = data.resources.disk.filesystem_used_gb;
        const diskTotalGB = data.resources.disk.filesystem_total_gb;
        const storageStatus = data.resources.disk.status;

        // Determine changeType based on disk status
        let diskChangeType: 'positive' | 'warning' | 'critical' | 'neutral' = 'positive';
        if (storageStatus === 'critical') diskChangeType = 'critical';
        else if (storageStatus === 'warning' || storageStatus === 'elevated') diskChangeType = 'warning';

        setStats([
          {
            name: 'Total Cameras',
            value: data.counts.devices.toString(),
            subValue: `${data.counts.streams.total} streams`,
            changeType: 'positive',
            icon: 'camera',
          },
          {
            name: 'Active Streams',
            value: data.counts.streams.active.toString(),
            subValue: `of ${data.counts.streams.total}`,
            changeType: data.counts.streams.active > 0 ? 'positive' : 'neutral',
            icon: 'stream',
          },
          {
            name: 'Storage Used',
            value: `${diskUsedGB} GB`,
            subValue: `${diskPercent}% of ${diskTotalGB} GB`,
            changeType: diskChangeType,
            icon: 'storage',
          },
          {
            name: 'Bookmarks',
            value: data.counts.bookmarks.toString(),
            subValue: `${data.counts.snapshots} snapshots`,
            changeType: 'positive',
            icon: 'recording',
          },
        ]);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch system stats:', err);
        setError('Failed to load stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'camera':
        return (
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'stream':
        return (
          <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'storage':
        return (
          <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
        );
      case 'recording':
        return (
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case 'positive':
        return 'text-green-600';
      case 'negative':
        return 'text-red-600';
      case 'warning':
        return 'text-yellow-600';
      case 'critical':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.name} className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                {loading ? (
                  <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
                ) : (
                  getIcon(stat.icon)
                )}
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    {stat.name}
                  </dt>
                  <dd className="flex items-baseline">
                    {loading ? (
                      <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
                    ) : (
                      <>
                        <div className="text-2xl font-semibold text-gray-900">
                          {stat.value}
                        </div>
                        {stat.subValue && (
                          <div className={`ml-2 flex items-baseline text-sm font-medium ${getChangeColor(stat.changeType)}`}>
                            {stat.subValue}
                          </div>
                        )}
                      </>
                    )}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
