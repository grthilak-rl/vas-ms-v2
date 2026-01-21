"""
Stream Health Monitor Service

Continuously monitors stream health by checking producer statistics.
Automatically restarts streams that have stopped receiving packets.
"""
import asyncio
from datetime import datetime, timezone
from typing import Dict, Optional, Set
from loguru import logger


class StreamHealthMonitor:
    """
    Monitors stream health and triggers restarts for unhealthy streams.

    Health is determined by checking if packetsReceived is increasing.
    If a producer stops receiving packets for a configured duration,
    the stream is considered unhealthy and will be restarted.
    """

    def __init__(
        self,
        check_interval: float = 10.0,  # Check every 10 seconds
        stale_threshold: int = 3,  # Number of consecutive checks with no packet increase
        restart_cooldown: float = 30.0,  # Minimum seconds between restart attempts
        max_restart_attempts: int = 3,  # Max restarts before giving up (resets after success)
    ):
        """
        Initialize the health monitor.

        Args:
            check_interval: Seconds between health checks
            stale_threshold: Number of consecutive stale checks before restart
            restart_cooldown: Minimum seconds between restart attempts for same stream
            max_restart_attempts: Maximum restart attempts before marking stream as failed
        """
        self.check_interval = check_interval
        self.stale_threshold = stale_threshold
        self.restart_cooldown = restart_cooldown
        self.max_restart_attempts = max_restart_attempts

        # Track packet counts per producer
        self._last_packet_counts: Dict[str, int] = {}

        # Track consecutive stale checks per producer
        self._stale_counts: Dict[str, int] = {}

        # Track restart attempts and cooldowns
        self._restart_attempts: Dict[str, int] = {}
        self._last_restart_time: Dict[str, datetime] = {}

        # Streams that have failed too many times
        self._failed_streams: Set[str] = set()

        # Monitor task
        self._monitor_task: Optional[asyncio.Task] = None
        self._running = False

        # Callback for restart (set by integration code)
        self._restart_callback = None

        logger.info(
            f"StreamHealthMonitor initialized: "
            f"check_interval={check_interval}s, "
            f"stale_threshold={stale_threshold}, "
            f"restart_cooldown={restart_cooldown}s"
        )

    def set_restart_callback(self, callback):
        """
        Set the callback function to restart a stream.

        The callback should accept (room_id: str) and return bool (success).
        """
        self._restart_callback = callback

    async def start(self):
        """Start the health monitor background task."""
        if self._running:
            logger.warning("StreamHealthMonitor already running")
            return

        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("StreamHealthMonitor started")

    async def stop(self):
        """Stop the health monitor."""
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
            self._monitor_task = None
        logger.info("StreamHealthMonitor stopped")

    def register_stream(self, room_id: str, producer_id: str):
        """
        Register a new stream for health monitoring.

        Args:
            room_id: The room/device ID
            producer_id: The MediaSoup producer ID
        """
        # Reset tracking for this producer
        self._last_packet_counts[producer_id] = 0
        self._stale_counts[producer_id] = 0
        self._restart_attempts[room_id] = 0

        # Remove from failed streams if it was there
        self._failed_streams.discard(room_id)

        logger.info(f"Registered stream for health monitoring: room={room_id}, producer={producer_id}")

    def unregister_stream(self, room_id: str, producer_id: str = None):
        """
        Unregister a stream from health monitoring.

        Args:
            room_id: The room/device ID
            producer_id: The MediaSoup producer ID (optional)
        """
        if producer_id:
            self._last_packet_counts.pop(producer_id, None)
            self._stale_counts.pop(producer_id, None)

        self._restart_attempts.pop(room_id, None)
        self._last_restart_time.pop(room_id, None)
        self._failed_streams.discard(room_id)

        logger.info(f"Unregistered stream from health monitoring: room={room_id}")

    def mark_stream_healthy(self, room_id: str):
        """
        Mark a stream as healthy (e.g., after successful restart).
        Resets restart attempts.
        """
        self._restart_attempts[room_id] = 0
        self._failed_streams.discard(room_id)
        logger.debug(f"Stream marked healthy: room={room_id}")

    def is_stream_failed(self, room_id: str) -> bool:
        """Check if a stream has been marked as failed."""
        return room_id in self._failed_streams

    def get_status(self) -> Dict:
        """Get current health monitor status."""
        return {
            "running": self._running,
            "monitored_producers": len(self._last_packet_counts),
            "stale_producers": sum(1 for c in self._stale_counts.values() if c > 0),
            "failed_streams": list(self._failed_streams),
            "restart_attempts": dict(self._restart_attempts),
        }

    async def _monitor_loop(self):
        """Main monitoring loop."""
        from app.services.mediasoup_client import mediasoup_client

        logger.info("Health monitor loop started")

        # Initial delay to let streams stabilize
        await asyncio.sleep(5)

        while self._running:
            try:
                await self._check_health(mediasoup_client)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health monitor loop: {e}")
                import traceback
                logger.debug(traceback.format_exc())

            await asyncio.sleep(self.check_interval)

        logger.info("Health monitor loop stopped")

    async def _check_health(self, mediasoup_client):
        """Perform health check on all producers."""
        try:
            # Ensure connection
            if not mediasoup_client.connected:
                await mediasoup_client.connect()

            # Get all producer stats in one call
            result = await mediasoup_client.get_all_producer_stats()
            stats_list = result.get("stats", [])

            if not stats_list:
                logger.debug("No producers to monitor")
                return

            logger.debug(f"Health check: {len(stats_list)} producers")

            unhealthy_streams = []

            for stat in stats_list:
                producer_id = stat.get("producerId")
                room_id = stat.get("roomId")
                packets_received = stat.get("packetsReceived", 0)
                transport_stats = stat.get("transportStats")

                if not producer_id or not room_id:
                    continue

                # Skip if stream is marked as failed
                if room_id in self._failed_streams:
                    continue

                # Check if this is a known producer
                if producer_id not in self._last_packet_counts:
                    # New producer, start tracking
                    self._last_packet_counts[producer_id] = packets_received
                    self._stale_counts[producer_id] = 0
                    continue

                last_count = self._last_packet_counts[producer_id]

                # Check if packets are increasing
                if packets_received > last_count:
                    # Healthy - packets are being received
                    self._last_packet_counts[producer_id] = packets_received
                    self._stale_counts[producer_id] = 0

                    # Reset restart attempts on sustained health
                    if self._restart_attempts.get(room_id, 0) > 0:
                        self._restart_attempts[room_id] = 0
                        logger.info(f"Stream recovered: room={room_id}, producer={producer_id}")
                else:
                    # Stale - no new packets
                    self._stale_counts[producer_id] = self._stale_counts.get(producer_id, 0) + 1
                    stale_count = self._stale_counts[producer_id]

                    # Log transport stats for debugging
                    if transport_stats:
                        transport_bytes = transport_stats.get("rtpBytesReceived", 0)
                        logger.warning(
                            f"Producer stale: producer={producer_id}, room={room_id}, "
                            f"stale_count={stale_count}/{self.stale_threshold}, "
                            f"producer_packets={packets_received}, transport_bytes={transport_bytes}"
                        )
                    else:
                        logger.warning(
                            f"Producer stale: producer={producer_id}, room={room_id}, "
                            f"stale_count={stale_count}/{self.stale_threshold}"
                        )

                    if stale_count >= self.stale_threshold:
                        unhealthy_streams.append({
                            "room_id": room_id,
                            "producer_id": producer_id,
                            "last_packets": last_count,
                            "stale_checks": stale_count,
                        })

            # Handle unhealthy streams
            for stream_info in unhealthy_streams:
                await self._handle_unhealthy_stream(stream_info)

        except Exception as e:
            logger.error(f"Error checking health: {e}")

    async def _handle_unhealthy_stream(self, stream_info: Dict):
        """Handle an unhealthy stream by triggering restart."""
        room_id = stream_info["room_id"]
        producer_id = stream_info["producer_id"]

        # Check cooldown
        last_restart = self._last_restart_time.get(room_id)
        if last_restart:
            elapsed = (datetime.now(timezone.utc) - last_restart).total_seconds()
            if elapsed < self.restart_cooldown:
                logger.debug(
                    f"Stream restart on cooldown: room={room_id}, "
                    f"elapsed={elapsed:.1f}s, cooldown={self.restart_cooldown}s"
                )
                return

        # Check restart attempts
        attempts = self._restart_attempts.get(room_id, 0)
        if attempts >= self.max_restart_attempts:
            if room_id not in self._failed_streams:
                logger.error(
                    f"Stream marked as FAILED after {attempts} restart attempts: room={room_id}"
                )
                self._failed_streams.add(room_id)
            return

        # Increment restart attempts
        self._restart_attempts[room_id] = attempts + 1
        self._last_restart_time[room_id] = datetime.now(timezone.utc)

        logger.warning(
            f"Triggering stream restart: room={room_id}, producer={producer_id}, "
            f"attempt={attempts + 1}/{self.max_restart_attempts}"
        )

        # Clear stale tracking for this producer
        self._stale_counts[producer_id] = 0
        self._last_packet_counts.pop(producer_id, None)

        # Trigger restart via callback
        if self._restart_callback:
            try:
                success = await self._restart_callback(room_id)
                if success:
                    logger.info(f"Stream restart initiated successfully: room={room_id}")
                else:
                    logger.error(f"Stream restart failed: room={room_id}")
            except Exception as e:
                logger.error(f"Error triggering stream restart: room={room_id}, error={e}")
        else:
            logger.warning("No restart callback configured - cannot restart stream")


# Global health monitor instance
stream_health_monitor = StreamHealthMonitor()
