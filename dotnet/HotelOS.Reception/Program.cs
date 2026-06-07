using HotelOS.Shared.Auth;
using HotelOS.Shared.Data;
using HotelOS.Shared.DTOs;
using HotelOS.Shared.Extensions;
using HotelOS.Shared.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel for port 8001
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8001);
});

// Configure database, Redis, and auth
builder.Services.AddHotelOsDb(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "hotelOS.db"));
builder.Services.AddHotelOsRedis();
builder.Services.AddHotelOsAuth();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

// Enforce lower_snake_case JSON naming globally
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
});

var app = builder.Build();
ServiceExtensions.InitializeDatabase(app.Services);

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Process check-in lock
var checkInLock = new SemaphoreSlim(1, 1);

// Broker helper for publishing and logging events
async Task PublishEventAsync(string eventType, object payload, HotelOsDbContext db, IConnectionMultiplexer redis)
{
    var envelope = new
    {
        event_id = Guid.NewGuid().ToString(),
        timestamp = DateTime.UtcNow.ToString("o"),
        event_type = eventType,
        payload = payload
    };
    var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    var messageJson = JsonSerializer.Serialize(envelope, options);
    
    try
    {
        var sub = redis.GetSubscriber();
        await sub.PublishAsync(new RedisChannel(eventType, RedisChannel.PatternMode.Literal), messageJson);
        await sub.PublishAsync(new RedisChannel("dashboard.notification", RedisChannel.PatternMode.Literal), messageJson);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Broker Error] Redis publish failed: {ex.Message}");
    }

    try
    {
        var audit = new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            Service = eventType.Contains('.') ? eventType.Split('.')[0] : "system",
            EventType = eventType,
            Message = $"Event {eventType} triggered",
            Payload = JsonSerializer.Serialize(payload, options)
        };
        db.AuditLogs.Add(audit);
        await db.SaveChangesAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Broker Error] Database logging failed: {ex.Message}");
    }
}

// ====== AUTH & STAFF LOGINS ======
app.MapPost("/api/reception/login", async (HotelOsDbContext db, JwtSettings jwt, [FromBody] LoginRequest req) =>
{
    Console.WriteLine($"[Login Debug] Received username: '{req.Username}', password: '{req.Password}'");
    var staff = await db.Staff.FirstOrDefaultAsync(s => s.Username == req.Username && s.Password == req.Password);
    if (staff == null)
    {
        return Results.Json(new { detail = "Invalid credentials. Staff credentials only." }, statusCode: 401);
    }
    
    var token = JwtHelper.GenerateToken(staff.Id, staff.Username, staff.Role, jwt);
    
    return Results.Ok(new LoginResponse(token, "bearer", staff.Role, staff.Username));
});

// Guest room-based login
app.MapPost("/api/reception/guest/login", async (
    [FromQuery(Name = "room_number")] int roomNumber,
    [FromQuery(Name = "guest_name")] string guestName,
    HotelOsDbContext db,
    JwtSettings jwt) =>
{
    var guest = await db.Guests.FirstOrDefaultAsync(g => 
        g.RoomNumber == roomNumber && 
        g.Name == guestName && 
        g.Status == "CheckedIn");
        
    if (guest == null)
    {
        return Results.Json(new { detail = "Active guest booking not found for this room number and name." }, statusCode: 401);
    }
    
    var token = JwtHelper.GenerateGuestToken(guest.Id, guest.Name, guest.RoomNumber!.Value, jwt);
    return Results.Ok(new {
        access_token = token,
        token_type = "bearer",
        guest_id = guest.Id,
        reservation_code = guest.ReservationCode
    });
});

// Guest code-based login
app.MapPost("/api/reception/guest/login/code", async (
    [FromQuery] string code,
    HotelOsDbContext db,
    JwtSettings jwt) =>
{
    var guest = await db.Guests.FirstOrDefaultAsync(g => 
        g.ReservationCode == code && 
        g.Status == "CheckedIn");
        
    if (guest == null)
    {
        return Results.Json(new { detail = "Active guest booking not found for this reservation code." }, statusCode: 401);
    }
    
    var token = JwtHelper.GenerateGuestToken(guest.Id, guest.Name, guest.RoomNumber!.Value, jwt);
    return Results.Ok(new {
        access_token = token,
        token_type = "bearer",
        room_number = guest.RoomNumber!.Value,
        guest_name = guest.Name,
        guest_id = guest.Id,
        reservation_code = guest.ReservationCode
    });
});

