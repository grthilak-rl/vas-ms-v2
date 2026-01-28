'use client';

import { useEffect, useState, useRef } from 'react';
import {
  getBookmarks,
  deleteBookmark,
  updateBookmark,
  getBookmarkVideoUrl,
  getBookmarkThumbnailUrl,
  downloadBookmarkVideo,
  V2Bookmark
} from '@/lib/api-v2';
import { getDevices, Device } from '@/lib/api';
import { ArrowPathIcon, TrashIcon, ArrowDownTrayIcon, XMarkIcon, BookmarkIcon, VideoCameraIcon, ClockIcon } from '@heroicons/react/24/outline';

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<V2Bookmark[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [eventType, setEventType] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [viewingBookmark, setViewingBookmark] = useState<V2Bookmark | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get all unique tags from bookmarks for filter
  const availableTags = Array.from(
    new Set(bookmarks.flatMap(b => b.tags || []))
  ).sort();

  const loadBookmarks = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getBookmarks(
        selectedDevice === 'all' ? undefined : selectedDevice,
        eventType === 'all' ? undefined : eventType,
        selectedTags.length > 0 ? selectedTags : undefined,
        dateRange.start || undefined,
        dateRange.end || undefined,
        100,
        0
      );

      setBookmarks(data.bookmarks); // V2 returns { bookmarks: [], pagination: {} }
      // Load thumbnails with authentication
      loadThumbnails(data.bookmarks);
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

  // Load thumbnail URLs with authentication
  const loadThumbnails = async (bookmarkList: V2Bookmark[]) => {
    const urls: Record<string, string> = {};
    for (const bookmark of bookmarkList) {
      if (bookmark.thumbnail_url && bookmark.status === 'ready') {
        try {
          urls[bookmark.id] = await getBookmarkThumbnailUrl(bookmark.id);
        } catch (err) {
          console.error(`Failed to load thumbnail for ${bookmark.id}:`, err);
        }
      }
    }
    setThumbnailUrls(urls);
  };

  // Handle viewing a bookmark - load video with auth
  const handleViewBookmark = async (bookmark: V2Bookmark) => {
    setViewingBookmark(bookmark);
    setVideoUrl(null);

    if (bookmark.video_url && bookmark.status === 'ready') {
      setLoadingVideo(true);
      try {
        const url = await getBookmarkVideoUrl(bookmark.id);
        setVideoUrl(url);
      } catch (err) {
        console.error('Failed to load video:', err);
      } finally {
        setLoadingVideo(false);
      }
    }
  };

  // Handle download with authentication
  const handleDownload = async (bookmark: V2Bookmark) => {
    if (!bookmark.video_url || bookmark.status !== 'ready') return;

    setDownloadingId(bookmark.id);
    try {
      const filename = `bookmark-${bookmark.stream_id.substring(0, 8)}-${new Date(bookmark.center_timestamp).toISOString().replace(/[:.]/g, '-')}.mp4`;
      await downloadBookmarkVideo(bookmark.id, filename);
    } catch (err: any) {
      console.error('Failed to download video:', err);
      alert(`Failed to download: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // Cleanup video URL when modal closes
  const handleCloseModal = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl(null);
    setViewingBookmark(null);
  };

  useEffect(() => {
    loadDevices();
    loadBookmarks();
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [selectedDevice, eventType, selectedTags, dateRange]);

  // Keyboard support for closing modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewingBookmark) {
        handleCloseModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingBookmark, videoUrl]);

  const handleDelete = async (bookmarkId: string) => {
    if (!confirm('Are you sure you want to delete this bookmark?')) {
      return;
    }

    try {
      setDeletingId(bookmarkId);
      await deleteBookmark(bookmarkId);
      await loadBookmarks();
    } catch (err: any) {
      console.error('Failed to delete bookmark:', err);
      alert(`Failed to delete bookmark: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateLabel = async (bookmarkId: string, newLabel: string, tags: string[]) => {
    try {
      await updateBookmark(bookmarkId, newLabel, tags);
      await loadBookmarks();
      setEditingId(null);
    } catch (err: any) {
      console.error('Failed to update bookmark:', err);
      alert(`Failed to update label: ${err.message}`);
    }
  };

  const toggleTagFilter = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const addTag = () => {
    if (newTag && !editTags.includes(newTag)) {
      setEditTags([...editTags, newTag]);
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter(t => t !== tag));
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
          onClick={() => loadBookmarks()}
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

          {/* Event Type Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Event Type:</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Events</option>
              <option value="motion">Motion Detected</option>
              <option value="person_detected">Person Detected</option>
              <option value="vehicle">Vehicle</option>
              <option value="anomaly">Anomaly</option>
              <option value="manual">Manual</option>
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
            {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Tag Filters */}
        {availableTags.length > 0 && (
          <div className="flex items-start gap-2">
            <label className="text-sm font-medium text-gray-700 pt-1.5">Tags:</label>
            <div className="flex gap-2 flex-wrap">
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTagFilter(tag)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    selectedTags.includes(tag)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active Filters Clear */}
        {(selectedDevice !== 'all' || eventType !== 'all' || selectedTags.length > 0 || dateRange.start || dateRange.end) && (
          <button
            onClick={() => {
              setSelectedDevice('all');
              setEventType('all');
              setSelectedTags([]);
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
            <BookmarkIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
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
                onClick={() => handleViewBookmark(bookmark)}
              >
                {/* Video Thumbnail */}
                {thumbnailUrls[bookmark.id] ? (
                  <img
                    src={thumbnailUrls[bookmark.id]}
                    alt={`Bookmark from stream ${bookmark.stream_id}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                  />
                ) : bookmark.status === 'processing' ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                      <span className="text-xs text-gray-400">Processing...</span>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <VideoCameraIcon className="w-12 h-12 text-gray-400" />
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
                <div className="absolute top-2 left-2 flex gap-2" style={{ zIndex: 10 }}>
                  {bookmark.source === 'ai_generated' ? (
                    <span className="px-2 py-1 rounded-lg text-xs font-medium shadow-lg bg-purple-600 text-white flex items-center gap-1.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                      </svg>
                      AI Generated
                    </span>
                  ) : (
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium shadow-lg flex items-center gap-1.5 ${
                      bookmark.source === 'live'
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                    }`}>
                      {bookmark.source === 'live' ? (
                        <><span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>Live</>
                      ) : (
                        <><span className="w-2 h-2 bg-white rounded-full"></span>Historical</>
                      )}
                    </span>
                  )}
                </div>

                {/* Duration Badge */}
                <div className="absolute top-2 right-2" style={{ zIndex: 10 }}>
                  <span className="px-2 py-1 bg-black bg-opacity-75 text-white rounded-lg text-xs font-medium">
                    {bookmark.duration_seconds}s
                  </span>
                </div>
              </div>

              {/* Metadata */}
              <div className="p-3 space-y-2">
                {/* Event Type Badge */}
                {bookmark.event_type && (
                  <div className="flex gap-1">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-800 text-xs rounded-lg font-medium">
                      {bookmark.event_type}
                    </span>
                  </div>
                )}

                {/* Label - Editable */}
                {editingId === bookmark.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Add label..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateLabel(bookmark.id, editLabel, editTags);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    {/* Tag Editor */}
                    <div className="space-y-1">
                      <div className="flex gap-1 flex-wrap">
                        {editTags.map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full flex items-center gap-1">
                            {tag}
                            <button onClick={() => removeTag(tag)} className="hover:text-red-600">×</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          placeholder="Add tag..."
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addTag();
                            }
                          }}
                        />
                        <button
                          onClick={addTag}
                          className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUpdateLabel(bookmark.id, editLabel, editTags)}
                        className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                      >
                        ✓ Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                      >
                        ✕ Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-xs text-gray-600 italic truncate cursor-pointer hover:text-blue-600"
                    onClick={() => {
                      setEditingId(bookmark.id);
                      setEditLabel(bookmark.label || '');
                      setEditTags(bookmark.tags || []);
                    }}
                    title={bookmark.label || 'Click to add label'}
                  >
                    {bookmark.label || '+ Add label'}
                  </div>
                )}

                {/* Confidence Score (for AI-generated bookmarks) */}
                {bookmark.source === 'ai_generated' && bookmark.confidence !== undefined && (
                  <div className="text-xs text-gray-600">
                    Confidence: <span className="font-medium">{Math.round(bookmark.confidence * 100)}%</span>
                  </div>
                )}

                {/* Tags Display */}
                {bookmark.tags && bookmark.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {bookmark.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Timestamp */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <ClockIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate" title={formatTimestamp(bookmark.center_timestamp)}>
                    {new Date(bookmark.center_timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(bookmark.id);
                  }}
                  disabled={deletingId === bookmark.id}
                  className="w-full px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

      {/* Video Player Modal */}
      {viewingBookmark && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-[60] flex items-center justify-center p-4"
          onClick={handleCloseModal}
        >
          <div
            className="relative max-w-4xl w-full bg-white rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-lg">Stream: {viewingBookmark.stream_id.substring(0, 8)}...</h3>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-sm text-gray-300">{formatTimestamp(viewingBookmark.center_timestamp)}</p>
                  {viewingBookmark.source === 'ai_generated' ? (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-600 text-white flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                      </svg>
                      AI
                    </span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium flex items-center gap-1 ${
                      viewingBookmark.source === 'live'
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                    }`}>
                      {viewingBookmark.source === 'live' ? (
                        <><span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>Live</>
                      ) : (
                        <><span className="w-1.5 h-1.5 bg-white rounded-full"></span>Historical</>
                      )}
                    </span>
                  )}
                  {viewingBookmark.event_type && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-white">
                      {viewingBookmark.event_type}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {viewingBookmark.duration_seconds}s
                  </span>
                  {viewingBookmark.confidence !== undefined && (
                    <span className="text-xs text-gray-400">
                      {Math.round(viewingBookmark.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                {viewingBookmark.label && (
                  <p className="text-sm text-gray-400 mt-1 italic">{viewingBookmark.label}</p>
                )}
                {viewingBookmark.tags && viewingBookmark.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {viewingBookmark.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Download Button - only show when video is available */}
                {viewingBookmark.video_url && viewingBookmark.status === 'ready' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(viewingBookmark);
                    }}
                    disabled={downloadingId === viewingBookmark.id}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors flex items-center gap-2"
                  >
                    {downloadingId === viewingBookmark.id ? (
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

            {/* Video Player */}
            <div className="bg-black" style={{ aspectRatio: '16/9' }}>
              {loadingVideo ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-white">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
                  <span className="text-lg text-gray-400">Loading video...</span>
                </div>
              ) : videoUrl ? (
                <video
                  ref={videoRef}
                  controls
                  autoPlay
                  className="w-full h-full"
                  src={videoUrl}
                >
                  Your browser does not support the video tag.
                </video>
              ) : viewingBookmark.status === 'processing' ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-white">
                  <svg className="w-16 h-16 text-gray-400 mb-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-lg text-gray-400">Video still processing...</span>
                  <span className="text-sm text-gray-500 mt-2">Please wait and refresh the page</span>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-white">
                  <svg className="w-16 h-16 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-lg text-gray-400">Video not available</span>
                  <span className="text-sm text-gray-500 mt-2">Status: {viewingBookmark.status || 'unknown'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
