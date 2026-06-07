import heapq
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from backend.shared.config import PORT_MAINTENANCE
from backend.shared.database import get_db, SessionLocal, init_db
from backend.shared.models import Room, MaintenanceIssue
from backend.shared.schemas import MaintenanceCreate, MaintenanceAssign, MaintenanceResolve
from backend.shared.auth import verify_staff, verify_guest, verify_guest_room, verify_staff_role
from backend.shared.event_broker import broker

# In-memory priority queue using heapq as requested
# We push tuples: (priority_level, timestamp_float, issue_id)
# heapq organizes this list as a binary heap where the smallest element is at the root.
# Priority levels: Critical=1, High=2, Normal=3, Low=4.
# This structure guarantees:
# 1. Lower numerical priority level (Critical=1) is popped first.
# 2. For identical priorities, the smaller timestamp (older request) is popped first.
# 3. issue_id handles potential timestamp collisions.
maintenance_queue = []

def load_pending_issues_to_heap():
    """Initializes the in-memory heapq with Pending tickets from SQLite."""
    maintenance_queue.clear()
    db = SessionLocal()
    try:
        pending_issues = db.query(MaintenanceIssue).filter(
            MaintenanceIssue.status == "Pending"
        ).all()
        for issue in pending_issues:
            # Push tuple into heap
            heapq.heappush(
                maintenance_queue, 
                (issue.priority, issue.created_at.timestamp(), issue.id)
            )
        print(f"[Maintenance] Loaded {len(maintenance_queue)} pending issues into heapq priority queue.")
    finally:
        db.close()

app = FastAPI(
    title="HotelOS Maintenance Service",
    version="1.0.0",
    description="Manages room maintenance issues, technician queues, and priority routing."
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()
    load_pending_issues_to_heap()

async def auto_assign_technicians(db: Session):
    """Core Scheduler: Automatically assigns free technicians to the highest-priority tickets in heapq."""
    technicians = ["John", "Sarah", "Mike"]
    
    # Identify busy technicians
    busy_issues = db.query(MaintenanceIssue.assigned_technician).filter(
        MaintenanceIssue.status == "Assigned"
    ).all()
    busy_techs = {issue[0] for issue in busy_issues if issue[0]}
    
    # Determine free technicians
    free_techs = [t for t in technicians if t not in busy_techs]
    
    print(f"[Maintenance Scheduler] Free technicians: {free_techs}. Pending queue size: {len(maintenance_queue)}")
    
    while free_techs and maintenance_queue:
        # Pop highest priority ticket
        priority, ts, issue_id = heapq.heappop(maintenance_queue)
        
        issue = db.query(MaintenanceIssue).filter(MaintenanceIssue.id == issue_id).first()
        if not issue:
            continue
            
        # Verify it hasn't been assigned or resolved by a manual action in the meantime
        if issue.status == "Pending":
            assigned_tech = free_techs.pop(0)
            issue.status = "Assigned"
            issue.assigned_technician = assigned_tech
            issue.started_at = datetime.utcnow()
            db.commit()
            
            # If critical maintenance issue, mark room status to Maintenance
            if issue.priority == 1:
                room = db.query(Room).filter(Room.room_number == issue.room_number).first()
                if room:
                    room.status = "Maintenance"
                    db.commit()
                    await broker.publish_event("room.status_changed", {
                        "room_number": room.room_number,
                        "status": "Maintenance"
                    })
            
            # Publish assignment events
            payload = {
                "id": issue.id,
                "room_number": issue.room_number,
                "description": issue.description,
                "priority": issue.priority,
                "status": "Assigned",
                "assigned_technician": assigned_tech,
                "created_at": issue.created_at.isoformat(),
                "started_at": issue.started_at.isoformat()
            }
            await broker.publish_event("maintenance.assigned", payload)
            print(f"[Maintenance Scheduler] Assigned {assigned_tech} to ticket ID {issue_id} (Priority {priority})")

@app.post("/api/maintenance/issue")
async def report_issue(req: MaintenanceCreate, db: Session = Depends(get_db)):
    """API endpoint to report a new maintenance issue (accessible by guests or staff)."""
    # Verify room exists
    room = db.query(Room).filter(Room.room_number == req.room_number).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    priority_map = {
        "Critical": 1,
        "High": 2,
        "Normal": 3,
        "Low": 4
    }
    priority_val = priority_map.get(req.urgency_level, 3)
    
    try:
        issue = MaintenanceIssue(
            room_number=req.room_number,
            guest_id=req.guest_id,
            description=req.description,
            priority=priority_val,
            status="Pending",
            before_photo=req.before_photo,
            created_at=datetime.utcnow()
        )
        db.add(issue)
        db.commit()
        db.refresh(issue)
        
        # Push into heap priority queue
        heapq.heappush(
            maintenance_queue,
            (priority_val, issue.created_at.timestamp(), issue.id)
        )
        
        # Publish event
        await broker.publish_event("maintenance.created", {
            "id": issue.id,
            "room_number": issue.room_number,
            "guest_id": issue.guest_id,
            "description": issue.description,
            "priority": priority_val,
            "status": "Pending",
            "before_photo": issue.before_photo,
            "created_at": issue.created_at.isoformat()
        })
        
        # Run scheduler to auto-assign technicians
        await auto_assign_technicians(db)
        
        return {
            "message": "Maintenance issue reported.",
            "issue_id": issue.id,
            "priority": priority_val,
            "status": issue.status,
            "assigned_technician": issue.assigned_technician
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database transaction failed: {str(e)}")

@app.get("/api/maintenance/issues")
def get_issues(db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "maintenance"]))):
    """Fetch all maintenance tickets (for Staff Portal)."""
    return db.query(MaintenanceIssue).all()

