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

// Configure Kestrel for port 8004
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8004);
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

// Load pending issues into memory queue on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HotelOsDbContext>();
    var pendingIssues = db.MaintenanceIssues
        .Where(i => i.Status == "Pending")
        .ToList();
        
    MaintenanceQueue.Initialize(pendingIssues);
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

// Scheduler: Automatically assigns free technicians to highest priority issues
async Task AutoAssignTechniciansAsync(HotelOsDbContext db, IConnectionMultiplexer redis)
{
    var technicians = new[] { "John", "Sarah", "Mike" };
    
    // Find busy technicians
    var busyTechs = await db.MaintenanceIssues
        .Where(i => i.Status == "Assigned")
        .Select(i => i.AssignedTechnician)
        .Where(t => t != null)
        .Distinct()
        .ToListAsync();
        
    var freeTechs = technicians.Where(t => !busyTechs.Contains(t)).ToList();
    
    var pendingList = MaintenanceQueue.GetQueue();
    
    while (freeTechs.Any() && pendingList.Any())
    {
        var nextIssue = MaintenanceQueue.Dequeue();
        if (nextIssue == null) break;
        
        var dbIssue = await db.MaintenanceIssues.FindAsync(nextIssue.Id);
        if (dbIssue != null && dbIssue.Status == "Pending")
        {
            var assignedTech = freeTechs[0];
            freeTechs.RemoveAt(0);
            
            dbIssue.Status = "Assigned";
            dbIssue.AssignedTechnician = assignedTech;
            dbIssue.StartedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            
            // If critical, mark room status as Maintenance
            if (dbIssue.Priority == 1)
            {
                var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == dbIssue.RoomNumber);
                if (room != null)
                {
                    room.Status = "Maintenance";
                    await db.SaveChangesAsync();
                    await PublishEventAsync("room.status_changed", new { room_number = room.RoomNumber, status = "Maintenance" }, db, redis);
                }
            }
            
            // Publish event
            await PublishEventAsync("maintenance.assigned", new
            {
                id = dbIssue.Id,
                room_number = dbIssue.RoomNumber,
                description = dbIssue.Description,
                priority = dbIssue.Priority,
                status = "Assigned",
                assigned_technician = assignedTech,
                created_at = dbIssue.CreatedAt.ToString("o"),
                started_at = dbIssue.StartedAt.Value.ToString("o")
            }, db, redis);
            
            Console.WriteLine($"[Scheduler] Assigned {assignedTech} to ticket ID {dbIssue.Id}");
        }
        
        pendingList = MaintenanceQueue.GetQueue();
    }
}

// ====== REPORT MAINTENANCE ISSUE ======
app.MapPost("/api/maintenance/issue", async (
    [FromBody] MaintenanceIssueRequest req,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == req.RoomNumber);
    if (room == null)
    {
        return Results.Json(new { detail = "Room not found" }, statusCode: 404);
    }
    
    var priorityMap = new Dictionary<string, int>
    {
        { "Critical", 1 },
        { "High", 2 },
        { "Normal", 3 },
        { "Low", 4 }
    };
    int priorityVal = priorityMap.GetValueOrDefault(req.UrgencyLevel, 3);
    
    try
    {
        var issue = new MaintenanceIssue
        {
            RoomNumber = req.RoomNumber,
            GuestId = req.GuestId,
            Description = req.Description,
            Priority = priorityVal,
            Status = "Pending",
            BeforePhoto = req.BeforePhoto,
            CreatedAt = DateTime.UtcNow
        };
        db.MaintenanceIssues.Add(issue);
        await db.SaveChangesAsync();
        
        // Push into in-memory queue
        MaintenanceQueue.Enqueue(issue);
        
        // Publish created event
        await PublishEventAsync("maintenance.created", new
        {
            id = issue.Id,
            room_number = issue.RoomNumber,
            guest_id = issue.GuestId,
            description = issue.Description,
            priority = priorityVal,
            status = "Pending",
            before_photo = issue.BeforePhoto,
            created_at = issue.CreatedAt.ToString("o")
        }, db, redis);
        
        // Run auto-scheduler
        await AutoAssignTechniciansAsync(db, redis);
        
        return Results.Ok(new
        {
            message = "Maintenance issue reported.",
            issue_id = issue.Id,
            priority = priorityVal,
            status = issue.Status,
            assigned_technician = issue.AssignedTechnician
        });
    }
    catch (Exception ex)
    {
        db.Database.CurrentTransaction?.Rollback();
        return Results.Json(new { detail = $"Database transaction failed: {ex.Message}" }, statusCode: 500);
    }
});

// ====== GET ALL ISSUES (Staff Portal) ======
app.MapGet("/api/maintenance/issues", async (HotelOsDbContext db) =>
{
    var issues = await db.MaintenanceIssues.ToListAsync();
    return Results.Ok(issues);
}).RequireAuthorization();

