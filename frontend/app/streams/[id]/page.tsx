'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import WebRTCPlayer from '@/components/players/WebRTCPlayer';
import { getDevices, Device, startStream } from '@/lib/api';
import { API_URL } from '@/lib/api-v2';

export default function StreamViewPage() {
  const params = useParams();
  const router = useRouter();
  const deviceId = params.id as string;
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch device details
    const fetchDevice = async () => {
      try {
        const devices = await getDevices();
        const foundDevice = devices.find(d => d.id === deviceId);
        if (!foundDevice) {
          setError('Device not found');
          return;
        }
        setDevice(foundDevice);
      } catch (err: any) {
        console.error('Failed to fetch device:', err);
        setError(err.message || 'Failed to load device');
      } finally {
        setLoading(false);
      }
    };

    fetchDevice();
  }, [deviceId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading device...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !device) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error || 'Device not found'}</p>
          <button
            onClick={() => router.push('/devices')}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            ← Back to Devices
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push('/devices')}
            className="text-gray-600 hover:text-gray-900 mb-2 inline-flex items-center"
          >
            ← Back to Devices
          </button>
          <h1 className="text-3xl font-bold text-gray-900">{device.name}</h1>
          <p className="mt-2 text-gray-600">Live video stream</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="aspect-video w-full bg-gray-900 rounded-lg overflow-hidden mb-6">
          <WebRTCPlayer
            streamId={deviceId}
            signalingUrl={`${API_URL.replace('http', 'ws')}/ws/signaling`}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Device Details</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-gray-800 font-medium">Device Name</dt>
                <dd className="text-sm font-medium text-gray-900">{device.name}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-800 font-medium">RTSP URL</dt>
                <dd className="text-sm font-mono text-gray-900">{device.rtsp_url}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-800 font-medium">Status</dt>
                <dd className="text-sm font-medium capitalize">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    device.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {device.is_active ? 'Active' : 'Inactive'}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Controls</h3>
            <div className="space-y-2">
              <button 
                onClick={() => router.push('/devices')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Manage Devices
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


