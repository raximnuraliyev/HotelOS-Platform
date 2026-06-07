import asyncio
import uuid
import json
from datetime import datetime, timedelta
from typing import List
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_

from backend.shared.config import PORT_RECEPTION
from backend.shared.database import get_db, init_db
from backend.shared.models import Room, Guest, Booking, RoomServiceOrder, BillingRecord, AuditLog, StaffMember
from backend.shared.schemas import CheckInRequest, CheckOutRequest, LoginRequest, GuestSchema, RoomSchema, StaffCreate, StaffResponse
from backend.shared.auth import create_access_token, verify_staff, verify_guest, verify_staff_role
from backend.shared.event_broker import broker

app = FastAPI(
    title="HotelOS Reception Service",
    version="1.0.0",
    description="Manages check-ins, check-outs, room assignments, and billing."
)

# Enable CORS for frontend portals
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Python in-memory lock for room assignment (Step 6 fallback)
assignment_lock = asyncio.Lock()

# Initialize DB on startup
@app.on_event("startup")
def startup_event():
    init_db()

@app.post("/api/reception/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Staff Login Endpoint. Authenticates against StaffMember table."""
    staff = db.query(StaffMember).filter(StaffMember.username == req.username).first()
    if staff and staff.password == req.password:
        token = create_access_token({"sub": staff.username, "role": "admin", "staff_role": staff.role})
        return {
            "access_token": token,
            "token_type": "bearer",
            "staff_role": staff.role,
            "username": staff.username
        }
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials. Staff credentials only."
    )

