"""
MediaSoup Client Service

Communicates with the MediaSoup Node.js server via WebSocket
"""
import asyncio
import json
import websockets
from typing import Dict, Optional, Any, List
from loguru import logger


class MediaSoupClient:
    """
    Client for communicating with MediaSoup server.
    """
    
    def __init__(self, mediasoup_url: str = "ws://10.30.250.245:3001"):
        """Initialize MediaSoup client."""
        self.mediasoup_url = mediasoup_url
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.response_futures: Dict[str, asyncio.Future] = {}
        self.connected = False
        
        logger.info(f"MediaSoup client initialized (server: {mediasoup_url})")
    
    async def connect(self):
        """Connect to MediaSoup server."""
        # Close existing connection if any
        if self.websocket:
            try:
                if not self.websocket.closed:
                    await self.websocket.close()
            except:
                pass
            self.websocket = None
        
        self.connected = False
        
        try:
            self.websocket = await websockets.connect(self.mediasoup_url)
            self.connected = True
            logger.info("Connected to MediaSoup server")
            # No background listener - we read responses directly in _send_request
            
        except Exception as e:
            self.connected = False
            logger.error(f"Failed to connect to MediaSoup server: {e}")
            raise
    
    async def _send_request(self, request_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send request to MediaSoup server and wait for response.
        
        Args:
            request_type: Type of request
            payload: Request payload
            
        Returns:
            Response data
        """
        # Check if connection is alive, reconnect if needed
        if not self.connected or not self.websocket or (hasattr(self.websocket, 'closed') and self.websocket.closed):
            logger.warning("WebSocket connection lost, reconnecting...")
            await self.connect()
        
        message = {
            "type": request_type,
            "payload": payload
        }
        
        try:
            await self.websocket.send(json.dumps(message))
            logger.debug(f"MediaSoup request sent: {request_type}")
            
            # Wait for response
            response_message = await self.websocket.recv()
            response = json.loads(response_message)
            
            # Check for errors in response
            if "error" in response:
                error_msg = response.get("error", "Unknown error")
                logger.error(f"MediaSoup error for {request_type}: {error_msg}")
                raise RuntimeError(f"MediaSoup error: {error_msg}")
            
            logger.debug(f"MediaSoup response received for {request_type}")
            return response
            
        except (websockets.exceptions.ConnectionClosed, websockets.exceptions.ConnectionClosedError) as e:
            # Connection closed, mark as disconnected and reconnect
            logger.warning(f"WebSocket connection closed during {request_type}: {e}")
            self.connected = False
            self.websocket = None
            raise RuntimeError(f"MediaSoup connection closed. Please try again.")
        
        except Exception as e:
            # On any other error, mark as disconnected if it's a connection error
            if "connection" in str(e).lower() or "closed" in str(e).lower():
                self.connected = False
                self.websocket = None
            raise
    
    async def get_router_rtp_capabilities(self, room_id: str) -> Dict[str, Any]:
        """
        Get router RTP capabilities for a room.
        
        Args:
            room_id: Room/device identifier
            
        Returns:
            RTP capabilities
        """
        response = await self._send_request("getRouterRtpCapabilities", {"roomId": room_id})
        return response.get("rtpCapabilities")
    
    async def create_plain_rtp_transport(self, room_id: str) -> Dict[str, Any]:
        """
        Create PlainRTP transport for FFmpeg input.
        
        Args:
            room_id: Room/device identifier
            
        Returns:
            Transport info with RTP ports
        """
        response = await self._send_request("createPlainRtpTransport", {"roomId": room_id})
        return response.get("transportInfo")
    
    async def get_transport_stats(
        self,
        transport_id: str
    ) -> List[Dict[str, Any]]:
        """
        Get transport statistics.
        
        Args:
            transport_id: Transport identifier
            
        Returns:
            List of transport stats
        """
        response = await self._send_request("getTransportStats", {
            "transportId": transport_id
        })
        return response.get("stats", [])
    
    async def create_producer(
        self,
        transport_id: str,
        kind: str,
        rtp_parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create a producer on a transport.
        
        Args:
            transport_id: Transport identifier
            kind: Media kind ('video' or 'audio')
            rtp_parameters: RTP parameters
            
        Returns:
            Producer info
        """
        response = await self._send_request("createProducer", {
            "transportId": transport_id,
            "kind": kind,
            "rtpParameters": rtp_parameters
        })
        return response.get("producerInfo")
    
    async def create_webrtc_transport(self, room_id: str) -> Dict[str, Any]:
        """
        Create WebRTC transport for consumer (browser).
        
        Args:
            room_id: Room/device identifier
            
        Returns:
            Transport info with ICE/DTLS parameters
        """
        response = await self._send_request("createWebRtcTransport", {"roomId": room_id})
        return response.get("transportInfo")
    
    async def connect_webrtc_transport(
        self,
        transport_id: str,
        dtls_parameters: Dict[str, Any]
    ):
        """
        Connect WebRTC transport.
        
        Args:
            transport_id: Transport identifier
            dtls_parameters: DTLS parameters from client
        """
        await self._send_request("connectWebRtcTransport", {
            "transportId": transport_id,
            "dtlsParameters": dtls_parameters
        })
    
    async def consume(
        self,
        transport_id: str,
        producer_id: str,
        rtp_capabilities: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create consumer to receive media.
        
        Args:
            transport_id: Transport identifier
            producer_id: Producer identifier
            rtp_capabilities: Client RTP capabilities
            
        Returns:
            Consumer info
        """
        response = await self._send_request("consume", {
            "transportId": transport_id,
            "producerId": producer_id,
            "rtpCapabilities": rtp_capabilities
        })
        return response.get("consumerInfo")
    
    async def get_producers(self, room_id: str) -> list:
        """
        Get list of producers for a room.
        
        Args:
            room_id: Room/device identifier
            
        Returns:
            List of producer IDs
        """
        response = await self._send_request("getProducers", {"roomId": room_id})
        return response.get("producers", [])
    
    async def close_producer(self, producer_id: str):
        """
        Close a producer.
        
        Args:
            producer_id: Producer identifier
        """
        await self._send_request("closeProducer", {"producerId": producer_id})
        logger.info(f"Closed producer: {producer_id}")
    
    async def close_transport(self, transport_id: str):
        """
        Close a transport (this will close all producers on it).
        
        Args:
            transport_id: Transport identifier
        """
        await self._send_request("closeTransport", {"transportId": transport_id})
        logger.info(f"Closed transport: {transport_id}")
    
    async def disconnect(self):
        """Disconnect from MediaSoup server."""
        if self.websocket:
            await self.websocket.close()
            self.connected = False
            logger.info("Disconnected from MediaSoup server")


# Global MediaSoup client instance
mediasoup_client = MediaSoupClient()

