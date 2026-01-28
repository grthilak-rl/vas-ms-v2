'use client';

import { useState } from 'react';

interface DeviceFormProps {
  onSubmit: (device: { name: string; ip_address: string; rtsp_url: string }) => void;
  onCancel: () => void;
}

export default function DeviceForm({ onSubmit, onCancel }: DeviceFormProps) {
  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, ip_address: ipAddress, rtsp_url: rtspUrl });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Device Name
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="ip" className="block text-sm font-medium text-gray-700 mb-1">
          IP Address
        </label>
        <input
          type="text"
          id="ip"
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="rtsp" className="block text-sm font-medium text-gray-700 mb-1">
          RTSP URL
        </label>
        <input
          type="text"
          id="rtsp"
          value={rtspUrl}
          onChange={(e) => setRtspUrl(e.target.value)}
          required
          placeholder="rtsp://"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Add Device
        </button>
      </div>
    </form>
  );
}


