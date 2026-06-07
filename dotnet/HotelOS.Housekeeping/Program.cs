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
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel for port 8002
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8002);
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

// Add background loops service
builder.Services.AddHostedService<HousekeepingBackgroundService>();

var app = builder.Build();
ServiceExtensions.InitializeDatabase(app.Services);

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

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

// ====== GET ALL TASKS ======
app.MapGet("/api/housekeeping/tasks", async (HotelOsDbContext db) =>
{
    var tasks = await db.HousekeepingTasks.ToListAsync();
    return Results.Ok(tasks);
}).RequireAuthorization();

// ====== START CLEANING (Timer Start) ======
app.MapPost("/api/housekeeping/tasks/{taskId}/start", async (
    [FromRoute] int taskId,
    [FromQuery] string housekeeper,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var task = await db.HousekeepingTasks.FirstOrDefaultAsync(t => t.Id == taskId);
    if (task == null)
    {
        return Results.Json(new { detail = "Housekeeping task not found" }, statusCode: 404);
    }
    
    if (task.Status != "Pending")
    {
        return Results.Json(new { detail = $"Cannot start task in state: {task.Status}" }, statusCode: 400);
    }
    
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == task.RoomNumber);
    if (room == null)
    {
        return Results.Json(new { detail = "Associated room not found" }, statusCode: 404);
    }
    
    task.Status = "In Progress";
    task.AssignedHousekeeper = housekeeper;
    task.StartedAt = DateTime.UtcNow;
    
    room.Status = "Being Cleaned";
    await db.SaveChangesAsync();
    
    // Publish events
    await PublishEventAsync("room.cleaning_started", new
    {
        room_number = room.RoomNumber,
        housekeeper = housekeeper,
        started_at = task.StartedAt.Value.ToString("o")
    }, db, redis);
    
    await PublishEventAsync("room.status_changed", new
    {
        room_number = room.RoomNumber,
        status = "Being Cleaned"
    }, db, redis);
    
    return Results.Ok(new
    {
        message = "Cleaning started.",
        task_id = task.Id,
        room_number = room.RoomNumber
    });
}).RequireAuthorization();

// ====== COMPLETE CLEANING (Timer Stop) ======
app.MapPost("/api/housekeeping/tasks/{taskId}/complete", async (
    [FromRoute] int taskId,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var task = await db.HousekeepingTasks.FirstOrDefaultAsync(t => t.Id == taskId);
    if (task == null)
    {
        return Results.Json(new { detail = "Housekeeping task not found" }, statusCode: 404);
    }
    
    if (task.Status != "In Progress")
    {
        return Results.Json(new { detail = $"Cannot complete task in state: {task.Status}" }, statusCode: 400);
    }
    
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == task.RoomNumber);
    if (room == null)
    {
        return Results.Json(new { detail = "Associated room not found" }, statusCode: 404);
    }
    
    task.Status = "Finished";
    task.CompletedAt = DateTime.UtcNow;
    
    var hasActiveGuest = await db.Guests.AnyAsync(g => g.RoomNumber == room.RoomNumber && g.Status == "CheckedIn");
    room.Status = hasActiveGuest ? "Occupied" : "Clean";
    room.CleanSince = DateTime.UtcNow;
    await db.SaveChangesAsync();
    
    // Publish events
    await PublishEventAsync("room.cleaned", new
    {
        room_number = room.RoomNumber
    }, db, redis);
    
    await PublishEventAsync("room.status_changed", new
    {
        room_number = room.RoomNumber,
        status = "Clean"
    }, db, redis);
    
    return Results.Ok(new
    {
        message = "Room is now Clean.",
        task_id = task.Id,
        room_number = room.RoomNumber
    });
}).RequireAuthorization();

