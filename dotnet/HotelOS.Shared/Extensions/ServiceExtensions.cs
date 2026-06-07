using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using HotelOS.Shared.Data;
using StackExchange.Redis;

namespace HotelOS.Shared.Extensions;

public static class ServiceExtensions
{
    public static IServiceCollection AddHotelOsDb(this IServiceCollection services, string dbPath = "hotelOS.db")
    {
        services.AddDbContext<HotelOsDbContext>(options =>
        {
            options.UseSqlite($"Data Source={dbPath}");
        });
        
        return services;
    }
    
    public static IServiceCollection AddHotelOsRedis(this IServiceCollection services, string connectionString = "localhost:6379")
    {
        services.AddSingleton<IConnectionMultiplexer>(_ =>
            ConnectionMultiplexer.Connect(connectionString));
        
        return services;
    }
    
    public static void InitializeDatabase(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HotelOsDbContext>();
        db.Database.EnsureCreated();
        
        // Enable WAL mode and set busy timeout
        db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");
        db.Database.ExecuteSqlRaw("PRAGMA busy_timeout=5000;");
    }
}
