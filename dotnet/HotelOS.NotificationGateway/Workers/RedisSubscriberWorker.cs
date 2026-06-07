using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace HotelOS.NotificationGateway.Workers;

public class RedisSubscriberWorker : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<RedisSubscriberWorker> _logger;
    
    public RedisSubscriberWorker(
        IConnectionMultiplexer redis,
        ILogger<RedisSubscriberWorker> logger)
    {
        _redis = redis;
        _logger = logger;
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var subscriber = _redis.GetSubscriber();
        
        var channels = new string[]
        {
            "guest.checked_in",
            "guest.checked_out",
            "room.vacated",
            "room.cleaning_started",
            "room.cleaned",
            "room.status_changed",
            "room_service.created",
            "room_service.updated",
            "maintenance.created",
            "maintenance.assigned",
            "maintenance.resolved",
            "dashboard.notification"
        };
        
        _logger.LogInformation("Redis Subscriber Worker started. Subscribing to events.");

        foreach (var ch in channels)
        {
            var channel = new RedisChannel(ch, RedisChannel.PatternMode.Literal);
            await subscriber.SubscribeAsync(channel, async (redisChannel, message) =>
            {
                var msgStr = message.ToString();
                _logger.LogInformation($"[Broker Event] Received on '{redisChannel}': {msgStr}");
                
                try
                {
                    // Broadcast through raw WebSockets
                    await WebSocketManager.BroadcastEventAsync(msgStr);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error broadcasting Redis event");
                }
            });
        }
        
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(1000, stoppingToken);
        }
    }
}
