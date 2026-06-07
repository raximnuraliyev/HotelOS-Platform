using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("staff_members")]
public class StaffMember
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("username")]
    public string Username { get; set; } = string.Empty;
    
    [Column("password")]
    public string Password { get; set; } = string.Empty;
    
    [Column("role")]
    public string Role { get; set; } = "receptionist"; // super_admin, receptionist, housekeeper, maintenance, kitchen_service
}
