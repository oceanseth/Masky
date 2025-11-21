# Update CloudFront to point to the correct API Gateway
# This script updates the API Gateway origin to use the Terraform-managed API Gateway

$ErrorActionPreference = "Stop"

$DistributionId = "E33L46W61GEWHI"
$ApiGatewayId = $null

# Get API Gateway ID from Terraform output
Write-Host "[INFO] Getting API Gateway ID from Terraform..." -ForegroundColor Cyan
try {
    Push-Location terraform
    $terraformOutput = terraform output -json | ConvertFrom-Json
    $ApiGatewayId = $terraformOutput.api_gateway_id.value
    Pop-Location
    
    if (-not $ApiGatewayId) {
        Write-Host "[ERROR] Could not get API Gateway ID from Terraform" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "[OK] API Gateway ID: $ApiGatewayId" -ForegroundColor Green
} catch {
    Pop-Location
    Write-Host "[ERROR] Failed to get Terraform output: $_" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Fetching CloudFront distribution configuration..." -ForegroundColor Cyan

# Get current CloudFront config
$config = aws cloudfront get-distribution-config --id $DistributionId | ConvertFrom-Json
$etag = $config.ETag
$distConfig = $config.DistributionConfig

Write-Host "[OK] Configuration retrieved (ETag: $etag)" -ForegroundColor Green

# Find and update the API Gateway origin
$apiOrigin = $distConfig.Origins.Items | Where-Object { $_.Id -eq "api-gateway-origin" }

if ($apiOrigin) {
    $oldDomain = $apiOrigin.DomainName
    $newDomain = "$ApiGatewayId.execute-api.us-east-1.amazonaws.com"
    
    Write-Host "[INFO] Current API Gateway origin: $oldDomain" -ForegroundColor Yellow
    Write-Host "[INFO] New API Gateway origin: $newDomain" -ForegroundColor Yellow
    
    if ($oldDomain -ne $newDomain) {
        $apiOrigin.DomainName = $newDomain
        $apiOrigin.OriginPath = "/production"
        
        Write-Host "[UPDATE] Updating API Gateway origin..." -ForegroundColor Cyan
        Write-Host "  DomainName: $newDomain" -ForegroundColor Green
        Write-Host "  OriginPath: /production" -ForegroundColor Green
        
        # Save updated config
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        $json = $distConfig | ConvertTo-Json -Depth 100
        $tempFile = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
        
        # Update CloudFront
        Write-Host "[UPDATE] Applying CloudFront configuration..." -ForegroundColor Cyan
        $result = aws cloudfront update-distribution `
            --id $DistributionId `
            --distribution-config "file://$tempFile" `
            --if-match $etag
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[SUCCESS] CloudFront distribution updated!" -ForegroundColor Green
            Write-Host "[INFO] Changes are propagating (may take 15-20 minutes)" -ForegroundColor Yellow
        } else {
            Write-Host "[ERROR] Failed to update CloudFront distribution" -ForegroundColor Red
            exit 1
        }
        
        # Clean up temp file
        Remove-Item $tempFile -Force
    } else {
        Write-Host "[SKIP] API Gateway origin is already correct" -ForegroundColor Green
        
        # Still check OriginPath
        if ($apiOrigin.OriginPath -ne "/production") {
            Write-Host "[UPDATE] Updating OriginPath to /production..." -ForegroundColor Cyan
            $apiOrigin.OriginPath = "/production"
            
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            $json = $distConfig | ConvertTo-Json -Depth 100
            $tempFile = [System.IO.Path]::GetTempFileName()
            [System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
            
            $result = aws cloudfront update-distribution `
                --id $DistributionId `
                --distribution-config "file://$tempFile" `
                --if-match $etag
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[SUCCESS] OriginPath updated!" -ForegroundColor Green
            } else {
                Write-Host "[ERROR] Failed to update OriginPath" -ForegroundColor Red
                exit 1
            }
            
            Remove-Item $tempFile -Force
        } else {
            Write-Host "[OK] OriginPath is already correct" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[ERROR] API Gateway origin not found in CloudFront configuration" -ForegroundColor Red
    exit 1
}

