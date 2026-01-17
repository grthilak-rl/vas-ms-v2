export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8085';
export const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'vas_default_api_key_change_in_production';

// Common headers for all API requests
export const getHeaders = (contentType?: string): HeadersInit => {
  const headers: HeadersInit = {
    'X-API-Key': API_KEY,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
};

export interface Device {
  id: string;
  name: string;
  description?: string;
  rtsp_url: string;
  is_active: boolean;
  location?: string;
  created_at: string;
  updated_at: string;
}

export interface Stream {
  id: string;
  name: string;
  device_id: string;
  status: string;
  stream_url: string;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: string;
  device_id: string;
  device_name?: string;
  timestamp: string;
  source: 'live' | 'historical';
  file_size: number;
  url: string;
  created_at: string;
}

// API functions
export async function getDevices(): Promise<Device[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(`${API_URL}/api/v1/devices`, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch devices: HTTP ${response.status}`);
    }
    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

export async function createDevice(device: { name: string; rtsp_url: string; description?: string; location?: string }): Promise<Device> {
  // Add timeout to prevent hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(`${API_URL}/api/v1/devices`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(device),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to create device');
    }
    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

export async function updateDevice(id: string, device: { name?: string; rtsp_url?: string; description?: string; location?: string }): Promise<Device> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(`${API_URL}/api/v1/devices/${id}`, {
      method: 'PUT',
      headers: getHeaders('application/json'),
      body: JSON.stringify(device),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to update device');
    }
    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

export async function deleteDevice(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/devices/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to delete device');
  }
}

export async function getStreams(): Promise<Stream[]> {
  const response = await fetch(`${API_URL}/api/v1/streams`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch streams');
  }
  return response.json();
}

export async function startStream(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/rtsp/streams/${id}/start`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to start stream');
  }
}

export async function stopStream(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/rtsp/streams/${id}/stop`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to stop stream');
  }
}

export async function getSnapshots(deviceId?: string, limit: number = 100): Promise<Snapshot[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const params = new URLSearchParams();
    if (deviceId) params.append('device_id', deviceId);
    params.append('limit', limit.toString());

    const response = await fetch(`${API_URL}/api/v1/snapshots?${params}`, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch snapshots: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.snapshots || [];
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
      method: 'DELETE',
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to delete snapshot');
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

// Bookmark interfaces
export interface Bookmark {
  id: string;
  device_id: string;
  device_name?: string;
  center_timestamp: string;
  start_timestamp: string;
  end_timestamp: string;
  label?: string;
  source: 'live' | 'historical';
  duration: number;
  video_format: string;
  file_size: number;
  created_at: string;
  updated_at?: string;
  video_url: string;
  thumbnail_url?: string;
}

// Bookmark API functions
export async function getBookmarks(deviceId?: string, limit: number = 100): Promise<Bookmark[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const params = new URLSearchParams();
    if (deviceId) params.append('device_id', deviceId);
    params.append('limit', limit.toString());

    const response = await fetch(`${API_URL}/api/v1/bookmarks?${params}`, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch bookmarks: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.bookmarks || [];
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

export async function captureBookmarkLive(deviceId: string, label?: string): Promise<Bookmark> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for video capture

  try {
    const response = await fetch(`${API_URL}/api/v1/bookmarks/devices/${deviceId}/capture/live`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ label }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to capture bookmark');
    }

    const data = await response.json();
    return data.bookmark;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Bookmark capture timeout - this may take up to 30 seconds');
    }
    throw err;
  }
}

export async function captureBookmarkHistorical(
  deviceId: string,
  centerTimestamp: string,
  label?: string
): Promise<Bookmark> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${API_URL}/api/v1/bookmarks/devices/${deviceId}/capture/historical`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ center_timestamp: centerTimestamp, label }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to capture bookmark');
    }

    const data = await response.json();
    return data.bookmark;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Bookmark capture timeout');
    }
    throw err;
  }
}

export async function updateBookmark(bookmarkId: string, label: string): Promise<Bookmark> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/api/v1/bookmarks/${bookmarkId}`, {
      method: 'PUT',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ label }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to update bookmark');
    }

    const data = await response.json();
    return data.bookmark;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/api/v1/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(error.detail || 'Failed to delete bookmark');
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}


