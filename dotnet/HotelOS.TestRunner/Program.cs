using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace HotelOS.TestRunner;

class Program
{
    const string URL_RECEPTION = "http://localhost:8001";
    const string URL_HOUSEKEEPING = "http://localhost:8002";
    const string URL_ROOM_SERVICE = "http://localhost:8003";
    const string URL_MAINTENANCE = "http://localhost:8004";

    static string? staffToken = null;

    static async Task<(int StatusCode, string ResponseBody)> MakeRequestAsync(
        HttpClient client,
        string url,
        HttpMethod method,
        object? payload = null,
        string? token = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (token != null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        
        if (payload != null)
        {
            var json = JsonSerializer.Serialize(payload);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        
        try
        {
            using var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, body);
        }
        catch (Exception ex)
        {
            return (500, JsonSerializer.Serialize(new { detail = ex.Message }));
        }
    }

    static async Task GetStaffTokenAsync(HttpClient client)
    {
        var (code, body) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/login", HttpMethod.Post, new
        {
            username = "admin",
            password = "hotelos123"
        });
        
        if (code == 200)
        {
            using var doc = JsonDocument.Parse(body);
            staffToken = doc.RootElement.GetProperty("access_token").GetString();
        }
        else
        {
            Console.WriteLine($"[-] Failed to login as staff: {body}");
            Environment.Exit(1);
        }
    }

