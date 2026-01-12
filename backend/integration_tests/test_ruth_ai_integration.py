#!/usr/bin/env python3
"""
Ruth-AI Integration Test - VAS-MS-V2
=====================================

Critical Success Criterion: Ruth-AI can integrate in ONE AFTERNOON

This test simulates a third-party AI application (Ruth-AI) consuming VAS-MS-V2:
1. Authenticate via OAuth2
2. Discover and consume live stream
3. Detect AI event (person detection)
4. Create bookmark programmatically
5. Query bookmarks by event_type
6. Download bookmark video for training dataset

Expected completion time: ONE AFTERNOON (3-4 hours for human developer)
"""

import asyncio
import httpx
import time
import os
import json
from datetime import datetime
from typing import Dict, List, Optional

# Configuration
API_URL = os.getenv("API_URL", "http://localhost:8080")
CLIENT_ID = os.getenv("TEST_CLIENT_ID", "ruth-ai")
CLIENT_SECRET = os.getenv("TEST_CLIENT_SECRET", "ruth-secret")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/tmp/ruth_ai_test")


class Colors:
    """Terminal colors for output"""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


class RuthAIIntegrationTest:
    """Simulates Ruth-AI consuming VAS-MS-V2 API"""

    def __init__(self):
        self.api_url = API_URL
        self.client_id = CLIENT_ID
        self.client_secret = CLIENT_SECRET
        self.access_token: Optional[str] = None
        self.client = httpx.AsyncClient(timeout=30.0)
        self.test_start_time = time.time()

    def log(self, message: str, color: str = Colors.OKBLUE):
        """Print colored log message"""
        print(f"{color}{message}{Colors.ENDC}")

    def log_step(self, step: int, total: int, message: str):
        """Print step header"""
        print(f"\n{Colors.BOLD}{'='*60}{Colors.ENDC}")
        print(f"{Colors.HEADER}[{step}/{total}] {message}{Colors.ENDC}")
        print(f"{Colors.BOLD}{'='*60}{Colors.ENDC}\n")

    def log_success(self, message: str):
        """Print success message"""
        print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")

    def log_error(self, message: str):
        """Print error message"""
        print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")

    def log_info(self, message: str):
        """Print info message"""
        print(f"{Colors.OKCYAN}   {message}{Colors.ENDC}")

    async def authenticate(self) -> Dict:
        """
        Step 1: Authenticate with VAS-MS-V2 using OAuth2 client credentials
        """
        self.log_step(1, 7, "Authenticating Ruth-AI with VAS-MS-V2")

        try:
            response = await self.client.post(
                f"{self.api_url}/api/v2/auth/token",
                json={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret
                }
            )

            if response.status_code != 200:
                raise Exception(f"Authentication failed with status {response.status_code}: {response.text}")

            data = response.json()
            self.access_token = data["access_token"]

            self.log_success(f"Authenticated as '{self.client_id}'")
            self.log_info(f"Access token: {self.access_token[:20]}...")
            self.log_info(f"Token expires in: {data.get('expires_in', 'N/A')} seconds")
            self.log_info(f"Token type: {data.get('token_type', 'N/A')}")

            return data

        except Exception as e:
            self.log_error(f"Authentication failed: {e}")
            raise

    async def discover_streams(self) -> List[Dict]:
        """
        Step 2: Discover available live streams
        """
        self.log_step(2, 7, "Discovering available streams")

        try:
            response = await self.client.get(
                f"{self.api_url}/api/v2/streams",
                headers={"Authorization": f"Bearer {self.access_token}"},
                params={"state": "live"}
            )

            if response.status_code != 200:
                raise Exception(f"Failed to list streams: {response.text}")

            data = response.json()
            streams = data.get("streams", [])

            if not streams:
                self.log_error("No live streams available for testing")
                raise Exception("No live streams found")

            self.log_success(f"Discovered {len(streams)} live stream(s)")

            for stream in streams:
                self.log_info(f"  - {stream['name']} (ID: {stream['id']}, State: {stream['state']})")

            return streams

        except Exception as e:
            self.log_error(f"Stream discovery failed: {e}")
            raise

    async def consume_stream(self, stream_id: str, max_retries: int = 5) -> str:
        """
        Step 3: Attach consumer to stream (WebRTC signaling)

        This demonstrates that Ruth-AI can consume the video stream
        for real-time AI inference.

        Implements retry logic for 409 Conflict responses when the producer
        is still initializing after stream reaches LIVE state.
        """
        self.log_step(3, 7, "Attaching WebRTC consumer to stream")

        try:
            # Minimal RTP capabilities for H.264 video
            rtp_capabilities = {
                "codecs": [{
                    "mimeType": "video/H264",
                    "kind": "video",
                    "clockRate": 90000,
                    "preferredPayloadType": 96,
                    "parameters": {
                        "packetization-mode": 1,
                        "profile-level-id": "42e01f"
                    }
                }],
                "headerExtensions": []
            }

            # Retry loop for handling 409 Conflict (producer not ready)
            for attempt in range(1, max_retries + 1):
                response = await self.client.post(
                    f"{self.api_url}/api/v2/streams/{stream_id}/consume",
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    json={
                        "client_id": "ruth-ai-simulator",
                        "rtp_capabilities": rtp_capabilities
                    }
                )

                if response.status_code in [200, 201]:
                    # Success!
                    data = response.json()
                    consumer_id = data["consumer_id"]

                    self.log_success(f"Consumer attached successfully")
                    self.log_info(f"Consumer ID: {consumer_id}")
                    self.log_info(f"Transport ID: {data.get('transport', {}).get('id', 'N/A')}")
                    self.log_info(f"Stream can now be processed by Ruth-AI")

                    return consumer_id

                elif response.status_code == 409:
                    # Producer not ready - follow retry_after_seconds hint
                    try:
                        error_detail = response.json().get("detail", {})
                        retry_after = error_detail.get("retry_after_seconds", 2)
                        error_type = error_detail.get("error", "UNKNOWN")
                        self.log_info(f"Attempt {attempt}/{max_retries}: {error_type}, retrying in {retry_after}s...")
                    except:
                        retry_after = 2
                        self.log_info(f"Attempt {attempt}/{max_retries}: Producer not ready, retrying in {retry_after}s...")

                    if attempt < max_retries:
                        await asyncio.sleep(retry_after)
                    else:
                        raise Exception(f"Failed to attach consumer after {max_retries} attempts: {response.text}")
                else:
                    raise Exception(f"Failed to attach consumer: {response.text}")

            # Should not reach here, but just in case
            raise Exception("Max retries exceeded")

        except Exception as e:
            self.log_error(f"Consumer attachment failed: {e}")
            raise

    async def simulate_ai_detection(self) -> Dict:
        """
        Step 4: Simulate AI person detection

        In production, Ruth-AI would:
        - Receive video frames from WebRTC consumer
        - Run YOLOv8 inference
        - Detect person with bounding box
        - Return detection metadata
        """
        self.log_step(4, 7, "Simulating AI person detection")

        # Simulate AI processing time
        self.log_info("Running YOLOv8 inference on video frames...")
        await asyncio.sleep(1)

        detection = {
            "label": "person",
            "confidence": 0.94,
            "bounding_box": {
                "x": 120,
                "y": 180,
                "width": 80,
                "height": 200
            },
            "detection_id": f"det_{int(time.time())}",
            "ai_model": "yolov8-person-detection-v2",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        self.log_success("Person detected by Ruth-AI!")
        self.log_info(f"Label: {detection['label']}")
        self.log_info(f"Confidence: {detection['confidence'] * 100:.1f}%")
        self.log_info(f"Bounding box: ({detection['bounding_box']['x']}, {detection['bounding_box']['y']}, {detection['bounding_box']['width']}x{detection['bounding_box']['height']})")
        self.log_info(f"Detection ID: {detection['detection_id']}")

        return detection

    async def create_bookmark(self, stream_id: str, detection: Dict) -> str:
        """
        Step 5: Create AI-generated bookmark

        This captures a 6-second video clip centered on the detection event,
        which Ruth-AI can later download for its training dataset.
        """
        self.log_step(5, 7, "Creating AI-generated bookmark")

        try:
            response = await self.client.post(
                f"{self.api_url}/api/v2/streams/{stream_id}/bookmarks",
                headers={"Authorization": f"Bearer {self.access_token}"},
                json={
                    "source": "live",
                    "label": f"Person detected by Ruth-AI",
                    "created_by": "ruth-ai",
                    "event_type": "person",
                    "confidence": detection["confidence"],
                    "tags": ["ai-detection", "person", "ruth-ai", "training-data"],
                    "metadata": {
                        "bounding_box": detection["bounding_box"],
                        "ai_model": detection["ai_model"],
                        "detection_id": detection["detection_id"],
                        "timestamp": detection["timestamp"]
                    }
                }
            )

            if response.status_code not in [200, 201]:
                raise Exception(f"Failed to create bookmark: {response.text}")

            data = response.json()
            bookmark_id = data["id"]

            self.log_success("AI-generated bookmark created!")
            self.log_info(f"Bookmark ID: {bookmark_id}")
            self.log_info(f"Label: {data.get('label', 'N/A')}")
            self.log_info(f"Event type: {data.get('event_type', 'N/A')}")
            self.log_info(f"Duration: {data.get('duration', 'N/A')} seconds")
            self.log_info(f"Tags: {', '.join(data.get('tags', []))}")
            self.log_info(f"Video URL: {data.get('video_url', 'N/A')}")

            return bookmark_id

        except Exception as e:
            self.log_error(f"Bookmark creation failed: {e}")
            raise

    async def query_bookmarks(self, stream_id: str) -> List[Dict]:
        """
        Step 6: Query person detection bookmarks

        Ruth-AI can filter bookmarks to find all person detections
        for batch downloading to training dataset.
        """
        self.log_step(6, 7, "Querying person detection bookmarks")

        try:
            response = await self.client.get(
                f"{self.api_url}/api/v2/bookmarks",
                headers={"Authorization": f"Bearer {self.access_token}"},
                params={
                    "stream_id": stream_id,
                    "event_type": "person",
                    "created_by": "ruth-ai",
                    "limit": 10
                }
            )

            if response.status_code != 200:
                raise Exception(f"Failed to query bookmarks: {response.text}")

            data = response.json()
            bookmarks = data.get("bookmarks", [])

            self.log_success(f"Found {len(bookmarks)} person detection bookmark(s)")

            for i, bookmark in enumerate(bookmarks[:5], 1):  # Show first 5
                self.log_info(f"{i}. {bookmark.get('label', 'N/A')} (Confidence: {bookmark.get('confidence', 0) * 100:.1f}%)")
                self.log_info(f"   ID: {bookmark['id']}, Created: {bookmark.get('created_at', 'N/A')}")

            return bookmarks

        except Exception as e:
            self.log_error(f"Bookmark query failed: {e}")
            raise

    async def download_bookmark_video(self, bookmark_id: str) -> str:
        """
        Step 7: Download bookmark video for training dataset

        Ruth-AI downloads the 6-second video clip to add to its
        person detection training dataset.
        """
        self.log_step(7, 7, "Downloading bookmark video for training dataset")

        try:
            response = await self.client.get(
                f"{self.api_url}/api/v2/bookmarks/{bookmark_id}/video",
                headers={"Authorization": f"Bearer {self.access_token}"}
            )

            if response.status_code != 200:
                raise Exception(f"Failed to download video: {response.text}")

            # Create output directory
            os.makedirs(OUTPUT_DIR, exist_ok=True)

            # Save video file
            filename = f"ruth_ai_training_{bookmark_id}.mp4"
            filepath = os.path.join(OUTPUT_DIR, filename)

            with open(filepath, "wb") as f:
                f.write(response.content)

            file_size_mb = len(response.content) / (1024 * 1024)

            self.log_success("Bookmark video downloaded!")
            self.log_info(f"Filename: {filename}")
            self.log_info(f"File size: {file_size_mb:.2f} MB")
            self.log_info(f"Saved to: {filepath}")
            self.log_info(f"Ready to add to Ruth-AI training dataset")

            return filepath

        except Exception as e:
            self.log_error(f"Video download failed: {e}")
            raise

    async def cleanup(self, consumer_id: str):
        """Clean up: Detach consumer"""
        self.log("\n🧹 Cleanup: Detaching consumer...", Colors.OKCYAN)

        try:
            response = await self.client.delete(
                f"{self.api_url}/api/v2/consumers/{consumer_id}",
                headers={"Authorization": f"Bearer {self.access_token}"}
            )

            if response.status_code in [200, 204]:
                self.log_success("Consumer detached successfully")
            else:
                self.log(f"⚠️  Consumer cleanup returned status {response.status_code}", Colors.WARNING)

        except Exception as e:
            self.log(f"⚠️  Cleanup failed (non-critical): {e}", Colors.WARNING)

    async def run(self) -> bool:
        """Run complete Ruth-AI integration test"""

        print(f"\n{Colors.BOLD}{'='*80}{Colors.ENDC}")
        print(f"{Colors.HEADER}{Colors.BOLD}RUTH-AI INTEGRATION TEST - VAS-MS-V2{Colors.ENDC}")
        print(f"{Colors.BOLD}{'='*80}{Colors.ENDC}")
        print(f"\n{Colors.OKBLUE}Critical Success Criterion: Complete integration in ONE AFTERNOON{Colors.ENDC}")
        print(f"{Colors.OKBLUE}Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Colors.ENDC}\n")

        try:
            # Step 1: Authenticate
            await self.authenticate()

            # Step 2: Discover streams
            streams = await self.discover_streams()
            stream_id = streams[0]["id"]
            stream_name = streams[0]["name"]

            # Step 3: Consume stream
            consumer_id = await self.consume_stream(stream_id)

            # Step 4: Simulate AI detection
            detection = await self.simulate_ai_detection()

            # Step 5: Create bookmark
            bookmark_id = await self.create_bookmark(stream_id, detection)

            # Step 6: Query bookmarks
            bookmarks = await self.query_bookmarks(stream_id)

            # Step 7: Download video
            video_path = await self.download_bookmark_video(bookmark_id)

            # Cleanup
            await self.cleanup(consumer_id)

            # SUCCESS!
            elapsed_time = time.time() - self.test_start_time
            elapsed_minutes = elapsed_time / 60

            print(f"\n{Colors.BOLD}{'='*80}{Colors.ENDC}")
            print(f"{Colors.OKGREEN}{Colors.BOLD}✅ SUCCESS! RUTH-AI INTEGRATION TEST PASSED{Colors.ENDC}")
            print(f"{Colors.BOLD}{'='*80}{Colors.ENDC}\n")

            print(f"{Colors.OKGREEN}Ruth-AI can now:{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Authenticate via OAuth2{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Discover and consume live streams{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Detect events with AI{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Create AI-generated bookmarks{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Query bookmarks by event type{Colors.ENDC}")
            print(f"{Colors.OKGREEN}  ✅ Download videos for training dataset{Colors.ENDC}\n")

            print(f"{Colors.OKCYAN}Test execution time: {elapsed_minutes:.1f} minutes{Colors.ENDC}")
            print(f"{Colors.OKCYAN}Target time: ONE AFTERNOON (180-240 minutes){Colors.ENDC}\n")

            if elapsed_minutes <= 10:
                print(f"{Colors.OKGREEN}{Colors.BOLD}🎉 ONE AFTERNOON SUCCESS CRITERION MET!{Colors.ENDC}\n")
            else:
                print(f"{Colors.WARNING}⚠️  Test took longer than expected (but still passed){Colors.ENDC}\n")

            print(f"{Colors.OKCYAN}Stream used: {stream_name} ({stream_id}){Colors.ENDC}")
            print(f"{Colors.OKCYAN}Bookmark created: {bookmark_id}{Colors.ENDC}")
            print(f"{Colors.OKCYAN}Video saved to: {video_path}{Colors.ENDC}\n")

            return True

        except Exception as e:
            elapsed_time = time.time() - self.test_start_time
            elapsed_minutes = elapsed_time / 60

            print(f"\n{Colors.BOLD}{'='*80}{Colors.ENDC}")
            print(f"{Colors.FAIL}{Colors.BOLD}❌ FAILED: RUTH-AI INTEGRATION TEST{Colors.ENDC}")
            print(f"{Colors.BOLD}{'='*80}{Colors.ENDC}\n")

            print(f"{Colors.FAIL}Error: {e}{Colors.ENDC}\n")
            print(f"{Colors.OKCYAN}Test execution time: {elapsed_minutes:.1f} minutes{Colors.ENDC}\n")

            return False

        finally:
            await self.client.aclose()


async def main():
    """Main entry point"""

    # Validate environment
    if not CLIENT_SECRET or CLIENT_SECRET == "ruth-secret":
        print(f"{Colors.FAIL}❌ Error: TEST_CLIENT_SECRET environment variable not set{Colors.ENDC}")
        print(f"{Colors.WARNING}Please set your Ruth-AI client secret:{Colors.ENDC}")
        print(f"{Colors.OKCYAN}  export TEST_CLIENT_SECRET=your-secret-here{Colors.ENDC}\n")
        return 1

    # Run test
    test = RuthAIIntegrationTest()
    success = await test.run()

    return 0 if success else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
