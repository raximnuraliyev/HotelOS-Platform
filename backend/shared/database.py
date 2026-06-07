from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from backend.shared.config import DATABASE_URL, INITIAL_ROOMS
from backend.shared.models import Base, Room, StaffMember

# Create SQLite engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} # Required for SQLite multi-threaded/async access
)

# Enable WAL (Write-Ahead Logging) and Normal synchronous mode for SQLite
# This is a critical production-grade performance optimization for concurrent reads/writes
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000") # 5 seconds busy timeout
    cursor.close()

# Session factories
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Database session generator to be used in FastAPI Dependency Injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initializes tables and seeds the exactly 10 rooms if they do not exist."""
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Check if rooms are already seeded
        room_count = db.query(Room).count()
        if room_count == 0:
            print("Seeding initial 10-room configuration...")
            for r_data in INITIAL_ROOMS:
                room = Room(
                    room_number=r_data["room_number"],
                    room_type=r_data["room_type"],
                    floor=r_data["floor"],
                    status="Clean",
                    nightly_rate=r_data["nightly_rate"],
                    near_elevator=r_data["near_elevator"],
                    near_stairs=r_data["near_stairs"]
                )
                db.add(room)
            db.commit()
            print("Successfully seeded rooms!")
        # Check if staff members are seeded
        staff_count = db.query(StaffMember).count()
        if staff_count == 0:
            print("Seeding initial staff member accounts...")
            initial_staff = [
                {"username": "admin", "password": "hotelos123", "role": "super_admin"},
                {"username": "recep1", "password": "hotelos123", "role": "receptionist"},
                {"username": "house1", "password": "hotelos123", "role": "housekeeper"},
                {"username": "tech1", "password": "hotelos123", "role": "maintenance"},
                {"username": "chef1", "password": "hotelos123", "role": "kitchen_service"}
            ]
            for s_data in initial_staff:
                staff = StaffMember(
                    username=s_data["username"],
                    password=s_data["password"],
                    role=s_data["role"]
                )
                db.add(staff)
            db.commit()
            print("Successfully seeded staff members!")
        else:
            print(f"Database already contains {staff_count} staff members. Skipping seeder.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
