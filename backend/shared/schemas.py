from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime

# Helper models
class OrderItemSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    quantity: int = Field(..., gt=0, lt=100)
    price: float = Field(..., ge=0.0)

# Input schemas
class CheckInRequest(BaseModel):
    guest_name: str = Field(..., min_length=2, max_length=100)
    room_type: str = Field(..., pattern="^(Single|Double|Accessible|Suite)$")
    floor_preference: Optional[int] = Field(None, ge=1, le=2)
    proximity_preference: Optional[str] = Field(None, pattern="^(Near Elevator|Near Stairs|Away From Elevator|None)$")
    nights: int = Field(..., gt=0, le=30)

    @field_validator('guest_name')
    @classmethod
    def validate_guest_name(cls, v: str) -> str:
        # Prevent HTML injection or empty/space names
        clean = v.strip()
        if not clean or any(char in clean for char in "<>\"'/\\;"):
            raise ValueError("Invalid characters in guest name")
        return clean

class CheckOutRequest(BaseModel):
    room_number: int = Field(..., ge=101, le=205)
    late_checkout_hours: int = Field(0, ge=0, le=12)
    minibar_charges: float = Field(0.0, ge=0.0, le=1000.0)
    discount_type: str = Field("none", pattern="^(none|fixed|percentage)$")
    discount_value: float = Field(0.0, ge=0.0)

    @field_validator('discount_value')
    @classmethod
    def validate_discount(cls, v: float, info) -> float:
        d_type = info.data.get('discount_type')
        if d_type == 'percentage' and v > 100.0:
            raise ValueError("Percentage discount cannot exceed 100%")
        elif d_type == 'fixed' and v > 5000.0:
            raise ValueError("Fixed discount cannot exceed $5000")
        return v

class RoomServiceCreate(BaseModel):
    room_number: int = Field(..., ge=101, le=205)
    guest_id: int = Field(..., gt=0)
    items: List[OrderItemSchema] = Field(..., min_length=1)

class RoomServiceUpdateStatus(BaseModel):
    status: str = Field(..., pattern="^(Received|Preparing|Out For Delivery|Delivered)$")

class MaintenanceCreate(BaseModel):
    room_number: int = Field(..., ge=101, le=205)
    description: str = Field(..., min_length=5, max_length=500)
    urgency_level: str = Field(..., pattern="^(Critical|High|Normal|Low)$")
    guest_id: Optional[int] = None
    before_photo: Optional[str] = None

    @field_validator('description')
    @classmethod
    def validate_desc(cls, v: str) -> str:
        clean = v.strip()
        if not clean or any(char in clean for char in "<>\"'\\"):
            raise ValueError("Invalid characters in description")
        return clean

class MaintenanceAssign(BaseModel):
    technician: str = Field(..., pattern="^(John|Sarah|Mike)$")

class MaintenanceResolve(BaseModel):
    after_photo: Optional[str] = None

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=50)

class StaffCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=50)
    role: str = Field(..., pattern="^(super_admin|receptionist|housekeeper|maintenance|kitchen_service)$")

class StaffResponse(BaseModel):
    id: int
    username: str
    role: str

    class Config:
        from_attributes = True

# Output / Response schemas
class RoomSchema(BaseModel):
    room_number: int
    room_type: str
    floor: int
    status: str
    nightly_rate: float
    clean_since: datetime
    near_elevator: bool
    near_stairs: bool

    class Config:
        from_attributes = True

class GuestSchema(BaseModel):
    id: int
    name: str
    reservation_code: str
    room_number: Optional[int]
    status: str

    class Config:
        from_attributes = True

class BookingSchema(BaseModel):
    id: int
    guest_id: int
    room_number: int
    check_in_time: datetime
    check_out_time: Optional[datetime]
    nights: int
    status: str

    class Config:
        from_attributes = True

class AuditLogSchema(BaseModel):
    id: int
    timestamp: datetime
    service: str
    event_type: str
    message: str
    payload: str

    class Config:
        from_attributes = True