// ====== STAFF CRUD ======
app.MapPost("/api/reception/staff", async (HotelOsDbContext db, HttpContext ctx, [FromBody] CreateStaffRequest req) =>
{
    var role = ctx.User.FindFirst("staff_role")?.Value;
    if (role != "super_admin")
    {
        return Results.Json(new { detail = "Access forbidden: requires super_admin role." }, statusCode: 403);
    }
    
    var existing = await db.Staff.AnyAsync(s => s.Username == req.Username);
    if (existing)
    {
        return Results.Json(new { detail = "Username already exists" }, statusCode: 400);
    }
    
    var staff = new StaffMember
    {
        Username = req.Username,
        Password = req.Password,
        Role = req.Role
    };
    
    db.Staff.Add(staff);
    await db.SaveChangesAsync();
    
    return Results.Created($"/api/reception/staff/{staff.Id}", staff);
}).RequireAuthorization();

app.MapGet("/api/reception/staff", async (HotelOsDbContext db, HttpContext ctx) =>
{
    var role = ctx.User.FindFirst("staff_role")?.Value;
    if (role != "super_admin")
    {
        return Results.Json(new { detail = "Access forbidden: requires super_admin role." }, statusCode: 403);
    }
    
    var staffList = await db.Staff.ToListAsync();
    return Results.Ok(staffList);
}).RequireAuthorization();

app.MapDelete("/api/reception/staff/{id}", async (int id, HotelOsDbContext db, HttpContext ctx) =>
{
    var role = ctx.User.FindFirst("staff_role")?.Value;
    if (role != "super_admin")
    {
        return Results.Json(new { detail = "Access forbidden: requires super_admin role." }, statusCode: 403);
    }
    
    var staff = await db.Staff.FindAsync(id);
    if (staff == null)
    {
        return Results.Json(new { detail = "Staff member not found" }, statusCode: 404);
    }
    if (staff.Username == "admin")
    {
        return Results.Json(new { detail = "Cannot delete default super admin 'admin'" }, statusCode: 400);
    }
    
    db.Staff.Remove(staff);
    await db.SaveChangesAsync();
    
    return Results.Ok(new { message = "Staff member deleted successfully" });
}).RequireAuthorization();

// ====== ROOMS & GUESTS LISTING ======
app.MapGet("/api/reception/rooms", async (HotelOsDbContext db) =>
{
    var rooms = await db.Rooms.ToListAsync();
    return Results.Ok(rooms);
});

app.MapGet("/api/reception/guests", async (HotelOsDbContext db) =>
{
    var guests = await db.Guests.ToListAsync();
    return Results.Ok(guests);
});

