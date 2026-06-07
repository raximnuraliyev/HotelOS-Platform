using System;
using System.Collections.Generic;

namespace HotelOS.Shared.DTOs;

// Auth
public record LoginRequest(string Username, string Password);
public record CreateStaffRequest(string Username, string Password, string Role);

// Reception
public record CheckInRequest(
    string GuestName,
    string RoomType,
    int? FloorPreference,
    string? ProximityPreference,
    int Nights
);

public record CheckOutRequest(
    int RoomNumber,
    int LateCheckoutHours,
    decimal MinibarCharges,
    string DiscountType,
    decimal DiscountValue
);

// Room Service
public record OrderItemDto(string Name, int Quantity, decimal Price);
public record RoomServiceOrderRequest(
    int RoomNumber,
    int GuestId,
    List<OrderItemDto> Items
);

// Maintenance
public record MaintenanceIssueRequest(
    int RoomNumber,
    string Description,
    string UrgencyLevel,
    int? GuestId,
    string? BeforePhoto
);

public record AssignMaintenanceRequest(string Technician);

// Housekeeping
public record HousekeepingTaskRequest(
    int RoomNumber,
    string TaskType,
    string? AssignedHousekeeper
);
