import json
from collections import deque
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from backend.shared.config import PORT_ROOM_SERVICE
from backend.shared.database import get_db, SessionLocal, init_db
from backend.shared.models import Room, Guest, RoomServiceOrder
from backend.shared.schemas import RoomServiceCreate, RoomServiceUpdateStatus
from backend.shared.auth import verify_staff, verify_guest, verify_guest_room, verify_staff_role
from backend.shared.event_broker import broker

# In-memory queue using collections.deque as requested
# We use collections.deque because it provides O(1) double-ended queue operations (appends and pops from both sides),
# making it the optimal choice for a First-In-First-Out (FIFO) kitchen order processing pipeline.
order_queue = deque()

def load_active_orders_to_queue():
    """Initializes the in-memory collections.deque with active orders from SQLite."""
    order_queue.clear()
    db = SessionLocal()
    try:
        active_orders = db.query(RoomServiceOrder).filter(
            RoomServiceOrder.status.in_(["Received", "Preparing", "Out For Delivery"])
        ).order_by(RoomServiceOrder.created_at.asc()).all()
        
        for order in active_orders:
            order_queue.append({
                "id": order.id,
                "room_number": order.room_number,
                "guest_id": order.guest_id,
                "items": json.loads(order.items),
                "total_price": order.total_price,
                "status": order.status,
                "created_at": order.created_at.isoformat()
            })
        print(f"[Room Service] Loaded {len(order_queue)} active orders into collections.deque.")
    finally:
        db.close()

app = FastAPI(
    title="HotelOS Room Service",
    version="1.0.0",
    description="Manages food and beverage ordering queues."
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
    load_active_orders_to_queue()

@app.post("/api/room-service/order")
async def place_order(req: RoomServiceCreate, db: Session = Depends(get_db), current_user = Depends(verify_guest)):
    """Places a room service order from the Guest Portal. Authenticated guests only."""
    # Ensure guest is checking in their own room number
    verify_guest_room(req.room_number, current_user)
    
    # Verify room is occupied
    room = db.query(Room).filter(Room.room_number == req.room_number).first()
    if not room or room.status != "Occupied":
        raise HTTPException(status_code=400, detail="Room is not currently occupied.")
        
    # Verify guest exists
    guest = db.query(Guest).filter(and_(Guest.id == req.guest_id, Guest.status == "CheckedIn")).first()
    if not guest:
        raise HTTPException(status_code=400, detail="Guest is not checked in.")
        
    try:
        # Calculate totals
        items_list = []
        total_price = 0.0
        for item in req.items:
            items_list.append({
                "name": item.name,
                "quantity": item.quantity,
                "price": item.price
            })
            total_price += item.price * item.quantity
            
        # Create Order in SQLite
        order = RoomServiceOrder(
            room_number=req.room_number,
            guest_id=req.guest_id,
            items=json.dumps(items_list),
            total_price=total_price,
            status="Received",
            created_at=datetime.utcnow()
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        
        # Add to in-memory collections.deque
        order_dict = {
            "id": order.id,
            "room_number": order.room_number,
            "guest_id": order.guest_id,
            "items": items_list,
            "total_price": total_price,
            "status": "Received",
            "created_at": order.created_at.isoformat()
        }
        order_queue.append(order_dict)
        
        # Publish event
        await broker.publish_event("room_service.created", order_dict)
        
        return {"message": "Order placed successfully.", "order_id": order.id, "total": total_price}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")

@app.get("/api/room-service/orders")
def get_orders(db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "kitchen_service"]))):
    """Fetch all room service orders (for Staff Portal)."""
    orders = db.query(RoomServiceOrder).all()
    return [
        {
            "id": o.id,
            "room_number": o.room_number,
            "guest_id": o.guest_id,
            "items": json.loads(o.items) if isinstance(o.items, str) else o.items,
            "total_price": o.total_price,
            "status": o.status,
            "created_at": o.created_at
        }
        for o in orders
    ]

@app.get("/api/room-service/queue")
def get_queue(current_user = Depends(verify_staff_role(["super_admin", "kitchen_service"]))):
    """Returns the in-memory FIFO queue (collections.deque) of active orders."""
    return list(order_queue)

@app.get("/api/room-service/guest/orders")
def get_guest_orders(room_number: int, db: Session = Depends(get_db), current_user = Depends(verify_guest)):
    """Fetch orders for a specific room (for Guest Portal). Enforces isolation."""
    verify_guest_room(room_number, current_user)
    orders = db.query(RoomServiceOrder).filter(RoomServiceOrder.room_number == room_number).all()
    return [
        {
            "id": o.id,
            "room_number": o.room_number,
            "guest_id": o.guest_id,
            "items": json.loads(o.items) if isinstance(o.items, str) else o.items,
            "total_price": o.total_price,
            "status": o.status,
            "created_at": o.created_at
        }
        for o in orders
    ]

@app.post("/api/room-service/orders/{order_id}/status")
async def update_order_status(order_id: int, req: RoomServiceUpdateStatus, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "kitchen_service"]))):
    """Updates order status: Received -> Preparing -> Out For Delivery -> Delivered."""
    order = db.query(RoomServiceOrder).filter(RoomServiceOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    try:
        old_status = order.status
        order.status = req.status
        db.commit()
        db.refresh(order)
        
        # Sync with in-memory collections.deque
        if req.status == "Delivered":
            # Remove from active queue if delivered ( kitchen completed )
            # Linear scan and remove (since deque is small in this mock environment)
            for idx, item in enumerate(order_queue):
                if item["id"] == order_id:
                    order_queue.remove(item)
                    break
        else:
            # Update status in the queue
            for item in order_queue:
                if item["id"] == order_id:
                    item["status"] = req.status
                    break
                    
        # Publish event
        order_dict = {
            "id": order.id,
            "room_number": order.room_number,
            "guest_id": order.guest_id,
            "items": json.loads(order.items),
            "total_price": order.total_price,
            "status": order.status,
            "created_at": order.created_at.isoformat()
        }
        await broker.publish_event("room_service.updated", order_dict)
        
        return {"message": f"Order status updated from {old_status} to {req.status}."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT_ROOM_SERVICE)
