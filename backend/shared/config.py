import os

# JWT Security
JWT_SECRET = os.getenv("JWT_SECRET", "hotelos-super-secret-key-2026-univeristy-assignment")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_MINUTES = 600 # 10 hours for ease of university demonstration

# SQLite database configuration
# Using a absolute path inside the backend directory to avoid any path resolution bugs across microservices
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.path.join(BASE_DIR, "hotelos.db")
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Redis configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"

# Backend microservices ports
PORT_RECEPTION = 8001
PORT_HOUSEKEEPING = 8002
PORT_ROOM_SERVICE = 8003
PORT_MAINTENANCE = 8004
PORT_NOTIFICATION_GATEWAY = 8005

# Frontend ports
PORT_FRONTEND_OPERATIONS = 3000
PORT_FRONTEND_GUEST = 3001
PORT_FRONTEND_LANDING = 3002

# Initial Hotel Room Configuration (exactly 10 rooms)
# Floor 1:
# 101 Single
# 102 Single
# 103 Double
# 104 Double
# 105 Accessible
# Floor 2:
# 201 Single
# 202 Single
# 203 Double
# 204 Double
# 205 Suite
INITIAL_ROOMS = [
    {
        "room_number": 101,
        "room_type": "Single",
        "floor": 1,
        "nightly_rate": 100.0,
        "near_elevator": True,
        "near_stairs": False,
    },
    {
        "room_number": 102,
        "room_type": "Single",
        "floor": 1,
        "nightly_rate": 100.0,
        "near_elevator": False,
        "near_stairs": True,
    },
    {
        "room_number": 103,
        "room_type": "Double",
        "floor": 1,
        "nightly_rate": 150.0,
        "near_elevator": False,
        "near_stairs": False,
    },
    {
        "room_number": 104,
        "room_type": "Double",
        "floor": 1,
        "nightly_rate": 150.0,
        "near_elevator": False,
        "near_stairs": True,
    },
    {
        "room_number": 105,
        "room_type": "Accessible",
        "floor": 1,
        "nightly_rate": 120.0,
        "near_elevator": True,
        "near_stairs": False,
    },
    {
        "room_number": 201,
        "room_type": "Single",
        "floor": 2,
        "nightly_rate": 110.0,
        "near_elevator": True,
        "near_stairs": False,
    },
    {
        "room_number": 202,
        "room_type": "Single",
        "floor": 2,
        "nightly_rate": 110.0,
        "near_elevator": False,
        "near_stairs": True,
    },
    {
        "room_number": 203,
        "room_type": "Double",
        "floor": 2,
        "nightly_rate": 160.0,
        "near_elevator": False,
        "near_stairs": False,
    },
    {
        "room_number": 204,
        "room_type": "Double",
        "floor": 2,
        "nightly_rate": 160.0,
        "near_elevator": False,
        "near_stairs": True,
    },
    {
        "room_number": 205,
        "room_type": "Suite",
        "floor": 2,
        "nightly_rate": 300.0,
        "near_elevator": True,
        "near_stairs": False,
    },
]