// ====== GET ROOM ISSUES (Guest Portal with Isolation) ======
app.MapGet("/api/maintenance/room/{roomNumber}/issues", async (
    int roomNumber,
    HotelOsDbContext db,
    HttpContext ctx) =>
{
    var roomNumClaim = ctx.User.FindFirst("room_number")?.Value;
    if (roomNumClaim != roomNumber.ToString())
    {
        return Results.Json(new { detail = "Access forbidden: You cannot access operations or data for another room." }, statusCode: 403);
    }
    
    var guestIdClaim = ctx.User.FindFirst("guest_id")?.Value;
    int? guestId = int.TryParse(guestIdClaim, out int gid) ? gid : null;
    if (guestId.HasValue)
    {
        var activeGuest = await db.Guests.FirstOrDefaultAsync(g => g.RoomNumber == roomNumber && g.Status == "CheckedIn");
        if (activeGuest == null || activeGuest.Id != guestId.Value)
        {
            return Results.Json(new { detail = "Guest is not checked in." }, statusCode: 401);
        }
    }
    
    var issues = await db.MaintenanceIssues
        .Where(i => i.RoomNumber == roomNumber && i.GuestId == guestId)
        .ToListAsync();
        
    return Results.Ok(issues);
}).RequireAuthorization();

// ====== GET QUEUE ======
app.MapGet("/api/maintenance/queue", () =>
{
    var sorted = MaintenanceQueue.GetQueue();
    var list = sorted.Select(i => new
    {
        priority = i.Priority,
        timestamp = (double)new DateTimeOffset(i.CreatedAt).ToUnixTimeSeconds(),
        issue_id = i.Id
    });
    return Results.Ok(list);
}).RequireAuthorization();

// ====== RESOLVE ISSUE ======
app.MapPost("/api/maintenance/issues/{issueId}/resolve", async (
    [FromRoute] int issueId,
    [FromBody] MaintenanceResolve? req,
    HotelOsDbContext db,
    IConnectionMultiplexer redis) =>
{
    var issue = await db.MaintenanceIssues.FirstOrDefaultAsync(i => i.Id == issueId);
    if (issue == null)
    {
        return Results.Json(new { detail = "Maintenance ticket not found" }, statusCode: 404);
    }
    
    if (issue.Status != "Assigned")
    {
        return Results.Json(new { detail = $"Cannot resolve ticket in state: {issue.Status}" }, statusCode: 400);
    }
    
    try
    {
        issue.Status = "Resolved";
        issue.ResolvedAt = DateTime.UtcNow;
        if (req != null && !string.IsNullOrEmpty(req.AfterPhoto))
        {
            issue.AfterPhoto = req.AfterPhoto;
        }
        
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.RoomNumber == issue.RoomNumber);
        if (room != null && room.Status == "Maintenance")
        {
            var hasActiveGuest = await db.Guests.AnyAsync(g => g.RoomNumber == room.RoomNumber && g.Status == "CheckedIn");
            room.Status = hasActiveGuest ? "Occupied" : "Dirty";
            await PublishEventAsync("room.status_changed", new { room_number = room.RoomNumber, status = room.Status }, db, redis);
        }
        
        await db.SaveChangesAsync();
        
        // Publish resolved event
        await PublishEventAsync("maintenance.resolved", new
        {
            id = issue.Id,
            room_number = issue.RoomNumber,
            assigned_technician = issue.AssignedTechnician,
            status = "Resolved",
            after_photo = issue.AfterPhoto,
            resolved_at = issue.ResolvedAt.Value.ToString("o")
        }, db, redis);
        
        // Run auto-scheduler for next ticket
        await AutoAssignTechniciansAsync(db, redis);
        
        return Results.Ok(new { message = "Issue marked resolved. Technician is now available." });
    }
    catch (Exception ex)
    {
        db.Database.CurrentTransaction?.Rollback();
        return Results.Json(new { detail = $"Database update failed: {ex.Message}" }, statusCode: 500);
    }
}).RequireAuthorization();

app.Run();

// ====== DTO FOR RESOLVE ======
public record MaintenanceResolve(string? AfterPhoto);

// ====== IN-MEMORY PRIORITY QUEUE ======
public static class MaintenanceQueue
{
    private static readonly List<MaintenanceIssue> Queue = new();
    private static readonly object LockObj = new();

    public static void Initialize(IEnumerable<MaintenanceIssue> issues)
    {
        lock (LockObj)
        {
            Queue.Clear();
            Queue.AddRange(issues);
        }
    }

    public static void Enqueue(MaintenanceIssue issue)
    {
        lock (LockObj)
        {
            Queue.Add(issue);
        }
    }

    public static List<MaintenanceIssue> GetQueue()
    {
        lock (LockObj)
        {
            return Queue
                .OrderBy(i => i.Priority)
                .ThenBy(i => i.CreatedAt)
                .ThenBy(i => i.Id)
                .ToList();
        }
    }

    public static MaintenanceIssue? Dequeue()
    {
        lock (LockObj)
        {
            var sorted = Queue
                .OrderBy(i => i.Priority)
                .ThenBy(i => i.CreatedAt)
                .ThenBy(i => i.Id)
                .FirstOrDefault();
            if (sorted != null)
            {
                Queue.Remove(sorted);
            }
            return sorted;
        }
    }
}
