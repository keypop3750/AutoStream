# Security check script for AutoStream V3
# Run this before starting the server to ensure no dangerous environment variables exist

Write-Host "Checking for dangerous environment variables..." -ForegroundColor Yellow

$dangerousVars = @('AD_KEY', 'ALLDEBRID_KEY', 'ALLDEBRID_API_KEY', 'AUTOSTREAM_AD_KEY')
$found = @()

foreach ($var in $dangerousVars) {
    $envVar = Get-Item "Env:$var" -ErrorAction SilentlyContinue
    if ($envVar) {
        $found += $var
        Write-Host "FOUND DANGEROUS VARIABLE: $var" -ForegroundColor Red
        Remove-Item "Env:$var" -ErrorAction SilentlyContinue
        Write-Host "Removed: $var" -ForegroundColor Green
    }
}

if ($found.Count -eq 0) {
    Write-Host "No dangerous environment variables found. Safe to start server." -ForegroundColor Green
} else {
    Write-Host "Removed $($found.Count) dangerous variables: $($found -join ', ')" -ForegroundColor Yellow
    Write-Host "These variables could have leaked your credentials to all users!" -ForegroundColor Yellow
}

Write-Host "Security check complete." -ForegroundColor Cyan
