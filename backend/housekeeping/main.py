import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_

from backend.shared.config import PORT_HOUSEKEEPING
from backend.shared.database import get_db, SessionLocal, init_db
from backend.shared.models import Room, HousekeepingTask
from backend.shared.auth import verify_staff, verify_staff_role
from backend.shared.event_broker import broker

# Background listener for Redis events
async def redis_listener():
    """Background listener subscribing to room.vacated to trigger cleaning tasks."""
    print("[Housekeeping] Starting Redis listener background worker...")
    try:
        r = await broker.get_redis()
        pubsub = r.pubsub()
        await pubsub.subscribe("room.vacated")
        
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    payload = data.get("payload", {})
                    room_number = payload.get("room_number")
                    
                    if room_number:
                        print(f"[Housekeeping] Room {room_number} vacated! Creating cleaning task.")
                        db = SessionLocal()
                        try:
                            # Avoid creating duplicate active tasks
                            existing = db.query(HousekeepingTask).filter(
                                and_(
                                    HousekeepingTask.room_number == room_number,
                                    HousekeepingTask.status != "Finished"
                                )
                            ).first()
                            
                            if not existing:
                                task = HousekeepingTask(
                                    room_number=room_number,
                                    status="Pending",
                                    created_at=datetime.utcnow()
                                )
                                db.add(task)
                                db.commit()
                                print(f"[Housekeeping] Created Pending task for room {room_number}")
                            else:
                                print(f"[Housekeeping] Clean task already active for room {room_number}")
                        except Exception as inner_e:
                            db.rollback()
                            print(f"[Housekeeping Error] Database write failed: {inner_e}")
                        finally:
                            db.close()
                except Exception as parse_e:
                    print(f"[Housekeeping Error] Failed to process message data: {parse_e}")
    except asyncio.CancelledError:
        print("[Housekeeping] Redis listener stopped.")
    except Exception as e:
        print(f"[Housekeeping Error] Redis connection failed in listener: {e}")
        await asyncio.sleep(5)
        # Attempt restart
        asyncio.create_task(redis_listener())

async def reconciliation_loop():
    """Periodic reconciliation loop checking for Dirty rooms without cleaning tasks.
    Acts as a resilient fallback in case the Redis broker is offline.
    """
    print("[Housekeeping] Starting DB reconciliation loop background worker...")
    while True:
        try:
            db = SessionLocal()
            try:
                # Find all dirty rooms
                dirty_rooms = db.query(Room).filter(Room.status == "Dirty").all()
                for room in dirty_rooms:
                    # Check if there is an active housekeeping task
                    existing = db.query(HousekeepingTask).filter(
                        and_(
                            HousekeepingTask.room_number == room.room_number,
                            HousekeepingTask.status != "Finished"
                        )
                    ).first()
                    if not existing:
                        task = HousekeepingTask(
                            room_number=room.room_number,
                            status="Pending",
                            created_at=datetime.utcnow()
                        )
                        db.add(task)
                        db.commit()
                        print(f"[Housekeeping Reconciler] Created cleaning task for Room {room.room_number}")
            except Exception as e:
                db.rollback()
                print(f"[Housekeeping Reconciler Error] DB query failed: {e}")
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Housekeeping Reconciler Error] Loop failed: {e}")
        await asyncio.sleep(2)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema before background subscriber loops query
    init_db()
    # Start background event listener
    listener_task = asyncio.create_task(redis_listener())
    # Start database reconciliation fallback loop
    reconcile_task = asyncio.create_task(reconciliation_loop())
    yield
    # Cancel background tasks
    listener_task.cancel()
    reconcile_task.cancel()
    try:
        await asyncio.gather(listener_task, reconcile_task, return_exceptions=True)
    except Exception:
        pass

app = FastAPI(
    title="HotelOS Housekeeping Service",
    version="1.0.0",
    description="Manages room cleanings and housekeeping queues.",
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

@app.get("/api/housekeeping/tasks")
def get_tasks(db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "housekeeper"]))):
    """Fetch all housekeeping tasks."""
    return db.query(HousekeepingTask).all()

@app.post("/api/housekeeping/tasks/{task_id}/start")
async def start_cleaning(task_id: int, housekeeper: str, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "housekeeper"]))):
    """Puts a room cleaning task in progress, changing status from Pending -> In Progress."""
    task = db.query(HousekeepingTask).filter(HousekeepingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Housekeeping task not found")
    
    if task.status != "Pending":
        raise HTTPException(status_code=400, detail=f"Cannot start task in state: {task.status}")
        
    room = db.query(Room).filter(Room.room_number == task.room_number).first()
    if not room:
        raise HTTPException(status_code=404, detail="Associated room not found")
        
    try:
        task.status = "In Progress"
        task.assigned_housekeeper = housekeeper
        task.started_at = datetime.utcnow()
        room.status = "Being Cleaned"
        db.commit()
        
        # Publish events
        await broker.publish_event("room.cleaning_started", {
            "room_number": room.room_number,
            "housekeeper": housekeeper,
            "started_at": task.started_at.isoformat()
        })
        await broker.publish_event("room.status_changed", {
            "room_number": room.room_number,
            "status": "Being Cleaned"
        })
        
        return {"message": "Cleaning started.", "task_id": task.id, "room_number": room.room_number}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")

@app.post("/api/housekeeping/tasks/{task_id}/complete")
async def complete_cleaning(task_id: int, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "housekeeper"]))):
    """Completes room cleaning, changing status from In Progress -> Finished. Sets clean_since."""
    task = db.query(HousekeepingTask).filter(HousekeepingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Housekeeping task not found")
        
    if task.status != "In Progress":
        raise HTTPException(status_code=400, detail=f"Cannot complete task in state: {task.status}")
        
    room = db.query(Room).filter(Room.room_number == task.room_number).first()
    if not room:
        raise HTTPException(status_code=404, detail="Associated room not found")
        
    try:
        task.status = "Finished"
        task.completed_at = datetime.utcnow()
        room.status = "Clean"
        room.clean_since = datetime.utcnow() # Reset cleanliness timer
        db.commit()
        
        # Publish events
        await broker.publish_event("room.cleaned", {
            "room_number": room.room_number
        })
        await broker.publish_event("room.status_changed", {
            "room_number": room.room_number,
            "status": "Clean"
        })
        
        return {"message": "Room is now Clean.", "task_id": task.id, "room_number": room.room_number}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")

@app.post("/api/housekeeping/tasks/room/{room_number}/dirty")
async def mark_room_dirty(room_number: int, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "housekeeper", "receptionist"]))):
    """Direct admin route to mark a room dirty and create a cleaning task."""
    room = db.query(Room).filter(Room.room_number == room_number).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    try:
        room.status = "Dirty"
        
        # Create Pending task if not existing
        existing = db.query(HousekeepingTask).filter(
            and_(
                HousekeepingTask.room_number == room_number,
                HousekeepingTask.status != "Finished"
            )
        ).first()
        
        if not existing:
            task = HousekeepingTask(
                room_number=room_number,
                status="Pending",
                created_at=datetime.utcnow()
            )
            db.add(task)
            
        db.commit()
        
        await broker.publish_event("room.status_changed", {
            "room_number": room.room_number,
            "status": "Dirty"
        })
        
        return {"message": f"Room {room_number} marked dirty."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT_HOUSEKEEPING)
