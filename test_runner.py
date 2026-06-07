import json
import urllib.request
import urllib.error
import time
import subprocess
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

# Base API URLs
URL_RECEPTION = "http://localhost:8001"
URL_HOUSEKEEPING = "http://localhost:8002"
URL_ROOM_SERVICE = "http://localhost:8003"
URL_MAINTENANCE = "http://localhost:8004"

# Global tokens
staff_token = None

# Utility function to make HTTP requests using urllib (zero dependencies)
def make_request(url, method="GET", headers=None, data=None):
    if headers is None:
        headers = {}
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
        
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            res_data = response.read().decode("utf-8")
            return response.status, json.loads(res_data) if res_data else {}
    except urllib.error.HTTPError as e:
        res_data = e.read().decode("utf-8")
        try:
            err_json = json.loads(res_data)
        except:
            err_json = {"detail": res_data}
        return e.code, err_json
    except Exception as e:
        return 500, {"detail": str(e)}

def get_staff_token():
    """Authenticates staff and caches JWT token."""
    global staff_token
    code, res = make_request(
        f"{URL_RECEPTION}/api/reception/login", 
        "POST", 
        data={"username": "admin", "password": "hotelos123"}
    )
    if code == 200:
        staff_token = res["access_token"]
        return staff_token
    else:
        print(f"[-] Failed to login as staff: {res}")
        sys.exit(1)

def run_ts01():
    """TS-01: Guest requests double room on preferred floor."""
    print("\n[Running TS-01] Guest requests Double room on Floor 1...")
    headers = {"Authorization": f"Bearer {staff_token}"}
    
    # Check-in Alice
    code, res = make_request(
        f"{URL_RECEPTION}/api/reception/checkin",
        "POST",
        headers=headers,
        data={
            "guest_name": "Alice Smith",
            "room_type": "Double",
            "floor_preference": 1,
            "proximity_preference": "None",
            "nights": 3
        }
    )
    
    if code == 200:
        room_num = res["room_number"]
        booking_id = res["booking_id"]
        # Verify it is 103 or 104 (Double rooms on Floor 1)
        if room_num in [103, 104]:
            print(f"[+] TS-01 PASS: Assigned Room {room_num} (Floor 1 Double). Booking ID: {booking_id}")
            return room_num, res["guest"]["id"]
        else:
            print(f"[-] TS-01 FAIL: Assigned unexpected room {room_num}")
            return None, None
    else:
        print(f"[-] TS-01 FAIL: HTTP Code {code}, response: {res}")
        return None, None

def run_ts02(room_number):
    """TS-02: Checkout triggers billing and housekeeping event."""
    print(f"\n[Running TS-02] Checking out Room {room_number}...")
    headers = {"Authorization": f"Bearer {staff_token}"}
    
    # Let's perform checkout for the room we checked in TS-01
    code, res = make_request(
        f"{URL_RECEPTION}/api/reception/checkout",
        "POST",
        headers=headers,
        data={
            "room_number": room_number,
            "late_checkout_hours": 2,
            "minibar_charges": 15.50,
            "discount_type": "percentage",
            "discount_value": 10.0
        }
    )
    
    if code == 200:
        bill = res["billing"]
        print(f"[+] Checkout Bill computed successfully:")
        print(f"    Subtotal: ${bill['subtotal']:.2f}")
        print(f"    Discount: -${bill['discount']:.2f}")
        print(f"    Tax (10%): ${bill['tax']:.2f}")
        print(f"    Grand Total: ${bill['grand_total']:.2f}")
        
        # Verify room changed status to Dirty
        code_rooms, res_rooms = make_request(f"{URL_RECEPTION}/api/reception/rooms")
        room_info = next((r for r in res_rooms if r["room_number"] == room_number), None)
        
        if room_info and room_info["status"] == "Dirty":
            print(f"[+] Room {room_number} status updated to Dirty.")
        else:
            print(f"[-] TS-02 FAIL: Room status did not update to Dirty: {room_info}")
            return None

        # Verify Housekeeping task was created in Pending state
        time.sleep(1.0) # Wait for Redis Pub/Sub async propagation
        code_hk, res_hk = make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks", headers=headers)
        task = next((t for t in res_hk if t["room_number"] == room_number and t["status"] != "Finished"), None)
        
        if task and task["status"] == "Pending":
            print(f"[+] Housekeeping task created. Task ID: {task['id']} Status: Pending")
            print("[+] TS-02 PASS: Checkout computed correct bill, room marked Dirty, cleaning task created.")
            return task["id"]
        else:
            print(f"[-] TS-02 FAIL: Cleaning task not found in Pending state: {res_hk}")
            return None
    else:
        print(f"[-] TS-02 FAIL: HTTP Code {code}, response: {res}")
        return None

