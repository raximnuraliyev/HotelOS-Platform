using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("bookings")]
public class Booking
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("guest_id")]
    public int GuestId { get; set; }
    
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("check_in_time")]
    public DateTime CheckInTime { get; set; } = DateTime.UtcNow;
    
    [Column("check_out_time")]
    public DateTime? CheckOutTime { get; set; }
    
    [Column("nights")]
    public int Nights { get; set; }
    
    [Column("status")]
    public string Status { get; set; } = "Active"; // Active, Completed
}