# --- STAFF MANAGEMENT (SUPER ADMIN ONLY) ---
@app.post("/api/reception/staff", response_model=StaffResponse)
def create_staff(req: StaffCreate, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin"]))):
    """Creates a new staff member. Super Admin only."""
    existing = db.query(StaffMember).filter(StaffMember.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    try:
        staff = StaffMember(
            username=req.username,
            password=req.password,
            role=req.role
        )
        db.add(staff)
        db.commit()
        db.refresh(staff)
        return staff
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")

@app.get("/api/reception/staff", response_model=List[StaffResponse])
def list_staff(db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin"]))):
    """Lists all staff members. Super Admin only."""
    return db.query(StaffMember).all()

@app.delete("/api/reception/staff/{staff_id}")
def delete_staff(staff_id: int, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin"]))):
    """Deletes a staff member. Super Admin only."""
    staff = db.query(StaffMember).filter(StaffMember.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if staff.username == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete default super admin 'admin'")
    try:
        db.delete(staff)
        db.commit()
        return {"message": "Staff member deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database deletion failed: {str(e)}")

@app.post("/api/reception/guest/login")
async def guest_login(room_number: int, guest_name: str, db: Session = Depends(get_db)):
    """Guest Portal Login. Requires Room Number and Guest Name."""
    guest = db.query(Guest).filter(
        and_(
            Guest.room_number == room_number,
            Guest.name == guest_name,
            Guest.status == "CheckedIn"
        )
    ).first()
    
    if not guest:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Active guest booking not found for this room number and name."
        )
        
    token = create_access_token({
        "sub": guest.name,
        "role": "guest",
        "guest_id": guest.id,
        "room_number": guest.room_number
    })
    return {"access_token": token, "token_type": "bearer", "guest_id": guest.id, "reservation_code": guest.reservation_code}

@app.post("/api/reception/guest/login/code")
async def guest_login_code(code: str, db: Session = Depends(get_db)):
    """Guest Portal Login by Reservation/Booking Code."""
    guest = db.query(Guest).filter(
        and_(
            Guest.reservation_code == code,
            Guest.status == "CheckedIn"
        )
    ).first()
    
    if not guest:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Active guest booking not found for this reservation code."
        )
        
    token = create_access_token({
        "sub": guest.name,
        "role": "guest",
        "guest_id": guest.id,
        "room_number": guest.room_number
    })
    return {
        "access_token": token,
        "token_type": "bearer",
        "room_number": guest.room_number,
        "guest_name": guest.name,
        "guest_id": guest.id,
        "reservation_code": guest.reservation_code
    }

# --- CRITICAL ALGORITHM 1: ROOM ASSIGNMENT ---
async def assign_room(req: CheckInRequest, db: Session) -> Room:
    """Executes the 6-step Room Assignment Algorithm.
    Ensures optimal room selection and absolute protection against double bookings.
    """
    # Try using Redis lock if available, fallback to python asyncio Lock
    redis_locked = False
    lock = None
    try:
        r = await broker.get_redis()
        # Create a simple distributed lock using Redis with a 5 second lease time
        lock_id = str(uuid.uuid4())
        # Try to acquire lock
        for _ in range(50): # Retry for up to 5 seconds
            if await r.set("lock:room_assignment", lock_id, nx=True, ex=5):
                redis_locked = True
                break
            await asyncio.sleep(0.1)
        if not redis_locked:
            print("[Warning] Redis assignment lock acquisition timed out. Falling back to asyncio lock.")
    except Exception as e:
        print(f"[Warning] Redis lock exception: {e}. Falling back to asyncio lock.")

    if not redis_locked:
        # Fallback to local python process lock
        await assignment_lock.acquire()

    try:
        # STEP 1: Find rooms matching requested room type
        # STEP 2: Exclude Dirty, Being Cleaned, Occupied, Maintenance (Only Clean remains)
        rooms_query = db.query(Room).filter(
            and_(
                Room.room_type == req.room_type,
                Room.status == "Clean"
            )
        ).all()

        if not rooms_query:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No Clean rooms of type '{req.room_type}' are currently available."
            )

        # In-memory Room Inventory List: list[Room]
        # We perform the sorting in python memory to allow complex multi-key heuristics
        eligible_rooms = list(rooms_query)

        # STEP 3: Sort by clean_since timestamp (FIFO - room clean longest selected first)
        eligible_rooms.sort(key=lambda r: r.clean_since)

        # STEP 4: Apply floor preference
        if req.floor_preference is not None:
            floor_matches = [r for r in eligible_rooms if r.floor == req.floor_preference]
            if floor_matches:
                eligible_rooms = floor_matches
            # If no room available on that floor, we fall back to any eligible floor (as per rules)

        # STEP 5: Apply proximity preference (Final Tiebreaker)
        if req.proximity_preference == "Near Elevator":
            # Preferred rooms with near_elevator == True
            eligible_rooms.sort(key=lambda r: 0 if r.near_elevator else 1)
        elif req.proximity_preference == "Near Stairs":
            # Preferred rooms with near_stairs == True
            eligible_rooms.sort(key=lambda r: 0 if r.near_stairs else 1)
        elif req.proximity_preference == "Away From Elevator":
            # Preferred rooms with near_elevator == False
            eligible_rooms.sort(key=lambda r: 0 if not r.near_elevator else 1)

        # Select the top room from the sorted list
        assigned = eligible_rooms[0]

        # STEP 6: Mark room occupied and save within transaction
        assigned.status = "Occupied"
        db.commit()
        db.refresh(assigned)
        return assigned

    finally:
        # Release locks
        if redis_locked:
            try:
                r = await broker.get_redis()
                # Verify lock matches lock_id before deleting to prevent releasing other locks
                if await r.get("lock:room_assignment") == lock_id:
                    await r.delete("lock:room_assignment")
            except Exception as e:
                print(f"[Error] Failed to release Redis lock: {e}")
        else:
            assignment_lock.release()

@app.post("/api/reception/checkin")
async def check_in(req: CheckInRequest, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "receptionist"]))):
    """Handles Check-In process. Assigns room and publishes guest.checked_in event."""
    try:
        # Assign Room
        room = await assign_room(req, db)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred during room assignment: {str(e)}"
        )

    try:
        # Create Guest Record
        reservation_code = f"RES-{uuid.uuid4().hex[:6].upper()}"
        guest = Guest(
            name=req.guest_name,
            reservation_code=reservation_code,
            room_number=room.room_number,
            status="CheckedIn"
        )
        db.add(guest)
        db.commit()
        db.refresh(guest)

        # Create Booking
        booking = Booking(
            guest_id=guest.id,
            room_number=room.room_number,
            check_in_time=datetime.utcnow(),
            nights=req.nights,
            status="Active"
        )
        db.add(booking)
        db.commit()
        db.refresh(booking)

        # Publish check-in event to Redis
        payload = {
            "guest_id": guest.id,
            "guest_name": guest.name,
            "reservation_code": guest.reservation_code,
            "room_number": room.room_number,
            "nights": req.nights,
            "room_type": room.room_type,
            "rate": room.nightly_rate
        }
        await broker.publish_event("guest.checked_in", payload)
        await broker.publish_event("room.status_changed", {"room_number": room.room_number, "status": "Occupied"})

        return {
            "message": "Guest checked in successfully.",
            "guest": {
                "id": guest.id,
                "name": guest.name,
                "reservation_code": guest.reservation_code
            },
            "room_number": room.room_number,
            "booking_id": booking.id
        }
    except Exception as e:
        db.rollback()
        # Reset room status if check-in database writes failed
        room.status = "Clean"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal database failure during check-in: {str(e)}"
        )