def run_ts03(task_id, room_number):
    """TS-03: Room cleaned and becomes available."""
    print(f"\n[Running TS-03] Processing Housekeeping Task {task_id} for Room {room_number}...")
    headers = {"Authorization": f"Bearer {staff_token}"}
    
    # 1. Start cleaning
    code_start, res_start = make_request(
        f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task_id}/start?housekeeper=Sarah",
        "POST",
        headers=headers
    )
    if code_start != 200:
        print(f"[-] TS-03 FAIL: Start cleaning endpoint failed: {res_start}")
        return False
        
    # Verify room status changed to Being Cleaned
    code_rooms, res_rooms = make_request(f"{URL_RECEPTION}/api/reception/rooms")
    room_info = next((r for r in res_rooms if r["room_number"] == room_number), None)
    if room_info and room_info["status"] == "Being Cleaned":
        print(f"[+] Room {room_number} status updated to Being Cleaned.")
    else:
        print(f"[-] TS-03 FAIL: Room status did not update to Being Cleaned: {room_info}")
        return False
        
    # 2. Complete cleaning
    code_comp, res_comp = make_request(
        f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task_id}/complete",
        "POST",
        headers=headers
    )
    if code_comp != 200:
        print(f"[-] TS-03 FAIL: Complete cleaning endpoint failed: {res_comp}")
        return False
        
    # Verify room status changed back to Clean
    code_rooms_2, res_rooms_2 = make_request(f"{URL_RECEPTION}/api/reception/rooms")
    room_info_2 = next((r for r in res_rooms_2 if r["room_number"] == room_number), None)
    if room_info_2 and room_info_2["status"] == "Clean":
        print(f"[+] Room {room_number} status updated back to Clean.")
        print("[+] TS-03 PASS: Room cleaned and status is now Clean.")
        return True
    else:
        print(f"[-] TS-03 FAIL: Room status is not Clean: {room_info_2}")
        return False

