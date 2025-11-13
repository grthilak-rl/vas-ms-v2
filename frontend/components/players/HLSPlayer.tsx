'use client';

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { captureBookmarkHistorical } from '@/lib/api';

interface HLSPlayerProps {
  streamUrl: string;
  deviceName: string;
  deviceId?: string;
  onSnapshotCaptured?: (snapshotId: string) => void;
  hideControls?: boolean;
}

export interface HLSPlayerRef {
  getVideoElement: () => HTMLVideoElement | null;
}

const HLSPlayer = forwardRef<HLSPlayerRef, HLSPlayerProps>(
  ({ streamUrl, deviceName, deviceId, onSnapshotCaptured, hideControls = false }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [capturingSnapshot, setCapturingSnapshot] = useState(false);
    const [snapshotSuccess, setSnapshotSuccess] = useState(false);
    const [capturingBookmark, setCapturingBookmark] = useState(false);
    const [bookmarkSuccess, setBookmarkSuccess] = useState(false);

    useImperativeHandle(ref, () => ({
      getVideoElement: () => videoRef.current,
    }));

  const handleCaptureSnapshot = async () => {
    if (!deviceId) {
      console.error('Device ID not provided');
      return;
    }

    try {
      setCapturingSnapshot(true);

      // For HLS rolling buffer: calculate how far back from "now" we are
      const currentTime = videoRef.current?.currentTime || 0;
      const duration = videoRef.current?.duration || 0;

      // How many seconds behind the live edge are we?
      const secondsBehind = duration - currentTime;

      // Calculate the actual timestamp
      const timestamp = new Date(Date.now() - (secondsBehind * 1000)).toISOString();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}/api/v1/snapshots/devices/${deviceId}/capture/historical`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp }),
        }
      );

      if (!response.ok) throw new Error('Failed to capture snapshot');

      const data = await response.json();
      setSnapshotSuccess(true);
      setTimeout(() => setSnapshotSuccess(false), 2000);

      if (onSnapshotCaptured && data.snapshot) {
        onSnapshotCaptured(data.snapshot.id);
      }
    } catch (error) {
      console.error('Snapshot capture error:', error);
    } finally {
      setCapturingSnapshot(false);
    }
  };

  const handleCaptureBookmark = async () => {
    if (!deviceId) {
      console.error('Device ID not provided');
      return;
    }

    try {
      setCapturingBookmark(true);

      // For HLS rolling buffer: calculate how far back from "now" we are
      const currentTime = videoRef.current?.currentTime || 0;
      const duration = videoRef.current?.duration || 0;

      // How many seconds behind the live edge are we?
      const secondsBehind = duration - currentTime;

      // Calculate the actual timestamp for the center of the bookmark
      const centerTimestamp = new Date(Date.now() - (secondsBehind * 1000)).toISOString();

      const bookmark = await captureBookmarkHistorical(deviceId, centerTimestamp);
      console.log('✅ Bookmark captured:', bookmark.id);

      setBookmarkSuccess(true);
      setTimeout(() => setBookmarkSuccess(false), 2000);
    } catch (error: any) {
      console.error('❌ Bookmark capture error:', error);
      alert('Failed to capture bookmark: ' + (error.message || 'Unknown error'));
    } finally {
      setCapturingBookmark(false);
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    let hls: any = null;

    const initPlayer = async () => {
      try {
        setLoading(true);
        setError(null);

        const Hls = (await import('hls.js')).default;

        if (Hls.isSupported()) {
          hls = new Hls({
            // Configuration for historical playback (not live)
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000, // 60 MB
            lowLatencyMode: false, // Historical mode
            backBufferLength: 60, // Keep more buffer for seeking
          });

          hls.loadSource(streamUrl);
          hls.attachMedia(videoElement);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false);
            videoElement.play().catch(e => {
              console.log('Autoplay prevented:', e);
              setLoading(false);
            });
          });

          // Enhanced error handling with auto-recovery
          let consecutiveErrors = 0;
          const MAX_CONSECUTIVE_ERRORS = 5;

          hls.on(Hls.Events.ERROR, (event: any, data: any) => {
            console.warn('HLS error:', data.type, data.details, data.fatal);

            if (data.fatal) {
              consecutiveErrors++;

              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Network error, attempting to recover...');
                  if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
                    // Try to recover from network error
                    setTimeout(() => {
                      hls.startLoad();
                    }, 1000);
                  } else {
                    setError('Network connection lost. Please check your connection.');
                    setLoading(false);
                  }
                  break;

                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Media error (possibly corrupt segment), recovering...');
                  if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
                    // Recover from media error (corrupted segment)
                    hls.recoverMediaError();
                  } else {
                    setError('Too many playback errors. Recording may be corrupted.');
                    setLoading(false);
                  }
                  break;

                default:
                  // Fatal error that cannot be recovered
                  console.error('Fatal HLS error, attempting to reload...');
                  if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
                    setTimeout(() => {
                      hls.destroy();
                      initPlayer();
                    }, 2000);
                  } else {
                    setError(`Playback failed: ${data.details}`);
                    setLoading(false);
                  }
                  break;
              }
            } else {
              // Non-fatal error - log but continue
              console.log('Non-fatal HLS error, player will auto-recover');
              // Player automatically skips bad segments and continues
            }
          });

          // Reset error counter on successful fragment load
          hls.on(Hls.Events.FRAG_LOADED, () => {
            consecutiveErrors = 0;
          });
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari)
          videoElement.src = streamUrl;
          videoElement.addEventListener('loadedmetadata', () => {
            setLoading(false);
            videoElement.play().catch(e => {
              console.log('Autoplay prevented:', e);
              setLoading(false);
            });
          });
          videoElement.addEventListener('error', () => {
            setError('Failed to load video stream');
            setLoading(false);
          });
        } else {
          setError('HLS is not supported in this browser');
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to initialize HLS player:', err);
        setError('Failed to initialize player');
        setLoading(false);
      }
    };

    initPlayer();

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [streamUrl]);

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls
        playsInline
      />

      {/* Capture buttons - Only show when not loading/error and deviceId provided and not hiding controls */}
      {!loading && !error && deviceId && !hideControls && (
        <div className="absolute top-4 right-4 flex gap-2 z-20">
          <button
            onClick={handleCaptureSnapshot}
            disabled={capturingSnapshot}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Capture snapshot from historical recording"
          >
            {capturingSnapshot ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Capturing...
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
            onClick={handleCaptureBookmark}
            disabled={capturingBookmark}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Capture 6-second bookmark clip from historical recording"
          >
            {capturingBookmark ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Capturing...
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
        </div>
      )}

      {/* Success indicators */}
      {snapshotSuccess && (
        <div className="absolute top-20 right-4 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white z-20">
          ✓ Snapshot saved!
        </div>
      )}
      {bookmarkSuccess && (
        <div className="absolute top-28 right-4 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white z-20">
          ✓ Bookmark saved!
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Loading {deviceName}...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-75">
          <div className="text-white text-center p-6">
            <svg className="w-12 h-12 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="font-bold mb-2">Playback Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
});

HLSPlayer.displayName = 'HLSPlayer';

export default HLSPlayer;