// ====== CHECK-IN (6-Step Assignment Heuristic) ======
app.MapPost("/api/reception/checkin", async (
    HotelOsDbContext db,
    IConnectionMultiplexer redis,
    [FromBody] CheckInRequest req) =>
{
    // Manual validation to match FastAPI/Pydantic validation structure for TS-08
    var validationErrors = new List<object>();
    
    if (string.IsNullOrEmpty(req.GuestName) || req.GuestName.Length < 2 || req.GuestName.Length > 100 || 
        req.GuestName.Any(c => "<>\"'/\\;".Contains(c)))
    {
        validationErrors.Add(new { msg = "Invalid characters or length in guest name", loc = new[] { "body", "guest_name" }, type = "value_error" });
    }
    
    var validRoomTypes = new[] { "Single", "Double", "Accessible", "Suite" };
    if (string.IsNullOrEmpty(req.RoomType) || !validRoomTypes.Contains(req.RoomType))
    {
        validationErrors.Add(new { msg = "String does not match regex ^(Single|Double|Accessible|Suite)$", loc = new[] { "body", "room_type" }, type = "value_error.str.regex" });
    }
    
    if (req.FloorPreference.HasValue && (req.FloorPreference.Value < 1 || req.FloorPreference.Value > 2))
    {
        validationErrors.Add(new { msg = "Floor preference must be between 1 and 2", loc = new[] { "body", "floor_preference" }, type = "value_error" });
    }
    
    var validProximities = new[] { "Near Elevator", "Near Stairs", "Away From Elevator", "None", null };
    if (!validProximities.Contains(req.ProximityPreference))
    {
        validationErrors.Add(new { msg = "Proximity preference must be Near Elevator, Near Stairs, Away From Elevator, or None", loc = new[] { "body", "proximity_preference" }, type = "value_error.str.regex" });
    }
    
    if (req.Nights < 1 || req.Nights > 30)
    {
        validationErrors.Add(new { msg = "Nights must be between 1 and 30", loc = new[] { "body", "nights" }, type = "value_error" });
    }

    if (validationErrors.Any())
    {
        return Results.Json(new { detail = validationErrors }, statusCode: 422);
    }

    await checkInLock.WaitAsync();
    try
    {
        // STEP 1 & 2: Filter clean rooms by type
        var availableRooms = await db.Rooms
            .Where(r => r.RoomType == req.RoomType && r.Status == "Clean")
            .ToListAsync();
            
        if (!availableRooms.Any())
        {
            return Results.Json(new { detail = $"No Clean rooms of type '{req.RoomType}' are currently available." }, statusCode: 400);
        }
        
        // STEP 3: Sort by CleanSince (FIFO)
        availableRooms = availableRooms.OrderBy(r => r.CleanSince).ToList();
        
        // STEP 4: Apply floor preference
        if (req.FloorPreference.HasValue)
        {
            var floorRooms = availableRooms.Where(r => r.Floor == req.FloorPreference.Value).ToList();
            if (floorRooms.Any())
            {
                availableRooms = floorRooms;
            }
        }
        
        // STEP 5: Apply proximity preference (Tiebreaker)
        if (req.ProximityPreference == "Near Elevator")
        {
            availableRooms = availableRooms.OrderBy(r => r.NearElevator ? 0 : 1).ToList();
        }
        else if (req.ProximityPreference == "Near Stairs")
        {
            availableRooms = availableRooms.OrderBy(r => r.NearStairs ? 0 : 1).ToList();
        }
        else if (req.ProximityPreference == "Away From Elevator")
        {
            availableRooms = availableRooms.OrderBy(r => !r.NearElevator ? 0 : 1).ToList();
        }
        
        // Select top room
        var room = availableRooms.First();
        
        // STEP 6: Mark occupied
        room.Status = "Occupied";
        
        // Create Guest
        var reservationCode = $"RES-{Guid.NewGuid().ToString("N")[..6].ToUpper()}";
        var guest = new Guest
        {
            Name = req.GuestName,
            ReservationCode = reservationCode,
            RoomNumber = room.RoomNumber,
            Status = "CheckedIn"
        };
        db.Guests.Add(guest);
        await db.SaveChangesAsync(); // Saves guest to generate guest.Id
        
        // Create Booking
        var booking = new Booking
        {
            GuestId = guest.Id,
            RoomNumber = room.RoomNumber,
            CheckInTime = DateTime.UtcNow,
            Nights = req.Nights,
            Status = "Active"
        };
        db.Bookings.Add(booking);
        await db.SaveChangesAsync();
        
        // Publish events to Redis & Audit log
        var payload = new
        {
            guest_id = guest.Id,
            guest_name = guest.Name,
            reservation_code = guest.ReservationCode,
            room_number = room.RoomNumber,
            nights = req.Nights,
            room_type = room.RoomType,
            rate = (double)room.NightlyRate
        };
        await PublishEventAsync("guest.checked_in", payload, db, redis);
        await PublishEventAsync("room.status_changed", new { room_number = room.RoomNumber, status = "Occupied" }, db, redis);
        
        return Results.Ok(new
        {
            message = "Guest checked in successfully.",
            guest = new
            {
                id = guest.Id,
                name = guest.Name,
                reservation_code = guest.ReservationCode
            },
            room_number = room.RoomNumber,
            booking_id = booking.Id
        });
    }
    finally
    {
        checkInLock.Release();
    }
}).RequireAuthorization();

