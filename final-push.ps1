# AutoStream V3 - Final Push Script
# Handle git pull and push with merge resolution

Write-Host "AutoStream V3 - Final Push Script" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Ensure we're in the right directory
Set-Location "c:\Users\karol\Desktop\AutoStreamV3"

Write-Host "Pulling latest changes from GitHub..." -ForegroundColor Yellow
git pull origin autostream-v3-optimized

if ($LASTEXITCODE -eq 0) {
    Write-Host "Pull successful!" -ForegroundColor Green
    
    # Push to GitHub
    Write-Host "`nPushing to GitHub..." -ForegroundColor Yellow
    git push origin autostream-v3-optimized
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Push successful!" -ForegroundColor Green
        Write-Host "`nAutoStream V3 with defensive security measures successfully pushed to GitHub!" -ForegroundColor Green
        Write-Host "Repository: keypop3750/AutoStream" -ForegroundColor Gray
        Write-Host "Branch: autostream-v3-optimized" -ForegroundColor Gray
        Write-Host "`nChanges include:" -ForegroundColor Cyan
        Write-Host "- Comprehensive defensive security measures" -ForegroundColor Gray
        Write-Host "- Process-level error handlers and crash prevention" -ForegroundColor Gray
        Write-Host "- Rate limiting and concurrency control" -ForegroundColor Gray
        Write-Host "- AllDebrid API protection with circuit breakers" -ForegroundColor Gray
        Write-Host "- Memory monitoring and input validation" -ForegroundColor Gray
        Write-Host "- 73 test/debug files organized in dev-files/" -ForegroundColor Gray
    } else {
        Write-Host "Push failed. Manual intervention may be required." -ForegroundColor Red
    }
} else {
    Write-Host "Pull failed or merge conflicts detected." -ForegroundColor Red
    Write-Host "Please resolve any conflicts manually and run:" -ForegroundColor Yellow
    Write-Host "  git push origin autostream-v3-optimized" -ForegroundColor Gray
}
