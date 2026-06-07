# HotelOS Debugging Log

This document records three realistic engineering bugs encountered and resolved during the design and development of the HotelOS microservices platform.

---

## BUG-001: SQLite Write Concurrency Lock ("Database is Locked")

* **Bug ID**: BUG-001
* **Type**: Database / Concurrency
* **Description**: Under simultaneous booking check-in requests, backend services throw database exceptions: `(sqlite3.OperationalError) database is locked`.
* **How Discovered**: Encountered during execution of test scenario **TS-06** (simultaneous check-ins) when concurrent threads hit the Reception Service check-in endpoint.
* **Debugging Steps**:
  1. Inspected Uvicorn logs for the Reception service, locating the traceback pointing to SQLAlchemy transaction commits.
  2. Checked current SQLite configuration and verified that SQLite is in the default journal mode (`DELETE`).
  3. Researched SQLite locking behaviors. In default mode, SQLite locks the entire database file for writes, causing concurrent threads to immediately block and time out.
* **Root Cause**: SQLite's default transaction isolation and journal settings lock the entire database file during write transactions, preventing concurrent writes across microservices.
* **Fix Applied**:
  Implemented Write-Ahead Logging (WAL) and adjusted busy timeouts to 5 seconds. Added SQLAlchemy connection listeners in [database.py](file:///c:/PDP/Assignment%20Briefs%202025-2026/Level%204%20(2-kurslar%20uchun)/programming/backend/shared/database.py):
  ```python
  @event.listens_for(engine, "connect")
  def set_sqlite_pragma(dbapi_connection, connection_record):
      cursor = dbapi_connection.cursor()
      cursor.execute("PRAGMA journal_mode=WAL")
      cursor.execute("PRAGMA synchronous=NORMAL")
      cursor.execute("PRAGMA busy_timeout=5000")
      cursor.close()
  ```
* **Prevention Strategy**: Always configure WAL mode and thread-safe connection arguments (`connect_args={"check_same_thread": False}`) when utilizing SQLite in asynchronous Python web frameworks.

---

## BUG-002: Guest Portal WebSocket Authentication Disconnect (HTTP 403)

* **Bug ID**: BUG-002
* **Type**: Security / Authentication / WebSockets
* **Description**: Connected Guest Portal web client receives instant connection close (HTTP 1008 or 403 Policy Violation) upon attempting WebSocket connection.
* **How Discovered**: Discovered when logging into the Guest Portal and opening the browser developer console, showing WebSocket handshake failures.
* **Debugging Steps**:
  1. Analyzed the Gateway WebSocket handler in [main.py](file:///c:/PDP/Assignment%2520Briefs%2525202025-2026/Level%2525204%252520%2525282-kurslar%252520uchun%252529/programming/backend/notification_gateway/main.py).
  2. Discovered the token validation logic assumed all tokens had the claim `role: "admin"` and rejected tokens with `role: "guest"`.
  3. Noticed that the connection manager did not have a structure to register client channels isolated by room number.
* **Root Cause**: The WebSocket gateway only supported staff JWT authorization payloads, discarding guest credentials and lacking client partitioning.
* **Fix Applied**:
  Updated `websocket_endpoint` in the Notification Gateway to decode guest JWTs, extract the `room_number` claims, and map connections into `self.guest_connections[room_number]`. Implemented room-specific event routing where guest clients only receive event payloads corresponding to their room.
* **Prevention Strategy**: Establish unified token decoding logic that supports multiple roles, and test connection handshakes with both administrative and customer tokens.

---

## BUG-003: Floor Fallback Violating Room Status Constraint in Room Assignment

* **Bug ID**: BUG-003
* **Type**: Logic / Algorithm
* **Description**: Guest check-in requests assigning dirty or maintenance rooms when a floor preference is specified.
* **How Discovered**: Discovered during testing of **TS-01** when a guest requested a Double room on Floor 1, and the system assigned Room 104 which was currently marked `Dirty` from a previous checkout.
* **Debugging Steps**:
  1. Inspected [reception/main.py](file:///c:/PDP/Assignment%2520Briefs%2525202025-2026/Level%2525204%252520%2525282-kurslar%252520uchun%252529/programming/backend/reception/main.py) check-in algorithm logs.
  2. Noticed the floor filter logic was executing queries for rooms on Floor 1 matching the requested type, but did not enforce status checks *after* applying the floor fallback.
  3. When no Clean room of that type existed on Floor 1, the fallback search was falling back to any room on Floor 1 (regardless of status) instead of searching other floors for a Clean room.
* **Root Cause**: The floor filter query fallback overrode the cleanliness constraints, selecting from dirty/maintenance inventory.
* **Fix Applied**:
  Restructured [assign_room](file:///c:/PDP/Assignment%2520Briefs%2525202025-2026/Level%2525204%252520%2525282-kurslar%252520uchun%252529/programming/backend/reception/main.py) to run the status checks (excluding Dirty, Occupied, Maintenance) at the very start (STEP 1 & 2), returning a base list of Clean rooms. Floor preferences and elevator proximity are then applied as logical filters and sort keys entirely in-memory on this clean subset, ensuring dirty/occupied rooms are never assigned.
* **Prevention Strategy**: Apply status constraints as absolute pre-filters in database queries. Never let auxiliary user preferences (floors, view, proximity) widen the query beyond clean inventory.
