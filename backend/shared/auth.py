import jwt
from datetime import datetime, timedelta
from fastapi import HTTPException, Security, status, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Dict, Any, Optional
from backend.shared.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_MINUTES

# Bearer token schemes
security_bearer = HTTPBearer()

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generates a JWT access token containing custom claims."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=JWT_EXPIRY_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a JWT token. Raises HTTPException if invalid."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def verify_staff(credentials: HTTPAuthorizationCredentials = Security(security_bearer)) -> Dict[str, Any]:
    """Dependency that restricts access to authenticated staff (admin role)."""
    payload = decode_token(credentials.credentials)
    role = payload.get("role")
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Staff credentials required."
        )
    return payload

async def verify_guest(credentials: HTTPAuthorizationCredentials = Security(security_bearer)) -> Dict[str, Any]:
    """Dependency that restricts access to authenticated guests."""
    payload = decode_token(credentials.credentials)
    role = payload.get("role")
    if role != "guest":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Guest credentials required."
        )
    return payload

def verify_guest_room(room_number: int, guest_payload: Dict[str, Any]) -> None:
    """Enforces guest-to-room isolation.
    Ensures that a guest in one room (e.g. 203) cannot view or request operations for another room (e.g. 204).
    """
    token_room = guest_payload.get("room_number")
    if token_room != room_number:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: You cannot access operations or data for another room."
        )

def verify_staff_role(allowed_roles: list):
    async def dependency(current_user: Dict[str, Any] = Depends(verify_staff)) -> Dict[str, Any]:
        staff_role = current_user.get("staff_role")
        if staff_role not in allowed_roles and staff_role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: requires role in {allowed_roles}."
            )
        return current_user
    return dependency
