'use client';

import { useEffect, useState, useRef } from 'react';
import { getBookmarks, deleteBookmark, updateBookmark, getDevices, Bookmark, Device } from '@/lib/api';

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [viewingBookmark, setViewingBookmark] = useState<Bookmark | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadBookmarks = async (deviceId?: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getBookmarks(deviceId === 'all' ? undefined : deviceId);
      setBookmarks(data);
    } catch (err: any) {
      console.error('Failed to load bookmarks:', err);
      setError(err.message || 'Failed to load bookmarks');
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

  useEffect(() => {
    loadDevices();
    loadBookmarks();
  }, []);

  useEffect(() => {
    loadBookmarks(selectedDevice);
  }, [selectedDevice]);

  // Keyboard support for closing modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewingBookmark) {
        setViewingBookmark(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingBookmark]);

  const handleDelete = async (bookmarkId: string) => {
    if (!confirm('Are you sure you want to delete this bookmark?')) {
      return;
    }

    try {
      setDeletingId(bookmarkId);
      await deleteBookmark(bookmarkId);
      await loadBookmarks(selectedDevice);
    } catch (err: any) {
      console.error('Failed to delete bookmark:', err);
      alert(`Failed to delete bookmark: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateLabel = async (bookmarkId: string, newLabel: string) => {
    try {
      await updateBookmark(bookmarkId, newLabel);
      await loadBookmarks(selectedDevice);
      setEditingId(null);
    } catch (err: any) {
      console.error('Failed to update bookmark:', err);
      alert(`Failed to update label: ${err.message}`);
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
          <h1 className="text-3xl font-bold text-gray-900">Bookmarks</h1>
          <p className="mt-2 text-gray-600">
            View and manage 6-second video bookmarks captured from live and historical feeds
          </p>
        </div>
        <button
          onClick={() => loadBookmarks(selectedDevice)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Filter */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Filter by Device:</label>
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
          <span className="text-sm text-gray-600">
            {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-12 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading bookmarks...</p>
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
              <h3 className="text-red-800 font-medium">Failed to load bookmarks</h3>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && bookmarks.length === 0 && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-12">
          <div className="text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No bookmarks found</h3>
            <p className="text-gray-600">
              Create bookmarks from live streams or historical recordings to see them here.
            </p>
          </div>
        </div>
      )}

      {/* Bookmarks Grid */}
      {!loading && !error && bookmarks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {bookmarks.map((bookmark) => (
            <div
              key={bookmark.id}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all group"
            >
              {/* Thumbnail - Clickable */}
              <div
                className="relative cursor-pointer overflow-hidden"
                style={{ aspectRatio: '16/9', backgroundColor: '#000' }}
                onClick={() => setViewingBookmark(bookmark)}
              >
                {/* Video Thumbnail */}
                {bookmark.thumbnail_url ? (
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}${bookmark.thumbnail_url}`}
                    alt={`Bookmark from ${bookmark.device_name || 'Unknown'}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <svg className="w-12 h-12 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                    </svg>
                  </div>
                )}

                {/* Play Icon Overlay */}
                <div
                  className="absolute inset-0 flex items-center justify-center transition-all"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    pointerEvents: 'none'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0)'}
                >
                  <svg className="w-16 h-16 text-white opacity-90" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                </div>

                {/* Source Badge */}
                <div className="absolute top-2 left-2" style={{ zIndex: 10 }}>
                  <span className={`px-2 py-1 rounded-md text-xs font-medium shadow-lg ${
                    bookmark.source === 'live'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                  }`}>
                    {bookmark.source === 'live' ? '🔴 Live' : '📼 Historical'}
                  </span>
                </div>

                {/* Duration Badge */}
                <div className="absolute top-2 right-2" style={{ zIndex: 10 }}>
                  <span className="px-2 py-1 bg-black bg-opacity-75 text-white rounded-md text-xs font-medium">
                    {bookmark.duration}s
                  </span>
                </div>
              </div>

              {/* Metadata */}
              <div className="p-3 space-y-2">
                {/* Device Name */}
                <h3 className="font-medium text-gray-900 text-sm truncate" title={bookmark.device_name}>
                  {bookmark.device_name || 'Unknown Device'}
                </h3>

                {/* Label - Editable */}
                {editingId === bookmark.id ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Add label..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateLabel(bookmark.id, editLabel);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    <button
                      onClick={() => handleUpdateLabel(bookmark.id, editLabel)}
                      className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div
                    className="text-xs text-gray-600 italic truncate cursor-pointer hover:text-blue-600"
                    onClick={() => {
                      setEditingId(bookmark.id);
                      setEditLabel(bookmark.label || '');
                    }}
                    title={bookmark.label || 'Click to add label'}
                  >
                    {bookmark.label || '+ Add label'}
                  </div>
                )}

                {/* Timestamp and File Size */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate" title={formatTimestamp(bookmark.center_timestamp)}>
                    {new Date(bookmark.center_timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span className="ml-auto text-gray-400">
                    {formatFileSize(bookmark.file_size)}
                  </span>
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(bookmark.id);
                  }}
                  disabled={deletingId === bookmark.id}
                  className="w-full px-3 py-2 bg-red-50 text-red-600 text-sm rounded-md hover:bg-red-100 transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deletingId === bookmark.id ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Player Modal */}
      {viewingBookmark && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingBookmark(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-white rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-lg">{viewingBookmark.device_name || 'Unknown Device'}</h3>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-sm text-gray-300">{formatTimestamp(viewingBookmark.center_timestamp)}</p>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    viewingBookmark.source === 'live'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                  }`}>
                    {viewingBookmark.source === 'live' ? '🔴 Live' : '📼 Historical'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {viewingBookmark.duration}s • {formatFileSize(viewingBookmark.file_size)}
                  </span>
                </div>
                {viewingBookmark.label && (
                  <p className="text-sm text-gray-400 mt-1 italic">{viewingBookmark.label}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Download Button */}
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}${viewingBookmark.video_url}`}
                  download={`bookmark-${viewingBookmark.device_name}-${new Date(viewingBookmark.center_timestamp).toISOString()}.mp4`}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
                {/* Close Button */}
                <button
                  onClick={() => setViewingBookmark(null)}
                  className="text-gray-300 hover:text-white transition-colors p-2"
                  title="Close (ESC)"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Video Player */}
            <div className="bg-black" style={{ aspectRatio: '16/9' }}>
              <video
                ref={videoRef}
                controls
                autoPlay
                className="w-full h-full"
                src={`${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}${viewingBookmark.video_url}`}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
