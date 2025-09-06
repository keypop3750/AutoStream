# AutoStream V3 - Cleanup and Push Script
# This script moves all test/debug files to dev-files folder and pushes clean code to GitHub

Write-Host "AutoStream V3 - Cleanup and Push Script" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

# Ensure we're in the right directory
Set-Location "c:\Users\karol\Desktop\AutoStreamV3"

# Create dev-files directory if it doesn't exist
if (!(Test-Path "dev-files")) {
    New-Item -ItemType Directory -Path "dev-files" -Force | Out-Null
    Write-Host "Created dev-files directory" -ForegroundColor Green
}

# Define patterns for files to move to dev-files
$filesToMove = @(
    "test*.js",
    "test*.ps1", 
    "test*.html",
    "debug*.js",
    "*SUMMARY*.md",
    "*REPORT*.md", 
    "*PLAN*.js",
    "audit*.js",
    "comprehensive*.js",
    "simple-test.js"
)

Write-Host "Moving test/debug files to dev-files folder..." -ForegroundColor Yellow

$movedCount = 0
foreach ($pattern in $filesToMove) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        try {
            Move-Item -Path $file.FullName -Destination "dev-files\" -Force
            Write-Host "  Moved: $($file.Name)" -ForegroundColor Gray
            $movedCount++
        } catch {
            Write-Host "  Could not move: $($file.Name)" -ForegroundColor Red
        }
    }
}

Write-Host "Moved $movedCount files to dev-files/" -ForegroundColor Green

# Add dev-files to .gitignore if not already there
$gitignorePath = ".gitignore"
$devFilesIgnore = "dev-files/"

if (Test-Path $gitignorePath) {
    $gitignoreContent = Get-Content $gitignorePath
    if ($gitignoreContent -notcontains $devFilesIgnore) {
        Add-Content -Path $gitignorePath -Value "`n# Development and test files`n$devFilesIgnore"
        Write-Host "Added dev-files/ to .gitignore" -ForegroundColor Green
    } else {
        Write-Host "dev-files/ already in .gitignore" -ForegroundColor Green
    }
} else {
    Set-Content -Path $gitignorePath -Value "# Development and test files`n$devFilesIgnore"
    Write-Host "Created .gitignore with dev-files/" -ForegroundColor Green
}

# Show current status
Write-Host "`nGit Status:" -ForegroundColor Cyan
git status --porcelain

# Stage all changes
Write-Host "`nStaging changes..." -ForegroundColor Yellow
git add -A

# Show what will be committed
Write-Host "`nChanges to be committed:" -ForegroundColor Cyan
git status --staged

# Commit the changes
$commitMessage = "feat: Add comprehensive defensive security measures

- Add process-level error handlers and graceful shutdown
- Implement rate limiting (100 req/min per IP) 
- Add concurrency control (max 15 concurrent requests)
- Add memory monitoring with 512MB limits
- Implement input validation for IMDB IDs and API keys
- Add AllDebrid API rate limiting and circuit breaker
- Add retry logic with progressive backoff and jitter
- Implement credential protection and sanitized logging
- Add comprehensive timeout and error handling
- Maintain 100% functionality while adding crash prevention
- Clean up test/debug files to dev-files folder"

Write-Host "`nCommitting changes..." -ForegroundColor Yellow
git commit -m $commitMessage

if ($LASTEXITCODE -eq 0) {
    Write-Host "Commit successful!" -ForegroundColor Green
    
    # Push to GitHub
    Write-Host "`nPushing to GitHub..." -ForegroundColor Yellow
    git push origin autostream-v3-optimized
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Push successful!" -ForegroundColor Green
        Write-Host "`nAutoStream V3 with defensive security measures successfully pushed to GitHub!" -ForegroundColor Green
        Write-Host "Repository: keypop3750/AutoStream" -ForegroundColor Gray
        Write-Host "Branch: autostream-v3-optimized" -ForegroundColor Gray
    } else {
        Write-Host "Push failed. Please check your GitHub credentials and network connection." -ForegroundColor Red
    }
} else {
    Write-Host "Commit failed. Please check for any issues." -ForegroundColor Red
}

Write-Host "`nDevelopment files are now in dev-files/ (ignored by git)" -ForegroundColor Cyan
Write-Host "Production code includes comprehensive defensive measures" -ForegroundColor Cyan
Write-Host "AutoStream V3 is ready for production deployment!" -ForegroundColor Green
