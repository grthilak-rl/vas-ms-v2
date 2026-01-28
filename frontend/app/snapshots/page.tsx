'use client';

import { useEffect, useState } from 'react';
import {
  getSnapshots,
  deleteSnapshot,
  getSnapshotImageUrl,
  downloadSnapshotImage,
  V2Snapshot
} from '@/lib/api-v2';
import { getDevices, Device } from '@/lib/api';
import { ArrowPathIcon, TrashIcon, ArrowDownTrayIcon, XMarkIcon, EyeIcon, PhotoIcon } from '@heroicons/react/24/outline';

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<V2Snapshot[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [viewingSnapshot, setViewingSnapshot] = useState<V2Snapshot | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [imageLoadingStates, setImageLoadingStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
  // Store authenticated blob URLs for thumbnails
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  // Store blob URL for full-size viewing
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [loadingViewImage, setLoadingViewImage] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadSnapshots = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSnapshots(
        selectedDevice === 'all' ? undefined : selectedDevice,
        dateRange.start || undefined,
        dateRange.end || undefined,
        100,
        0
      );
      setSnapshots(data.snapshots); // V2 returns { snapshots: [], pagination: {} }
    } catch (err: any) {
      console.error('Failed to load snapshots:', err);
      setError(err.message || 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  };

  const loadDevices = async () => {
    try {
      const data = await getDevices();
      setDevices(data);
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  };

  // Load authenticated thumbnail URLs for snapshots
  const loadThumbnails = async (snapshotList: V2Snapshot[]) => {
    const newUrls: Record<string, string> = {};

    for (const snapshot of snapshotList) {
      if (snapshot.image_url && snapshot.status === 'ready' && !imageUrls[snapshot.id]) {
        try {
          const blobUrl = await getSnapshotImageUrl(snapshot.id);
          newUrls[snapshot.id] = blobUrl;
        } catch (err) {
          console.error(`Failed to load thumbnail for ${snapshot.id}:`, err);
        }
      }
    }

    if (Object.keys(newUrls).length > 0) {
      setImageUrls(prev => ({ ...prev, ...newUrls }));
    }
  };

  // Handle viewing a snapshot full-size
  const handleViewSnapshot = async (snapshot: V2Snapshot) => {
    setViewingSnapshot(snapshot);

    if (snapshot.image_url && snapshot.status === 'ready') {
      setLoadingViewImage(true);
      try {
        const blobUrl = await getSnapshotImageUrl(snapshot.id);
        setViewingImageUrl(blobUrl);
      } catch (err) {
        console.error('Failed to load full-size image:', err);
      } finally {
        setLoadingViewImage(false);
      }
    }
  };

  // Handle closing modal
  const handleCloseModal = () => {
    setViewingSnapshot(null);
    if (viewingImageUrl) {
      URL.revokeObjectURL(viewingImageUrl);
      setViewingImageUrl(null);
    }
  };

  // Handle download
  const handleDownload = async (snapshot: V2Snapshot) => {
    try {
      setDownloadingId(snapshot.id);
      await downloadSnapshotImage(snapshot.id, `snapshot-${snapshot.stream_id.substring(0, 8)}-${new Date(snapshot.timestamp).toISOString()}.jpg`);
    } catch (err) {
      console.error('Failed to download snapshot:', err);
      alert('Failed to download snapshot');
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    loadDevices();
    loadSnapshots();
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [selectedDevice, dateRange]);

  // Load thumbnails when snapshots change
  useEffect(() => {
    if (snapshots.length > 0) {
      loadThumbnails(snapshots);
    }
  }, [snapshots]);

  // Keyboard support for closing modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewingSnapshot) {
        handleCloseModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingSnapshot, viewingImageUrl]);

  const handleDelete = async (snapshotId: string) => {
    if (!confirm('Are you sure you want to delete this snapshot?')) {
      return;
    }

    try {
      setDeletingId(snapshotId);
      await deleteSnapshot(snapshotId);
      // Refresh snapshots list
      await loadSnapshots();
    } catch (err: any) {
      console.error('Failed to delete snapshot:', err);
      alert(`Failed to delete snapshot: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Snapshots</h1>
          <p className="mt-2 text-gray-600">
            View and manage captured snapshots from live and historical feeds
          </p>
        </div>
        <button
          onClick={() => loadSnapshots()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className="w-5 h-5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Device Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Device:</label>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Date Range:</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <span className="ml-auto text-sm text-gray-600">
            {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Active Filters Clear */}
        {(selectedDevice !== 'all' || dateRange.start || dateRange.end) && (
          <button
            onClick={() => {
              setSelectedDevice('all');
              setDateRange({ start: '', end: '' });
            }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-12 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading snapshots...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="text-red-800 font-medium">Failed to load snapshots</h3>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && snapshots.length === 0 && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-12">
          <div className="text-center">
            <PhotoIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No snapshots found</h3>
            <p className="text-gray-600">
              Capture snapshots from live streams or historical recordings to see them here.
            </p>
          </div>
        </div>
      )}

      {/* Snapshots Grid */}
      {!loading && !error && snapshots.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all group"
            >
              {/* Thumbnail - Clickable */}
              <div
                className="relative cursor-pointer overflow-hidden"
                style={{ aspectRatio: '16/9', backgroundColor: '#f0f0f0' }}
                onClick={() => snapshot.status === 'ready' && handleViewSnapshot(snapshot)}
              >
                {/* Show placeholder when image not ready, actual image otherwise */}
                {snapshot.status === 'ready' && imageUrls[snapshot.id] ? (
                  <img
                    src={imageUrls[snapshot.id]}
                    alt={`Snapshot from stream ${snapshot.stream_id}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                    onError={(e) => {
                      console.error('Failed to load image:', snapshot.id);
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-200">
                    <PhotoIcon className="w-12 h-12 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-500">Processing...</span>
                  </div>
                )}

                {/* Hover Overlay */}
                <div
                  className="absolute inset-0 flex items-center justify-center transition-all"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    pointerEvents: 'none'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0)'}
                >
                  <div className="text-white text-center">
                    <EyeIcon className="w-10 h-10 mx-auto mb-2" />
                    <span className="text-sm font-medium">View Full Size</span>
                  </div>
                </div>

                {/* Source Badge */}
                <div className="absolute top-2 left-2" style={{ zIndex: 10 }}>
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium shadow-lg flex items-center gap-1.5 ${
                    snapshot.source === 'live'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                  }`}>
                    {snapshot.source === 'live' ? (
                      <><span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>Live</>
                    ) : (
                      <><span className="w-2 h-2 bg-white rounded-full"></span>Historical</>
                    )}
                  </span>
                </div>
              </div>

              {/* Metadata - Compact */}
              <div className="p-3 space-y-2">
                <h3 className="font-medium text-gray-900 text-sm truncate" title={snapshot.stream_id}>
                  Stream: {snapshot.stream_id.substring(0, 12)}...
                </h3>

                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate" title={formatTimestamp(snapshot.timestamp)}>
                    {new Date(snapshot.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span className="ml-auto text-gray-400">
                    {formatFileSize(snapshot.file_size)}
                  </span>
                </div>

                {/* Delete Button - Full Width */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(snapshot.id);
                  }}
                  disabled={deletingId === snapshot.id}
                  className="w-full px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  title="Delete snapshot"
                >
                  {deletingId === snapshot.id ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <TrashIcon className="w-4 h-4" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-size Image Modal */}
      {viewingSnapshot && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-[60] flex items-center justify-center p-4"
          onClick={handleCloseModal}
        >
          <div
            className="relative max-w-7xl max-h-[95vh] bg-white rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-lg">Stream: {viewingSnapshot.stream_id.substring(0, 8)}...</h3>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-sm text-gray-300">{formatTimestamp(viewingSnapshot.timestamp)}</p>
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                    viewingSnapshot.source === 'live'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                  }`}>
                    {viewingSnapshot.source === 'live' ? (
                      <><span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>Live</>
                    ) : (
                      <><span className="w-1.5 h-1.5 bg-white rounded-full"></span>Historical</>
                    )}
                  </span>
                  <span className="text-xs text-gray-400">
                    {viewingSnapshot.file_size ? formatFileSize(viewingSnapshot.file_size) : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Download Button - only show when image is available */}
                {viewingSnapshot.status === 'ready' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(viewingSnapshot);
                    }}
                    disabled={downloadingId === viewingSnapshot.id}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors flex items-center gap-2"
                  >
                    {downloadingId === viewingSnapshot.id ? (
                      <>
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <ArrowDownTrayIcon className="w-5 h-5" />
                        Download
                      </>
                    )}
                  </button>
                )}
                {/* Close Button */}
                <button
                  onClick={handleCloseModal}
                  className="text-gray-300 hover:text-white transition-colors p-2"
                  title="Close (ESC)"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="overflow-auto max-h-[calc(95vh-88px)] bg-gray-50">
              {loadingViewImage ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                  <span className="text-lg text-gray-500">Loading image...</span>
                </div>
              ) : viewingImageUrl ? (
                <img
                  src={viewingImageUrl}
                  alt={`Snapshot from stream ${viewingSnapshot.stream_id}`}
                  className="w-full h-auto"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <PhotoIcon className="w-24 h-24 text-gray-400 mb-4" />
                  <span className="text-lg text-gray-500">Image still processing...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


