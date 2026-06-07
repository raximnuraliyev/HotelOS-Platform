namespace HotelOS.Shared.Auth;

public class JwtSettings
{
    public string Secret { get; set; } = "HotelOS-SuperSecret-JWT-Key-2025-MustBe32CharsLong!";
    public string Issuer { get; set; } = "HotelOS";
    public string Audience { get; set; } = "HotelOS-Staff";
    public int ExpiryMinutes { get; set; } = 480; // 8 hours
}
