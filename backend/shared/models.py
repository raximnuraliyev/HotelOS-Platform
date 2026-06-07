from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Room(Base):
    __tablename__ = "rooms"

    # We use list[Room] in memory for inventory management in microservices logic.
    # A list is chosen because the total rooms are exactly 10, meaning O(N) linear scanning
    # is extremely fast, avoids hashing overhead, and allows sorting and sequential tie-breakers in-memory.
    room_number = Column(Integer, primary_key=True)
    room_type = Column(String(50), nullable=False) # Single, Double, Accessible, Suite
    floor = Column(Integer, nullable=False)
    status = Column(String(50), default="Clean", nullable=False) # Clean, Dirty, Being Cleaned, Occupied, Maintenance
    nightly_rate = Column(Float, nullable=False)
    clean_since = Column(DateTime, default=datetime.utcnow, nullable=False)
    near_elevator = Column(Boolean, default=False, nullable=False)
    near_stairs = Column(Boolean, default=False, nullable=False)

    bookings = relationship("Booking", back_populates="room")

class Guest(Base):
    __tablename__ = "guests"

    # We use dict[int, Guest] in memory for guest records to allow O(1) direct lookup
    # by guest ID, which is the most frequent access pattern when validating guest sessions
    # or updating room service and billing records.
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    reservation_code = Column(String(50), unique=True, index=True, nullable=False)
    room_number = Column(Integer, ForeignKey("rooms.room_number"), nullable=True)
    status = Column(String(50), default="Reserved", nullable=False) # Reserved, CheckedIn, CheckedOut

    bookings = relationship("Booking", back_populates="guest")

class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=False)
    room_number = Column(Integer, ForeignKey("rooms.room_number"), nullable=False)
    check_in_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    check_out_time = Column(DateTime, nullable=True)
    nights = Column(Integer, nullable=False)
    status = Column(String(50), default="Active", nullable=False) # Active, Completed

    guest = relationship("Guest", back_populates="bookings")
    room = relationship("Room", back_populates="bookings")

class RoomServiceOrder(Base):
    __tablename__ = "room_service_orders"

    # We use collections.deque in memory to queue room service orders in FIFO (First-In-First-Out)
    # fashion. This provides O(1) time complexity for both left-pops (dispatching oldest orders)
    # and right-appends (adding new orders).
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_number = Column(Integer, nullable=False)
    guest_id = Column(Integer, nullable=False)
    items = Column(Text, nullable=False) # JSON encoded string, e.g. [{"name": "Coffee", "quantity": 2, "price": 5.0}]
    total_price = Column(Float, nullable=False)
    status = Column(String(50), default="Received", nullable=False) # Received, Preparing, Out For Delivery, Delivered
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class MaintenanceIssue(Base):
    __tablename__ = "maintenance_issues"

    # We use a priority queue (heapq) in memory for active maintenance tickets.
    # heapq allows O(log N) push and O(1) extraction of the highest-priority element,
    # sorting by (priority, timestamp, task_id) to ensure Critical tickets are resolved first,
    # and tie-breaks are resolved by the oldest timestamp.
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_number = Column(Integer, nullable=False)
    guest_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False) # Critical=1, High=2, Normal=3, Low=4
    status = Column(String(50), default="Pending", nullable=False) # Pending, Assigned, Resolved
    assigned_technician = Column(String(100), nullable=True) # John, Sarah, Mike
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    before_photo = Column(Text, nullable=True)
    after_photo = Column(Text, nullable=True)

class HousekeepingTask(Base):
    __tablename__ = "housekeeping_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_number = Column(Integer, nullable=False)
    status = Column(String(50), default="Pending", nullable=False) # Pending, In Progress, Finished
    assigned_housekeeper = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

class BillingRecord(Base):
    __tablename__ = "billing_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guest_id = Column(Integer, nullable=False)
    room_number = Column(Integer, nullable=False)
    room_charges = Column(Float, nullable=False)
    room_service_charges = Column(Float, nullable=False)
    minibar_charges = Column(Float, nullable=False)
    late_checkout_fees = Column(Float, nullable=False)
    discount = Column(Float, default=0.0, nullable=False)
    tax = Column(Float, nullable=False)
    grand_total = Column(Float, nullable=False)
    itemized_bill = Column(Text, nullable=False) # Text formatted details of billing calculation
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    service = Column(String(100), nullable=False) # reception, housekeeping, etc.
    event_type = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    payload = Column(Text, nullable=False) # JSON string of full payload

class StaffMember(Base):
    __tablename__ = "staff_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password = Column(String(100), nullable=False)
    role = Column(String(50), nullable=False) # super_admin, receptionist, housekeeper, maintenance, kitchen_service
