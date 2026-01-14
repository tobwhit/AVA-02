from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from typing import List, Dict
import json
import logging
from datetime import datetime

router = APIRouter()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections for live telemetry broadcasting"""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_count = 0

    async def connect(self, websocket: WebSocket):
        """Accept and store a new WebSocket connection"""
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_count += 1
        logger.info(f"New WebSocket connection. Total active: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: Dict):
        """Send message to all connected clients"""
        disconnected = []

        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error sending to client: {e}")
                disconnected.append(connection)

        # Clean up dead connections
        for conn in disconnected:
            await self.disconnect(conn)

    def get_connection_count(self) -> int:
        """Return number of active connections"""
        return len(self.active_connections)

# Global connection manager instance
manager = ConnectionManager()


@router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time telemetry streaming.
    Frontend clients connect here to receive live data.
    """
    await manager.connect(websocket)

    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection",
            "status": "connected",
            "timestamp": datetime.now().isoformat(),
            "message": "Connected to AVA-02 Live Telemetry"
        })

        # Keep connection alive and listen for any client messages
        while True:
            # Receive any messages from client (e.g., ping/pong, commands)
            data = await websocket.receive_text()

            # Handle ping/pong to keep connection alive
            if data == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("Client disconnected normally")
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await manager.disconnect(websocket)


@router.post("/telemetry/send")
async def receive_telemetry_data(data: Dict):
    """
    HTTP endpoint for Raspberry Pi to send telemetry data.
    Data is immediately broadcast to all connected WebSocket clients.

    Expected data format:
    {
        "msg_id": 1,           # Sensor ID (from idMap.js)
        "value": 512,          # Sensor value
        "timestamp": 1674567890123,  # Unix timestamp in milliseconds
        "raw_data": [0, 2]     # Optional: raw bytes
    }
    """
    try:
        # Validate required fields
        if "msg_id" not in data or "value" not in data:
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: msg_id and value"
            )

        # Add server timestamp if not provided
        if "timestamp" not in data:
            data["timestamp"] = int(datetime.now().timestamp() * 1000)

        # Add message type
        data["type"] = "telemetry"

        # Broadcast to all connected WebSocket clients
        await manager.broadcast(data)

        logger.info(f"Broadcast telemetry: msg_id={data['msg_id']}, value={data['value']}")

        return {
            "status": "success",
            "broadcasted_to": manager.get_connection_count(),
            "timestamp": data["timestamp"]
        }

    except Exception as e:
        logger.error(f"Error processing telemetry data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/telemetry/batch")
async def receive_telemetry_batch(data: Dict):
    """
    HTTP endpoint for receiving multiple sensor readings at once.
    Useful for reducing HTTP overhead when Pi sends multiple sensors.

    Expected data format:
    {
        "readings": [
            {"msg_id": 1, "value": 512},
            {"msg_id": 2, "value": 256},
            ...
        ],
        "timestamp": 1674567890123
    }
    """
    try:
        if "readings" not in data or not isinstance(data["readings"], list):
            raise HTTPException(
                status_code=400,
                detail="Missing or invalid 'readings' array"
            )

        timestamp = data.get("timestamp", int(datetime.now().timestamp() * 1000))

        # Broadcast each reading individually
        for reading in data["readings"]:
            message = {
                "type": "telemetry",
                "msg_id": reading["msg_id"],
                "value": reading["value"],
                "timestamp": timestamp,
                "raw_data": reading.get("raw_data")
            }
            await manager.broadcast(message)

        return {
            "status": "success",
            "readings_processed": len(data["readings"]),
            "broadcasted_to": manager.get_connection_count()
        }

    except Exception as e:
        logger.error(f"Error processing batch telemetry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/telemetry/status")
def get_telemetry_status():
    """
    Get current telemetry system status.
    Useful for monitoring and debugging.
    """
    return {
        "status": "online",
        "active_connections": manager.get_connection_count(),
        "timestamp": datetime.now().isoformat()
    }