# --- CRITICAL ALGORITHM 2: BILLING CALCULATION ---
def calculate_bill(
    room_rate: float, 
    nights: int, 
    orders_total: float, 
    minibar: float, 
    late_checkout_hours: int,
    discount_type: str,
    discount_value: float,
    orders: list = None
) -> dict:
    """Performs checkout billing calculation.
    Handles early checkout, late checkouts, zero charges, and flat/percentage discounts.
    """
    # 1. Base Room Charges
    room_charges = room_rate * nights
    
    # 2. Late checkout fee ($20 per hour)
    late_checkout_fees = late_checkout_hours * 20.0
    
    # 3. Subtotal
    subtotal = room_charges + orders_total + minibar + late_checkout_fees
    
    # 4. Calculate discount
    discount = 0.0
    if discount_type == "percentage":
        discount = subtotal * (discount_value / 100.0)
    elif discount_type == "fixed":
        discount = discount_value
        
    # Clamp discount to subtotal
    discount = min(discount, subtotal)
    
    # 5. Tax (10% standard rate on subtotal after discount)
    taxable_amount = max(subtotal - discount, 0.0)
    tax = taxable_amount * 0.10
    
    # 6. Grand total
    grand_total = taxable_amount + tax
    
    # Create itemized receipt text
    rs_details = ""
    if orders:
        rs_details = "Room Service Items Ordered:\n"
        for order in orders:
            try:
                items = json.loads(order.items) if isinstance(order.items, str) else order.items
                for item in items:
                    rs_details += f"  - {item['quantity']}x {item['name']} @ ${item['price']:.2f} = ${item['quantity'] * item['price']:.2f}\n"
            except Exception as e:
                print(f"[Error] Failed to format order items in receipt: {e}")
    else:
        rs_details = f"Room Service Orders: ${orders_total:.2f}\n"

    itemized = (
        f"--- HOTELOS BILLING RECEIPT ---\n"
        f"Room Charges: {nights} nights @ ${room_rate:.2f}/night = ${room_charges:.2f}\n"
        f"{rs_details}"
        f"Minibar Charges: ${minibar:.2f}\n"
        f"Late Checkout Fees ({late_checkout_hours} hrs @ $20.00/hr): ${late_checkout_fees:.2f}\n"
        f"---------------------------------\n"
        f"Subtotal: ${subtotal:.2f}\n"
        f"Discount ({discount_type} {discount_value}): -${discount:.2f}\n"
        f"Tax (10% VAT): ${tax:.2f}\n"
        f"---------------------------------\n"
        f"GRAND TOTAL: ${grand_total:.2f}\n"
    )
    
    return {
        "room_charges": room_charges,
        "room_service_charges": orders_total,
        "minibar_charges": minibar,
        "late_checkout_fees": late_checkout_fees,
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "grand_total": grand_total,
        "itemized_bill": itemized,
        "nights": nights
    }

@app.get("/api/reception/checkout/preview")
async def checkout_preview(room_number: int, late_checkout_hours: int = 0, minibar_charges: float = 0.0, discount_type: str = "none", discount_value: float = 0.0, db: Session = Depends(get_db)):
    """Computes a preview of the guest's checkout bill without executing checkout."""
    guest = db.query(Guest).filter(
        and_(
            Guest.room_number == room_number,
            Guest.status == "CheckedIn"
        )
    ).first()
    
    if not guest:
        raise HTTPException(status_code=404, detail=f"No checked-in guest found in room {room_number}")
        
    booking = db.query(Booking).filter(
        and_(
            Booking.guest_id == guest.id,
            Booking.status == "Active"
        )
    ).first()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Active booking not found for this guest")
        
    room = db.query(Room).filter(Room.room_number == room_number).first()
    
    # Calculate stay duration
    check_in_time = booking.check_in_time
    duration = datetime.utcnow() - check_in_time
    # Handled: early checkout (minimum 1 night)
    actual_nights = max(duration.days, 1)
    # Clamp to at least 1, but if booked for less nights, we charge actual_nights or booking.nights.
    # In simple simulation, we charge actual_nights or booking.nights, whichever is larger or actual. Let's use booking.nights.
    # If checking out early, we charge actual_nights (Early Checkout logic). Let's use max(actual_nights, 1).
    # If they stay less than a day, they pay 1 night. If they stay 3 days, they pay 3 nights.
    nights_charged = min(actual_nights, booking.nights)
    
    # Fetch room service charges (include all placed orders to keep invoice details dynamic)
    orders = db.query(RoomServiceOrder).filter(
        and_(
            RoomServiceOrder.room_number == room_number,
            RoomServiceOrder.guest_id == guest.id
        )
    ).all()
    orders_total = sum(order.total_price for order in orders)
    
    billing_data = calculate_bill(
        room_rate=room.nightly_rate,
        nights=nights_charged,
        orders_total=orders_total,
        minibar=minibar_charges,
        late_checkout_hours=late_checkout_hours,
        discount_type=discount_type,
        discount_value=discount_value,
        orders=orders
    )
    
    return billing_data

