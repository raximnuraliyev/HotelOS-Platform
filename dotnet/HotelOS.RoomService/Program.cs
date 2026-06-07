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
using System.Threading.Tasks;

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel for port 8003
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8003);
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

// Load active orders into memory on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HotelOsDbContext>();
    var activeOrders = db.RoomServiceOrders
        .Where(o => o.Status == "Received" || o.Status == "Preparing" || o.Status == "Out For Delivery")
        .OrderBy(o => o.CreatedAt)
        .ToList();
        
    var dtoList = activeOrders.Select(o =>
    {
        List<OrderItemDto> items = new();
        try
        {
            items = JsonSerializer.Deserialize<List<OrderItemDto>>(o.Items, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }) ?? new();
        }
        catch { }
        
        return new ActiveOrderDto
        {
            Id = o.Id,
            RoomNumber = o.RoomNumber,
            GuestId = o.GuestId,
            Items = items,
            TotalPrice = o.TotalPrice,
            Status = o.Status,
            CreatedAt = o.CreatedAt.ToString("o")
        };
    });
    
    ActiveOrderQueue.Initialize(dtoList);
}

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

// ====== PLACE ORDER ======
app.MapPost("/api/room-service/order", async (
    [FromBody] RoomServiceOrderRequest req,
    HotelOsDbContext db,
    IConnectionMultiplexer redis,
    HttpContext ctx) =>
{
    // Guest validation: room isolation
    var roomNumClaim = ctx.User.FindFirst("room_number")?.Value;
    if (roomNumClaim != req.RoomNumber.ToString())
    {
        return Results.Json(new { detail = "Access forbidden: You cannot access operations or data for another room." }, statusCode: 403);
    }
    
    // Verify room is Occupied
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == req.RoomNumber);
    if (room == null || room.Status != "Occupied")
    {
        return Results.Json(new { detail = "Room is not currently occupied." }, statusCode: 400);
    }
    
    // Verify guest is CheckedIn
    var guest = await db.Guests.FirstOrDefaultAsync(g => g.Id == req.GuestId && g.Status == "CheckedIn");
    if (guest == null)
    {
        return Results.Json(new { detail = "Guest is not checked in." }, statusCode: 400);
    }
    
    // Calculate total price
    decimal total = 0;
    var itemsList = new List<OrderItemDto>();
    foreach (var item in req.Items)
    {
        itemsList.Add(item);
        total += item.Price * item.Quantity;
    }
    
    try
    {
        var order = new RoomServiceOrder
        {
            RoomNumber = req.RoomNumber,
            GuestId = req.GuestId,
            Items = JsonSerializer.Serialize(itemsList, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }),
            TotalPrice = total,
            Status = "Received",
            CreatedAt = DateTime.UtcNow
        };
        db.RoomServiceOrders.Add(order);
        await db.SaveChangesAsync();
        
        var dto = new ActiveOrderDto
        {
            Id = order.Id,
            RoomNumber = order.RoomNumber,
            GuestId = order.GuestId,
            Items = itemsList,
            TotalPrice = total,
            Status = "Received",
            CreatedAt = order.CreatedAt.ToString("o")
        };
        
        // Push to FIFO Queue
        ActiveOrderQueue.Enqueue(dto);
        
        // Publish event
        await PublishEventAsync("room_service.created", dto, db, redis);
        
        return Results.Ok(new { message = "Order placed successfully.", order_id = order.Id, total = (double)total });
    }
    catch (Exception ex)
    {
        db.Database.CurrentTransaction?.Rollback();
        return Results.Json(new { detail = $"Database write failed: {ex.Message}" }, statusCode: 500);
    }
}).RequireAuthorization();

// ====== GET ALL ORDERS (Staff Portal) ======
app.MapGet("/api/room-service/orders", async (HotelOsDbContext db) =>
{
    var orders = await db.RoomServiceOrders.ToListAsync();
    var list = orders.Select(o =>
    {
        List<OrderItemDto> items = new();
        try
        {
            items = JsonSerializer.Deserialize<List<OrderItemDto>>(o.Items, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }) ?? new();
        }
        catch { }
        
        return new
        {
            id = o.Id,
            room_number = o.RoomNumber,
            guest_id = o.GuestId,
            items = items,
            total_price = o.TotalPrice,
            status = o.Status,
            created_at = o.CreatedAt
        };
    });
    return Results.Ok(list);
}).RequireAuthorization();

// ====== GET ACTIVE QUEUE ======
app.MapGet("/api/room-service/queue", () =>
{
    return Results.Ok(ActiveOrderQueue.GetQueue());
}).RequireAuthorization();

