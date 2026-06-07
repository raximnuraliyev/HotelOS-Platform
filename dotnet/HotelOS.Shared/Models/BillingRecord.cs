using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("billing_records")]
public class BillingRecord
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("guest_id")]
    public int GuestId { get; set; }
    
    [Column("room_number")]
    public int RoomNumber { get; set; }
    
    [Column("room_charges")]
    public decimal RoomCharges { get; set; }
    
    [Column("room_service_charges")]
    public decimal RoomServiceCharges { get; set; }
    
    [Column("minibar_charges")]
    public decimal MinibarCharges { get; set; }
    
    [Column("late_checkout_fees")]
    public decimal LateCheckoutFees { get; set; }
    
    [Column("discount")]
    public decimal Discount { get; set; }
    
    [Column("tax")]
    public decimal Tax { get; set; }
    
    [Column("grand_total")]
    public decimal GrandTotal { get; set; }
    
    [Column("itemized_bill")]
    public string ItemizedBill { get; set; } = string.Empty;
    
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