// ====== BILLING CALCULATION ======
BillingBreakdown RunCalculateBill(
    decimal nightlyRate,
    int nights,
    decimal ordersTotal,
    decimal minibar,
    int lateCheckoutHours,
    string discountType,
    decimal discountValue,
    List<RoomServiceOrder> orders)
{
    decimal roomCharges = nightlyRate * nights;
    decimal lateCheckoutFees = lateCheckoutHours * 20.00m;
    
    decimal subtotal = roomCharges + ordersTotal + minibar + lateCheckoutFees;
    
    decimal discount = 0.00m;
    if (discountType == "percentage")
    {
        discount = subtotal * (discountValue / 100.00m);
    }
    else if (discountType == "fixed")
    {
        discount = discountValue;
    }
    discount = Math.Min(discount, subtotal);
    
    decimal taxableAmount = Math.Max(subtotal - discount, 0.00m);
    decimal tax = taxableAmount * 0.10m; // 10% VAT
    
    decimal grandTotal = taxableAmount + tax;
    
    // Construct itemized receipt
    string rsDetails = "";
    if (orders != null && orders.Any())
    {
        rsDetails = "Room Service Items Ordered:\n";
        foreach (var order in orders)
        {
            try
            {
                var items = JsonSerializer.Deserialize<List<OrderItemDto>>(order.Items, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });
                if (items != null)
                {
                    foreach (var item in items)
                    {
                        rsDetails += $"  - {item.Quantity}x {item.Name} @ ${item.Price:F2} = ${item.Quantity * item.Price:F2}\n";
                    }
                }
            }
            catch
            {
                rsDetails += $"  - Order #{order.Id}: ${order.TotalPrice:F2}\n";
            }
        }
    }
    else
    {
        rsDetails = $"Room Service Orders: ${ordersTotal:F2}\n";
    }

    string itemized = 
        $"--- HOTELOS BILLING RECEIPT ---\n" +
        $"Room Charges: {nights} nights @ ${nightlyRate:F2}/night = ${roomCharges:F2}\n" +
        $"{rsDetails}" +
        $"Minibar Charges: ${minibar:F2}\n" +
        $"Late Checkout Fees ({lateCheckoutHours} hrs @ $20.00/hr): ${lateCheckoutFees:F2}\n" +
        $"---------------------------------\n" +
        $"Subtotal: ${subtotal:F2}\n" +
        $"Discount ({discountType} {discountValue}): -${discount:F2}\n" +
        $"Tax (10% VAT): ${tax:F2}\n" +
        $"---------------------------------\n" +
        $"GRAND TOTAL: ${grandTotal:F2}\n";
        
    return new BillingBreakdown(
        roomCharges,
        ordersTotal,
        minibar,
        lateCheckoutFees,
        subtotal,
        discount,
        tax,
        grandTotal,
        itemized,
        nights
    );
}

// ====== PREVIEW BILL ======
app.MapGet("/api/reception/checkout/preview", async (
    HotelOsDbContext db,
    [FromQuery(Name = "room_number")] int roomNumber,
    [FromQuery(Name = "late_checkout_hours")] int lateCheckoutHours = 0,
    [FromQuery(Name = "minibar_charges")] decimal minibarCharges = 0,
    [FromQuery(Name = "discount_type")] string discountType = "none",
    [FromQuery(Name = "discount_value")] decimal discountValue = 0) =>
{
    var guest = await db.Guests.FirstOrDefaultAsync(g => g.RoomNumber == roomNumber && g.Status == "CheckedIn");
    if (guest == null)
    {
        return Results.Json(new { detail = $"No checked-in guest found in room {roomNumber}" }, statusCode: 404);
    }
    
    var booking = await db.Bookings.FirstOrDefaultAsync(b => b.GuestId == guest.Id && b.Status == "Active");
    if (booking == null)
    {
        return Results.Json(new { detail = "Active booking not found for this guest" }, statusCode: 404);
    }
    
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == roomNumber);
    
    // Calculate stay nights
    var duration = DateTime.UtcNow - booking.CheckInTime;
    int actualNights = Math.Max(duration.Days, 1);
    int nightsCharged = Math.Min(actualNights, booking.Nights);
    
    // Fetch room service orders
    var orders = await db.RoomServiceOrders
        .Where(o => o.RoomNumber == roomNumber && o.GuestId == guest.Id)
        .ToListAsync();
    decimal ordersTotal = orders.Sum(o => o.TotalPrice);
    
    var billingData = RunCalculateBill(
        room!.NightlyRate,
        nightsCharged,
        ordersTotal,
        minibarCharges,
        lateCheckoutHours,
        discountType,
        discountValue,
        orders
    );
    
    return Results.Ok(billingData);
});

