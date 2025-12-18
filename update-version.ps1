# Update version.js with current timestamp
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Set-Content -Path 'version.js' -Value "// Auto-generated version hash`nwindow.APP_VERSION = $timestamp;"
Write-Host "Version updated to: $timestamp" -ForegroundColor Green
