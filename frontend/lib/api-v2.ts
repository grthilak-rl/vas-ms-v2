/**
 * V2 API Client with JWT Authentication
 * All endpoints use Bearer token authentication
 */

import { getValidAccessToken, clearAuth, clearClientCredentials } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.99:8085';

/**
 * Create authenticated headers with JWT token
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getValidAccessToken(API_URL);
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Authenticated fetch wrapper with timeout and error handling
 */
async function authFetch(
  url: string,
  options: RequestInit = {},
  timeout: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      // Clear stale auth state - token was rejected by backend
      clearAuth();
      clearClientCredentials();
      throw new Error('Authentication required. Please log in.');
    }

    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - backend may be unresponsive');
    }
    throw err;
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface V2Stream {
  id: string;
  name: string;
  camera_id: string;
  state: 'initializing' | 'ready' | 'live' | 'error' | 'stopped' | 'closed';
  codec_config: Record<string, any>;
  access_policy: Record<string, any>;
  metadata: Record<string, any>;
  producer?: {
    id: string;
    mediasoup_id: string;
    ssrc: number;
    state: string;
    created_at: string;
  };
  consumers: {
    active: number;
    total_created: number;
  };
  endpoints: {
    webrtc: string;
    hls: string;
    health: string;
  };
  created_at: string;
  uptime_seconds?: number;
}

export interface V2Bookmark {
  id: string;
  stream_id: string;
  center_timestamp: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  label?: string;
  source: 'live' | 'historical' | 'ai_generated';
  created_by?: string;
  video_url?: string | null;  // null when still processing
  thumbnail_url?: string | null;
  event_type?: string;
  confidence?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  status?: 'processing' | 'ready' | 'failed';  // processing status
  created_at: string;
}

export interface V2Snapshot {
  id: string;
  stream_id: string;
  timestamp: string;
  source: 'live' | 'historical';
  file_size: number;
  image_url?: string | null;  // null when still processing
  thumbnail_url?: string | null;
  metadata?: Record<string, any>;
  status?: 'processing' | 'ready' | 'failed';  // processing status
  created_at: string;
}

export interface ConsumerAttachRequest {
  client_id: string;
  rtp_capabilities: Record<string, any>;
}

export interface ConsumerAttachResponse {
  consumer_id: string;
  transport: {
    id: string;
    ice_parameters: Record<string, any>;
    ice_candidates: Array<Record<string, any>>;
    dtls_parameters: Record<string, any>;
  };
  rtp_parameters: Record<string, any>;
}

// ============================================================================
// STREAM ENDPOINTS
// ============================================================================

/**
 * List all streams (replaces GET /v1/devices)
 */
