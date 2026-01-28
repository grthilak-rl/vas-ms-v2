'use client';

import { useState, useEffect } from 'react';
import { getDevices, createDevice, updateDevice, deleteDevice, Device } from '@/lib/api';
import { CameraIcon, TrashIcon, CheckCircleIcon, PencilIcon } from '@heroicons/react/24/outline';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit state
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);

  // Load devices on mount
  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    setIsLoading(true);
    try {
      const data = await getDevices();
      setDevices(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load devices');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await createDevice({ name, rtsp_url: rtspUrl });
      setSuccess('Device added successfully!');
      setName('');
      setRtspUrl('');
      setIsModalOpen(false);
      await loadDevices();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to add device');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await updateDevice(editingDevice.id, { name, rtsp_url: rtspUrl });
      setSuccess('Device updated successfully!');
      setName('');
      setRtspUrl('');
      setIsEditModalOpen(false);
      setEditingDevice(null);
      await loadDevices();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update device');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (device: Device) => {
    setEditingDevice(device);
    setName(device.name);
    setRtspUrl(device.rtsp_url);
    setIsEditModalOpen(true);
    setError(null);
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm('Are you sure you want to delete this device?')) {
      return;
    }

    try {
      await deleteDevice(id);
      setSuccess('Device deleted successfully!');
      await loadDevices();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete device');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Device Management</h1>
          <p className="mt-2 text-gray-600">
            Add, edit, and manage your camera devices
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <CameraIcon className="h-5 w-5" />
          Add Device
        </button>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircleIcon className="h-5 w-5" />
          {success}
        </div>
      )}

      {/* Devices List */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading devices...</p>
          </div>
        ) : devices.length === 0 ? (
          <div className="p-12 text-center">
            <CameraIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-600">No devices added yet</p>
            <p className="mt-2 text-sm text-gray-500">Click "Add Device" to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Device
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    RTSP URL
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Added
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {devices.map((device) => (
                  <tr key={device.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{device.name}</div>
                        {device.location && (
                          <div className="text-sm text-gray-500">{device.location}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 font-mono">{device.rtsp_url}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        // Determine status based on is_active and stream_state
                        const streamState = device.stream_state;
                        let statusText = 'Inactive';
                        let statusClass = 'bg-gray-100 text-gray-800';

                        if (device.is_active && streamState === 'live') {
                          statusText = 'Active';
                          statusClass = 'bg-green-100 text-green-800';
                        } else if (streamState === 'error') {
                          statusText = 'Error';
                          statusClass = 'bg-red-100 text-red-800';
                        } else if (device.is_active) {
                          // is_active but not live - may be initializing or in an intermediate state
                          statusText = 'Starting...';
                          statusClass = 'bg-yellow-100 text-yellow-800';
                        }

                        return (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                            {statusText}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(device.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEditModal(device)}
                          className="text-blue-600 hover:text-blue-900 transition-colors"
                          title="Edit Device"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteDevice(device.id)}
                          className="text-red-600 hover:text-red-900 transition-colors"
                          title="Delete Device"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Device Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Add New Device</h2>
              <p className="text-sm text-gray-600 mt-1">Enter device details to add a camera</p>
            </div>
            
            <form onSubmit={handleAddDevice} className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Device Name *
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  placeholder="e.g., Camera 1"
                  required
                />
              </div>

              <div>
                <label htmlFor="rtspUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  RTSP URL *
                </label>
                <input
                  type="text"
                  id="rtspUrl"
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm text-gray-900"
                  placeholder="rtsp://username:password@ip:port/path"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Format: rtsp://[username]:[password]@[ip]:[port]/[path]
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setName('');
                    setRtspUrl('');
                    setError(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding...' : 'Add Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Device Modal */}
      {isEditModalOpen && editingDevice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Edit Device</h2>
              <p className="text-sm text-gray-600 mt-1">Update device details</p>
            </div>

            <form onSubmit={handleEditDevice} className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="edit-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Device Name *
                </label>
                <input
                  type="text"
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  placeholder="e.g., Camera 1"
                  required
                />
              </div>

              <div>
                <label htmlFor="edit-rtspUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  RTSP URL *
                </label>
                <input
                  type="text"
                  id="edit-rtspUrl"
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm text-gray-900"
                  placeholder="rtsp://username:password@ip:port/path"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Format: rtsp://[username]:[password]@[ip]:[port]/[path]
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingDevice(null);
                    setName('');
                    setRtspUrl('');
                    setError(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Updating...' : 'Update Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