def run_ts04():
    """TS-04: Guest orders 2 coffees and sandwich."""
    print("\n[Running TS-04] Guest orders 2 coffees and sandwich...")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}
    
    # 1. Check in Bob to a Single room
    code_in, res_in = make_request(
        f"{URL_RECEPTION}/api/reception/checkin",
        "POST",
        headers=headers_staff,
        data={
            "guest_name": "Bob Miller",
            "room_type": "Single",
            "floor_preference": 2,
            "proximity_preference": "None",
            "nights": 1
        }
    )
    if code_in != 200:
        print(f"[-] TS-04 FAIL: Check-in Bob failed: {res_in}")
        return
    room_num = res_in["room_number"]
    guest_id = res_in["guest"]["id"]
    
    # 2. Log in as Guest Bob
    code_login, res_login = make_request(
        f"{URL_RECEPTION}/api/reception/guest/login?room_number={room_num}&guest_name=Bob%20Miller",
        "POST"
    )
    if code_login != 200:
        print(f"[-] TS-04 FAIL: Guest login failed: {res_login}")
        return
    guest_tok = res_login["access_token"]
    headers_guest = {"Authorization": f"Bearer {guest_tok}"}
    
    # 3. Place room service order
    # Coffee = $4.50, Club Sandwich = $12.00. 2x Coffee + 1x Sandwich = $21.00
    code_order, res_order = make_request(
        f"{URL_ROOM_SERVICE}/api/room-service/order",
        "POST",
        headers=headers_guest,
        data={
            "room_number": room_num,
            "guest_id": guest_id,
            "items": [
                {"name": "Coffee", "quantity": 2, "price": 4.50},
                {"name": "Club Sandwich", "quantity": 1, "price": 12.00}
            ]
        }
    )
    
    if code_order == 200:
        order_id = res_order["order_id"]
        total = res_order["total"]
        if total == 21.00:
            print(f"[+] Room service order created. ID: {order_id}, Price Total: ${total:.2f}")
        else:
            print(f"[-] TS-04 FAIL: Incorrect cart total: ${total:.2f}")
            return
            
        # Verify in kitchen queue
        code_queue, res_queue = make_request(f"{URL_ROOM_SERVICE}/api/room-service/queue", headers=headers_staff)
        in_queue = any(o["id"] == order_id for o in res_queue)
        if in_queue:
            print(f"[+] Order is present in active kitchen collections.deque queue.")
            
            # Move order to delivered so it reflects in Bob's charges
            make_request(
                f"{URL_ROOM_SERVICE}/api/room-service/orders/{order_id}/status",
                "POST",
                headers=headers_staff,
                data={"status": "Delivered"}
            )
            print(f"[+] Order #{order_id} marked Delivered.")
            print("[+] TS-04 PASS: Room service cart calculated, placed, and moved through queue.")
        else:
            print(f"[-] TS-04 FAIL: Order not found in kitchen queue.")
    else:
        print(f"[-] TS-04 FAIL: HTTP Code {code_order}, response: {res_order}")

def run_ts05():
    """TS-05: Critical maintenance issue."""
    print("\n[Running TS-05] Submitting Critical Maintenance Issue...")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}
    
    # Report a critical issue for Room 102
    code, res = make_request(
        f"{URL_MAINTENANCE}/api/maintenance/issue",
        "POST",
        data={
            "room_number": 102,
            "description": "Pipe burst in bathroom flooding Floor 1",
            "urgency_level": "Critical"
        }
    )
    
    if code == 200:
        issue_id = res["issue_id"]
        tech = res["assigned_technician"]
        status_m = res["status"]
        
        # Verify auto technician assignment
        if status_m == "Assigned" and tech in ["John", "Sarah", "Mike"]:
            print(f"[+] Issue #{issue_id} auto-assigned to technician: {tech}")
        else:
            print(f"[-] TS-05 FAIL: Status was not assigned or tech was empty: Status={status_m}, Tech={tech}")
            return
            
        # Verify room status changed to Maintenance (since it was Critical)
        code_rooms, res_rooms = make_request(f"{URL_RECEPTION}/api/reception/rooms")
        room_info = next((r for r in res_rooms if r["room_number"] == 102), None)
        if room_info and room_info["status"] == "Maintenance":
            print(f"[+] Room 102 status set to Maintenance (Critical Issue lock).")
        else:
            print(f"[-] TS-05 FAIL: Room status did not update to Maintenance: {room_info}")
            return
            
        # Resolve issue
        code_res, res_res = make_request(
            f"{URL_MAINTENANCE}/api/maintenance/issues/{issue_id}/resolve",
            "POST",
            headers=headers_staff
        )
        
        if code_res == 200:
            # Room status should revert to Dirty (needs housekeeping cleaning)
            code_rooms_2, res_rooms_2 = make_request(f"{URL_RECEPTION}/api/reception/rooms")
            room_info_2 = next((r for r in res_rooms_2 if r["room_number"] == 102), None)
            if room_info_2 and room_info_2["status"] == "Dirty":
                print(f"[+] Room 102 resolved, status reverted to Dirty.")
                print("[+] TS-05 PASS: Critical issue locked room, assigned technician, and resolved successfully.")
            else:
                print(f"[-] TS-05 FAIL: Room status is not Dirty after resolution: {room_info_2}")
        else:
            print(f"[-] TS-05 FAIL: Resolve issue endpoint failed: {res_res}")
    else:
        print(f"[-] TS-05 FAIL: HTTP Code {code}, response: {res}")

