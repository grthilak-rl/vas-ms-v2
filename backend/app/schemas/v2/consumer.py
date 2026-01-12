"""Consumer/WebRTC schemas for V2 API."""
from pydantic import BaseModel, Field, UUID4
from typing import Dict, Any, List, Optional


class ConsumerAttachRequest(BaseModel):
    """Request to attach a WebRTC consumer to a stream."""
    client_id: str = Field(..., description="Unique client identifier")
    rtp_capabilities: Dict[str, Any] = Field(..., description="Client RTP capabilities")

    model_config = {
        "json_schema_extra": {
            "example": {
                "client_id": "ruth-ai-instance-1",
                "rtp_capabilities": {
                    "codecs": [
                        {
                            "mimeType": "video/H264",
                            "kind": "video",
                            "clockRate": 90000,
                            "preferredPayloadType": 96
                        }
                    ],
                    "headerExtensions": []
                }
            }
        }
    }


class TransportInfo(BaseModel):
    """WebRTC transport information."""
    id: str = Field(..., description="Transport ID")
    ice_parameters: Dict[str, Any] = Field(..., description="ICE parameters")
    ice_candidates: List[Dict[str, Any]] = Field(..., description="ICE candidates")
    dtls_parameters: Dict[str, Any] = Field(..., description="DTLS parameters")


class ConsumerAttachResponse(BaseModel):
    """Response after attaching consumer."""
    consumer_id: UUID4 = Field(..., description="Consumer UUID")
    transport: TransportInfo = Field(..., description="WebRTC transport info")
    rtp_parameters: Dict[str, Any] = Field(..., description="RTP parameters for consumer")

    model_config = {
        "json_schema_extra": {
            "example": {
                "consumer_id": "cccccccc-0000-0000-0000-000000000001",
                "transport": {
                    "id": "transport-uuid-123",
                    "ice_parameters": {
                        "usernameFragment": "abc123",
                        "password": "def456"
                    },
                    "ice_candidates": [
                        {
                            "foundation": "udpcandidate",
                            "priority": 1076302079,
                            "ip": "10.30.250.245",
                            "port": 40123,
                            "type": "host",
                            "protocol": "udp"
                        }
                    ],
                    "dtls_parameters": {
                        "role": "auto",
                        "fingerprints": [
                            {
                                "algorithm": "sha-256",
                                "value": "A1:B2:C3:..."
                            }
                        ]
                    }
                },
                "rtp_parameters": {
                    "codecs": [{"mimeType": "video/H264"}],
                    "encodings": [{"ssrc": 2622226488}]
                }
            }
        }
    }


class ConsumerConnectRequest(BaseModel):
    """Request to complete DTLS handshake."""
    dtls_parameters: Dict[str, Any] = Field(..., description="Client DTLS parameters")


class ICECandidateRequest(BaseModel):
    """Request to send ICE candidate."""
    candidate: Dict[str, Any] = Field(..., description="ICE candidate")