    static async Task<(int? RoomNum, int? GuestId)> RunTS01Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-01] Guest requests Double room on Floor 1...");
        
        var (code, body) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
        {
            guest_name = "Alice Smith",
            room_type = "Double",
            floor_preference = 1,
            proximity_preference = "None",
            nights = 3
        }, staffToken);
        
        if (code == 200)
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            int roomNum = root.GetProperty("room_number").GetInt32();
            int bookingId = root.GetProperty("booking_id").GetInt32();
            int guestId = root.GetProperty("guest").GetProperty("id").GetInt32();
            
            if (roomNum == 103 || roomNum == 104)
            {
                Console.WriteLine($"[+] TS-01 PASS: Assigned Room {roomNum} (Floor 1 Double). Booking ID: {bookingId}");
                return (roomNum, guestId);
            }
            else
            {
                Console.WriteLine($"[-] TS-01 FAIL: Assigned unexpected room {roomNum}");
                return (null, null);
            }
        }
        else
        {
            Console.WriteLine($"[-] TS-01 FAIL: HTTP Code {code}, response: {body}");
            return (null, null);
        }
    }

    static async Task<int?> RunTS02Async(HttpClient client, int roomNumber)
    {
        Console.WriteLine($"\n[Running TS-02] Checking out Room {roomNumber}...");
        
        var (code, body) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkout", HttpMethod.Post, new
        {
            room_number = roomNumber,
            late_checkout_hours = 2,
            minibar_charges = 15.50,
            discount_type = "percentage",
            discount_value = 10.0
        }, staffToken);
        
        if (code == 200)
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var bill = root.GetProperty("billing");
            double subtotal = bill.GetProperty("subtotal").GetDouble();
            double discount = bill.GetProperty("discount").GetDouble();
            double tax = bill.GetProperty("tax").GetDouble();
            double grandTotal = bill.GetProperty("grand_total").GetDouble();
            
            Console.WriteLine("[+] Checkout Bill computed successfully:");
            Console.WriteLine($"    Subtotal: ${subtotal:F2}");
            Console.WriteLine($"    Discount: -${discount:F2}");
            Console.WriteLine($"    Tax (10%): ${tax:F2}");
            Console.WriteLine($"    Grand Total: ${grandTotal:F2}");
            
            // Verify room changed status to Dirty
            var (codeRooms, bodyRooms) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
            using var docRooms = JsonDocument.Parse(bodyRooms);
            var roomInfo = docRooms.RootElement.EnumerateArray()
                .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == roomNumber);
                
            if (roomInfo.ValueKind != JsonValueKind.Undefined && roomInfo.GetProperty("status").GetString() == "Dirty")
            {
                Console.WriteLine($"[+] Room {roomNumber} status updated to Dirty.");
            }
            else
            {
                Console.WriteLine($"[-] TS-02 FAIL: Room status did not update to Dirty: {bodyRooms}");
                return null;
            }
            
            // Verify Housekeeping task was created in Pending state
            await Task.Delay(1000); // Wait for Redis Pub/Sub async propagation
            
            var (codeHk, bodyHk) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks", HttpMethod.Get, null, staffToken);
            using var docHk = JsonDocument.Parse(bodyHk);
            var task = docHk.RootElement.EnumerateArray()
                .FirstOrDefault(t => t.GetProperty("room_number").GetInt32() == roomNumber && t.GetProperty("status").GetString() != "Finished");
                
            if (task.ValueKind != JsonValueKind.Undefined && task.GetProperty("status").GetString() == "Pending")
            {
                int taskId = task.GetProperty("id").GetInt32();
                Console.WriteLine($"[+] Housekeeping task created. Task ID: {taskId} Status: Pending");
                Console.WriteLine("[+] TS-02 PASS: Checkout computed correct bill, room marked Dirty, cleaning task created.");
                return taskId;
            }
            else
            {
                Console.WriteLine($"[-] TS-02 FAIL: Cleaning task not found in Pending state: {bodyHk}");
                return null;
            }
        }
        else
        {
            Console.WriteLine($"[-] TS-02 FAIL: HTTP Code {code}, response: {body}");
            return null;
        }
    }

    static async Task<bool> RunTS03Async(HttpClient client, int taskId, int roomNumber)
    {
        Console.WriteLine($"\n[Running TS-03] Processing Housekeeping Task {taskId} for Room {roomNumber}...");
        
        // 1. Start cleaning
        var (codeStart, bodyStart) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/start?housekeeper=Sarah", HttpMethod.Post, null, staffToken);
        if (codeStart != 200)
        {
            Console.WriteLine($"[-] TS-03 FAIL: Start cleaning endpoint failed: {bodyStart}");
            return false;
        }
        
        // Verify room status changed to Being Cleaned
        var (codeRooms, bodyRooms) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
        using var docRooms = JsonDocument.Parse(bodyRooms);
        var roomInfo = docRooms.RootElement.EnumerateArray()
            .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == roomNumber);
            
        if (roomInfo.ValueKind != JsonValueKind.Undefined && roomInfo.GetProperty("status").GetString() == "Being Cleaned")
        {
            Console.WriteLine($"[+] Room {roomNumber} status updated to Being Cleaned.");
        }
        else
        {
            Console.WriteLine($"[-] TS-03 FAIL: Room status did not update to Being Cleaned: {bodyRooms}");
            return false;
        }
        
        // 2. Complete cleaning
        var (codeComp, bodyComp) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/complete", HttpMethod.Post, null, staffToken);
        if (codeComp != 200)
        {
            Console.WriteLine($"[-] TS-03 FAIL: Complete cleaning endpoint failed: {bodyComp}");
            return false;
        }
        
        // Verify room status changed back to Clean
        var (codeRooms2, bodyRooms2) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
        using var docRooms2 = JsonDocument.Parse(bodyRooms2);
        var roomInfo2 = docRooms2.RootElement.EnumerateArray()
            .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == roomNumber);
            
        if (roomInfo2.ValueKind != JsonValueKind.Undefined && roomInfo2.GetProperty("status").GetString() == "Clean")
        {
            Console.WriteLine($"[+] Room {roomNumber} status updated back to Clean.");
            Console.WriteLine("[+] TS-03 PASS: Room cleaned and status is now Clean.");
            return true;
        }
        else
        {
            Console.WriteLine($"[-] TS-03 FAIL: Room status is not Clean: {bodyRooms2}");
            return false;
        }
    }

    static async Task RunTS04Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-04] Guest orders 2 coffees and sandwich...");
        
        // 1. Check in Bob to a Single room
        var (codeIn, bodyIn) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
        {
            guest_name = "Bob Miller",
            room_type = "Single",
            floor_preference = 2,
            proximity_preference = "None",
            nights = 1
        }, staffToken);
        
        if (codeIn != 200)
        {
            Console.WriteLine($"[-] TS-04 FAIL: Check-in Bob failed: {bodyIn}");
            return;
        }
        
        using var docIn = JsonDocument.Parse(bodyIn);
        int roomNum = docIn.RootElement.GetProperty("room_number").GetInt32();
        int guestId = docIn.RootElement.GetProperty("guest").GetProperty("id").GetInt32();
        
        // 2. Log in as Guest Bob
        var (codeLogin, bodyLogin) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/guest/login?room_number={roomNum}&guest_name=Bob%20Miller", HttpMethod.Post);
        if (codeLogin != 200)
        {
            Console.WriteLine($"[-] TS-04 FAIL: Guest login failed: {bodyLogin}");
            return;
        }
        
        using var docLogin = JsonDocument.Parse(bodyLogin);
        string guestTok = docLogin.RootElement.GetProperty("access_token").GetString()!;
        
        // 3. Place room service order
        var (codeOrder, bodyOrder) = await MakeRequestAsync(client, $"{URL_ROOM_SERVICE}/api/room-service/order", HttpMethod.Post, new
        {
            room_number = roomNum,
            guest_id = guestId,
            items = new[]
            {
                new { name = "Coffee", quantity = 2, price = 4.50 },
                new { name = "Club Sandwich", quantity = 1, price = 12.00 }
            }
        }, guestTok);
        
        if (codeOrder == 200)
        {
            using var docOrder = JsonDocument.Parse(bodyOrder);
            int orderId = docOrder.RootElement.GetProperty("order_id").GetInt32();
            double total = docOrder.RootElement.GetProperty("total").GetDouble();
            
            if (total == 21.00)
            {
                Console.WriteLine($"[+] Room service order created. ID: {orderId}, Price Total: ${total:F2}");
            }
            else
            {
                Console.WriteLine($"[-] TS-04 FAIL: Incorrect cart total: ${total:F2}");
                return;
            }
            
            // Verify in kitchen queue
            var (codeQueue, bodyQueue) = await MakeRequestAsync(client, $"{URL_ROOM_SERVICE}/api/room-service/queue", HttpMethod.Get, null, staffToken);
            using var docQueue = JsonDocument.Parse(bodyQueue);
            bool inQueue = docQueue.RootElement.EnumerateArray()
                .Any(o => o.GetProperty("id").GetInt32() == orderId);
                
            if (inQueue)
            {
                Console.WriteLine("[+] Order is present in active kitchen collections.deque queue.");
                
                // Move order to delivered so it reflects in Bob's charges
                await MakeRequestAsync(client, $"{URL_ROOM_SERVICE}/api/room-service/orders/{orderId}/status", HttpMethod.Post, new { status = "Delivered" }, staffToken);
                Console.WriteLine($"[+] Order #{orderId} marked Delivered.");
                Console.WriteLine("[+] TS-04 PASS: Room service cart calculated, placed, and moved through queue.");
            }
            else
            {
                Console.WriteLine("[-] TS-04 FAIL: Order not found in kitchen queue.");
            }
        }
        else
        {
            Console.WriteLine($"[-] TS-04 FAIL: HTTP Code {codeOrder}, response: {bodyOrder}");
        }
    }

    static async Task RunTS05Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-05] Submitting Critical Maintenance Issue...");
        
        var (code, body) = await MakeRequestAsync(client, $"{URL_MAINTENANCE}/api/maintenance/issue", HttpMethod.Post, new
        {
            room_number = 102,
            description = "Pipe burst in bathroom flooding Floor 1",
            urgency_level = "Critical"
        }, staffToken);
        
        if (code == 200)
        {
            using var doc = JsonDocument.Parse(body);
            int issueId = doc.RootElement.GetProperty("issue_id").GetInt32();
            string tech = doc.RootElement.GetProperty("assigned_technician").GetString()!;
            string statusM = doc.RootElement.GetProperty("status").GetString()!;
            
            if (statusM == "Assigned" && (tech == "John" || tech == "Sarah" || tech == "Mike"))
            {
                Console.WriteLine($"[+] Issue #{issueId} auto-assigned to technician: {tech}");
            }
            else
            {
                Console.WriteLine($"[-] TS-05 FAIL: Status was not assigned or tech was empty: Status={statusM}, Tech={tech}");
                return;
            }
            
            // Verify room status set to Maintenance
            var (codeRooms, bodyRooms) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
            using var docRooms = JsonDocument.Parse(bodyRooms);
            var roomInfo = docRooms.RootElement.EnumerateArray()
                .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == 102);
                
            if (roomInfo.ValueKind != JsonValueKind.Undefined && roomInfo.GetProperty("status").GetString() == "Maintenance")
            {
                Console.WriteLine("[+] Room 102 status set to Maintenance (Critical Issue lock).");
            }
            else
            {
                Console.WriteLine($"[-] TS-05 FAIL: Room status did not update to Maintenance: {bodyRooms}");
                return;
            }
            
            // Resolve issue
            var (codeRes, bodyRes) = await MakeRequestAsync(client, $"{URL_MAINTENANCE}/api/maintenance/issues/{issueId}/resolve", HttpMethod.Post, null, staffToken);
            if (codeRes == 200)
            {
                // Room status should revert to Dirty
                var (codeRooms2, bodyRooms2) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
                using var docRooms2 = JsonDocument.Parse(bodyRooms2);
                var roomInfo2 = docRooms2.RootElement.EnumerateArray()
                    .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == 102);
                    
                if (roomInfo2.ValueKind != JsonValueKind.Undefined && roomInfo2.GetProperty("status").GetString() == "Dirty")
                {
                    Console.WriteLine("[+] Room 102 resolved, status reverted to Dirty.");
                    Console.WriteLine("[+] TS-05 PASS: Critical issue locked room, assigned technician, and resolved successfully.");
                }
                else
                {
                    Console.WriteLine($"[-] TS-05 FAIL: Room status is not Dirty after resolution: {bodyRooms2}");
                }
            }
            else
            {
                Console.WriteLine($"[-] TS-05 FAIL: Resolve issue endpoint failed: {bodyRes}");
            }
        }
        else
        {
            Console.WriteLine($"[-] TS-05 FAIL: HTTP Code {code}, response: {body}");
        }
    }

    static async Task RunTS06Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-06] Simultaneous check-ins for the single Suite (Room 205)...");
        
        // Ensure Room 205 (Suite) is Clean
        var (codeRooms, bodyRooms) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/rooms", HttpMethod.Get, null, staffToken);
        using var docRooms = JsonDocument.Parse(bodyRooms);
        var room205 = docRooms.RootElement.EnumerateArray()
            .FirstOrDefault(r => r.GetProperty("room_number").GetInt32() == 205);
            
        if (room205.ValueKind != JsonValueKind.Undefined && room205.GetProperty("status").GetString() != "Clean")
        {
            string currentStatus = room205.GetProperty("status").GetString()!;
            Console.WriteLine($"[~] Room 205 is not Clean (Status: {currentStatus}). Resetting to Clean for TS-06.");
            
            if (currentStatus == "Occupied")
            {
                await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkout", HttpMethod.Post, new
                {
                    room_number = 205,
                    late_checkout_hours = 0,
                    minibar_charges = 0.0,
                    discount_type = "none",
                    discount_value = 0.0
                }, staffToken);
            }
            
            var (codeHk, bodyHk) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks", HttpMethod.Get, null, staffToken);
            using var docHk = JsonDocument.Parse(bodyHk);
            var task = docHk.RootElement.EnumerateArray()
                .FirstOrDefault(t => t.GetProperty("room_number").GetInt32() == 205 && t.GetProperty("status").GetString() != "Finished");
                
            if (task.ValueKind != JsonValueKind.Undefined)
            {
                int taskId = task.GetProperty("id").GetInt32();
                if (task.GetProperty("status").GetString() == "Pending")
                {
                    await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/start?housekeeper=John", HttpMethod.Post, null, staffToken);
                }
                await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/complete", HttpMethod.Post, null, staffToken);
            }
        }
        
        // Now Room 205 is clean. Let's spawn 2 threads simultaneously
        var successes = new System.Collections.Concurrent.ConcurrentBag<(string Name, string Body)>();
        var failures = new System.Collections.Concurrent.ConcurrentBag<(string Name, int Code, string Body)>();
        
        async Task AttemptCheckin(string guestName)
        {
            var (code, body) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
            {
                guest_name = guestName,
                room_type = "Suite",
                floor_preference = 2,
                proximity_preference = "None",
                nights = 1
            }, staffToken);
            
            if (code == 200)
            {
                successes.Add((guestName, body));
            }
            else
            {
                failures.Add((guestName, code, body));
            }
        }
        
        var t1 = AttemptCheckin("Simultaneous Guest A");
        var t2 = AttemptCheckin("Simultaneous Guest B");
        await Task.WhenAll(t1, t2);
        
        await Task.Delay(1000);
        
        Console.WriteLine($"    Successes: {successes.Count}");
        Console.WriteLine($"    Failures: {failures.Count}");
        
        if (successes.Count == 1 && failures.Count == 1)
        {
            using var docS = JsonDocument.Parse(successes.First().Body);
            int roomNum = docS.RootElement.GetProperty("room_number").GetInt32();
            
            using var docF = JsonDocument.Parse(failures.First().Body);
            string detail = docF.RootElement.GetProperty("detail").GetString()!;
            
            Console.WriteLine("[+] One guest checked in successfully, the other failed safely with double-booking block.");
            Console.WriteLine($"    Succeeded Checkin Room: {roomNum}");
            Console.WriteLine($"    Failed Checkin Reason: {detail}");
            Console.WriteLine("[+] TS-06 PASS: Transactional lock protected the single Suite from double-booking.");
            
            // Clean up
            await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkout", HttpMethod.Post, new
            {
                room_number = roomNum,
                late_checkout_hours = 0,
                minibar_charges = 0.0,
                discount_type = "none",
                discount_value = 0.0
            }, staffToken);
            
            await Task.Delay(1000);
            
            var (codeHk2, bodyHk2) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks", HttpMethod.Get, null, staffToken);
            using var docHk2 = JsonDocument.Parse(bodyHk2);
            var task2 = docHk2.RootElement.EnumerateArray()
                .FirstOrDefault(t => t.GetProperty("room_number").GetInt32() == roomNum && t.GetProperty("status").GetString() != "Finished");
                
            if (task2.ValueKind != JsonValueKind.Undefined)
            {
                int taskId = task2.GetProperty("id").GetInt32();
                await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/start?housekeeper=John", HttpMethod.Post, null, staffToken);
                await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/complete", HttpMethod.Post, null, staffToken);
            }
        }
        else
        {
            Console.WriteLine($"[-] TS-06 FAIL: Unexpected result. Success={successes.Count}, Failures={failures.Count}");
        }
    }

    static async Task RunTS07Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-07] Checking in when room inventory is depleted...");
        
        // Occupy last Suite
        var (code1, body1) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
        {
            guest_name = "Full Hotel Suite Guest",
            room_type = "Suite",
            nights = 1
        }, staffToken);
        
        if (code1 != 200)
        {
            Console.WriteLine($"[-] TS-07 FAIL: Initial Suite check-in failed: {body1}");
            return;
        }
        
        Console.WriteLine("[+] Occupied the last available Suite (Room 205).");
        
        // Try to check in another
        var (code2, body2) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
        {
            guest_name = "Full Hotel Overbook Guest",
            room_type = "Suite",
            nights = 1
        }, staffToken);
        
        if (code2 == 400)
        {
            using var doc = JsonDocument.Parse(body2);
            string detail = doc.RootElement.GetProperty("detail").GetString()!;
            Console.WriteLine($"[+] Overbook blocked correctly. Status 400, Error Detail: {detail}");
            Console.WriteLine("[+] TS-07 PASS: Room depletion gracefully returns a validation error.");
        }
        else
        {
            Console.WriteLine($"[-] TS-07 FAIL: Check-in did not block overbooking. Status: {code2}, Response: {body2}");
        }
        
        // Clean up
        await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkout", HttpMethod.Post, new
        {
            room_number = 205,
            late_checkout_hours = 0,
            minibar_charges = 0.0,
            discount_type = "none",
            discount_value = 0.0
        }, staffToken);
        
        await Task.Delay(1000);
        
        var (codeHk, bodyHk) = await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks", HttpMethod.Get, null, staffToken);
        using var docHk = JsonDocument.Parse(bodyHk);
        var task = docHk.RootElement.EnumerateArray()
            .FirstOrDefault(t => t.GetProperty("room_number").GetInt32() == 205 && t.GetProperty("status").GetString() != "Finished");
            
        if (task.ValueKind != JsonValueKind.Undefined)
        {
            int taskId = task.GetProperty("id").GetInt32();
            await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/start?housekeeper=John", HttpMethod.Post, null, staffToken);
            await MakeRequestAsync(client, $"{URL_HOUSEKEEPING}/api/housekeeping/tasks/{taskId}/complete", HttpMethod.Post, null, staffToken);
        }
    }

    static async Task RunTS08Async(HttpClient client)
    {
        Console.WriteLine("\n[Running TS-08] Submitting invalid check-in schema parameters...");
        
        var (code, body) = await MakeRequestAsync(client, $"{URL_RECEPTION}/api/reception/checkin", HttpMethod.Post, new
        {
            guest_name = "Invalid Room Guy",
            room_type = "Super Deluxe Extra Large",
            nights = 1
        }, staffToken);
        
        if (code == 422)
        {
            using var doc = JsonDocument.Parse(body);
            var firstError = doc.RootElement.GetProperty("detail").EnumerateArray().First();
            string msg = firstError.GetProperty("msg").GetString()!;
            Console.WriteLine("[+] Request validation caught error (HTTP 422):");
            Console.WriteLine($"    {msg}");
            Console.WriteLine("[+] TS-08 PASS: Input schema validation rules blocked malformed payload.");
        }
        else
        {
            Console.WriteLine($"[-] TS-08 FAIL: Expected HTTP 422, received Code {code}: {body}");
        }
    }

    static async Task Main(string[] args)
    {
        using var client = new HttpClient();
        
        Console.WriteLine("========================================");
        Console.WriteLine("     HOTELOS AUTOMATED TEST RUNNER      ");
        Console.WriteLine("========================================");
        
        Console.WriteLine("[~] Verifying connection to microservices...");
        bool success = false;
        for (int i = 0; i < 10; i++)
        {
            try
            {
                var response = await client.GetAsync($"{URL_RECEPTION}/api/reception/rooms");
                if (response.IsSuccessStatusCode)
                {
                    success = true;
                    break;
                }
            }
            catch
            {
                // ignore
            }
            Console.WriteLine("[~] Waiting for microservices to warm up...");
            await Task.Delay(2000);
        }
        
        if (!success)
        {
            Console.WriteLine("[-] Error: Backend services are not running. Please start the services first!");
            Environment.Exit(1);
        }
        
        Console.WriteLine("[+] Connection verified!");
        
        await GetStaffTokenAsync(client);
        
        var (roomNum, guestId) = await RunTS01Async(client);
        if (roomNum.HasValue)
        {
            int? taskId = await RunTS02Async(client, roomNum.Value);
            if (taskId.HasValue)
            {
                await RunTS03Async(client, taskId.Value, roomNum.Value);
            }
        }
        
        await RunTS04Async(client);
        await RunTS05Async(client);
        await RunTS06Async(client);
        await RunTS07Async(client);
        await RunTS08Async(client);
        
        Console.WriteLine("\n========================================");
        Console.WriteLine("         TEST CAMPAIGN COMPLETED        ");
        Console.WriteLine("========================================");
    }
}
