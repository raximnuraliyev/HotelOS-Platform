using HotelOS.Shared.Extensions;
using HotelOS.Shared.Auth;
using HotelOS.NotificationGateway.Workers;
using Microsoft.IdentityModel.Tokens;
using System;
using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8005);
});

builder.Services.AddHotelOsRedis();
builder.Services.AddSingleton<JwtSettings>();
builder.Services.AddHostedService<RedisSubscriberWorker>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();

app.UseCors();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(120)
});

// Raw WebSockets Endpoint supporting JWT query parameter auth
app.Map("/ws", async (HttpContext context, JwtSettings jwtSettings) =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var token = context.Request.Query["token"].ToString();
        string role = "anonymous";
        int? roomNumber = null;

        if (!string.IsNullOrEmpty(token))
        {
            try
            {
                var handler = new JwtSecurityTokenHandler();
                var validationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Secret))
                };

                // Decode token and extract role and room number
                var principal = handler.ValidateToken(token, validationParameters, out _);
                role = principal.FindFirst("role")?.Value ?? "anonymous";
                var roomStr = principal.FindFirst("room_number")?.Value;
                if (int.TryParse(roomStr, out int rNum))
                {
                    roomNumber = rNum;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Gateway Warning] JWT Validation failed: {ex.Message}");
            }
        }

        using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
        var socketId = Guid.NewGuid().ToString();
        
        WebSocketManager.AddConnection(socketId, webSocket, role, roomNumber);

        try
        {
            var buffer = new byte[1024 * 4];
            while (webSocket.State == WebSocketState.Open)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await webSocket.CloseAsync(result.CloseStatus.Value, result.CloseStatusDescription, CancellationToken.None);
                }
                else if (result.MessageType == WebSocketMessageType.Text)
                {
                    var receivedText = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    if (receivedText == "ping")
                    {
                        var pongBytes = Encoding.UTF8.GetBytes("pong");
                        await webSocket.SendAsync(new ArraySegment<byte>(pongBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Gateway Socket Error] {ex.Message}");
        }
        finally
        {
            WebSocketManager.RemoveConnection(socketId, role, roomNumber);
        }
    }
    else
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
    }
});

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "NotificationGateway", timestamp = DateTime.UtcNow }));

app.Run();

// ====== STATIC WEBSOCKET MANAGER ======
public static class WebSocketManager
{
    private static readonly ConcurrentDictionary<string, WebSocket> StaffConnections = new();
    private static readonly ConcurrentDictionary<int, ConcurrentDictionary<string, WebSocket>> GuestConnections = new();

    public static void AddConnection(string id, WebSocket socket, string role, int? roomNumber)
    {
        if (role == "admin" || (role == "anonymous" && roomNumber == null))
        {
            StaffConnections.TryAdd(id, socket);
            Console.WriteLine($"[Gateway] Connected staff/anonymous. Total staff: {StaffConnections.Count}");
        }
        else if (role == "guest" && roomNumber.HasValue)
        {
            var roomSockets = GuestConnections.GetOrAdd(roomNumber.Value, _ => new ConcurrentDictionary<string, WebSocket>());
            roomSockets.TryAdd(id, socket);
            Console.WriteLine($"[Gateway] Connected guest for room {roomNumber.Value}. Total for room: {roomSockets.Count}");
        }
        else
        {
            StaffConnections.TryAdd(id, socket);
            Console.WriteLine($"[Gateway] Connected fallback. Total staff: {StaffConnections.Count}");
        }
    }

    public static void RemoveConnection(string id, string role, int? roomNumber)
    {
        StaffConnections.TryRemove(id, out _);
        if (roomNumber.HasValue && GuestConnections.TryGetValue(roomNumber.Value, out var roomSockets))
        {
            roomSockets.TryRemove(id, out _);
            if (roomSockets.IsEmpty)
            {
                GuestConnections.TryRemove(roomNumber.Value, out _);
            }
        }
        Console.WriteLine("[Gateway] Disconnected socket.");
    }

    public static async Task BroadcastEventAsync(string messageJson)
    {
        string filteredMessage = messageJson;
        JsonElement eventData;
        try
        {
            eventData = JsonSerializer.Deserialize<JsonElement>(messageJson);
        }
        catch
        {
            return;
        }

        // Filter sensitive fields
        try
        {
            var jsonNode = System.Text.Json.Nodes.JsonNode.Parse(messageJson);
            if (jsonNode != null && jsonNode["payload"] is System.Text.Json.Nodes.JsonObject payloadNode)
            {
                payloadNode.Remove("credit_card");
                payloadNode.Remove("passport");
                payloadNode.Remove("private_billing_details");
            }
            filteredMessage = jsonNode?.ToJsonString() ?? messageJson;
        }
        catch
        {
            // Fallback to original if parse fails
        }

        var bytes = Encoding.UTF8.GetBytes(filteredMessage);

        // 1. Send to all staff / anonymous connections
        foreach (var socket in StaffConnections.Values)
        {
            if (socket.State == WebSocketState.Open)
            {
                try
                {
                    await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch
                {
                    // Ignore transient errors
                }
            }
        }

        // 2. Send to specific room guest connections
        if (eventData.TryGetProperty("payload", out var payloadElement) && payloadElement.ValueKind == JsonValueKind.Object)
        {
            int? roomNumber = null;
            if (payloadElement.TryGetProperty("room_number", out var roomElement))
            {
                if (roomElement.ValueKind == JsonValueKind.Number && roomElement.TryGetInt32(out int r1))
                {
                    roomNumber = r1;
                }
                else if (roomElement.ValueKind == JsonValueKind.String && int.TryParse(roomElement.GetString(), out int r2))
                {
                    roomNumber = r2;
                }
            }

            if (roomNumber.HasValue && GuestConnections.TryGetValue(roomNumber.Value, out var roomSockets))
            {
                foreach (var socket in roomSockets.Values)
                {
                    if (socket.State == WebSocketState.Open)
                    {
                        try
                        {
                            await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                        }
                        catch
                        {
                            // Ignore transient errors
                        }
                    }
                }
            }
        }
    }
}
