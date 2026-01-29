'use client';

import { useState, useEffect, useRef } from 'react';
import DualModePlayer, { DualModePlayerRef } from '@/components/players/DualModePlayer';
import { getDevices, Device } from '@/lib/api';
import { getStreams, createSnapshot, createBookmark, startDeviceStream, stopDeviceStream, getRecordingPlaylist, API_URL } from '@/lib/api-v2';
import { CameraIcon, VideoCameraIcon, PlayIcon, StopIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';

type GridSize = 2 | 3 | 4;

export default function StreamsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [gridSize, setGridSize] = useState<GridSize>(2);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Track which streams are active (should connect player)
  const [activeStreams, setActiveStreams] = useState<Record<string, boolean>>({});
  const [capturingSnapshot, setCapturingSnapshot] = useState<Record<string, boolean>>({});
  const [snapshotSuccess, setSnapshotSuccess] = useState<Record<string, boolean>>({});
  const [capturingBookmark, setCapturingBookmark] = useState<Record<string, boolean>>({});
  const [bookmarkSuccess, setBookmarkSuccess] = useState<Record<string, boolean>>({});
  const [playerModes, setPlayerModes] = useState<Record<string, 'live' | 'historical'>>({});
  const playerRefs = useRef<Record<string, DualModePlayerRef | null>>({});

  // V2 API: Device-to-Stream mapping (camera_id -> stream_id)
  const [deviceStreamMap, setDeviceStreamMap] = useState<Record<string, string>>({});

  // Load persisted state on mount - but only after auth is ready
  useEffect(() => {
    // Wait for auth to finish loading before making API calls
    if (authLoading || !isAuthenticated) return;

    loadDevices();

    // Load selected devices from localStorage (which devices to display)
    const savedDevices = localStorage.getItem('selectedDevices');
    if (savedDevices) {
      try {
        const parsed = JSON.parse(savedDevices);
        setSelectedDevices(parsed);
      } catch (e) {
        console.error('Failed to parse saved devices:', e);
      }
    }

    // NOTE: We don't restore activeStreams from localStorage
    // because that would cause players to auto-reconnect and create
    // new MediaSoup transports, leading to port exhaustion.
    // Instead, we rely on backend sync (device.is_active) to show
    // which streams are running, and let users manually reconnect.
  }, [authLoading, isAuthenticated]);

  // Persist selected devices to localStorage whenever they change
  useEffect(() => {
    if (selectedDevices.length > 0) {
      localStorage.setItem('selectedDevices', JSON.stringify(selectedDevices));
    }
  }, [selectedDevices]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownOpen && !(event.target as Element).closest('.device-selector')) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const loadDevices = async () => {
    try {
      const data = await getDevices();
      setDevices(data);

      // Validate selectedDevices against actual device IDs to remove stale entries
      const validDeviceIds = new Set(data.map(d => d.id));
      setSelectedDevices(prev => prev.filter(id => validDeviceIds.has(id)));

      // Discover V2 streams for snapshot/bookmark capture
      await discoverStreams();

      // NOTE: We don't auto-set activeStreams here to avoid auto-reconnecting
      // players. The backend's device.is_active shows stream state for UI only.
      // Users must manually click "Start Stream" to reconnect.
    } catch (err: any) {
      console.error('Failed to load devices:', err);
    }
  };

  const discoverStreams = async () => {
    try {
      const { streams } = await getStreams('live'); // Only get active streams

      // Map camera_id (device_id) to stream_id
      const mapping: Record<string, string> = {};
      streams.forEach(stream => {
        mapping[stream.camera_id] = stream.id;
      });

      setDeviceStreamMap(mapping);
      console.log('📡 Stream discovery:', mapping);
    } catch (err: any) {
      // Don't log auth errors as failures - they're expected when not logged in
      if (err.message?.includes('Authentication required')) {
        console.log('📡 Stream discovery skipped - not authenticated');
      } else {
        console.error('Failed to discover streams:', err);
      }
    }
  };

  const getSelectedDeviceDetails = () => {
    return devices.filter(d => selectedDevices.includes(d.id));
  };

  const handleStartStream = async (deviceId: string) => {
    try {
      setLoading(prev => ({ ...prev, [deviceId]: true }));

      // Find the device to check if it's already streaming
      const device = devices.find(d => d.id === deviceId);

      if (device?.is_active) {
        // Stream is already running on backend, just connect the player
        console.log('Stream already active on backend, connecting player...');
        // Refresh stream discovery to ensure we have the V2 Stream ID for snapshots/bookmarks
        await discoverStreams();
        setActiveStreams(prev => ({ ...prev, [deviceId]: true }));
      } else {
        // Stream not running, start it on backend (using JWT-authenticated V2 wrapper)
        const data = await startDeviceStream(deviceId);
        console.log('Stream started:', data);

        // Reload devices to update status
        await loadDevices();

        // Explicitly refresh stream discovery to get the new V2 Stream ID
        // This is needed for snapshot/bookmark functionality
        await discoverStreams();
        console.log('📡 Stream discovery refreshed after start');

        // Wait a moment for producer to be ready, then trigger player connection
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay

        setActiveStreams(prev => ({ ...prev, [deviceId]: true }));
      }

    } catch (err: any) {
      console.error('Failed to start stream:', err);
      alert('Failed to start stream: ' + err.message);
    } finally {
      setLoading(prev => ({ ...prev, [deviceId]: false }));
    }
  };

  const handleStopStream = async (deviceId: string) => {
    try {
      setLoading(prev => ({ ...prev, [deviceId]: true }));

      // Use JWT-authenticated V2 wrapper
      const data = await stopDeviceStream(deviceId);
      console.log('Stream stopped:', data);

      // Update UI immediately
      setActiveStreams(prev => ({ ...prev, [deviceId]: false }));

      // Reload devices to update status
      await loadDevices();

    } catch (err: any) {
      console.error('Failed to stop stream:', err);
      alert('Failed to stop stream: ' + err.message);
    } finally {
      setLoading(prev => ({ ...prev, [deviceId]: false }));
    }
  };

  const handleCaptureSnapshot = async (deviceId: string) => {
    try {
      setCapturingSnapshot(prev => ({ ...prev, [deviceId]: true }));

      // Get stream_id from device-to-stream mapping
      const streamId = deviceStreamMap[deviceId];
      if (!streamId) {
        throw new Error('No active stream found for this device. Please start the stream first.');
      }

      const mode = playerModes[deviceId] || 'live';
      let timestamp: string | undefined;

      if (mode === 'historical') {
        // Historical mode - get timestamp from HLS playlist
        const playerRef = playerRefs.current[deviceId];
        const videoElement = playerRef?.getVideoElement();

        if (!videoElement) {
          throw new Error('Video element not available');
        }

        const currentTime = videoElement.currentTime || 0;

        // Get the actual timestamp by parsing the HLS playlist
        timestamp = await getTimestampFromHLSPosition(deviceId, currentTime);
      }

      console.log('📸 Snapshot Request:', {
        deviceId,
        streamId,
        mode,
        timestamp
      });

      // V2 API call - pass source explicitly based on mode
      const source = mode === 'live' ? 'live' : 'historical';
      const snapshot = await createSnapshot(streamId, source, timestamp);
      console.log('✅ Snapshot captured:', snapshot.id);

      // Show success indicator briefly
      setSnapshotSuccess(prev => ({ ...prev, [deviceId]: true }));
      setTimeout(() => {
        setSnapshotSuccess(prev => ({ ...prev, [deviceId]: false }));
      }, 2000);

    } catch (err: any) {
      console.error('❌ Failed to capture snapshot:', err);
      alert('Failed to capture snapshot: ' + err.message);
    } finally {
      setCapturingSnapshot(prev => ({ ...prev, [deviceId]: false }));
    }
  };

  const getTimestampFromHLSPosition = async (deviceId: string, currentTime: number): Promise<string> => {
    // Fetch HLS playlist to get segment information (using authenticated API)
    const playlistText = await getRecordingPlaylist(deviceId);

    // Parse playlist to extract segments and their durations
    const lines = playlistText.split('\n');
    const segments: { filename: string; duration: number; timestamp: number }[] = [];
    let accumulatedTime = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for segment duration line
      if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split(':')[1].split(',')[0]);
        const nextLine = lines[i + 1]?.trim();

        if (nextLine && nextLine.endsWith('.ts')) {
          // Extract Unix timestamp from filename: segment-1763031193.ts
          const match = nextLine.match(/segment-(\d+)\.ts/);
          if (match) {
            const unixTimestamp = parseInt(match[1]);
            segments.push({
              filename: nextLine,
              duration,
              timestamp: unixTimestamp
            });
            accumulatedTime += duration;
          }
        }
      }
    }

    if (segments.length === 0) {
      throw new Error('No segments found in HLS playlist');
    }

    // Find which segment contains the currentTime position
    let timeInPlaylist = 0;
    for (const segment of segments) {
      if (currentTime >= timeInPlaylist && currentTime < timeInPlaylist + segment.duration) {
        // Found the segment! Calculate the offset within this segment
        const offsetInSegment = currentTime - timeInPlaylist;
        const actualTimestamp = segment.timestamp + offsetInSegment;

        console.log('📍 Timestamp Calculation:', {
          currentTime,
          segmentFilename: segment.filename,
          segmentStartTime: timeInPlaylist,
          segmentTimestamp: segment.timestamp,
          offsetInSegment,
          calculatedTimestamp: actualTimestamp,
          asDate: new Date(actualTimestamp * 1000).toISOString()
        });

        return new Date(actualTimestamp * 1000).toISOString();
      }
      timeInPlaylist += segment.duration;
    }

    // If we're past the end, use the last segment's timestamp
    const lastSegment = segments[segments.length - 1];
    const lastTimestamp = lastSegment.timestamp + lastSegment.duration;
    console.warn('⚠️ Current time beyond playlist duration, using last segment');
    return new Date(lastTimestamp * 1000).toISOString();
  };

  const handleCaptureBookmark = async (deviceId: string) => {
    try {
      setCapturingBookmark(prev => ({ ...prev, [deviceId]: true }));

      // Get stream_id from device-to-stream mapping
      const streamId = deviceStreamMap[deviceId];
      if (!streamId) {
        throw new Error('No active stream found for this device. Please start the stream first.');
      }

      const mode = playerModes[deviceId] || 'live';
      let centerTimestamp: string;

      if (mode === 'live') {
        // For live mode, use current time
        centerTimestamp = new Date().toISOString();
      } else {
        // Historical mode - get timestamp from HLS playlist
        const playerRef = playerRefs.current[deviceId];
        const videoElement = playerRef?.getVideoElement();

        if (!videoElement) {
          throw new Error('Video element not available');
        }

        const currentTime = videoElement.currentTime || 0;

        // Get the actual timestamp by parsing the HLS playlist
        centerTimestamp = await getTimestampFromHLSPosition(deviceId, currentTime);
      }

      console.log('📍 Bookmark Request:', {
        deviceId,
        streamId,
        centerTimestamp,
        mode
      });

      // V2 API call - pass source explicitly based on mode
      const source = mode === 'live' ? 'live' : 'historical';
      const bookmark = await createBookmark(streamId, source, centerTimestamp);
      console.log('✅ Bookmark captured:', bookmark.id);

      // Show success indicator briefly
      setBookmarkSuccess(prev => ({ ...prev, [deviceId]: true }));
      setTimeout(() => {
        setBookmarkSuccess(prev => ({ ...prev, [deviceId]: false }));
      }, 2000);

    } catch (err: any) {
      console.error('❌ Failed to capture bookmark:', err);
      alert('Failed to capture bookmark: ' + err.message);
    } finally {
      setCapturingBookmark(prev => ({ ...prev, [deviceId]: false }));
    }
  };

  const getGridClassName = () => {
    switch (gridSize) {
      case 2: return 'grid-cols-1 md:grid-cols-2';
      case 3: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 4: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Streams Management</h1>
          <p className="mt-2 text-gray-600">Monitor and control your video streams</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Device Selector */}
          <div className="relative device-selector">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Select Devices
              {selectedDevices.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {selectedDevices.length} selected
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full px-3 py-2 text-left border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between"
            >
              <span>
                {selectedDevices.length === 0
                  ? 'Select devices...'
                  : selectedDevices.length === 1
                  ? '1 device selected'
                  : `${selectedDevices.length} devices selected`}
              </span>
              <span className="text-gray-400">▼</span>
            </button>
            
            {dropdownOpen && (
              <div className="absolute z-[55] mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {devices.length === 0 ? (
                  <div className="px-4 py-2 text-sm text-gray-500">No devices available</div>
                ) : (
                  devices.map((device) => (
                    <label
                      key={device.id}
                      className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDevices.includes(device.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDevices([...selectedDevices, device.id]);
                          } else {
                            setSelectedDevices(selectedDevices.filter(id => id !== device.id));
                          }
                        }}
                        className="mr-3"
                      />
                      <span className="text-sm text-gray-900">{device.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Grid Size Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Grid Layout
            </label>
            <div className="flex gap-2">
              {[2, 3, 4].map((size) => (
                <button
                  key={size}
                  onClick={() => setGridSize(size as GridSize)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    gridSize === size
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {size}×{size}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stream Grid */}
      {selectedDevices.length > 0 ? (
        <div className={`grid ${getGridClassName()} gap-6`}>
          {getSelectedDeviceDetails().map((device) => (
            <div key={device.id} className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
              {/* Video Player Area */}
              <div className="aspect-video bg-gray-900 relative">
                <DualModePlayer
                  ref={(el) => { playerRefs.current[device.id] = el; }}
                  deviceId={device.id}
                  deviceName={device.name}
                  shouldConnect={activeStreams[device.id] || false}
                  onModeChange={(mode) => {
                    setPlayerModes(prev => ({ ...prev, [device.id]: mode }));
                  }}
                />
                {!device.is_active && !activeStreams[device.id] && (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center text-white">
                        <VideoCameraIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm opacity-75">No stream active</p>
                      </div>
                    </div>

                    {/* Stream Status Badge */}
                    <div className="absolute top-2 right-2">
                      <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-medium">
                        Offline
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Device Info & Controls */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">{device.name}</h3>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    device.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {device.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="text-xs text-gray-600 mb-3 font-mono truncate">
                  {device.rtsp_url}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleStartStream(device.id)}
                    disabled={loading[device.id] || activeStreams[device.id]}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    {loading[device.id] && !activeStreams[device.id] ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        {device.is_active ? 'Connecting...' : 'Starting...'}
                      </>
                    ) : activeStreams[device.id] ? (
                      <>
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                        Connected
                      </>
                    ) : device.is_active ? (
                      <>
                        <PlayIcon className="h-4 w-4" />
                        Connect
                      </>
                    ) : (
                      <>
                        <PlayIcon className="h-4 w-4" />
                        Start Stream
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleCaptureSnapshot(device.id)}
                    disabled={
                      (playerModes[device.id] === 'live' && !activeStreams[device.id]) ||
                      capturingSnapshot[device.id] ||
                      snapshotSuccess[device.id]
                    }
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      snapshotSuccess[device.id]
                        ? 'bg-green-100 text-green-700 cursor-default border border-green-300'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:border-gray-200'
                    }`}
                    title={playerModes[device.id] === 'historical' ? 'Capture snapshot from historical position' : 'Capture snapshot from live stream'}
                  >
                    {capturingSnapshot[device.id] ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                        Capturing...
                      </>
                    ) : snapshotSuccess[device.id] ? (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Captured!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                        </svg>
                        Snapshot
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleCaptureBookmark(device.id)}
                    disabled={
                      (playerModes[device.id] === 'live' && !activeStreams[device.id]) ||
                      capturingBookmark[device.id] ||
                      bookmarkSuccess[device.id]
                    }
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      bookmarkSuccess[device.id]
                        ? 'bg-purple-100 text-purple-700 cursor-default border border-purple-300'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:border-gray-200'
                    }`}
                    title={playerModes[device.id] === 'historical' ? 'Capture 6-second bookmark from historical position (±3s)' : 'Capture 6-second bookmark from live stream (last 6s)'}
                  >
                    {capturingBookmark[device.id] ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                        Capturing...
                      </>
                    ) : bookmarkSuccess[device.id] ? (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Bookmarked!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                        </svg>
                        Bookmark
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleStopStream(device.id)}
                    disabled={loading[device.id] || (!device.is_active && !activeStreams[device.id])}
                    className="flex-1 border border-red-300 text-red-600 hover:bg-red-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:border-gray-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    {loading[device.id] && (device.is_active || activeStreams[device.id]) ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Stopping...
                      </>
                    ) : (
                      <>
                        <StopIcon className="h-4 w-4" />
                        Stop Stream
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-12 text-center">
          <CameraIcon className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-gray-600">No devices selected</p>
          <p className="mt-2 text-sm text-gray-500">Select devices from above to start streaming</p>
        </div>
      )}
    </div>
  );
}
