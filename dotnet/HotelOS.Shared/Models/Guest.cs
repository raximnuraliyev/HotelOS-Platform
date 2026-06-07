using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("guests")]
public class Guest
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("name")]
    public string Name { get; set; } = string.Empty;
    
    [Column("reservation_code")]
    public string ReservationCode { get; set; } = string.Empty;
    
    [Column("room_number")]
    public int? RoomNumber { get; set; }
    
    [Column("status")]
    public string Status { get; set; } = "Reserved"; // Reserved, CheckedIn, CheckedOut
}
