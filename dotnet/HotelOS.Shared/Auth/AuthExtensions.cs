using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;

namespace HotelOS.Shared.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddHotelOsAuth(this IServiceCollection services, JwtSettings? settings = null)
    {
        settings ??= new JwtSettings();
        
        JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();
        
        services.AddSingleton(settings);
        
        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = settings.Issuer,
                ValidateAudience = true,
                ValidAudience = settings.Audience,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.Secret))
            };
        });
        
        services.AddAuthorization();
        
        return services;
    }
}