@app.post("/api/reception/checkout")
async def check_out(req: CheckOutRequest, db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin", "receptionist"]))):
    """Executes Checkout process. Persists billing record, vacates room, and publishes events."""
    guest = db.query(Guest).filter(
        and_(
            Guest.room_number == req.room_number,
            Guest.status == "CheckedIn"
        )
    ).first()
    
    if not guest:
        raise HTTPException(status_code=404, detail=f"No checked-in guest found in room {req.room_number}")
        
    booking = db.query(Booking).filter(
        and_(
            Booking.guest_id == guest.id,
            Booking.status == "Active"
        )
    ).first()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Active booking not found for this guest")
        
    room = db.query(Room).filter(Room.room_number == req.room_number).first()

    # Calculate actual stay nights (Early Checkout logic)
    duration = datetime.utcnow() - booking.check_in_time
    actual_nights = max(duration.days, 1)
    nights_charged = min(actual_nights, booking.nights)
    
    # Retrieve room service orders (include all placed orders to keep invoice details dynamic)
    orders = db.query(RoomServiceOrder).filter(
        and_(
            RoomServiceOrder.room_number == req.room_number,
            RoomServiceOrder.guest_id == guest.id
        )
    ).all()
    orders_total = sum(order.total_price for order in orders)
    
    # Run Critical Algorithm 2
    billing_data = calculate_bill(
        room_rate=room.nightly_rate,
        nights=nights_charged,
        orders_total=orders_total,
        minibar=req.minibar_charges,
        late_checkout_hours=req.late_checkout_hours,
        discount_type=req.discount_type,
        discount_value=req.discount_value,
        orders=orders
    )
    
    try:
        # Create Billing Record
        bill = BillingRecord(
            guest_id=guest.id,
            room_number=room.room_number,
            room_charges=billing_data["room_charges"],
            room_service_charges=billing_data["room_service_charges"],
            minibar_charges=billing_data["minibar_charges"],
            late_checkout_fees=billing_data["late_checkout_fees"],
            discount=billing_data["discount"],
            tax=billing_data["tax"],
            grand_total=billing_data["grand_total"],
            itemized_bill=billing_data["itemized_bill"]
        )
        db.add(bill)
        
        # Complete booking and guest records
        booking.status = "Completed"
        booking.check_out_time = datetime.utcnow()
        guest.status = "CheckedOut"
        guest.room_number = None # Vacate guest from room model
        
        # Update Room status to Dirty on Checkout
        room.status = "Dirty"
        db.commit()

        # Publish Events
        # guest.checked_out
        await broker.publish_event("guest.checked_out", {
            "guest_id": guest.id,
            "guest_name": guest.name,
            "room_number": room.room_number,
            "grand_total": billing_data["grand_total"]
        })
        
        # room.vacated
        await broker.publish_event("room.vacated", {
            "room_number": room.room_number,
            "guest_id": guest.id
        })
        
        # room.status_changed
        await broker.publish_event("room.status_changed", {
            "room_number": room.room_number,
            "status": "Dirty"
        })

        return {
            "message": "Checkout completed successfully.",
            "billing": billing_data
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database transaction failure during checkout: {str(e)}"
        )

# Query Endpoints
@app.get("/api/reception/rooms", response_model=List[RoomSchema])
def get_rooms(db: Session = Depends(get_db)):
    """Fetch all room information."""
    return db.query(Room).all()

@app.get("/api/reception/guests", response_model=List[GuestSchema])
def get_guests(db: Session = Depends(get_db)):
    """Fetch all guest information."""
    return db.query(Guest).all()

@app.get("/api/reception/audit-logs")
def get_audit_logs(db: Session = Depends(get_db), current_user = Depends(verify_staff_role(["super_admin"]))):
    """Fetch all system audit logs for administrative view."""
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(100).all()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT_RECEPTION)