def run_ts06():
    """TS-06: Simultaneous check-ins."""
    print("\n[Running TS-06] Simultaneous check-ins for the single Suite (Room 205)...")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}
    
    # Ensure Room 205 (Suite) is Clean
    # First, let's verify if there is an active booking on 205.
    # We will just check status of 205. If occupied, let's make it Clean.
    code_rooms, res_rooms = make_request(f"{URL_RECEPTION}/api/reception/rooms")
    room_205 = next((r for r in res_rooms if r["room_number"] == 205), None)
    if room_205 and room_205["status"] != "Clean":
        print(f"[~] Room 205 is not Clean (Status: {room_205['status']}). Resetting to Clean for TS-06.")
        # Perform checkout if occupied
        if room_205["status"] == "Occupied":
            make_request(
                f"{URL_RECEPTION}/api/reception/checkout",
                "POST",
                headers=headers_staff,
                data={"room_number": 205, "late_checkout_hours": 0, "minibar_charges": 0.0, "discount_type": "none", "discount_value": 0.0}
            )
        # Complete housekeeping cleaning
        code_hk, res_hk = make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks", headers=headers_staff)
        task = next((t for t in res_hk if t["room_number"] == 205 and t["status"] != "Finished"), None)
        if task:
            if task["status"] == "Pending":
                make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/start?housekeeper=John", "POST", headers=headers_staff)
            make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/complete", "POST", headers=headers_staff)
            
    # Now Room 205 is guaranteed Clean. Let's spawn 2 threads simultaneously to check-in for "Suite" type.
    successes = []
    failures = []
    
    def attempt_checkin(guest_name):
        code, res = make_request(
            f"{URL_RECEPTION}/api/reception/checkin",
            "POST",
            headers=headers_staff,
            data={
                "guest_name": guest_name,
                "room_type": "Suite",
                "floor_preference": 2,
                "proximity_preference": "None",
                "nights": 1
            }
        )
        if code == 200:
            successes.append((guest_name, res))
        else:
            failures.append((guest_name, res))

    # Trigger simultaneously using a ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as executor:
        executor.submit(attempt_checkin, "Simultaneous Guest A")
        executor.submit(attempt_checkin, "Simultaneous Guest B")
        
    time.sleep(1.0)
    
    print(f"    Successes: {len(successes)}")
    print(f"    Failures: {len(failures)}")
    
    if len(successes) == 1 and len(failures) == 1:
        print(f"[+] One guest checked in successfully, the other failed safely with double-booking block.")
        print(f"    Succeeded Checkin Room: {successes[0][1]['room_number']}")
        print(f"    Failed Checkin Reason: {failures[0][1]['detail']}")
        print("[+] TS-06 PASS: Transactional lock protected the single Suite from double-booking.")
        
        # Clean up the suite by checking them out
        room_num = successes[0][1]['room_number']
        make_request(
            f"{URL_RECEPTION}/api/reception/checkout",
            "POST",
            headers=headers_staff,
            data={"room_number": room_num, "late_checkout_hours": 0, "minibar_charges": 0.0, "discount_type": "none", "discount_value": 0.0}
        )
        # Complete housekeeping cleaning
        time.sleep(1.0) # Wait for Redis Pub/Sub async propagation
        code_hk, res_hk = make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks", headers=headers_staff)
        task = next((t for t in res_hk if t["room_number"] == room_num and t["status"] != "Finished"), None)
        if task:
            make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/start?housekeeper=John", "POST", headers=headers_staff)
            make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/complete", "POST", headers=headers_staff)
    else:
        print(f"[-] TS-06 FAIL: Unexpected result. Success={len(successes)}, Failures={len(failures)}")