// ====== CHECK-OUT ======
app.MapPost("/api/reception/checkout", async (
    CheckOutRequest req,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var guest = await db.Guests.FirstOrDefaultAsync(g => g.RoomNumber == req.RoomNumber && g.Status == "CheckedIn");
    if (guest == null)
    {
        return Results.Json(new { detail = $"No checked-in guest found in room {req.RoomNumber}" }, statusCode: 404);
    }
    
    var booking = await db.Bookings.FirstOrDefaultAsync(b => b.GuestId == guest.Id && b.Status == "Active");
    if (booking == null)
    {
        return Results.Json(new { detail = "Active booking not found for this guest" }, statusCode: 404);
    }
    
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == req.RoomNumber);
    
    // Calculate stay nights
    var duration = DateTime.UtcNow - booking.CheckInTime;
    int actualNights = Math.Max(duration.Days, 1);
    int nightsCharged = Math.Min(actualNights, booking.Nights);
    
    // Fetch room service orders
    var orders = await db.RoomServiceOrders
        .Where(o => o.RoomNumber == req.RoomNumber && o.GuestId == guest.Id)
        .ToListAsync();
    decimal ordersTotal = orders.Sum(o => o.TotalPrice);
    
    var billingData = RunCalculateBill(
        room!.NightlyRate,
        nightsCharged,
        ordersTotal,
        req.MinibarCharges,
        req.LateCheckoutHours,
        req.DiscountType,
        req.DiscountValue,
        orders
    );
    
    try
    {
        // Save Billing Record
        var record = new BillingRecord
        {
            GuestId = guest.Id,
            RoomNumber = room.RoomNumber,
            RoomCharges = billingData.RoomCharges,
            RoomServiceCharges = billingData.RoomServiceCharges,
            MinibarCharges = billingData.MinibarCharges,
            LateCheckoutFees = billingData.LateCheckoutFees,
            Discount = billingData.Discount,
            Tax = billingData.Tax,
            GrandTotal = billingData.GrandTotal,
            ItemizedBill = billingData.ItemizedBill,
            CreatedAt = DateTime.UtcNow
        };
        db.BillingRecords.Add(record);
        
        // Update booking and guest
        booking.Status = "Completed";
        booking.CheckOutTime = DateTime.UtcNow;
        guest.Status = "CheckedOut";
        guest.RoomNumber = null; // Vacate room
        
        // Mark Room status to Dirty
        room.Status = "Dirty";
        await db.SaveChangesAsync();
        
        // Publish Events
        await PublishEventAsync("guest.checked_out", new
        {
            guest_id = guest.Id,
            guest_name = guest.Name,
            room_number = room.RoomNumber,
            grand_total = (double)billingData.GrandTotal
        }, db, redis);
        
        await PublishEventAsync("room.vacated", new
        {
            room_number = room.RoomNumber,
            guest_id = guest.Id
        }, db, redis);
        
        await PublishEventAsync("room.status_changed", new
        {
            room_number = room.RoomNumber,
            status = "Dirty"
        }, db, redis);
        
        return Results.Ok(new
        {
            message = "Checkout completed successfully.",
            billing = billingData
        });
    }
    catch (Exception ex)
    {
        db.Database.CurrentTransaction?.Rollback();
        return Results.Json(new { detail = $"Database transaction failure during checkout: {ex.Message}" }, statusCode: 500);
    }
}).RequireAuthorization();

// ====== AUDIT LOGS ======
app.MapGet("/api/reception/audit-logs", async (HotelOsDbContext db, HttpContext ctx) =>
{
    var role = ctx.User.FindFirst("staff_role")?.Value;
    if (role != "super_admin")
    {
        return Results.Json(new { detail = "Access forbidden: requires super_admin role." }, statusCode: 403);
    }
    
    var logs = await db.AuditLogs
        .OrderByDescending(l => l.Timestamp)
        .Take(100)
        .ToListAsync();
    return Results.Ok(logs);
}).RequireAuthorization();

app.Run();
