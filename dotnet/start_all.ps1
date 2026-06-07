# HotelOS - Start All Microservices
# This script starts all 5 microservices in separate PowerShell windows

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HotelOS Microservices Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$basePath = $PSScriptRoot

# Service definitions
$services = @(
    @{ Name = "Reception";           Port = 8001; Path = "$basePath\HotelOS.Reception" },
    @{ Name = "Housekeeping";        Port = 8002; Path = "$basePath\HotelOS.Housekeeping" },
    @{ Name = "RoomService";         Port = 8003; Path = "$basePath\HotelOS.RoomService" },
    @{ Name = "Maintenance";         Port = 8004; Path = "$basePath\HotelOS.Maintenance" },
    @{ Name = "NotificationGateway"; Port = 8005; Path = "$basePath\HotelOS.NotificationGateway" }
)

# Check Redis
Write-Host "[CHECK] Verifying Redis is running..." -ForegroundColor Yellow
try {
    $redis = New-Object System.Net.Sockets.TcpClient
    $redis.Connect("localhost", 6379)
    $redis.Close()
    Write-Host "[OK] Redis is running on port 6379" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Redis is not running on port 6379. Starting Redis..." -ForegroundColor Red
    Write-Host "       Make sure Redis is installed and start it manually if needed." -ForegroundColor Red
}

Write-Host ""
Write-Host "Starting microservices..." -ForegroundColor Yellow
Write-Host ""

foreach ($svc in $services) {
    Write-Host "  Starting $($svc.Name) on port $($svc.Port)..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "cd '$($svc.Path)'; Write-Host '=== HotelOS $($svc.Name) Service (Port $($svc.Port)) ===' -ForegroundColor Green; dotnet run"
    )
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All services started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Service Endpoints:" -ForegroundColor White
Write-Host "    Reception:      http://localhost:8001" -ForegroundColor Gray
Write-Host "    Housekeeping:    http://localhost:8002" -ForegroundColor Gray
Write-Host "    Room Service:    http://localhost:8003" -ForegroundColor Gray
Write-Host "    Maintenance:     http://localhost:8004" -ForegroundColor Gray
Write-Host "    Notifications:   http://localhost:8005" -ForegroundColor Gray
Write-Host "    SignalR Hub:     http://localhost:8005/hubs/notifications" -ForegroundColor Gray
Write-Host ""