// ====== DIRECT ADMIN ROUTE TO MARK ROOM DIRTY ======
app.MapPost("/api/housekeeping/tasks/room/{roomNumber}/dirty", async (
    int roomNumber,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == roomNumber);
    if (room == null)
    {
        return Results.Json(new { detail = "Room not found" }, statusCode: 404);
    }
    
    room.Status = "Dirty";
    
    var existing = await db.HousekeepingTasks
        .AnyAsync(t => t.RoomNumber == roomNumber && t.Status != "Finished");
        
    if (!existing)
    {
        var task = new HousekeepingTask
        {
            RoomNumber = roomNumber,
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };
        db.HousekeepingTasks.Add(task);
    }
    
    await db.SaveChangesAsync();
    
    await PublishEventAsync("room.status_changed", new
    {
        room_number = room.RoomNumber,
        status = "Dirty"
    }, db, redis);
    
    return Results.Ok(new { message = $"Room {roomNumber} marked dirty." });
}).RequireAuthorization();

app.Run();

// ====== BACKGROUND SUBSCRIBER & RECONCILIATION LOOP ======
public class HousekeepingBackgroundService : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<HousekeepingBackgroundService> _logger;

    public HousekeepingBackgroundService(
        IConnectionMultiplexer redis,
        IServiceProvider serviceProvider,
        ILogger<HousekeepingBackgroundService> logger)
    {
        _redis = redis;
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Housekeeping Background Service started.");
        
        // 1. Subscribe to Redis room.vacated
        try
        {
            var subscriber = _redis.GetSubscriber();
            var channel = new RedisChannel("room.vacated", RedisChannel.PatternMode.Literal);
            await subscriber.SubscribeAsync(channel, async (redisChannel, message) =>
            {
                try
                {
                    var envelope = JsonSerializer.Deserialize<JsonElement>(message.ToString());
                    if (envelope.TryGetProperty("payload", out var payload) && payload.TryGetProperty("room_number", out var roomNode))
                    {
                        int roomNumber = 0;
                        if (roomNode.ValueKind == JsonValueKind.Number && roomNode.TryGetInt32(out int r1)) roomNumber = r1;
                        else if (roomNode.ValueKind == JsonValueKind.String && int.TryParse(roomNode.GetString(), out int r2)) roomNumber = r2;

                        if (roomNumber > 0)
                        {
                            using var scope = _serviceProvider.CreateScope();
                            var db = scope.ServiceProvider.GetRequiredService<HotelOsDbContext>();
                            
                            var existing = await db.HousekeepingTasks
                                .AnyAsync(t => t.RoomNumber == roomNumber && t.Status != "Finished");
                                
                            if (!existing)
                            {
                                var task = new HousekeepingTask
                                {
                                    RoomNumber = roomNumber,
                                    Status = "Pending",
                                    CreatedAt = DateTime.UtcNow
                                };
                                db.HousekeepingTasks.Add(task);
                                await db.SaveChangesAsync();
                                _logger.LogInformation($"[Redis Listener] Created cleaning task for room {roomNumber}");
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing room.vacated event");
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect Redis in Housekeeping subscriber");
        }

        // 2. Reconciliation Loop (runs every 2 seconds)
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<HotelOsDbContext>();

                var dirtyRooms = await db.Rooms
                    .Where(r => r.Status == "Dirty")
                    .ToListAsync(stoppingToken);

                foreach (var room in dirtyRooms)
                {
                    var existing = await db.HousekeepingTasks
                        .AnyAsync(t => t.RoomNumber == room.RoomNumber && t.Status != "Finished", stoppingToken);
                        
                    if (!existing)
                    {
                        var task = new HousekeepingTask
                        {
                            RoomNumber = room.RoomNumber,
                            Status = "Pending",
                            CreatedAt = DateTime.UtcNow
                        };
                        db.HousekeepingTasks.Add(task);
                        await db.SaveChangesAsync(stoppingToken);
                        _logger.LogInformation($"[Reconciler] Created cleaning task for dirty Room {room.RoomNumber}");
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in Housekeeping reconciler loop");
            }

            await Task.Delay(2000, stoppingToken);
        }
    }
}
