using System;

namespace HotelOS.Shared.DTOs;

public record LoginResponse(
    string AccessToken,
    string TokenType,
    string StaffRole,
    string Username
);

public record BillingBreakdown(
    decimal RoomCharges,
    decimal RoomServiceCharges,
    decimal MinibarCharges,
    decimal LateCheckoutFees,
    decimal Subtotal,
    decimal Discount,
    decimal Tax,
    decimal GrandTotal,
    string ItemizedBill,
    int Nights
);

public record DashboardStats(
    int TotalRooms,
    int OccupiedRooms,
    int CleanRooms,
    int DirtyRooms,
    int MaintenanceRooms,
    int ActiveGuests,
    int PendingOrders,
    int OpenIssues
);
