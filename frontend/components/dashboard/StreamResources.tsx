'use client';

import { useEffect, useState } from 'react';
import { getSystemStats, StreamResource } from '@/lib/api-v2';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function StreamResources() {
  const [streams, setStreams] = useState<StreamResource[]>([]);
  const [totals, setTotals] = useState({
    cpu: 0,
    memory: 0,
    storage: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStreamResources = async () => {
      try {
        const data = await getSystemStats();
        setStreams(data.streams);

        // Calculate totals
        const totalCpu = data.streams.reduce((sum, s) => sum + s.ffmpeg.cpu_percent, 0);
        const totalMemory = data.streams.reduce((sum, s) => sum + s.ffmpeg.memory_mb, 0);
        const totalStorage = data.streams.reduce((sum, s) => sum + s.storage.recordings_bytes, 0);

        setTotals({
          cpu: totalCpu,
          memory: totalMemory,
          storage: totalStorage,
        });

        setError(null);
      } catch (err) {
        console.error('Failed to fetch stream resources:', err);
        setError('Failed to load stream resources');
      } finally {
        setLoading(false);
      }
    };

    fetchStreamResources();

    // Refresh every 15 seconds
    const interval = setInterval(fetchStreamResources, 15000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Stream Resources</h2>
        </div>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Stream Resources</h2>
          {!loading && streams.length > 0 && (
            <div className="flex items-center space-x-4 text-xs text-gray-500">
              <span>Total CPU: <span className="font-medium text-gray-700">{totals.cpu.toFixed(1)}%</span></span>
              <span>Memory: <span className="font-medium text-gray-700">{totals.memory.toFixed(0)} MB</span></span>
              <span>Storage: <span className="font-medium text-gray-700">{formatBytes(totals.storage)}</span></span>
            </div>
          )}
        </div>
      </div>
      <div className="p-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : streams.length === 0 ? (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No Active Streams</h3>
            <p className="mt-1 text-sm text-gray-500">Start a stream to see resource usage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {streams.map((stream) => (
              <div
                key={stream.stream_id}
                className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${stream.ffmpeg.status === 'running' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span className="text-sm font-medium text-gray-900 font-mono">
                      {stream.stream_id.substring(0, 8)}...
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Uptime: {formatDuration(stream.uptime_seconds)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* CPU */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>CPU</span>
                      <span className="font-medium text-gray-700">{stream.ffmpeg.cpu_percent}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          stream.ffmpeg.cpu_percent > 80 ? 'bg-red-500' :
                          stream.ffmpeg.cpu_percent > 50 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(stream.ffmpeg.cpu_percent, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Memory */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>Memory</span>
                      <span className="font-medium text-gray-700">{stream.ffmpeg.memory_mb.toFixed(0)} MB</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          stream.ffmpeg.memory_mb > 500 ? 'bg-red-500' :
                          stream.ffmpeg.memory_mb > 200 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min((stream.ffmpeg.memory_mb / 500) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Storage */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>Storage</span>
                      <span className="font-medium text-gray-700">{formatBytes(stream.storage.recordings_bytes)}</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all"
                        style={{ width: `${Math.min((stream.storage.recordings_gb / 10) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {stream.ffmpeg.pid && (
                  <div className="mt-2 text-xs text-gray-400">
                    PID: {stream.ffmpeg.pid}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