// ====== GET GUEST ROOM ORDERS ======
app.MapGet("/api/room-service/guest/orders", async (
    [FromQuery(Name = "room_number")] int roomNumber,
    HotelOsDbContext db,
    HttpContext ctx) =>
{
    var roomNumClaim = ctx.User.FindFirst("room_number")?.Value;
    if (roomNumClaim != roomNumber.ToString())
    {
        return Results.Json(new { detail = "Access forbidden: You cannot access operations or data for another room." }, statusCode: 403);
    }
    
    var guestIdClaim = ctx.User.FindFirst("guest_id")?.Value;
    if (guestIdClaim != null && int.TryParse(guestIdClaim, out var guestId))
    {
        var activeGuest = await db.Guests.FirstOrDefaultAsync(g => g.RoomNumber == roomNumber && g.Status == "CheckedIn");
        if (activeGuest == null || activeGuest.Id != guestId)
        {
            return Results.Json(new { detail = "Guest is not checked in." }, statusCode: 401);
        }
    }
    
    var orders = await db.RoomServiceOrders.Where(o => o.RoomNumber == roomNumber).ToListAsync();
    var list = orders.Select(o =>
    {
        List<OrderItemDto> items = new();
        try
        {
            items = JsonSerializer.Deserialize<List<OrderItemDto>>(o.Items, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }) ?? new();
        }
        catch { }
        
        return new
        {
            id = o.Id,
            room_number = o.RoomNumber,
            guest_id = o.GuestId,
            items = items,
            total_price = o.TotalPrice,
            status = o.Status,
            created_at = o.CreatedAt
        };
    });
    return Results.Ok(list);
}).RequireAuthorization();

// ====== UPDATE ORDER STATUS ======
app.MapPost("/api/room-service/orders/{orderId}/status", async (
    [FromRoute] int orderId,
    [FromBody] RoomServiceUpdateStatus req,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var order = await db.RoomServiceOrders.FirstOrDefaultAsync(o => o.Id == orderId);
    if (order == null)
    {
        return Results.Json(new { detail = "Order not found" }, statusCode: 404);
    }
    
    try
    {
        var oldStatus = order.Status;
        order.Status = req.Status;
        await db.SaveChangesAsync();
        
        // Sync queue
        if (req.Status == "Delivered")
        {
            ActiveOrderQueue.Remove(orderId);
        }
        else
        {
            ActiveOrderQueue.UpdateStatus(orderId, req.Status);
        }
        
        List<OrderItemDto> items = new();
        try
        {
            items = JsonSerializer.Deserialize<List<OrderItemDto>>(order.Items, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }) ?? new();
        }
        catch { }
        
        var dto = new
        {
            id = order.Id,
            room_number = order.RoomNumber,
            guest_id = order.GuestId,
            items = items,
            total_price = order.TotalPrice,
            status = order.Status,
            created_at = order.CreatedAt.ToString("o")
        };
        
        await PublishEventAsync("room_service.updated", dto, db, redis);
        
        return Results.Ok(new { message = $"Order status updated from {oldStatus} to {req.Status}." });
    }
    catch (Exception ex)
    {
        db.Database.CurrentTransaction?.Rollback();
        return Results.Json(new { detail = $"Database update failed: {ex.Message}" }, statusCode: 500);
    }
}).RequireAuthorization();

app.Run();

// ====== DTO FOR IN-MEMORY QUEUE ======
public class ActiveOrderDto
{
    public int Id { get; set; }
    public int RoomNumber { get; set; }
    public int GuestId { get; set; }
    public List<OrderItemDto> Items { get; set; } = new();
    public decimal TotalPrice { get; set; }
    public string Status { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = string.Empty;
}

public record RoomServiceUpdateStatus(string Status);

// ====== IN-MEMORY FIFO QUEUE ======
public static class ActiveOrderQueue
{
    private static readonly List<ActiveOrderDto> Queue = new();
    private static readonly object LockObj = new();

    public static void Initialize(IEnumerable<ActiveOrderDto> orders)
    {
        lock (LockObj)
        {
            Queue.Clear();
            Queue.AddRange(orders);
        }
    }

    public static void Enqueue(ActiveOrderDto order)
    {
        lock (LockObj)
        {
            Queue.Add(order);
        }
    }

    public static List<ActiveOrderDto> GetQueue()
    {
        lock (LockObj)
        {
            return Queue.ToList();
        }
    }

    public static void Remove(int id)
    {
        lock (LockObj)
        {
            var item = Queue.FirstOrDefault(x => x.Id == id);
            if (item != null)
            {
                Queue.Remove(item);
            }
        }
    }

    public static void UpdateStatus(int id, string status)
    {
        lock (LockObj)
        {
            var item = Queue.FirstOrDefault(x => x.Id == id);
            if (item != null)
            {
                item.Status = status;
            }
        }
    }
}
