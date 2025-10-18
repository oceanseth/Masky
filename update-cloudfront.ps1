# Update CloudFront to forward Authorization header for /api/* path

$distributionId = "E33L46W61GEWHI"

Write-Host "Fetching current CloudFront configuration..." -ForegroundColor Yellow

# Get current config
$config = aws cloudfront get-distribution-config --id $distributionId | ConvertFrom-Json
$etag = $config.ETag
$distConfig = $config.DistributionConfig

Write-Host "Current configuration retrieved (ETag: $etag)" -ForegroundColor Green

# Find the /api/* cache behavior
$apiBehavior = $distConfig.CacheBehaviors.Items | Where-Object { $_.PathPattern -eq "/api/*" }

if ($apiBehavior) {
    Write-Host "Found /api/* behavior" -ForegroundColor Green
    
    # Use AWS managed "AllViewer" origin request policy
    # This forwards all viewer headers including Authorization
    $managedPolicyId = "216adef6-5c7f-47e4-b989-5492eafa07d3"
    
    # Add the OriginRequestPolicyId property to the behavior
    $apiBehavior | Add-Member -MemberType NoteProperty -Name "OriginRequestPolicyId" -Value $managedPolicyId -Force
    
    Write-Host "Added OriginRequestPolicyId: $managedPolicyId (AllViewer - forwards all headers)" -ForegroundColor Green
    
    # Save updated config to file with UTF8 encoding (no BOM)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $json = $distConfig | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText("$PSScriptRoot\cloudfront-updated.json", $json, $utf8NoBom)
    
    Write-Host "Configuration saved to cloudfront-updated.json" -ForegroundColor Green
    Write-Host "Updating CloudFront distribution..." -ForegroundColor Yellow
    
    # Update the distribution
    $result = aws cloudfront update-distribution `
        --id $distributionId `
        --distribution-config file://cloudfront-updated.json `
        --if-match $etag
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "SUCCESS! CloudFront distribution updated." -ForegroundColor Green
        Write-Host "The distribution is now deploying (this takes 5-10 minutes)." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "The Authorization header will now be forwarded to your API." -ForegroundColor Green
        Write-Host ""
        Write-Host "After deployment completes, you can revert src/config.js to use CloudFront:" -ForegroundColor Cyan
        Write-Host "  return window.location.origin;" -ForegroundColor Gray
    } else {
        Write-Host "ERROR updating distribution" -ForegroundColor Red
        Write-Host $result
    }
} else {
    Write-Host "ERROR: Could not find /api/* cache behavior" -ForegroundColor Red
    Write-Host "Available behaviors:"
    $distConfig.CacheBehaviors.Items | ForEach-Object { Write-Host "  - $($_.PathPattern)" }
}

