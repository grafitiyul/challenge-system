param(
    [Parameter(Mandatory = $true)]
    [string]$Message
)

Set-Location $PSScriptRoot

Write-Host "Starting deploy..." -ForegroundColor Cyan

Write-Host "`nStatus:" -ForegroundColor Gray
git status
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git status failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nStaging all changes..." -ForegroundColor Gray
git add .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git add failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nCommitting..." -ForegroundColor Gray
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed. Nothing to commit, or another error." -ForegroundColor Red
    exit 1
}

Write-Host "`nPushing..." -ForegroundColor Gray
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nDeploy completed successfully." -ForegroundColor Green
