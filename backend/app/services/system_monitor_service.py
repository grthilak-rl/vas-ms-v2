"""
System Monitor Service - VAS-MS-V2

Monitors server-level resources:
- Disk space usage
- CPU utilization
- Memory usage
- Per-stream resource consumption (FFmpeg processes)
- Docker container stats
"""
import os
import asyncio
import psutil
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from pathlib import Path
from loguru import logger


class SystemMonitorService:
    """
    Service for monitoring system resources and per-stream resource usage.
    """

    def __init__(self):
        """Initialize the system monitor service."""
        self._recordings_path = os.environ.get('RECORDINGS_PATH', '/recordings/hot')
        self._snapshots_path = os.environ.get('SNAPSHOTS_PATH', '/snapshots')
        self._bookmarks_path = os.environ.get('BOOKMARKS_PATH', '/bookmarks')
        logger.info("SystemMonitorService initialized")

    def get_disk_usage(self) -> Dict[str, Any]:
        """
        Get disk usage statistics for the system and specific paths.

        Returns:
            Dict with disk usage info
        """
        try:
            # Get root filesystem usage
            root_usage = psutil.disk_usage('/')

            # Calculate usage for VAS-specific directories
            recordings_size = self._get_directory_size(self._recordings_path)
            snapshots_size = self._get_directory_size(self._snapshots_path)
            bookmarks_size = self._get_directory_size(self._bookmarks_path)

            vas_total_size = recordings_size + snapshots_size + bookmarks_size

            return {
                "filesystem": {
                    "total_bytes": root_usage.total,
                    "used_bytes": root_usage.used,
                    "free_bytes": root_usage.free,
                    "percent_used": root_usage.percent,
                    "total_gb": round(root_usage.total / (1024**3), 2),
                    "used_gb": round(root_usage.used / (1024**3), 2),
                    "free_gb": round(root_usage.free / (1024**3), 2)
                },
                "vas_storage": {
                    "recordings_bytes": recordings_size,
                    "recordings_gb": round(recordings_size / (1024**3), 2),
                    "snapshots_bytes": snapshots_size,
                    "snapshots_mb": round(snapshots_size / (1024**2), 2),
                    "bookmarks_bytes": bookmarks_size,
                    "bookmarks_mb": round(bookmarks_size / (1024**2), 2),
                    "total_bytes": vas_total_size,
                    "total_gb": round(vas_total_size / (1024**3), 2)
                },
                "status": self._get_disk_status(root_usage.percent)
            }
        except Exception as e:
            logger.error(f"Error getting disk usage: {e}")
            return {
                "error": str(e),
                "status": "unknown"
            }

    def get_cpu_usage(self) -> Dict[str, Any]:
        """
        Get CPU usage statistics.

        Returns:
            Dict with CPU usage info
        """
        try:
            # Get overall CPU usage (with 1-second interval for accuracy)
            cpu_percent = psutil.cpu_percent(interval=0.1)
            cpu_count = psutil.cpu_count()
            cpu_count_logical = psutil.cpu_count(logical=True)

            # Get per-CPU usage
            per_cpu = psutil.cpu_percent(interval=0.1, percpu=True)

            # Get load averages (1, 5, 15 minutes)
            try:
                load_avg = os.getloadavg()
            except (OSError, AttributeError):
                load_avg = (0, 0, 0)

            return {
                "percent": cpu_percent,
                "count_physical": cpu_count,
                "count_logical": cpu_count_logical,
                "per_cpu": per_cpu,
                "load_average": {
                    "1min": round(load_avg[0], 2),
                    "5min": round(load_avg[1], 2),
                    "15min": round(load_avg[2], 2)
                },
                "status": self._get_cpu_status(cpu_percent)
            }
        except Exception as e:
            logger.error(f"Error getting CPU usage: {e}")
            return {
                "error": str(e),
                "status": "unknown"
            }

    def get_memory_usage(self) -> Dict[str, Any]:
        """
        Get memory usage statistics.

        Returns:
            Dict with memory usage info
        """
        try:
            mem = psutil.virtual_memory()
            swap = psutil.swap_memory()

            return {
                "ram": {
                    "total_bytes": mem.total,
                    "available_bytes": mem.available,
                    "used_bytes": mem.used,
                    "percent": mem.percent,
                    "total_gb": round(mem.total / (1024**3), 2),
                    "available_gb": round(mem.available / (1024**3), 2),
                    "used_gb": round(mem.used / (1024**3), 2)
                },
                "swap": {
                    "total_bytes": swap.total,
                    "used_bytes": swap.used,
                    "free_bytes": swap.free,
                    "percent": swap.percent,
                    "total_gb": round(swap.total / (1024**3), 2),
                    "used_gb": round(swap.used / (1024**3), 2)
                },
                "status": self._get_memory_status(mem.percent)
            }
        except Exception as e:
            logger.error(f"Error getting memory usage: {e}")
            return {
                "error": str(e),
                "status": "unknown"
            }

    def get_network_stats(self) -> Dict[str, Any]:
        """
        Get network I/O statistics.

        Returns:
            Dict with network stats
        """
        try:
            net_io = psutil.net_io_counters()

            return {
                "bytes_sent": net_io.bytes_sent,
                "bytes_recv": net_io.bytes_recv,
                "packets_sent": net_io.packets_sent,
                "packets_recv": net_io.packets_recv,
                "bytes_sent_gb": round(net_io.bytes_sent / (1024**3), 2),
                "bytes_recv_gb": round(net_io.bytes_recv / (1024**3), 2),
                "errors_in": net_io.errin,
                "errors_out": net_io.errout,
                "drop_in": net_io.dropin,
                "drop_out": net_io.dropout
            }
        except Exception as e:
            logger.error(f"Error getting network stats: {e}")
            return {"error": str(e)}

    async def get_ffmpeg_process_stats(self) -> Dict[str, Any]:
        """
        Get resource usage for all FFmpeg processes.

        Returns:
            Dict with per-stream FFmpeg resource usage
        """
        try:
            ffmpeg_processes = []
            total_cpu = 0.0
            total_memory = 0.0

            for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'cpu_percent', 'memory_info', 'create_time']):
                try:
                    if proc.info['name'] and 'ffmpeg' in proc.info['name'].lower():
                        cmdline = proc.info.get('cmdline', [])

                        # Try to extract stream ID from command line
                        stream_id = self._extract_stream_id_from_cmdline(cmdline)

                        # Get CPU and memory
                        cpu_percent = proc.cpu_percent(interval=0.1)
                        memory_info = proc.info.get('memory_info')
                        memory_mb = memory_info.rss / (1024**2) if memory_info else 0

                        # Calculate uptime
                        create_time = proc.info.get('create_time', 0)
                        uptime_seconds = int(datetime.now().timestamp() - create_time) if create_time else 0

                        total_cpu += cpu_percent
                        total_memory += memory_mb

                        ffmpeg_processes.append({
                            "pid": proc.info['pid'],
                            "stream_id": stream_id,
                            "cpu_percent": round(cpu_percent, 1),
                            "memory_mb": round(memory_mb, 1),
                            "uptime_seconds": uptime_seconds
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            return {
                "total_processes": len(ffmpeg_processes),
                "total_cpu_percent": round(total_cpu, 1),
                "total_memory_mb": round(total_memory, 1),
                "processes": ffmpeg_processes
            }
        except Exception as e:
            logger.error(f"Error getting FFmpeg process stats: {e}")
            return {
                "error": str(e),
                "total_processes": 0,
                "processes": []
            }

    async def get_per_stream_resources(self, stream_ingestion_service) -> List[Dict[str, Any]]:
        """
        Get detailed resource usage per stream including FFmpeg and recording storage.

        Args:
            stream_ingestion_service: The stream ingestion service for process info

        Returns:
            List of per-stream resource usage
        """
        try:
            stream_resources = []

            # Get all active ingestions from the service
            active_ingestions = await stream_ingestion_service.get_all_active_ingestions()

            for stream_id, info in active_ingestions.get('streams', {}).items():
                # Get FFmpeg process stats
                pid = info.get('pid')
                cpu_percent = 0
                memory_mb = 0

                if pid:
                    try:
                        proc = psutil.Process(pid)
                        cpu_percent = proc.cpu_percent(interval=0.1)
                        memory_mb = proc.memory_info().rss / (1024**2)
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                # Get recording storage for this stream
                stream_recording_path = os.path.join(self._recordings_path, stream_id)
                recording_size = self._get_directory_size(stream_recording_path)

                stream_resources.append({
                    "stream_id": stream_id,
                    "ffmpeg": {
                        "pid": pid,
                        "cpu_percent": round(cpu_percent, 1),
                        "memory_mb": round(memory_mb, 1),
                        "status": info.get('status', 'unknown')
                    },
                    "storage": {
                        "recordings_bytes": recording_size,
                        "recordings_mb": round(recording_size / (1024**2), 1),
                        "recordings_gb": round(recording_size / (1024**3), 2)
                    },
                    "uptime_seconds": info.get('uptime_seconds', 0)
                })

            return stream_resources
        except Exception as e:
            logger.error(f"Error getting per-stream resources: {e}")
            return []

    def get_system_summary(self) -> Dict[str, Any]:
        """
        Get a complete system resource summary.

        Returns:
            Dict with all system metrics
        """
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "disk": self.get_disk_usage(),
            "cpu": self.get_cpu_usage(),
            "memory": self.get_memory_usage(),
            "network": self.get_network_stats(),
            "overall_status": self._calculate_overall_status()
        }

    def _get_directory_size(self, path: str) -> int:
        """
        Calculate total size of a directory recursively.

        Args:
            path: Directory path

        Returns:
            Total size in bytes
        """
        total_size = 0
        try:
            if os.path.exists(path):
                for dirpath, dirnames, filenames in os.walk(path):
                    for filename in filenames:
                        filepath = os.path.join(dirpath, filename)
                        try:
                            total_size += os.path.getsize(filepath)
                        except (OSError, IOError):
                            continue
        except Exception as e:
            logger.warning(f"Error calculating directory size for {path}: {e}")
        return total_size

    def _extract_stream_id_from_cmdline(self, cmdline: List[str]) -> Optional[str]:
        """
        Try to extract stream ID from FFmpeg command line arguments.

        Args:
            cmdline: List of command line arguments

        Returns:
            Stream ID if found, None otherwise
        """
        if not cmdline:
            return None

        cmdline_str = ' '.join(cmdline)

        # Look for UUID pattern in recordings path
        import re
        uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        matches = re.findall(uuid_pattern, cmdline_str, re.IGNORECASE)

        if matches:
            return matches[0]

        return None

    def _get_disk_status(self, percent: float) -> str:
        """Get status based on disk usage percentage."""
        if percent >= 90:
            return "critical"
        elif percent >= 80:
            return "warning"
        elif percent >= 70:
            return "elevated"
        return "healthy"

    def _get_cpu_status(self, percent: float) -> str:
        """Get status based on CPU usage percentage."""
        if percent >= 90:
            return "critical"
        elif percent >= 75:
            return "warning"
        elif percent >= 60:
            return "elevated"
        return "healthy"

    def _get_memory_status(self, percent: float) -> str:
        """Get status based on memory usage percentage."""
        if percent >= 90:
            return "critical"
        elif percent >= 80:
            return "warning"
        elif percent >= 70:
            return "elevated"
        return "healthy"

    def _calculate_overall_status(self) -> str:
        """Calculate overall system health status."""
        disk = self.get_disk_usage()
        cpu = self.get_cpu_usage()
        memory = self.get_memory_usage()

        statuses = [
            disk.get('status', 'unknown'),
            cpu.get('status', 'unknown'),
            memory.get('status', 'unknown')
        ]

        if 'critical' in statuses:
            return 'critical'
        elif 'warning' in statuses:
            return 'warning'
        elif 'elevated' in statuses:
            return 'elevated'
        elif 'unknown' in statuses:
            return 'degraded'
        return 'healthy'


# Global instance
system_monitor_service = SystemMonitorService()
