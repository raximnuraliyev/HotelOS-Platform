using Microsoft.EntityFrameworkCore;
using HotelOS.Shared.Models;
using System;
using System.Collections.Generic;

namespace HotelOS.Shared.Data;

public class HotelOsDbContext : DbContext
{
    public HotelOsDbContext(DbContextOptions<HotelOsDbContext> options) : base(options) { }
    
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Guest> Guests => Set<Guest>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<StaffMember> Staff => Set<StaffMember>();
    public DbSet<HousekeepingTask> HousekeepingTasks => Set<HousekeepingTask>();
    public DbSet<RoomServiceOrder> RoomServiceOrders => Set<RoomServiceOrder>();
    public DbSet<MaintenanceIssue> MaintenanceIssues => Set<MaintenanceIssue>();
    public DbSet<BillingRecord> BillingRecords => Set<BillingRecord>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        
        // Seed the exactly 10 rooms matching backend/shared/config.py
        var rooms = new List<Room>
        {
            new Room { RoomNumber = 101, RoomType = "Single", Floor = 1, NightlyRate = 100.00m, NearElevator = true, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 102, RoomType = "Single", Floor = 1, NightlyRate = 100.00m, NearElevator = false, NearStairs = true, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 103, RoomType = "Double", Floor = 1, NightlyRate = 150.00m, NearElevator = false, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 104, RoomType = "Double", Floor = 1, NightlyRate = 150.00m, NearElevator = false, NearStairs = true, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 105, RoomType = "Accessible", Floor = 1, NightlyRate = 120.00m, NearElevator = true, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 201, RoomType = "Single", Floor = 2, NightlyRate = 110.00m, NearElevator = true, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 202, RoomType = "Single", Floor = 2, NightlyRate = 110.00m, NearElevator = false, NearStairs = true, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 203, RoomType = "Double", Floor = 2, NightlyRate = 160.00m, NearElevator = false, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 204, RoomType = "Double", Floor = 2, NightlyRate = 160.00m, NearElevator = false, NearStairs = true, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
            new Room { RoomNumber = 205, RoomType = "Suite", Floor = 2, NightlyRate = 300.00m, NearElevator = true, NearStairs = false, CleanSince = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) }
        };
        
        modelBuilder.Entity<Room>().HasData(rooms);
        
        // Seed initial staff members matching backend/shared/database.py
        var staff = new List<StaffMember>
        {
            new StaffMember { Id = 1, Username = "admin", Password = "hotelos123", Role = "super_admin" },
            new StaffMember { Id = 2, Username = "recep1", Password = "hotelos123", Role = "receptionist" },
            new StaffMember { Id = 3, Username = "house1", Password = "hotelos123", Role = "housekeeper" },
            new StaffMember { Id = 4, Username = "tech1", Password = "hotelos123", Role = "maintenance" },
            new StaffMember { Id = 5, Username = "chef1", Password = "hotelos123", Role = "kitchen_service" }
        };
        
        modelBuilder.Entity<StaffMember>().HasData(staff);
    }
}
