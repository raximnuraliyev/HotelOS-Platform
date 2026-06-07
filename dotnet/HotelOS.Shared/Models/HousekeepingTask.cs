using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("housekeeping_tasks")]
public class HousekeepingTask
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("status")]
    public string Status { get; set; } = "Pending"; // Pending, In Progress, Finished
    
    [Column("assigned_housekeeper")]
    public string? AssignedHousekeeper { get; set; } // John, Sarah, etc.
    
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    [Column("started_at")]
    public DateTime? StartedAt { get; set; }
    
    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }
}