export async function getStreams(
  state?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ streams: V2Stream[]; pagination: { total: number; limit: number; offset: number } }> {
  const params = new URLSearchParams();
  if (state) params.append('state', state);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const response = await authFetch(`/v2/streams?${params}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch streams: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get single stream details
 */
export async function getStream(streamId: string): Promise<V2Stream> {
  const response = await authFetch(`/v2/streams/${streamId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch stream: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get router RTP capabilities for a stream
 * Required to initialize MediaSoup device before consuming
 */
export async function getStreamRouterCapabilities(streamId: string): Promise<Record<string, any>> {
  const response = await authFetch(`/v2/streams/${streamId}/router-capabilities`);

  if (!response.ok) {
    throw new Error('Failed to fetch router capabilities');
  }

  const data = await response.json();
  return data.rtp_capabilities || data;
}

/**
 * Attach WebRTC consumer to stream (replaces direct MediaSoup WebSocket)
 */
export async function attachConsumer(
  streamId: string,
  request: ConsumerAttachRequest
): Promise<ConsumerAttachResponse> {
  const response = await authFetch(`/v2/streams/${streamId}/consume`, {
    method: 'POST',
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`
    }));
    throw new Error(error.detail || 'Failed to attach consumer');
  }

  return response.json();
}

/**
 * Complete DTLS handshake for consumer
 */
export async function connectConsumer(
  consumerId: string,
  dtlsParameters: Record<string, any>
): Promise<void> {
  const response = await authFetch(`/v2/consumers/${consumerId}/connect`, {
    method: 'POST',
    body: JSON.stringify({ dtls_parameters: dtlsParameters })
  });

  if (!response.ok) {
    throw new Error('Failed to connect consumer');
  }
}

/**
 * Detach consumer from stream
 */
export async function detachConsumer(consumerId: string): Promise<void> {
  const response = await authFetch(`/v2/consumers/${consumerId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to detach consumer');
  }
}

/**
 * Get stream health metrics
 */
export async function getStreamHealth(streamId: string): Promise<any> {
  const response = await authFetch(`/v2/streams/${streamId}/health`);

  if (!response.ok) {
    throw new Error('Failed to fetch stream health');
  }

  return response.json();
}

// ============================================================================
// BOOKMARK ENDPOINTS
// ============================================================================

/**
 * List bookmarks with filtering (replaces GET /v1/bookmarks)
 */
export async function getBookmarks(
  streamId?: string,
  eventType?: string,
  tags?: string[],
  startDate?: string,
  endDate?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ bookmarks: V2Bookmark[]; pagination: { total: number; limit: number; offset: number } }> {
  const params = new URLSearchParams();
  if (streamId) params.append('stream_id', streamId);
  if (eventType) params.append('event_type', eventType);
  if (tags && tags.length > 0) params.append('tags', tags.join(','));
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const response = await authFetch(`/v2/bookmarks?${params}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch bookmarks: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Create bookmark for stream (replaces POST /v1/bookmarks/devices/{id}/capture/live)
 */
export async function createBookmark(
  streamId: string,
  source: 'live' | 'historical',
  centerTimestamp?: string,
  label?: string,
  tags?: string[],
  metadata?: Record<string, any>
): Promise<V2Bookmark> {
  const response = await authFetch(`/v2/streams/${streamId}/bookmarks`, {
    method: 'POST',
    body: JSON.stringify({
      source,
      center_timestamp: centerTimestamp,
      label,
      tags,
      metadata
    })
  }, 30000); // 30s timeout for video processing

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`
    }));
    throw new Error(error.detail || 'Failed to create bookmark');
  }

  return response.json();
}

/**
 * Update bookmark
 */
export async function updateBookmark(
  bookmarkId: string,
  label?: string,
  tags?: string[]
): Promise<V2Bookmark> {
  const response = await authFetch(`/v2/bookmarks/${bookmarkId}`, {
    method: 'PUT',
    body: JSON.stringify({ label, tags })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`
    }));
    throw new Error(error.detail || 'Failed to update bookmark');
  }

  return response.json();
}

/**
 * Delete bookmark
 */
export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const response = await authFetch(`/v2/bookmarks/${bookmarkId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to delete bookmark');
  }
}

/**
 * Get bookmark video as blob URL (with authentication)
 * Use this instead of direct URL access
 */
export async function getBookmarkVideoUrl(bookmarkId: string): Promise<string> {
  const response = await authFetch(`/v2/bookmarks/${bookmarkId}/video`, {
    method: 'GET'
  }, 60000); // 60s timeout for video download

  if (!response.ok) {
    throw new Error('Failed to fetch bookmark video');
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Get bookmark thumbnail as blob URL (with authentication)
 */
export async function getBookmarkThumbnailUrl(bookmarkId: string): Promise<string> {
  const response = await authFetch(`/v2/bookmarks/${bookmarkId}/thumbnail`, {
    method: 'GET'
  }, 30000);

  if (!response.ok) {
    throw new Error('Failed to fetch bookmark thumbnail');
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Download bookmark video file (with authentication)
 * Triggers browser download with proper filename
 */
export async function downloadBookmarkVideo(bookmarkId: string, filename?: string): Promise<void> {
  const blobUrl = await getBookmarkVideoUrl(bookmarkId);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename || `bookmark-${bookmarkId}.mp4`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Cleanup blob URL after download starts
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

// ============================================================================
// SNAPSHOT ENDPOINTS
// ============================================================================

/**
 * List snapshots (replaces GET /v1/snapshots)
 */
export async function getSnapshots(
  streamId?: string,
  startDate?: string,
  endDate?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ snapshots: V2Snapshot[]; pagination: { total: number; limit: number; offset: number } }> {
  const params = new URLSearchParams();
  if (streamId) params.append('stream_id', streamId);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const response = await authFetch(`/v2/snapshots?${params}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch snapshots: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Create snapshot for stream (replaces POST /v1/snapshots/devices/{id}/capture/live)
 */
export async function createSnapshot(
  streamId: string,
  source: 'live' | 'historical',
  timestamp?: string,
  metadata?: Record<string, any>
): Promise<V2Snapshot> {
  const response = await authFetch(`/v2/streams/${streamId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({ source, timestamp, metadata })
  }, 30000); // 30s timeout

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`
    }));
    throw new Error(error.detail || 'Failed to create snapshot');
  }

  return response.json();
}

/**
 * Delete snapshot
 */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const response = await authFetch(`/v2/snapshots/${snapshotId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to delete snapshot');
  }
}

/**
 * Get snapshot image as blob URL (authenticated)
 */
export async function getSnapshotImageUrl(snapshotId: string): Promise<string> {
  const response = await authFetch(`/v2/snapshots/${snapshotId}/image`, {
    method: 'GET'
  }, 30000);

  if (!response.ok) {
    throw new Error('Failed to fetch snapshot image');
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Download snapshot image
 */
export async function downloadSnapshotImage(snapshotId: string, filename?: string): Promise<void> {
  const blobUrl = await getSnapshotImageUrl(snapshotId);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename || `snapshot-${snapshotId}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

// ============================================================================
// HEALTH & METRICS ENDPOINTS
// ============================================================================

/**
 * Get system health
 */
export async function getSystemHealth(): Promise<any> {
  const response = await authFetch('/v2/health');

  if (!response.ok) {
    throw new Error('Failed to fetch system health');
  }

  return response.json();
}

/**
 * Get all streams health
 */
export async function getAllStreamsHealth(): Promise<any> {
  const response = await authFetch('/v2/health/streams');

  if (!response.ok) {
    throw new Error('Failed to fetch streams health');
  }

  return response.json();
}

// ============================================================================
// SYSTEM MONITORING ENDPOINTS
// ============================================================================

export interface SystemResources {
  timestamp: string;
  disk: {
    filesystem: {
      total_bytes: number;
      used_bytes: number;
      free_bytes: number;
      percent_used: number;
      total_gb: number;
      used_gb: number;
      free_gb: number;
    };
    vas_storage: {
      recordings_bytes: number;
      recordings_gb: number;
      snapshots_bytes: number;
      snapshots_mb: number;
      bookmarks_bytes: number;
      bookmarks_mb: number;
      total_bytes: number;
      total_gb: number;
    };
    status: 'healthy' | 'elevated' | 'warning' | 'critical' | 'unknown';
  };
  cpu: {
    percent: number;
    count_physical: number;
    count_logical: number;
    per_cpu: number[];
    load_average: {
      '1min': number;
      '5min': number;
      '15min': number;
    };
    status: 'healthy' | 'elevated' | 'warning' | 'critical' | 'unknown';
  };
  memory: {
    ram: {
      total_bytes: number;
      available_bytes: number;
      used_bytes: number;
      percent: number;
      total_gb: number;
      available_gb: number;
      used_gb: number;
    };
    swap: {
      total_bytes: number;
      used_bytes: number;
      free_bytes: number;
      percent: number;
      total_gb: number;
      used_gb: number;
    };
    status: 'healthy' | 'elevated' | 'warning' | 'critical' | 'unknown';
  };
  network: {
    bytes_sent: number;
    bytes_recv: number;
    packets_sent: number;
    packets_recv: number;
    bytes_sent_gb: number;
    bytes_recv_gb: number;
    errors_in: number;
    errors_out: number;
    drop_in: number;
    drop_out: number;
  };
  overall_status: 'healthy' | 'elevated' | 'warning' | 'critical' | 'degraded';
}

export interface StreamResource {
  stream_id: string;
  ffmpeg: {
    pid: number | null;
    cpu_percent: number;
    memory_mb: number;
    status: string;
  };
  storage: {
    recordings_bytes: number;
    recordings_mb: number;
    recordings_gb: number;
  };
  uptime_seconds: number;
}

export interface SystemStats {
  counts: {
    devices: number;
    streams: {
      total: number;
      active: number;
      by_state: Record<string, number>;
    };
    bookmarks: number;
    snapshots: number;
  };
  resources: {
    disk: {
      filesystem_percent: number;
      filesystem_used_gb: number;
      filesystem_total_gb: number;
      filesystem_free_gb: number;
      vas_storage_gb: number;
      recordings_gb: number;
      status: string;
    };
    cpu: {
      percent: number;
      load_1min: number;
      status: string;
    };
    memory: {
      percent: number;
      used_gb: number;
      total_gb: number;
      status: string;
    };
    ffmpeg: {
      total_processes: number;
      total_cpu_percent: number;
      total_memory_mb: number;
    };
  };
  streams: StreamResource[];
  overall_status: string;
}

/**
 * Get comprehensive system resource metrics
 */
export async function getSystemResources(): Promise<SystemResources> {
  const response = await authFetch('/v2/system/resources');

  if (!response.ok) {
    throw new Error('Failed to fetch system resources');
  }

  return response.json();
}

/**
 * Get aggregate system statistics for dashboard
 */
export async function getSystemStats(): Promise<SystemStats> {
  const response = await authFetch('/v2/system/stats');

  if (!response.ok) {
    throw new Error('Failed to fetch system stats');
  }

  return response.json();
}

/**
 * Get disk usage details
 */
export async function getDiskUsage(): Promise<SystemResources['disk']> {
  const response = await authFetch('/v2/system/resources/disk');

  if (!response.ok) {
    throw new Error('Failed to fetch disk usage');
  }

  return response.json();
}

/**
 * Get CPU usage details
 */
export async function getCpuUsage(): Promise<SystemResources['cpu']> {
  const response = await authFetch('/v2/system/resources/cpu');

  if (!response.ok) {
    throw new Error('Failed to fetch CPU usage');
  }

  return response.json();
}

/**
 * Get memory usage details
 */
export async function getMemoryUsage(): Promise<SystemResources['memory']> {
  const response = await authFetch('/v2/system/resources/memory');

  if (!response.ok) {
    throw new Error('Failed to fetch memory usage');
  }

  return response.json();
}

/**
 * Get per-stream resource usage
 */
export async function getPerStreamResources(): Promise<StreamResource[]> {
  const response = await authFetch('/v2/system/resources/streams');

  if (!response.ok) {
    throw new Error('Failed to fetch per-stream resources');
  }

  return response.json();
}

// ============================================================================
// V1 API WRAPPERS (with JWT auth for compatibility)
// ============================================================================

/**
 * Start stream for a device (V1 API with JWT auth)
 * Uses V1 endpoint but with JWT authentication header
 */
export async function startDeviceStream(deviceId: string): Promise<{
  status: string;
  device_id: string;
  room_id: string;
  transport_id?: string;
  producers?: { video: string };
  stream?: any;
  reconnect?: boolean;
}> {
  const response = await authFetch(`/api/v1/devices/${deviceId}/start-stream`, {
    method: 'POST'
  }, 30000); // 30s timeout for RTSP/MediaSoup setup

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`,
      error_code: 'UNKNOWN_ERROR'
    }));

    // Extract meaningful error message
    const message = error.detail || error.message || 'Failed to start stream';
    const errorCode = error.error_code || 'STREAM_START_FAILED';

    throw new Error(`[${errorCode}] ${message}`);
  }

  return response.json();
}

/**
 * Stop stream for a device (V1 API with JWT auth)
 */
export async function stopDeviceStream(deviceId: string): Promise<{
  status: string;
  device_id: string;
  stopped: boolean;
}> {
  const response = await authFetch(`/api/v1/devices/${deviceId}/stop-stream`, {
    method: 'POST'
  }, 15000);

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`
    }));
    throw new Error(error.detail || 'Failed to stop stream');
  }

  return response.json();
}

/**
 * Get HLS playlist for historical playback (with JWT auth)
 */
export async function getRecordingPlaylist(deviceId: string): Promise<string> {
  const response = await authFetch(`/api/v1/recordings/devices/${deviceId}/playlist`, {
    method: 'GET'
  }, 10000);

  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: HTTP ${response.status}`);
  }

  return response.text();
}

/**
 * Export getAuthHeaders for components that need to add auth to custom requests
 */
export { getAuthHeaders };

export { API_URL };
