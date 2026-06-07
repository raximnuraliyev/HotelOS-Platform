using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("maintenance_issues")]
public class MaintenanceIssue
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("guest_id")]
    public int? GuestId { get; set; }
    
    [Column("description")]
    public string Description { get; set; } = string.Empty;
    
    [Column("priority")]
    public int Priority { get; set; } // Critical=1, High=2, Normal=3, Low=4
    
    [Column("status")]
    public string Status { get; set; } = "Pending"; // Pending, Assigned, Resolved
    
    [Column("assigned_technician")]
    public string? AssignedTechnician { get; set; } // John, Sarah, Mike
    
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    [Column("started_at")]
    public DateTime? StartedAt { get; set; }
    
    [Column("resolved_at")]
    public DateTime? ResolvedAt { get; set; }
    
    [Column("before_photo")]
    public string? BeforePhoto { get; set; }
    
    [Column("after_photo")]
    public string? AfterPhoto { get; set; }
}
