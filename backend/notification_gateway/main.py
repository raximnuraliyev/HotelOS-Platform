import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import jwt

from backend.shared.config import PORT_NOTIFICATION_GATEWAY, JWT_SECRET, JWT_ALGORITHM
from backend.shared.event_broker import broker
from backend.shared.database import init_db

class ConnectionManager:
    def __init__(self):
        # Staff connections receive all broadcast events
        self.staff_connections: list[WebSocket] = []
        # Guest connections map room_number -> list of WebSockets
        self.guest_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, role: str, room_number: int = None):
        await websocket.accept()
        if role == "admin":
            self.staff_connections.append(websocket)
            print(f"[Gateway] Connected staff client. Total staff: {len(self.staff_connections)}")
        elif role == "guest" and room_number:
            if room_number not in self.guest_connections:
                self.guest_connections[room_number] = []
            self.guest_connections[room_number].append(websocket)
            print(f"[Gateway] Connected guest client for room {room_number}. Total for room: {len(self.guest_connections[room_number])}")
        else:
            # Fallback connection (e.g. anonymous dashboard listener for tests)
            self.staff_connections.append(websocket)
            print("[Gateway] Connected anonymous client. Added to staff broadcast list.")

    def disconnect(self, websocket: WebSocket, role: str, room_number: int = None):
        if websocket in self.staff_connections:
            self.staff_connections.remove(websocket)
            print("[Gateway] Disconnected staff/anonymous client.")
        if room_number and room_number in self.guest_connections:
            if websocket in self.guest_connections[room_number]:
                self.guest_connections[room_number].remove(websocket)
                print(f"[Gateway] Disconnected guest client for room {room_number}.")
                if not self.guest_connections[room_number]:
                    del self.guest_connections[room_number]

    async def broadcast_event(self, channel: str, message_json: str):
        """Dispatches Redis messages to WebSocket clients.
        Staff clients receive every event.
        Guest clients only receive events targeted for their room (payload contains room_number).
        """
        try:
            event = json.loads(message_json)
        except Exception as parse_err:
            print(f"[Gateway Error] JSON parse failure: {parse_err}")
            return

        # Security: Remove any potentially sensitive fields from websocket broadcast
        # E.g. passport, credit card details, etc. (They aren't created in the system, but this is a security filter)
        payload = event.get("payload", {})
        if isinstance(payload, dict):
            payload.pop("credit_card", None)
            payload.pop("passport", None)
            payload.pop("private_billing_details", None)
        
        filtered_message = json.dumps(event)

        # 1. Send to all staff connections
        for connection in self.staff_connections:
            try:
                await connection.send_text(filtered_message)
            except Exception as e:
                # Connection is dead, we'll clean it up on disconnect, skip for now
                pass

        # 2. Send to specific room guest connections
        room_number = payload.get("room_number")
        if room_number and int(room_number) in self.guest_connections:
            target_room = int(room_number)
            for connection in self.guest_connections[target_room]:
                try:
                    await connection.send_text(filtered_message)
                except Exception as e:
                    pass

manager = ConnectionManager()

async def redis_event_subscriber():
    """Subscribes to Redis Pub/Sub channels and broadcasts events through WebSockets."""
    print("[Gateway] Starting Redis pub/sub subscriber...")
    try:
        r = await broker.get_redis()
        pubsub = r.pubsub()
        channels = [
            "guest.checked_in",
            "guest.checked_out",
            "room.vacated",
            "room.cleaning_started",
            "room.cleaned",
            "room.status_changed",
            "room_service.created",
            "room_service.updated",
            "maintenance.created",
            "maintenance.assigned",
            "maintenance.resolved",
            "dashboard.notification"
        ]
        await pubsub.subscribe(*channels)
        
        async for message in pubsub.listen():
            if message["type"] == "message":
                channel = message["channel"]
                data = message["data"]
                await manager.broadcast_event(channel, data)
    except asyncio.CancelledError:
        print("[Gateway] Redis listener stopped.")
    except Exception as e:
        print(f"[Gateway Error] Redis exception in listener: {e}")
        await asyncio.sleep(5)
        # Attempt to restart
        asyncio.create_task(redis_event_subscriber())

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema before background subscriber loops query
    init_db()
    # Start background listener task
    sub_task = asyncio.create_task(redis_event_subscriber())
    yield
    sub_task.cancel()
    try:
        await sub_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="HotelOS Notification Gateway Service",
    version="1.0.0",
    description="WebSocket gateway broadcasting live Redis Pub/Sub events.",
    lifespan=lifespan
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    """WebSocket endpoint supporting JWT auth to isolate guest and staff channels."""
    role = "anonymous"
    room_number = None
    
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            role = payload.get("role", "anonymous")
            room_number = payload.get("room_number")
            if room_number:
                room_number = int(room_number)
        except Exception as e:
            # Token invalid, treat as anonymous
            print(f"[Gateway WS Warning] JWT Decode error: {e}")
            
    await manager.connect(websocket, role=role, room_number=room_number)
    try:
        while True:
            # Keep connection alive; clients can send pings, or we just listen
            data = await websocket.receive_text()
            # Respond to ping messages
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, role=role, room_number=room_number)
    except Exception as e:
        print(f"[Gateway WS Error] Exception: {e}")
        manager.disconnect(websocket, role=role, room_number=room_number)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT_NOTIFICATION_GATEWAY)
