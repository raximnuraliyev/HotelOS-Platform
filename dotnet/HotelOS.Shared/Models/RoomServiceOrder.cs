using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("room_service_orders")]
public class RoomServiceOrder
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("guest_id")]
    public int GuestId { get; set; }
    
    [Column("items")]
    public string Items { get; set; } = "[]"; // JSON string
    
    [Column("total_price")]
    public decimal TotalPrice { get; set; }
    
    [Column("status")]
    public string Status { get; set; } = "Received"; // Received, Preparing, Out For Delivery, Delivered
    
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
