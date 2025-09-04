# Safe startup script for AutoStream V3
# This script ensures a clean environment before starting the server

Write-Host "AutoStream V3 Safe Startup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Run security check first
& "$PSScriptRoot\security-check.ps1"

Write-Host ""
Write-Host "Starting AutoStream V3 server..." -ForegroundColor Green
Write-Host "Server will be available at: http://localhost:7010" -ForegroundColor Green
Write-Host "Configuration UI: http://localhost:7010/configure" -ForegroundColor Green
Write-Host ""

# Start the server
node server.js
