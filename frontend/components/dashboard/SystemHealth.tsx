'use client';

import { useEffect, useState } from 'react';
import { getSystemStats, SystemStats } from '@/lib/api-v2';

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  value: string;
  detail?: string;
}

export default function SystemHealth() {
  const [services, setServices] = useState<ServiceHealth[]>([
    { name: 'CPU Usage', status: 'unknown', value: '-' },
    { name: 'Memory', status: 'unknown', value: '-' },
    { name: 'Disk Space', status: 'unknown', value: '-' },
    { name: 'FFmpeg Processes', status: 'unknown', value: '-' },
  ]);
  const [overallStatus, setOverallStatus] = useState<string>('unknown');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await getSystemStats();

        const cpuStatus = getStatusFromString(data.resources.cpu.status);
        const memoryStatus = getStatusFromString(data.resources.memory.status);
        const diskStatus = getStatusFromString(data.resources.disk.status);

        // FFmpeg status based on whether processes are running for active streams
        const ffmpegStatus: 'healthy' | 'warning' | 'critical' | 'unknown' =
          data.counts.streams.active > 0
            ? (data.resources.ffmpeg.total_processes >= data.counts.streams.active ? 'healthy' : 'warning')
            : 'healthy';

        setServices([
          {
            name: 'CPU Usage',
            status: cpuStatus,
            value: `${data.resources.cpu.percent}%`,
            detail: `Load: ${data.resources.cpu.load_1min}`,
          },
          {
            name: 'Memory',
            status: memoryStatus,
            value: `${data.resources.memory.percent}%`,
            detail: `${data.resources.memory.used_gb} / ${data.resources.memory.total_gb} GB`,
          },
          {
            name: 'Disk Space',
            status: diskStatus,
            value: `${data.resources.disk.filesystem_percent}%`,
            detail: `${data.resources.disk.filesystem_free_gb} GB free`,
          },
          {
            name: 'FFmpeg Processes',
            status: ffmpegStatus,
            value: `${data.resources.ffmpeg.total_processes} active`,
            detail: `CPU: ${data.resources.ffmpeg.total_cpu_percent}%, Mem: ${data.resources.ffmpeg.total_memory_mb} MB`,
          },
        ]);

        setOverallStatus(data.overall_status);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch system health:', err);
        setError('Failed to load health status');
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();

    // Refresh every 10 seconds
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusFromString = (status: string): 'healthy' | 'warning' | 'critical' | 'unknown' => {
    switch (status) {
      case 'healthy':
        return 'healthy';
      case 'elevated':
      case 'warning':
        return 'warning';
      case 'critical':
        return 'critical';
      default:
        return 'unknown';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'warning':
        return 'bg-yellow-500';
      case 'critical':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'critical':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getOverallStatusText = (status: string) => {
    switch (status) {
      case 'healthy':
        return { text: 'All Systems Operational', color: 'text-green-700', bg: 'bg-green-100' };
      case 'elevated':
      case 'warning':
        return { text: 'Performance Degraded', color: 'text-yellow-700', bg: 'bg-yellow-100' };
      case 'critical':
        return { text: 'Critical Issues Detected', color: 'text-red-700', bg: 'bg-red-100' };
      case 'degraded':
        return { text: 'Some Services Unavailable', color: 'text-orange-700', bg: 'bg-orange-100' };
      default:
        return { text: 'Status Unknown', color: 'text-gray-700', bg: 'bg-gray-100' };
    }
  };

  if (error) {
    return (
      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
        </div>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const statusInfo = getOverallStatusText(overallStatus);

  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
          {!loading && (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.color}`}>
              {statusInfo.text}
            </span>
          )}
        </div>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {services.map((service) => (
            <div
              key={service.name}
              className={`flex items-center justify-between p-3 rounded-lg border ${getStatusBgColor(service.status)}`}
            >
              <div className="flex items-center space-x-3">
                {loading ? (
                  <div className="w-3 h-3 bg-gray-300 rounded-full animate-pulse" />
                ) : (
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(service.status)}`}>
                    {service.status === 'healthy' && (
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(service.status)} animate-pulse`} />
                    )}
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {service.name}
                  </span>
                  {service.detail && !loading && (
                    <p className="text-xs text-gray-500">{service.detail}</p>
                  )}
                </div>
              </div>
              {loading ? (
                <div className="h-5 w-12 bg-gray-200 rounded animate-pulse" />
              ) : (
                <span className="text-sm font-semibold text-gray-700">{service.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