@app.get("/api/maintenance/room/{room_number}/issues")
def get_room_issues(room_number: int, db: Session = Depends(get_db), current_user = Depends(verify_guest)):
    """Fetch maintenance tickets for a specific room (for Guest Portal). Enforces guest isolation."""
    verify_guest_room(room_number, current_user)
    guest_id = current_user.get("guest_id")
    return db.query(MaintenanceIssue).filter(
        and_(
            MaintenanceIssue.room_number == room_number,
            MaintenanceIssue.guest_id == guest_id
        )
    ).all()

@app.get("/api/maintenance/queue")
def get_queue(current_user = Depends(verify_staff_role(["super_admin", "maintenance"]))):
    """Returns the in-memory heapq queue structure in ordered fashion."""
    # Convert heap list to sorted copy
    sorted_heap = sorted(maintenance_queue)
    return [{"priority": item[0], "timestamp": item[1], "issue_id": item[2]} for item in sorted_heap]

@app.post("/api/maintenance/issues/{issue_id}/resolve")
async def resolve_issue(issue_id: int, req: Optional[MaintenanceResolve] = None, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "maintenance"]))):
    """Resolves an active issue, freeing the technician and triggering the scheduler to process the queue."""
    issue = db.query(MaintenanceIssue).filter(MaintenanceIssue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")
        
    if issue.status != "Assigned":
        raise HTTPException(status_code=400, detail=f"Cannot resolve ticket in state: {issue.status}")
        
    try:
        issue.status = "Resolved"
        issue.resolved_at = datetime.utcnow()
        if req and req.after_photo:
            issue.after_photo = req.after_photo
            
        # If room was put in maintenance status, revert room status to Dirty (requires cleaning next)
        room = db.query(Room).filter(Room.room_number == issue.room_number).first()
        if room and room.status == "Maintenance":
            room.status = "Dirty"
            await broker.publish_event("room.status_changed", {
                "room_number": room.room_number,
                "status": "Dirty"
            })
            
        db.commit()
        db.refresh(issue)
        
        # Publish event
        await broker.publish_event("maintenance.resolved", {
            "id": issue.id,
            "room_number": issue.room_number,
            "assigned_technician": issue.assigned_technician,
            "status": "Resolved",
            "after_photo": issue.after_photo,
            "resolved_at": issue.resolved_at.isoformat()
        })
        
        print(f"[Maintenance] Ticket {issue_id} resolved by {issue.assigned_technician}.")
        
        # Run scheduler to assign the newly freed technician to the next pending ticket
        await auto_assign_technicians(db)
        
        return {"message": "Issue marked resolved. Technician is now available."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT_MAINTENANCE)
