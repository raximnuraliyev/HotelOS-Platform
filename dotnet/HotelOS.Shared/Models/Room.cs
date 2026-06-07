using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("rooms")]
public class Room
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.None)]
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("room_type")]
    public string RoomType { get; set; } = "Single"; // Single, Double, Accessible, Suite
    
    [Column("floor")]
    public int Floor { get; set; }
    
    [Column("status")]
    public string Status { get; set; } = "Clean"; // Clean, Dirty, Being Cleaned, Occupied, Maintenance
    
    [Column("nightly_rate")]
    public decimal NightlyRate { get; set; }
    
    [Column("clean_since")]
    public DateTime CleanSince { get; set; } = DateTime.UtcNow;
    
    [Column("near_elevator")]
    public bool NearElevator { get; set; }
    
    [Column("near_stairs")]
    public bool NearStairs { get; set; }
}