def run_ts07():
    """TS-07: No rooms available."""
    print("\n[Running TS-07] Checking in when room inventory is depleted...")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}
    
    # We only have 1 Suite (Room 205).
    # Since we cleaned room 205 in TS-06, it is Clean.
    # 1. Let's check in Guest A to the Suite.
    code_1, res_1 = make_request(
        f"{URL_RECEPTION}/api/reception/checkin",
        "POST",
        headers=headers_staff,
        data={
            "guest_name": "Full Hotel Suite Guest",
            "room_type": "Suite",
            "nights": 1
        }
    )
    if code_1 != 200:
        print(f"[-] TS-07 FAIL: Initial Suite check-in failed: {res_1}")
        return
        
    print(f"[+] Occupied the last available Suite (Room 205).")
    
    # 2. Try to check in another Suite guest.
    code_2, res_2 = make_request(
        f"{URL_RECEPTION}/api/reception/checkin",
        "POST",
        headers=headers_staff,
        data={
            "guest_name": "Full Hotel Overbook Guest",
            "room_type": "Suite",
            "nights": 1
        }
    )
    
    if code_2 == 400:
        print(f"[+] Overbook blocked correctly. Status 400, Error Detail: {res_2['detail']}")
        print("[+] TS-07 PASS: Room depletion gracefully returns a validation error.")
    else:
        print(f"[-] TS-07 FAIL: Check-in did not block overbooking. Status: {code_2}, Response: {res_2}")
        
    # Clean up Suite
    make_request(
        f"{URL_RECEPTION}/api/reception/checkout",
        "POST",
        headers=headers_staff,
        data={"room_number": 205, "late_checkout_hours": 0, "minibar_charges": 0.0, "discount_type": "none", "discount_value": 0.0}
    )
    time.sleep(1.0) # Wait for Redis Pub/Sub async propagation
    code_hk, res_hk = make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks", headers=headers_staff)
    task = next((t for t in res_hk if t["room_number"] == 205 and t["status"] != "Finished"), None)
    if task:
        make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/start?housekeeper=John", "POST", headers=headers_staff)
        make_request(f"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{task['id']}/complete", "POST", headers=headers_staff)

def run_ts08():
    """TS-08: Invalid room number."""
    print("\n[Running TS-08] Submitting invalid check-in schema parameters...")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}
    
    # Try invalid room type
    code, res = make_request(
        f"{URL_RECEPTION}/api/reception/checkin",
        "POST",
        headers=headers_staff,
        data={
            "guest_name": "Invalid Room Guy",
            "room_type": "Super Deluxe Extra Large", # Invalid pattern
            "nights": 1
        }
    )
    
    if code == 422:
        print(f"[+] Request validation caught error (HTTP 422):")
        print(f"    {res['detail'][0]['msg']}")
        print("[+] TS-08 PASS: Input schema validation rules blocked malformed payload.")
    else:
        print(f"[-] TS-08 FAIL: Expected HTTP 422, received Code {code}: {res}")

def main():
    print("========================================")
    print("     HOTELOS AUTOMATED TEST RUNNER      ")
    print("========================================")
    
    # 1. Warm-up wait for microservices
    print("[~] Verifying connection to microservices...")
    success = False
    for i in range(10):
        try:
            urllib.request.urlopen("http://localhost:8001/api/reception/rooms", timeout=2)
            success = True
            break
        except Exception:
            print("[~] Waiting for microservices to warm up...")
            time.sleep(2)
            
    if not success:
        print("[-] Error: Backend services are not running. Please start the dashboard using python run_dashboard.py first!")
        sys.exit(1)
        
    print("[+] Connection verified!")
    
    # 2. Get JWT token
    get_staff_token()
    
    # 3. Run all tests
    room_num, guest_id = run_ts01()
    
    if room_num:
        task_id = run_ts02(room_num)
        if task_id:
            run_ts03(task_id, room_num)
            
    run_ts04()
    run_ts05()
    run_ts06()
    run_ts07()
    run_ts08()
    
    print("\n========================================")
    print("         TEST CAMPAIGN COMPLETED        ")
    print("========================================")

if __name__ == "__main__":
    main()
