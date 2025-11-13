'use client';

import { useState, useEffect, useRef } from 'react';
import MediaSoupPlayer from './MediaSoupPlayer';
import dynamic from 'next/dynamic';

const HLSPlayer = dynamic(() => import('./HLSPlayer'), { ssr: false });

interface UnifiedPlayerProps {
  deviceId: string;
  deviceName: string;
  shouldConnect?: boolean;
}

interface RecordingDate {
  date: string;
  formatted: string;
  segments_count: number;
}

const LIVE_THRESHOLD_SECONDS = 10; // If within 10s of current time, use WebRTC

export default function UnifiedPlayer({ deviceId, deviceName, shouldConnect = false }: UnifiedPlayerProps) {
  const [recordingDates, setRecordingDates] = useState<RecordingDate[]>([]);
  const [timelineStart, setTimelineStart] = useState<number | null>(null); // Unix timestamp (ms)
  const [timelineEnd, setTimelineEnd] = useState<number>(Date.now()); // Current time
  const [currentPosition, setCurrentPosition] = useState<number>(Date.now()); // Current playback position
  const [isLive, setIsLive] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [hlsTargetTime, setHlsTargetTime] = useState<number | null>(null);

  const hlsPlayerRef = useRef<HTMLVideoElement>(null);
  const liveUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch recording timeline
  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}/api/v1/recordings/devices/${deviceId}/dates`
        );
        const data = await response.json();

        if (data.dates && data.dates.length > 0) {
          setRecordingDates(data.dates);

          // Calculate timeline start from oldest recording date
          const oldestDate = data.dates[data.dates.length - 1].date; // Dates are sorted newest first
          const startTime = new Date(
            `${oldestDate.substring(0, 4)}-${oldestDate.substring(4, 6)}-${oldestDate.substring(6, 8)}`
          ).getTime();
          setTimelineStart(startTime);
        } else {
          // No recordings yet, start from current time
          setTimelineStart(Date.now());
        }
      } catch (error) {
        console.error('Failed to fetch recording timeline:', error);
        setTimelineStart(Date.now());
      }
    };

    fetchTimeline();
    // Refresh timeline every 30 seconds
    const interval = setInterval(fetchTimeline, 30000);
    return () => clearInterval(interval);
  }, [deviceId]);

  // Update timeline end and current position when in live mode
  useEffect(() => {
    if (isLive && !isDragging) {
      liveUpdateIntervalRef.current = setInterval(() => {
        const now = Date.now();
        setTimelineEnd(now);
        setCurrentPosition(now);
      }, 1000);
    } else {
      if (liveUpdateIntervalRef.current) {
        clearInterval(liveUpdateIntervalRef.current);
        liveUpdateIntervalRef.current = null;
      }
    }

    return () => {
      if (liveUpdateIntervalRef.current) {
        clearInterval(liveUpdateIntervalRef.current);
      }
    };
  }, [isLive, isDragging]);

  // Determine if current position is "live"
  useEffect(() => {
    const now = Date.now();
    const diffSeconds = (now - currentPosition) / 1000;
    const shouldBeLive = diffSeconds <= LIVE_THRESHOLD_SECONDS;

    if (shouldBeLive !== isLive) {
      setIsTransitioning(true);
      setIsLive(shouldBeLive);

      // Clear transition state after a brief delay
      setTimeout(() => setIsTransitioning(false), 500);
    }
  }, [currentPosition, isLive]);

  // Handle seek bar interaction
  const handleSeekBarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!timelineStart) return;

    const value = parseFloat(e.target.value);
    const newPosition = timelineStart + (timelineEnd - timelineStart) * (value / 100);
    setCurrentPosition(newPosition);

    // If scrubbing to historical, set HLS target time
    if (!isLive) {
      setHlsTargetTime(newPosition);
    }
  };

  const handleSeekBarMouseDown = () => {
    setIsDragging(true);
  };

  const handleSeekBarMouseUp = () => {
    setIsDragging(false);
  };

  const handleJumpToLive = () => {
    const now = Date.now();
    setCurrentPosition(now);
    setTimelineEnd(now);
    setIsLive(true);
  };

  // Calculate seek bar value (0-100)
  const getSeekBarValue = () => {
    if (!timelineStart) return 100;
    const range = timelineEnd - timelineStart;
    if (range === 0) return 100;
    return ((currentPosition - timelineStart) / range) * 100;
  };

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (!timelineStart) {
    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading timeline...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      {/* Player container */}
      <div className="absolute inset-0">
        {isLive ? (
          <div className="w-full h-full">
            <MediaSoupPlayer
              roomId={deviceId}
              mediasoupUrl="ws://10.30.250.245:8080/ws/mediasoup"
              shouldConnect={shouldConnect}
            />
          </div>
        ) : (
          <div className="w-full h-full">
            <HLSPlayer
              streamUrl={`${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}/api/v1/recordings/devices/${deviceId}/playlist`}
              deviceName={deviceName}
              seekToTime={hlsTargetTime || undefined}
            />
          </div>
        )}
      </div>

      {/* Transition overlay */}
      {isTransitioning && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20 pointer-events-none">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Switching to {isLive ? 'Live' : 'Historical'} mode...</p>
          </div>
        </div>
      )}

      {/* Timeline controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4 z-10">
        {/* Timeline seek bar */}
        <div className="mb-3">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={getSeekBarValue()}
            onChange={handleSeekBarChange}
            onMouseDown={handleSeekBarMouseDown}
            onMouseUp={handleSeekBarMouseUp}
            onTouchStart={handleSeekBarMouseDown}
            onTouchEnd={handleSeekBarMouseUp}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${getSeekBarValue()}%, #374151 ${getSeekBarValue()}%, #374151 100%)`
            }}
          />
        </div>

        {/* Timeline info */}
        <div className="flex items-center justify-between text-white text-sm">
          <div className="flex items-center gap-4">
            {/* Current time */}
            <div>
              <div className="font-mono">{formatTime(currentPosition)}</div>
              <div className="text-xs text-gray-400">{formatDate(currentPosition)}</div>
            </div>

            {/* Mode indicator */}
            <div className="flex items-center gap-2">
              {isLive ? (
                <div className="flex items-center gap-2 px-3 py-1 bg-red-600 rounded-full">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                  <span className="font-semibold">LIVE</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-600 rounded-full">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="font-semibold">HISTORICAL</span>
                </div>
              )}
            </div>
          </div>

          {/* Jump to live button */}
          {!isLive && (
            <button
              onClick={handleJumpToLive}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors"
            >
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
              Go Live
            </button>
          )}
        </div>

        {/* Timeline range display */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>{timelineStart ? formatTime(timelineStart) : '--:--:--'}</span>
          <span>
            {recordingDates.length > 0
              ? `${recordingDates.length} day${recordingDates.length > 1 ? 's' : ''} of recordings`
              : 'No recordings yet'}
          </span>
          <span>{formatTime(timelineEnd)}</span>
        </div>
      </div>

      {/* Live latency indicator (top right) */}
      <div className="absolute top-4 right-4 z-10">
        <div className="bg-black bg-opacity-75 text-white px-3 py-1 rounded text-xs">
          {isLive ? (
            <span className="flex items-center gap-2">
              Real-time (&lt;500ms latency)
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Recorded feed (seekable)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
