"""
Bookmark service for capturing 6-second video clips from live and historical streams.
"""
import os
import asyncio
import subprocess
from datetime import datetime, timedelta
from typing import Optional, List
from pathlib import Path
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.bookmark import Bookmark
from app.models.device import Device


class BookmarkService:
    """Service for capturing and managing bookmarks (6-second video clips)."""

    def __init__(self):
        self.bookmark_base_dir = "/bookmarks"
        os.makedirs(self.bookmark_base_dir, exist_ok=True)
        logger.info(f"Bookmark service initialized. Base directory: {self.bookmark_base_dir}")

    async def capture_from_live_stream(
        self,
        device_id: str,
        rtsp_url: str,
        label: Optional[str],
        db: AsyncSession
    ) -> Bookmark:
        """
        Capture a 6-second bookmark from live RTSP stream (last 6 seconds).

        Args:
            device_id: Device UUID
            rtsp_url: RTSP stream URL
            label: Optional user label
            db: Database session

        Returns:
            Bookmark object with captured video clip
        """
        center_timestamp = datetime.now()
        # For live, we capture the last 6 seconds, so start is 6 seconds ago
        start_timestamp = center_timestamp - timedelta(seconds=6)
        end_timestamp = center_timestamp

        device_dir = os.path.join(self.bookmark_base_dir, device_id)
        os.makedirs(device_dir, exist_ok=True)

        filename = f"live_{center_timestamp.strftime('%Y%m%d_%H%M%S')}.mp4"
        video_file_path = os.path.join(device_dir, filename)
        thumbnail_filename = f"live_{center_timestamp.strftime('%Y%m%d_%H%M%S')}_thumb.jpg"
        thumbnail_path = os.path.join(device_dir, thumbnail_filename)

        logger.info(f"Capturing live bookmark (6s clip) from {rtsp_url} -> {video_file_path}")

        # FFmpeg command to capture 6 seconds of video
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",  # Overwrite output file
            "-rtsp_transport", "tcp",
            "-timeout", "5000000",  # 5 second timeout
            "-i", rtsp_url,
            "-t", "6",  # Capture 6 seconds
            "-c:v", "libx264",  # H.264 codec
            "-preset", "fast",
            "-crf", "23",  # Good quality
            "-c:a", "aac",  # Audio codec (if available)
            "-b:a", "128k",
            "-movflags", "+faststart",  # Enable web streaming
            video_file_path
        ]

        try:
            # Run FFmpeg with timeout
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=15.0  # Longer timeout for video capture
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise RuntimeError("FFmpeg bookmark capture timed out after 15 seconds")

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"FFmpeg bookmark capture failed: {error_msg}")
                raise RuntimeError(f"FFmpeg failed: {error_msg}")

            # Verify file was created
            if not os.path.exists(video_file_path):
                raise RuntimeError("Bookmark video file was not created")

            file_size = os.path.getsize(video_file_path)
            logger.info(f"Bookmark captured successfully: {video_file_path} ({file_size} bytes)")

            # Generate thumbnail from center frame (3 seconds into the clip)
            await self._generate_thumbnail(video_file_path, thumbnail_path, seek_time="00:00:03")

            # Create database entry
            bookmark = Bookmark(
                device_id=device_id,
                center_timestamp=center_timestamp,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                video_file_path=video_file_path,
                thumbnail_path=thumbnail_path if os.path.exists(thumbnail_path) else None,
                label=label,
                source="live",
                duration=6,
                video_format="mp4",
                file_size=file_size
            )

            db.add(bookmark)
            await db.commit()
            await db.refresh(bookmark)

            return bookmark

        except Exception as e:
            logger.error(f"Failed to capture live bookmark: {e}")
            # Cleanup partial files
            if os.path.exists(video_file_path):
                os.remove(video_file_path)
            if os.path.exists(thumbnail_path):
                os.remove(thumbnail_path)
            raise

    async def capture_from_historical(
        self,
        device_id: str,
        center_timestamp: datetime,
        label: Optional[str],
        db: AsyncSession
    ) -> Bookmark:
        """
        Capture a 6-second bookmark from historical HLS recordings (±3 seconds).

        Args:
            device_id: Device UUID
            center_timestamp: Center point of the bookmark
            label: Optional user label
            db: Database session

        Returns:
            Bookmark object with captured video clip
        """
        start_timestamp = center_timestamp - timedelta(seconds=3)
        end_timestamp = center_timestamp + timedelta(seconds=3)

        # Find the recording segments for this timestamp
        # Recordings are organized in dated folders: /recordings/hot/{device_id}/YYYYMMDD/segment-{unix_ts}.ts
        hls_base_dir = "/recordings/hot"
        device_recording_dir = os.path.join(hls_base_dir, device_id)

        # Get the date folder for the requested timestamp
        date_folder = start_timestamp.strftime("%Y%m%d")
        date_folder_path = os.path.join(device_recording_dir, date_folder)

        if not os.path.exists(date_folder_path):
            raise FileNotFoundError(f"No recordings found for device {device_id} on date {date_folder}")

        device_dir = os.path.join(self.bookmark_base_dir, device_id)
        os.makedirs(device_dir, exist_ok=True)

        filename = f"historical_{center_timestamp.strftime('%Y%m%d_%H%M%S')}.mp4"
        video_file_path = os.path.join(device_dir, filename)
        thumbnail_filename = f"historical_{center_timestamp.strftime('%Y%m%d_%H%M%S')}_thumb.jpg"
        thumbnail_path = os.path.join(device_dir, thumbnail_filename)

        logger.info(f"Capturing historical bookmark from {date_folder_path} at {center_timestamp}")

        # Find the segment file that contains the start timestamp by parsing the HLS playlist
        # This matches the frontend's approach in getTimestampFromHLSPosition()
        hls_playlist_path = os.path.join(os.path.dirname(date_folder_path), "stream.m3u8")

        if not os.path.exists(hls_playlist_path):
            raise FileNotFoundError(f"HLS playlist not found at {hls_playlist_path}")

        # Parse HLS playlist to map timestamps to segments
        segments_info = []  # List of (segment_filename, duration, unix_timestamp)

        with open(hls_playlist_path, 'r') as f:
            lines = f.readlines()
            i = 0
            while i < len(lines):
                line = lines[i].strip()
                if line.startswith('#EXTINF:'):
                    # Get duration
                    duration = float(line.split(':')[1].split(',')[0])
                    # Get segment filename from next line
                    if i + 1 < len(lines):
                        seg_filename = lines[i + 1].strip()
                        # Extract Unix timestamp from segment filename
                        if seg_filename.startswith('segment-') and seg_filename.endswith('.ts'):
                            seg_ts = int(seg_filename.split('-')[1].split('.')[0])
                            segments_info.append((seg_filename, duration, seg_ts))
                    i += 2
                else:
                    i += 1

        if not segments_info:
            raise FileNotFoundError(f"No valid segments found in HLS playlist")

        # Find which segment contains the requested center timestamp
        # Following the same logic as frontend: accumulate durations and find the matching segment
        center_unix_ts = int(center_timestamp.timestamp())
        start_unix_ts = int(start_timestamp.timestamp())

        # Find segments that cover the requested time range (start_timestamp to end_timestamp)
        # We need 6 seconds total: from start_unix_ts to (start_unix_ts + 6)
        end_unix_ts = int(end_timestamp.timestamp())
        required_segments = []

        for seg_filename, duration, seg_ts in segments_info:
            seg_end_ts = seg_ts + duration
            # Include segment if it overlaps with our requested range
            if (seg_ts <= start_unix_ts < seg_end_ts) or \
               (seg_ts <= end_unix_ts < seg_end_ts) or \
               (start_unix_ts <= seg_ts < end_unix_ts):
                seg_path = os.path.join(date_folder_path, seg_filename)
                required_segments.append((seg_ts, seg_path, duration))

        if not required_segments:
            # Fallback: find closest segments
            segments_info.sort(key=lambda x: abs(x[2] - center_unix_ts))
            seg_filename, duration, seg_ts = segments_info[0]
            seg_path = os.path.join(date_folder_path, seg_filename)
            required_segments = [(seg_ts, seg_path, duration)]
            logger.warning(f"No exact segment match, using closest: {seg_filename}")

        # Sort segments by timestamp
        required_segments.sort(key=lambda x: x[0])

        first_segment_ts = required_segments[0][0]
        last_segment_ts = required_segments[-1][0]

        # Calculate seek offset within the first segment
        offset_in_first_segment = max(0, start_unix_ts - first_segment_ts)

        target_segments = [(ts, path) for ts, path, dur in required_segments]
        seek_offset = offset_in_first_segment

        logger.info(f"📊 Segment Selection Debug:")
        logger.info(f"  - Requested center timestamp: {center_timestamp} (unix: {int(center_timestamp.timestamp())})")
        logger.info(f"  - Requested start timestamp: {start_timestamp} (unix: {start_unix_ts})")
        logger.info(f"  - Using {len(target_segments)} segments")
        logger.info(f"  - First segment timestamp: {first_segment_ts} ({datetime.fromtimestamp(first_segment_ts)})")
        logger.info(f"  - Last segment timestamp: {last_segment_ts} ({datetime.fromtimestamp(last_segment_ts)})")
        logger.info(f"  - Calculated seek offset: {seek_offset}s")
        logger.info(f"  - Segment details: {[(ts, os.path.basename(path)) for ts, path in target_segments]}")

        # Create a concat file for FFmpeg to process multiple segments
        concat_file_path = os.path.join(device_dir, f"concat_temp_{center_timestamp.timestamp()}.txt")
        with open(concat_file_path, 'w') as f:
            for seg_ts, seg_path in target_segments:
                f.write(f"file '{seg_path}'\n")

        # FFmpeg command to extract 6-second clip from concatenated segments
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_file_path,
            "-ss", str(max(0, seek_offset)),  # Seek to the position within concat
            "-t", "6",  # Duration: 6 seconds from that position
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            video_file_path
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=20.0
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise RuntimeError("FFmpeg historical bookmark capture timed out")

            # Log FFmpeg output for debugging
            stderr_output = stderr.decode() if stderr else ""
            if stderr_output:
                logger.debug(f"FFmpeg stderr output:\n{stderr_output}")

            if process.returncode != 0:
                error_msg = stderr_output if stderr_output else "Unknown error"
                logger.error(f"FFmpeg historical bookmark failed (exit code {process.returncode}): {error_msg}")
                raise RuntimeError(f"FFmpeg failed: {error_msg}")

            if not os.path.exists(video_file_path):
                raise RuntimeError("Historical bookmark video file was not created")

            file_size = os.path.getsize(video_file_path)
            logger.info(f"✅ Historical bookmark captured: {video_file_path} ({file_size} bytes)")

            # Check if file is suspiciously small
            if file_size < 1000:
                logger.error(f"⚠️ Warning: Bookmark file is very small ({file_size} bytes), likely corrupt!")
                logger.error(f"FFmpeg stderr: {stderr_output[-500:]}")

            # Generate thumbnail from center frame
            await self._generate_thumbnail(video_file_path, thumbnail_path, seek_time="00:00:03")

            # Create database entry
            bookmark = Bookmark(
                device_id=device_id,
                center_timestamp=center_timestamp,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                video_file_path=video_file_path,
                thumbnail_path=thumbnail_path if os.path.exists(thumbnail_path) else None,
                label=label,
                source="historical",
                duration=6,
                video_format="mp4",
                file_size=file_size
            )

            db.add(bookmark)
            await db.commit()
            await db.refresh(bookmark)

            # Cleanup temporary concat file
            if os.path.exists(concat_file_path):
                os.remove(concat_file_path)

            return bookmark

        except Exception as e:
            logger.error(f"Failed to capture historical bookmark: {e}")
            # Cleanup partial files
            if os.path.exists(video_file_path):
                os.remove(video_file_path)
            if os.path.exists(thumbnail_path):
                os.remove(thumbnail_path)
            if os.path.exists(concat_file_path):
                os.remove(concat_file_path)
            raise

    async def _generate_thumbnail(
        self,
        video_path: str,
        thumbnail_path: str,
        seek_time: str = "00:00:03"
    ):
        """
        Generate thumbnail from video at specified time.

        Args:
            video_path: Path to source video
            thumbnail_path: Path to save thumbnail
            seek_time: Time to extract frame (format: HH:MM:SS)
        """
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-ss", seek_time,
            "-i", video_path,
            "-frames:v", "1",
            "-q:v", "2",
            thumbnail_path
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            await asyncio.wait_for(process.communicate(), timeout=5.0)

            if process.returncode == 0 and os.path.exists(thumbnail_path):
                logger.info(f"Thumbnail generated: {thumbnail_path}")
            else:
                logger.warning(f"Failed to generate thumbnail for {video_path}")

        except Exception as e:
            logger.warning(f"Thumbnail generation error: {e}")

    async def get_bookmarks(
        self,
        db: AsyncSession,
        device_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Bookmark]:
        """
        Get list of bookmarks with optional device filter.

        Args:
            db: Database session
            device_id: Optional device UUID filter
            skip: Number of records to skip
            limit: Max records to return

        Returns:
            List of bookmarks
        """
        query = select(Bookmark).order_by(Bookmark.created_at.desc())

        if device_id:
            query = query.filter(Bookmark.device_id == device_id)

        query = query.offset(skip).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())

    async def get_bookmark(self, bookmark_id: str, db: AsyncSession) -> Optional[Bookmark]:
        """Get a single bookmark by ID."""
        result = await db.execute(select(Bookmark).filter(Bookmark.id == bookmark_id))
        return result.scalars().first()

    async def update_bookmark(
        self,
        bookmark_id: str,
        label: Optional[str],
        db: AsyncSession
    ) -> Optional[Bookmark]:
        """Update bookmark label."""
        bookmark = await self.get_bookmark(bookmark_id, db)
        if bookmark:
            if label is not None:
                bookmark.label = label
            await db.commit()
            await db.refresh(bookmark)
        return bookmark

    async def delete_bookmark(self, bookmark_id: str, db: AsyncSession) -> bool:
        """Delete bookmark and associated files."""
        bookmark = await self.get_bookmark(bookmark_id, db)
        if not bookmark:
            return False

        # Delete files
        try:
            if os.path.exists(bookmark.video_file_path):
                os.remove(bookmark.video_file_path)
                logger.info(f"Deleted video file: {bookmark.video_file_path}")

            if bookmark.thumbnail_path and os.path.exists(bookmark.thumbnail_path):
                os.remove(bookmark.thumbnail_path)
                logger.info(f"Deleted thumbnail: {bookmark.thumbnail_path}")
        except Exception as e:
            logger.error(f"Error deleting bookmark files: {e}")

        # Delete database entry
        await db.delete(bookmark)
        await db.commit()
        return True


# Global bookmark service instance
bookmark_service = BookmarkService()
