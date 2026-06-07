import json
import uuid
from datetime import datetime
import redis.asyncio as aioredis
from sqlalchemy.orm import Session
from backend.shared.config import REDIS_URL
from backend.shared.models import AuditLog
from backend.shared.database import SessionLocal

class EventBroker:
    def __init__(self):
        self.redis_url = REDIS_URL
        self.redis_client = None

    async def get_redis(self):
        """Lazy initializer for async Redis client."""
        if self.redis_client is None:
            self.redis_client = aioredis.from_url(
                self.redis_url, 
                encoding="utf-8", 
                decode_responses=True,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                retry_on_timeout=False
            )
        return self.redis_client

    async def publish_event(self, event_type: str, payload: dict):
        """Publishes an event to Redis Pub/Sub after validation and logs it to SQLite."""
        event_id = str(uuid.uuid4())
        timestamp_str = datetime.utcnow().isoformat()
        
        # Enforce exact event wrapper structure
        event_envelope = {
            "event_id": event_id,
            "timestamp": timestamp_str,
            "event_type": event_type,
            "payload": payload
        }
        
        message_json = json.dumps(event_envelope)
        
        # 1. Publish to Redis
        try:
            r = await self.get_redis()
            await r.publish(event_type, message_json)
            # Also publish to a general dashboard notifications channel
            await r.publish("dashboard.notification", message_json)
            print(f"[Broker] Event published on {event_type}: {event_id}")
        except Exception as e:
            # Fallback/Log in case Redis broker is starting up or temporarily disconnected
            print(f"[Broker Error] Failed to publish to Redis: {e}")

        # 2. Persist to audit_logs in SQLite database
        db: Session = SessionLocal()
        try:
            audit = AuditLog(
                timestamp=datetime.utcnow(),
                service=event_type.split(".")[0] if "." in event_type else "system",
                event_type=event_type,
                message=f"Event {event_type} triggered",
                payload=json.dumps(payload)
            )
            db.add(audit)
            db.commit()
        except Exception as db_err:
            db.rollback()
            print(f"[Broker Error] Database logging failed: {db_err}")
        finally:
            db.close()

# Instantiate global event broker
broker = EventBroker()
