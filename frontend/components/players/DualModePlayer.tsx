'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import MediaSoupPlayer from './MediaSoupPlayer';
import dynamic from 'next/dynamic';

const HLSPlayer = dynamic(() => import('./HLSPlayer'), { ssr: false });

interface DualModePlayerProps {
  deviceId: string;
  deviceName: string;
  shouldConnect?: boolean;
  onLog?: (message: string) => void;
  onModeChange?: (mode: 'live' | 'historical') => void;
}

export interface DualModePlayerRef {
  getMode: () => 'live' | 'historical';
  getVideoElement: () => HTMLVideoElement | null;
}

type StreamMode = 'live' | 'historical';

const DualModePlayer = forwardRef<DualModePlayerRef, DualModePlayerProps>(
  ({ deviceId, deviceName, shouldConnect = false, onLog, onModeChange }, ref) => {
    const [mode, setMode] = useState<StreamMode>('live');
    const hlsPlayerRef = useRef<any>(null);

    const handleModeChange = (newMode: StreamMode) => {
      setMode(newMode);
      if (onModeChange) {
        onModeChange(newMode);
      }
    };

    useImperativeHandle(ref, () => ({
      getMode: () => mode,
      getVideoElement: () => hlsPlayerRef.current?.getVideoElement() || null,
    }));

  return (
    <div className="relative w-full h-full">
      {/* Mode selector */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        <button
          onClick={() => handleModeChange('live')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            mode === 'live'
              ? 'bg-red-600 text-white shadow-lg'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className="flex items-center gap-2">
            {mode === 'live' && (
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            )}
            LIVE
          </div>
        </button>

        <button
          onClick={() => handleModeChange('historical')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            mode === 'historical'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            Historical
          </div>
        </button>
      </div>

      {/* Player based on mode */}
      <div className="w-full h-full">
        {mode === 'live' ? (
          <MediaSoupPlayer
            roomId={deviceId}
            mediasoupUrl="ws://10.30.250.245:8080/ws/mediasoup"
            shouldConnect={shouldConnect}
            onLog={onLog}
          />
        ) : (
          <HLSPlayer
            ref={hlsPlayerRef}
            streamUrl={`${process.env.NEXT_PUBLIC_API_URL || 'http://10.30.250.245:8080'}/api/v1/recordings/devices/${deviceId}/playlist`}
            deviceName={deviceName}
            deviceId={deviceId}
            hideControls={true}
          />
        )}
      </div>

      {/* Mode indicator */}
      <div className="absolute bottom-4 left-4 bg-black bg-opacity-75 text-white px-3 py-1 rounded text-xs">
        {mode === 'live' ? (
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            Real-time streaming (&lt;500ms latency)
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            </svg>
            Recorded/Buffered feed (seekable)
          </span>
        )}
      </div>
    </div>
  );
});

DualModePlayer.displayName = 'DualModePlayer';

export default DualModePlayer;
