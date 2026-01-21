"""
RTSP Pipeline Service

Handles RTSP stream ingestion and forwarding to MediaSoup.
"""
import subprocess
import asyncio
import socket
import struct
import os
from typing import Dict, Optional, Any
from loguru import logger


class RTSPPipeline:
    """
    RTSP Pipeline for ingesting and forwarding RTSP streams.
    
    This service:
    - Starts FFmpeg to read RTSP streams
    - Forwards RTP to MediaSoup
    - Monitors stream health
    - Handles auto-reconnection
    """
    
    def __init__(self):
        """Initialize RTSP Pipeline service."""
        self.active_streams: Dict[str, Any] = {}
        self.ffmpeg_processes: Dict[str, subprocess.Popen] = {}
        self.recording_retention_days = 7  # Keep recordings for 7 days
        self.cleanup_task = None

        logger.info("RTSP Pipeline service initialized")

        # NOTE: Cleanup task deferred - no event loop at import time
    
    async def capture_ssrc_with_temp_ffmpeg(
        self,
        rtsp_url: str,
        timeout: float = 10.0
    ) -> Optional[int]:
        """
        Capture SSRC by starting FFmpeg on a temporary port and reading the first RTP packet.
        This is more reliable than tcpdump as it doesn't require root permissions.

        Args:
            rtsp_url: RTSP source URL
            timeout: Maximum time to wait for RTP packet (seconds)

        Returns:
            SSRC value if found, None otherwise
        """
        temp_port = 50000 + (abs(hash(rtsp_url)) % 10000)  # Use a high port based on URL hash
        temp_socket = None
        temp_process = None

        try:
            # Create UDP socket to capture RTP packets
            temp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            temp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            temp_socket.settimeout(timeout)
            temp_socket.bind(('127.0.0.1', temp_port))

            logger.info(f"Temporary socket bound to 127.0.0.1:{temp_port} for SSRC capture")

            # Start FFmpeg to send RTP to the temporary port (minimal command for fast startup)
            ffmpeg_cmd = [
                "ffmpeg",
                "-loglevel", "warning",  # Show warnings/errors
                "-rtsp_transport", "tcp",
                "-timeout", "5000000",  # 5 second timeout for RTSP connection
                "-i", rtsp_url,
                "-an",  # No audio
                "-vframes", "30",  # Only capture 30 frames (enough to get SSRC)
                "-c:v", "copy",  # Copy video codec (faster)
                "-f", "rtp",
                "-payload_type", "96",
                f"rtp://127.0.0.1:{temp_port}"
            ]

            logger.debug(f"Starting temporary FFmpeg: {' '.join(ffmpeg_cmd)}")

            temp_process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            # Monitor FFmpeg stderr in background to catch connection errors
            async def monitor_ffmpeg_errors():
                while True:
                    line = await temp_process.stderr.readline()
                    if not line:
                        break
                    line_str = line.decode().strip()
                    if line_str:
                        logger.debug(f"Temp FFmpeg: {line_str}")

            error_monitor_task = asyncio.create_task(monitor_ffmpeg_errors())

            # Wait for first RTP packet with timeout
            logger.info("Waiting for RTP packet to capture SSRC...")

            try:
                # Use asyncio to make socket operations non-blocking
                loop = asyncio.get_event_loop()
                data = await asyncio.wait_for(
                    loop.run_in_executor(None, temp_socket.recv, 1500),
                    timeout=timeout
                )

                if len(data) >= 12:
                    # Extract SSRC (big-endian, 32-bit unsigned integer at offset 8)
                    ssrc = struct.unpack('>I', data[8:12])[0]
                    logger.info(f"✅ Successfully captured SSRC: {ssrc} (0x{ssrc:08x})")

                    # Cancel error monitor
                    error_monitor_task.cancel()

                    return ssrc
                else:
                    logger.warning(f"RTP packet too short: {len(data)} bytes")
                    error_monitor_task.cancel()
                    return None

            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for RTP packet on port {temp_port}")
                error_monitor_task.cancel()

                # Check if FFmpeg process is still running
                if temp_process.returncode is not None:
                    stderr_output = await temp_process.stderr.read()
                    logger.error(f"FFmpeg exited with code {temp_process.returncode}: {stderr_output.decode()}")
                else:
                    logger.warning("FFmpeg is still running but no packets received - possible RTSP connection issue")

                return None

        except Exception as e:
            logger.error(f"Failed to capture SSRC with temporary FFmpeg: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None
        finally:
            # Cleanup
            if temp_socket:
                try:
                    temp_socket.close()
                except:
                    pass
            if temp_process and temp_process.returncode is None:
                try:
                    temp_process.terminate()
                    await asyncio.wait_for(temp_process.wait(), timeout=2.0)
                except:
                    try:
                        temp_process.kill()
                    except:
                        pass
    
    async def capture_rtp_ssrc(
        self,
        listen_port: int,
        timeout: float = 5.0
    ) -> Optional[int]:
        """
        Capture the SSRC from the first RTP packet received on a UDP port.
        
        Args:
            listen_port: UDP port to listen on
            timeout: Maximum time to wait for RTP packet (seconds)
            
        Returns:
            SSRC value if found, None otherwise
        """
        try:
            # Create UDP socket to capture RTP packets
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            sock.bind(('127.0.0.1', listen_port))
            logger.debug(f"Listening on 127.0.0.1:{listen_port} for RTP packets to extract SSRC...")
            
            # Wait for first RTP packet (non-blocking with timeout)
            try:
                data, addr = sock.recvfrom(1500)
                
                # RTP header format:
                # Bytes 0-1: Version (2 bits), Padding (1 bit), Extension (1 bit), CSRC count (4 bits),
                #           Marker (1 bit), Payload type (7 bits)
                # Bytes วล-3: Sequence number
                # Bytes 4-7: Timestamp
                # Bytes 8-11: SSRC (Synchronization Source Identifier)
                
                if len(data) >= 12:
                    # Extract SSRC (big-endian, 32-bit unsigned integer at offset 8)
                    ssrc = struct.unpack('>I', data[8:12])[0]
                    logger.info(f"Captured SSRC from RTP packet: {ssrc} (from {addr})")
                    sock.close()
                    return ssrc
                else:
                    logger.warning(f"RTP packet too short: {len(data)} bytes")
                    
            except socket.timeout:
                logger.warning(f"Timeout waiting for RTP packet on port {listen_port}")
            except Exception as e:
                logger.error(f"Error receiving RTP packet: {e}")
            
            sock.close()
            return None
            
        except Exception as e:
            logger.error(f"Failed to capture RTP SSRC: {e}")
            return None
    
    def get_ffmpeg_source_port(self, stream_id: str) -> int:
        """
        Get a deterministic source port for FFmpeg based on stream_id.
        This allows us to explicitly connect the PlainRtpTransport to a known port.

        Port range: 40000-49999 (10000 ports available)

        Args:
            stream_id: Stream identifier

        Returns:
            Port number for FFmpeg to bind to
        """
        # Use hash of stream_id to get a port in the 40000-49999 range
        port = 40000 + (abs(hash(stream_id)) % 10000)
        return port

    async def start_stream(
        self,
        stream_id: str,
        rtsp_url: str,
        mediasoup_ip: str = "127.0.0.1",
        mediasoup_video_port: int = None,
        ssrc: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Start RTSP stream ingestion and forward to MediaSoup via RTP.

        NOTE: This starts FFmpeg immediately. The producer should already exist
        with the correct SSRC before calling this method.

        Args:
            stream_id: Stream identifier
            rtsp_url: RTSP source URL
            mediasoup_ip: MediaSoup server IP
            mediasoup_video_port: RTP video port for MediaSoup
            ssrc: SSRC value (for logging/tracking only)

        Returns:
            Stream status (includes ffmpeg_source_port for transport connection)
        """
        if stream_id in self.active_streams:
            logger.warning(f"Stream {stream_id} is already running")
            return self.active_streams[stream_id]

        logger.info(f"Starting RTSP stream: {stream_id} from {rtsp_url}")
        logger.info(f"MediaSoup target: {mediasoup_ip}:{mediasoup_video_port} (video only)")
        if ssrc:
            logger.info(f"Using SSRC: {ssrc} (0x{ssrc:08x})")

        try:
            # Create recording directory for this device
            import os
            from datetime import datetime
            recording_base = f"/recordings/hot/{stream_id}"
            recording_date_path = os.path.join(recording_base, datetime.now().strftime("%Y%m%d"))
            os.makedirs(recording_date_path, exist_ok=True)

            hls_playlist_path = os.path.join(recording_base, "stream.m3u8")
            hls_segment_pattern = os.path.join(recording_date_path, "segment-%03d.ts")

            logger.info(f"Recording path: {recording_date_path}")

            # FFmpeg command with dual output: RTP (WebRTC) + HLS (Recording)
            # Single decode, dual encode for efficiency
            # VIDEO ONLY - cameras don't have audio
            ffmpeg_cmd = [
                "ffmpeg",
                "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-fflags", "nobuffer",
                "-flags", "low_delay",
                "-strict", "experimental",
                "-i", rtsp_url,

                # Output 1: RTP for WebRTC (Low latency - prioritized)
                "-map", "0:v:0",
                "-c:v", "libx264",
                "-preset", "ultrafast",  # Fastest encoding for minimal latency
                "-tune", "zerolatency",
                "-profile:v", "baseline",  # Simpler profile for lower latency
                "-level", "3.1",
                "-pix_fmt", "yuv420p",
                "-g", "30",  # Keyframe every 1 second (reduced from 60 for smoother WebRTC)
                "-b:v", "2000k",  # 2 Mbps
                "-maxrate", "2500k",
                "-bufsize", "1000k",  # Small buffer for low latency
                "-r", "30",
                "-f", "rtp",
                "-payload_type", "96",
            ]

            # Add SSRC for RTP output
            if ssrc:
                # FFmpeg expects a signed 32-bit integer, but SSRC is unsigned 32-bit
                # Convert to signed if necessary (values > 2^31-1 become negative)
                if ssrc > 2147483647:  # 2^31 - 1
                    ssrc_signed = ssrc - 4294967296  # 2^32
                else:
                    ssrc_signed = ssrc
                ffmpeg_cmd.extend(["-ssrc", str(ssrc_signed)])
                logger.info(f"Configuring FFmpeg to use SSRC: {ssrc} (signed: {ssrc_signed})")

            # Get deterministic source port for FFmpeg
            # This allows us to explicitly connect the PlainRtpTransport to this known port
            ffmpeg_source_port = self.get_ffmpeg_source_port(stream_id)
            logger.info(f"FFmpeg will send RTP from local port {ffmpeg_source_port}")

            # Include localport in the RTP URL so MediaSoup can be connected to a known endpoint
            ffmpeg_cmd.append(f"rtp://{mediasoup_ip}:{mediasoup_video_port}?pkt_size=1200&localport={ffmpeg_source_port}")

            # Output 2: HLS for Historical Playback/Recording
            ffmpeg_cmd.extend([
                "-map", "0:v:0",
                "-c:v", "libx264",
                "-preset", "veryfast",  # Faster encoding for recording
                "-profile:v", "main",
                "-level", "4.0",
                "-pix_fmt", "yuv420p",
                "-g", "60",
                "-b:v", "3000k",  # 3 Mbps for recording
                "-maxrate", "4000k",
                "-bufsize", "6000k",
                "-r", "30",
                "-f", "hls",
                "-hls_time", "6",  # 6-second segments
                "-hls_list_size", "14400",  # Keep last 14400 segments (24 hours at 6s each)
                "-hls_flags", "append_list+delete_segments",
                "-hls_delete_threshold", "14400",  # Delete segments older than 14400 segments (24 hours)
                "-hls_segment_filename", hls_segment_pattern,
                "-hls_start_number_source", "epoch",
                hls_playlist_path
            ])

            logger.info(f"Starting FFmpeg to send RTP to MediaSoup port {mediasoup_video_port}")
            logger.debug(f"FFmpeg command: {' '.join(ffmpeg_cmd)}")

            # Start FFmpeg process
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            self.ffmpeg_processes[stream_id] = process

            # Log FFmpeg errors in background
            async def log_ffmpeg(process):
                while True:
                    line = await process.stderr.readline()
                    if not line:
                        break
                    line_str = line.decode().strip()
                    if line_str:  # Only log non-empty lines
                        logger.error(f"FFmpeg[{stream_id}]: {line_str}")

            asyncio.create_task(log_ffmpeg(process))

            # Brief wait for FFmpeg to initialize - actual readiness is verified by caller
            # using mediasoup_client.wait_for_producer_ready()
            logger.info("Waiting for FFmpeg to initialize...")
            await asyncio.sleep(0.5)

            # Check if process is still running
            if process.returncode is not None:
                error_output = await process.stderr.read()
                logger.error(f"FFmpeg process exited immediately with code {process.returncode}: {error_output.decode()}")
                raise RuntimeError(f"FFmpeg failed to start: {error_output.decode()}")

            stream_info = {
                "stream_id": stream_id,
                "rtsp_url": rtsp_url,
                "status": "active",
                "mediasoup_ip": mediasoup_ip,
                "mediasoup_video_port": mediasoup_video_port,
                "ffmpeg_source_port": ffmpeg_source_port,  # Port FFmpeg sends from (for transport connect)
                "protocol": "rtp",
                "mode": "video_only",
                "health_check": "healthy",
                "ssrc": ssrc,  # Track SSRC for reference
                "recording": {
                    "enabled": True,
                    "path": recording_base,
                    "playlist": hls_playlist_path,
                    "started_at": datetime.now().isoformat()
                }
            }

            self.active_streams[stream_id] = stream_info
            logger.info(f"Stream {stream_id} started successfully (RTP → MediaSoup + HLS Recording)")

        except Exception as e:
            logger.error(f"Failed to start stream {stream_id}: {e}")
            stream_info = {
                "stream_id": stream_id,
                "status": "error",
                "error": str(e)
            }

        return stream_info
    
    async def stop_stream(self, stream_id: str) -> bool:
        """
        Stop RTSP stream.

        Args:
            stream_id: Stream identifier

        Returns:
            True if stopped successfully
        """
        was_active = stream_id in self.active_streams

        if not was_active:
            logger.warning(f"Stream {stream_id} is not tracked as active, but will attempt cleanup anyway")
        else:
            logger.info(f"Stopping stream: {stream_id}")

        # Stop tracked FFmpeg process if running
        if stream_id in self.ffmpeg_processes:
            process = self.ffmpeg_processes[stream_id]
            try:
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                process.kill()
            except Exception as e:
                logger.error(f"Error stopping FFmpeg process for {stream_id}: {e}")
            finally:
                del self.ffmpeg_processes[stream_id]

        # Also kill any orphaned FFmpeg processes for this device (by matching device ID in paths)
        # This catches processes that weren't properly tracked
        try:
            import os
            result = subprocess.run(
                ["pgrep", "-f", f"ffmpeg.*{stream_id}"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                pids = result.stdout.strip().split('\n')
                for pid in pids:
                    if pid:
                        try:
                            os.kill(int(pid), 15)  # SIGTERM
                            logger.info(f"Killed orphaned FFmpeg process {pid} for {stream_id}")
                        except (ProcessLookupError, ValueError):
                            pass
                # Give SIGTERM a moment to work
                await asyncio.sleep(0.5)
        except Exception as e:
            logger.warning(f"Error killing orphaned FFmpeg processes: {e}")

        # Remove from active streams if it was tracked
        if was_active:
            del self.active_streams[stream_id]

        # Cleanup MediaSoup producers and transports (close them to prevent accumulation)
        try:
            from app.services.mediasoup_client import mediasoup_client

            # Get all producers for this room and close them
            try:
                producers = await mediasoup_client.get_producers(stream_id)
                for producer_id in producers:
                    try:
                        await mediasoup_client.close_producer(producer_id)
                        logger.info(f"Closed producer {producer_id} for stream {stream_id}")
                    except Exception as e:
                        logger.warning(f"Error closing producer {producer_id}: {e}")
            except Exception as e:
                logger.warning(f"Could not get producers for cleanup: {e}")

            logger.info(f"Cleaned up MediaSoup producers for stream {stream_id}")
        except Exception as e:
            logger.warning(f"Could not cleanup MediaSoup producers: {e}")

        logger.info(f"Stream {stream_id} stopped (was_active={was_active})")
        return True
    
    async def check_stream_health(self, stream_id: str) -> Dict[str, Any]:
        """
        Check the health of an RTSP stream.
        
        Args:
            stream_id: Stream identifier
            
        Returns:
            Health status
        """
        if stream_id not in self.active_streams:
            return {"status": "not_found", "healthy": False}
        
        stream_info = self.active_streams[stream_id]
        
        # In real implementation, this would check:
        # - FFmpeg process status
        # - RTP forwarding status
        # - Bitrate/stats
        
        health_status = {
            "stream_id": stream_id,
            "healthy": stream_info["status"] == "active",
            "status": stream_info["status"],
            "rtsp_url": stream_info["rtsp_url"]
        }
        
        logger.info(f"Health check for {stream_id}: {health_status['healthy']}")
        
        return health_status
    
    async def get_stream_stats(self, stream_id: str) -> Dict[str, Any]:
        """
        Get statistics for a stream.
        
        Args:
            stream_id: Stream identifier
            
        Returns:
            Stream statistics
        """
        if stream_id not in self.active_streams:
            return {}
        
        # In real implementation, this would report:
        # - Bitrate
        # - Resolution
        # - Frame rate
        # - Packet loss
        # - Latency
        
        return {
            "stream_id": stream_id,
            "bitrate": "unknown",
            "resolution": "unknown",
            "fps": "unknown"
        }
    
    async def reconnect_stream(self, stream_id: str) -> bool:
        """
        Attempt to reconnect a failed stream.
        
        Args:
            stream_id: Stream identifier
            
        Returns:
            True if reconnected successfully
        """
        if stream_id not in self.active_streams:
            return False
        
        stream_info = self.active_streams[stream_id]
        rtsp_url = stream_info["rtsp_url"]
        rtp_params = stream_info["rtp_params"]
        
        logger.info(f"Reconnecting stream: {stream_id}")
        
        # Stop existing stream
        await self.stop_stream(stream_id)
        
        # Wait a bit
        await asyncio.sleep(2)
        
        # Restart stream
        await self.start_stream(stream_id, rtsp_url, rtp_params)
        
        logger.info(f"Reconnected stream: {stream_id}")
        return True
    
    async def list_active_streams(self) -> list:
        """
        List all active streams.

        Returns:
            List of active stream IDs
        """
        return list(self.active_streams.keys())

    async def _start_cleanup_service(self):
        """Background task to clean up old recordings."""
        import time
        await asyncio.sleep(60)  # Wait 1 minute before first cleanup

        logger.info("Recording cleanup service started")

        while True:
            try:
                # Check disk space first
                await self._check_disk_space()

                # Regular cleanup
                await self._cleanup_old_recordings()

                # Run cleanup every 6 hours
                await asyncio.sleep(6 * 3600)
            except Exception as e:
                logger.error(f"Error in cleanup service: {e}")
                await asyncio.sleep(3600)  # Retry in 1 hour on error

    async def _cleanup_old_recordings(self):
        """Delete recordings older than retention period."""
        import os
        import shutil
        from datetime import datetime, timedelta

        recording_base = "/recordings/hot"
        if not os.path.exists(recording_base):
            return

        cutoff_date = datetime.now() - timedelta(days=self.recording_retention_days)
        deleted_count = 0
        freed_space = 0

        logger.info(f"Starting cleanup of recordings older than {cutoff_date.date()}")

        try:
            # Iterate through device directories
            for device_id in os.listdir(recording_base):
                device_path = os.path.join(recording_base, device_id)
                if not os.path.isdir(device_path):
                    continue

                # Iterate through date directories
                for date_dir in os.listdir(device_path):
                    if date_dir == "stream.m3u8":  # Skip playlist file
                        continue

                    date_path = os.path.join(device_path, date_dir)
                    if not os.path.isdir(date_path):
                        continue

                    # Parse date from directory name (YYYYMMDD)
                    try:
                        dir_date = datetime.strptime(date_dir, "%Y%m%d")
                        if dir_date < cutoff_date:
                            # Calculate size before deletion
                            dir_size = sum(
                                os.path.getsize(os.path.join(date_path, f))
                                for f in os.listdir(date_path)
                                if os.path.isfile(os.path.join(date_path, f))
                            )

                            # Delete the directory
                            shutil.rmtree(date_path)
                            deleted_count += 1
                            freed_space += dir_size

                            logger.info(f"Deleted old recording: {date_path} ({dir_size / 1024 / 1024:.2f} MB)")
                    except ValueError:
                        logger.warning(f"Invalid date directory name: {date_dir}")
                        continue

            if deleted_count > 0:
                logger.info(f"Cleanup complete: Deleted {deleted_count} directories, freed {freed_space / 1024 / 1024 / 1024:.2f} GB")
            else:
                logger.info("Cleanup complete: No old recordings to delete")

        except Exception as e:
            logger.error(f"Error during recording cleanup: {e}")
            import traceback
            logger.error(traceback.format_exc())

    async def _check_disk_space(self):
        """Monitor disk space and trigger emergency cleanup if needed."""
        import shutil

        recording_base = "/recordings/hot"
        if not os.path.exists(recording_base):
            return

        try:
            # Get disk usage
            stat = shutil.disk_usage(recording_base)
            total_gb = stat.total / (1024 ** 3)
            used_gb = stat.used / (1024 ** 3)
            free_gb = stat.free / (1024 ** 3)
            usage_percent = (stat.used / stat.total) * 100

            logger.info(f"Disk space: {free_gb:.2f} GB free / {total_gb:.2f} GB total ({usage_percent:.1f}% used)")

            # Emergency cleanup thresholds
            if usage_percent >= 95:
                logger.critical(f"⚠️  CRITICAL: Disk usage at {usage_percent:.1f}%! Triggering emergency cleanup...")
                await self._emergency_cleanup(target_percent=80)
            elif usage_percent >= 90:
                logger.error(f"⚠️  WARNING: Disk usage at {usage_percent:.1f}%! Triggering aggressive cleanup...")
                await self._emergency_cleanup(target_percent=85)
            elif usage_percent >= 85:
                logger.warning(f"⚠️  High disk usage: {usage_percent:.1f}%. Consider reducing retention period.")

        except Exception as e:
            logger.error(f"Error checking disk space: {e}")

    async def _emergency_cleanup(self, target_percent: float = 80):
        """Emergency cleanup when disk is critically full."""
        import os
        import shutil
        from datetime import datetime

        recording_base = "/recordings/hot"
        if not os.path.exists(recording_base):
            return

        logger.warning(f"Starting EMERGENCY cleanup - target: {target_percent}% disk usage")

        try:
            # Get current disk usage
            stat = shutil.disk_usage(recording_base)
            current_percent = (stat.used / stat.total) * 100

            deleted_count = 0
            freed_space = 0

            # Get all device directories
            device_dates = []
            for device_id in os.listdir(recording_base):
                device_path = os.path.join(recording_base, device_id)
                if not os.path.isdir(device_path):
                    continue

                # Get all date directories for this device
                for date_dir in os.listdir(device_path):
                    if date_dir == "stream.m3u8":
                        continue

                    date_path = os.path.join(device_path, date_dir)
                    if not os.path.isdir(date_path):
                        continue

                    try:
                        # Parse date and get directory size
                        dir_date = datetime.strptime(date_dir, "%Y%m%d")
                        dir_size = sum(
                            os.path.getsize(os.path.join(date_path, f))
                            for f in os.listdir(date_path)
                            if os.path.isfile(os.path.join(date_path, f))
                        )

                        device_dates.append({
                            'path': date_path,
                            'date': dir_date,
                            'size': dir_size,
                            'device_id': device_id,
                            'date_str': date_dir
                        })
                    except (ValueError, OSError) as e:
                        logger.warning(f"Skipping invalid directory {date_path}: {e}")
                        continue

            # Sort by date (oldest first)
            device_dates.sort(key=lambda x: x['date'])

            # Delete oldest recordings until we reach target
            for item in device_dates:
                # Check current disk usage
                stat = shutil.disk_usage(recording_base)
                current_percent = (stat.used / stat.total) * 100

                if current_percent <= target_percent:
                    logger.info(f"✅ Target reached: {current_percent:.1f}% disk usage")
                    break

                # Delete this directory
                try:
                    shutil.rmtree(item['path'])
                    deleted_count += 1
                    freed_space += item['size']

                    logger.info(
                        f"EMERGENCY: Deleted {item['device_id']}/{item['date_str']} "
                        f"({item['size'] / 1024 / 1024:.1f} MB, date: {item['date'].date()})"
                    )
                except Exception as e:
                    logger.error(f"Failed to delete {item['path']}: {e}")

            # Final report
            stat = shutil.disk_usage(recording_base)
            final_percent = (stat.used / stat.total) * 100

            logger.warning(
                f"Emergency cleanup complete: Deleted {deleted_count} directories, "
                f"freed {freed_space / 1024 / 1024 / 1024:.2f} GB. "
                f"Disk usage: {final_percent:.1f}%"
            )

            if final_percent > target_percent:
                logger.critical(
                    f"⚠️  CRITICAL: Could not reach target! Still at {final_percent:.1f}%. "
                    f"Consider adding more storage or reducing retention."
                )

        except Exception as e:
            logger.error(f"Error during emergency cleanup: {e}")
            import traceback
            logger.error(traceback.format_exc())


# Global RTSP pipeline instance
rtsp_pipeline = RTSPPipeline()

# Module-level function aliases for backwards compatibility
capture_ssrc_with_temp_ffmpeg = rtsp_pipeline.capture_ssrc_with_temp_ffmpeg
start_stream = rtsp_pipeline.start_stream
stop_stream = rtsp_pipeline.stop_stream
get_active_streams = rtsp_pipeline.list_active_streams
