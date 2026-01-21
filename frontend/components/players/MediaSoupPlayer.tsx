'use client';

import { useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { API_URL } from '@/lib/api-v2';

interface MediaSoupPlayerProps {
  roomId: string; // Device ID
  mediasoupUrl?: string;
  shouldConnect?: boolean; // Don't auto-connect, wait for explicit trigger
  onLog?: (message: string) => void; // Callback for detailed logs
}

export default function MediaSoupPlayer({
  roomId,
  mediasoupUrl = `${API_URL.replace('http', 'ws')}/ws/mediasoup`,  // Proxy through backend
  shouldConnect = false,
  onLog
}: MediaSoupPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>('Ready to start stream');
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<mediasoupClient.types.Device | null>(null);
  const transportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const consumersRef = useRef<mediasoupClient.types.Consumer[]>([]);

  // Helper for logging with callback
  const log = (message: string, level: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    console.log(logMessage);
    if (onLog) {
      onLog(logMessage);
    }
  };

  // Cleanup effect when shouldConnect changes to false
  useEffect(() => {
    if (!shouldConnect) {
      // Clean up existing connections when stream is stopped
      consumersRef.current.forEach(consumer => consumer.close());
      consumersRef.current = [];

      if (transportRef.current) {
        transportRef.current.close();
        transportRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setStatus('Ready to start stream');
      setError(null);
    }
  }, [shouldConnect]);

  useEffect(() => {
    // Only connect when shouldConnect is true
    if (!shouldConnect) {
      log('Player ready - waiting for stream to be started...', 'info');
      setStatus('Ready to start stream');
      return;
    }

    let mounted = true;

    const connectMediaSoup = async () => {
      try {
        if (!mounted) return;
        log('STEP 1: Connecting to MediaSoup WebSocket server...', 'info');
        setStatus('Connecting to MediaSoup server...');
        
        // Connect to MediaSoup WebSocket
        const ws = new WebSocket(mediasoupUrl);
        wsRef.current = ws;

        // Wait for WebSocket to open
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            log('STEP 1: WebSocket connected successfully', 'success');
            resolve();
          };
          ws.onerror = (err) => {
            log('STEP 1: WebSocket connection error', 'error');
            reject(err);
          };
          setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        });

        if (!mounted) return;
        log('STEP 2: Getting router RTP capabilities...', 'info');
        setStatus('Loading MediaSoup device...');

        // Send request and wait for response helper
        const sendRequest = async (type: string, payload: any): Promise<any> => {
          return new Promise((resolve, reject) => {
            const handler = (event: MessageEvent) => {
              const response = JSON.parse(event.data);
              if (response.type === 'error') {
                reject(new Error(response.error));
              } else {
                ws.removeEventListener('message', handler);
                resolve(response);
              }
            };
            
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({ type, payload }));
            
            // Timeout
            setTimeout(() => {
              ws.removeEventListener('message', handler);
              reject(new Error(`Request timeout: ${type}`));
            }, 10000);
          });
        };

        // 1. Get router RTP capabilities
        const routerResponse = await sendRequest('getRouterRtpCapabilities', { roomId });
        const rtpCapabilities = routerResponse.rtpCapabilities;
        log('STEP 2: Router RTP capabilities received', 'success');

        if (!mounted) return;
        log('STEP 3: Creating MediaSoup Device...', 'info');
        setStatus('Creating MediaSoup device...');

        // 2. Create mediasoup Device
        const device = new mediasoupClient.Device();
        deviceRef.current = device;
        
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        log('STEP 3: MediaSoup Device created and loaded', 'success');

        if (!mounted) return;
        log('STEP 4: Creating WebRTC transport...', 'info');
        setStatus('Creating WebRTC transport...');

        // 3. Create WebRTC transport (recv-only for consumer)
        const transportResponse = await sendRequest('createWebRtcTransport', { roomId });
        const transportInfo = transportResponse.transportInfo;
        log('STEP 4: WebRTC transport created', 'success');

        // Create recv transport
        const transport = device.createRecvTransport({
          id: transportInfo.id,
          iceParameters: transportInfo.iceParameters,
          iceCandidates: transportInfo.iceCandidates,
          dtlsParameters: transportInfo.dtlsParameters,
        });
        
        transportRef.current = transport;

        // Handle transport connection event
        transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            log('STEP 5: Transport connect event fired - establishing DTLS connection...', 'info');
            await sendRequest('connectWebRtcTransport', {
              transportId: transport.id,
              dtlsParameters,
            });
            callback();
            log('STEP 5: WebRTC transport connected successfully (DTLS established)', 'success');
          } catch (err) {
            log(`STEP 5: Transport connect failed: ${err}`, 'error');
            errback(err as Error);
          }
        });

        log('Transport created and listening for connection event', 'info');

        // Check if consumers already exist (prevent duplicate creation)
        if (consumersRef.current.length > 0) {
          console.log('Consumers already exist, reusing existing stream');
          const existingStream = new MediaStream(consumersRef.current.map(c => c.track));
          if (videoRef.current && mounted) {
            videoRef.current.srcObject = existingStream;
            setStatus('🔴 LIVE');
          }
          return;
        }

        if (!mounted) return;
        log('STEP 6: Getting available producers...', 'info');
        setStatus('Getting producers...');

        // 4. Get available producers with retry logic
        // This handles the race condition where the producer might not be immediately available
        const getProducersWithRetry = async (
          maxRetries: number = 5,
          initialDelayMs: number = 500
        ): Promise<string[]> => {
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (!mounted) return [];

            const producersResponse = await sendRequest('getProducers', { roomId });
            const ids = producersResponse.producers;

            if (ids && ids.length > 0) {
              log(`STEP 6: Found ${ids.length} producer(s) on attempt ${attempt + 1}`, 'success');
              return ids;
            }

            if (attempt < maxRetries - 1) {
              // Exponential backoff: 500, 750, 1125, 1687, 2531ms
              const delay = Math.floor(initialDelayMs * Math.pow(1.5, attempt));
              log(`STEP 6: No producers yet (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`, 'info');
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }

          return [];
        };

        const producerIds = await getProducersWithRetry();

        if (!producerIds || producerIds.length === 0) {
          const errMsg = 'No producers available after retries. Is the stream started?';
          log(`STEP 6: ${errMsg}`, 'error');
          throw new Error(errMsg);
        }

        if (!mounted) return;
        log('STEP 7: Consuming video producer...', 'info');
        setStatus('Consuming media streams...');

        // 5. Consume the LATEST producer (last in array = most recent)
        // Since old producers aren't always cleaned up, we need to pick the newest one
        const stream = new MediaStream();
        
        // Pick the LAST producer in the list (most recently created)
        // This ensures we consume the producer that's currently receiving packets
        const latestProducerId = producerIds[producerIds.length - 1];
        
        if (!latestProducerId) {
          throw new Error('No producer available');
        }
        
        log(`STEP 7: Selecting LATEST producer: ${latestProducerId} (${producerIds.length} total producers, using last one)`, 'info');
        
        const consumerResponse = await sendRequest('consume', {
          transportId: transport.id,
          producerId: latestProducerId,
          rtpCapabilities: device.rtpCapabilities,
        });
        
        const consumerInfo = consumerResponse.consumerInfo;
        
        // Only consume video tracks
        if (consumerInfo.kind !== 'video') {
          throw new Error(`Expected video producer, got ${consumerInfo.kind}`);
        }
        
        const consumer = await transport.consume({
          id: consumerInfo.id,
          producerId: consumerInfo.producerId,
          kind: consumerInfo.kind,
          rtpParameters: consumerInfo.rtpParameters,
        });
        
        // Many mediasoup servers create Consumers paused by default.
        // Explicitly resume to start receiving media frames.
        try {
          await consumer.resume();
          log('STEP 7: Consumer resumed', 'success');
        } catch (e: any) {
          log(`STEP 7: Failed to resume consumer: ${e?.message || e}`, 'error');
        }
        
        consumersRef.current.push(consumer);
        stream.addTrack(consumer.track);
        
        log(`STEP 7: Consumed LATEST video track (producer: ${latestProducerId.substring(0, 8)}...)`, 'success');
        log(`  Track ID: ${consumer.track.id}, Enabled: ${consumer.track.enabled}, Muted: ${consumer.track.muted}, ReadyState: ${consumer.track.readyState}`, 'info');

        // 6. Attach stream to video element
        if (videoRef.current && mounted) {
          log('STEP 8: Attaching stream to video element...', 'info');
          videoRef.current.srcObject = stream;
          log(`STEP 8: Video element srcObject set (${stream.getTracks().length} track(s))`, 'success');
          
          // Monitor track state with smart mute detection
          // Brief mutes (<3s) are normal due to keyframe intervals, only log long mutes
          stream.getTracks().forEach(track => {
            let muteTimeout: NodeJS.Timeout | null = null;

            track.addEventListener('ended', () => {
              log(`⚠️ Track ended: ${track.id}`, 'error');
            });

            track.addEventListener('mute', () => {
              // Set a timeout - only log if muted for >3 seconds (actual problem)
              muteTimeout = setTimeout(() => {
                log(`⚠️ Track muted for >3s: ${track.id.substring(0, 8)}... (possible stream issue)`, 'error');
              }, 3000);
            });

            track.addEventListener('unmute', () => {
              // Clear the timeout - track recovered quickly (normal behavior)
              if (muteTimeout) {
                clearTimeout(muteTimeout);
                muteTimeout = null;
              }
              // Don't log unmute events - they're just noise for normal operation
            });
          });
          
          log('STEP 9: Attempting to play video...', 'info');
          
          try {
            await videoRef.current.play();
            log('STEP 9: Video playback started successfully! 🎉', 'success');
            setStatus('🔴 LIVE');
            setError(null);
          } catch (playErr: any) {
            log(`STEP 9: Video play() failed: ${playErr.message || playErr}`, 'error');
            setError(`Play failed: ${playErr.message || playErr}`);
          }
        }

      } catch (err: any) {
        log(`Connection error at step: ${err.message || err}`, 'error');
        console.error('MediaSoup connection error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Connection failed');
          setStatus('Error');
        }
      }
    };

    connectMediaSoup();

    // Cleanup
    return () => {
      mounted = false;
      
      // Close consumers
      consumersRef.current.forEach(consumer => consumer.close());
      consumersRef.current = [];
      
      // Close transport
      if (transportRef.current) {
        transportRef.current.close();
        transportRef.current = null;
      }
      
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [roomId, mediasoupUrl, shouldConnect]);

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        className="w-full h-full object-contain"
      />
      
      {/* Status overlay */}
      <div className={`absolute top-4 left-4 px-4 py-2 rounded-lg text-sm font-medium ${
        status === '🔴 LIVE'
          ? 'bg-red-600 text-white animate-pulse'
          : 'bg-black bg-opacity-75 text-white'
      }`}>
        {status}
      </div>

      {/* Loading spinner */}
      {!error && status !== '🔴 LIVE' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-lg">{status}</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-75">
          <div className="text-white text-center max-w-md p-6">
            <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-lg font-bold mb-2">Connection Error</p>
            <p className="text-sm">{error}</p>
            <p className="text-xs mt-4 text-gray-300">
              Make sure the stream is started and MediaSoup server is running
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

