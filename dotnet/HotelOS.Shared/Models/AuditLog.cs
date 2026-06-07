using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace HotelOS.Shared.Models;

[Table("audit_logs")]
public class AuditLog
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    [Column("id")]
    public int Id { get; set; }
    
    [Column("timestamp")]
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    
    [Column("service")]
    public string Service { get; set; } = string.Empty;
    
    [Column("event_type")]
    public string EventType { get; set; } = string.Empty;
    
    [Column("message")]
    public string Message { get; set; } = string.Empty;
    
    [Column("payload")]
    public string Payload { get; set; } = "{}"; // JSON string
}
