# Configure CloudFront to route user URLs (/{username}) to user.html
# This script updates the existing CloudFront function to handle user URL rewriting

$distributionId = "E33L46W61GEWHI"
$functionName = "www-redirect-masky"
$accountId = "218827615080"

Write-Host "Configuring CloudFront for user URLs..." -ForegroundColor Yellow
Write-Host "Distribution ID: $distributionId" -ForegroundColor Cyan
Write-Host "Function Name: $functionName" -ForegroundColor Cyan

# Read the function code
$functionCodePath = Join-Path $PSScriptRoot "iac\user-url-function.js"
if (-not (Test-Path $functionCodePath)) {
    Write-Host "ERROR: Function code file not found at $functionCodePath" -ForegroundColor Red
    exit 1
}

$functionCode = Get-Content $functionCodePath -Raw -Encoding UTF8

Write-Host "`nStep 1: Getting current function configuration (DEVELOPMENT stage)..." -ForegroundColor Yellow
# Use describe-function to get ETag for DEVELOPMENT stage
$functionDesc = aws cloudfront describe-function --name $functionName --stage DEVELOPMENT 2>&1
$functionETag = $null

if ($LASTEXITCODE -eq 0) {
    $functionETag = ($functionDesc | ConvertFrom-Json).ETag
    Write-Host "Found existing function in DEVELOPMENT stage (ETag: $functionETag)" -ForegroundColor Green
} else {
    Write-Host "Function not found in DEVELOPMENT stage. Checking LIVE stage..." -ForegroundColor Yellow
    # Try LIVE stage
    $functionDesc = aws cloudfront describe-function --name $functionName --stage LIVE 2>&1
    if ($LASTEXITCODE -eq 0) {
        $functionETag = ($functionDesc | ConvertFrom-Json).ETag
        Write-Host "Found function in LIVE stage (ETag: $functionETag)" -ForegroundColor Green
        Write-Host "Note: We'll update DEVELOPMENT stage, then publish to LIVE" -ForegroundColor Yellow
    }
}

if ($functionETag) {
    Write-Host "`nStep 2: Updating function code in DEVELOPMENT stage..." -ForegroundColor Yellow
    
    # Get fresh ETag from DEVELOPMENT stage using describe-function
    $devDesc = aws cloudfront describe-function --name $functionName --stage DEVELOPMENT 2>&1
    if ($LASTEXITCODE -eq 0) {
        $devETag = ($devDesc | ConvertFrom-Json).ETag
    } else {
        Write-Host "Could not get DEVELOPMENT stage ETag, using cached value" -ForegroundColor Yellow
        $devETag = $functionETag
    }
    
    # Update the function in DEVELOPMENT stage
    $updateResult = aws cloudfront update-function `
        --name $functionName `
        --function-code fileb://$functionCodePath `
        --function-config Comment="Redirects www to non-www and rewrites user URLs to user.html",Runtime="cloudfront-js-2.0" `
        --if-match $devETag 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR updating function:" -ForegroundColor Red
        Write-Host $updateResult
        Write-Host "`nTrying to get fresh ETag..." -ForegroundColor Yellow
        # Get fresh ETag and try again
        $functionDesc = aws cloudfront describe-function --name $functionName --stage DEVELOPMENT 2>&1
        if ($LASTEXITCODE -eq 0) {
            $functionETag = ($functionDesc | ConvertFrom-Json).ETag
            $updateResult = aws cloudfront update-function `
                --name $functionName `
                --function-code fileb://$functionCodePath `
                --function-config Comment="Redirects www to non-www and rewrites user URLs to user.html",Runtime="cloudfront-js-2.0" `
                --if-match $functionETag 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR updating function (second attempt):" -ForegroundColor Red
                Write-Host $updateResult
                exit 1
            }
        } else {
            exit 1
        }
    }
    
    Write-Host "Function updated successfully in DEVELOPMENT!" -ForegroundColor Green
    $newETag = ($updateResult | ConvertFrom-Json).ETag
    
    Write-Host "`nStep 3: Publishing function from DEVELOPMENT to LIVE..." -ForegroundColor Yellow
    $publishResult = aws cloudfront publish-function `
        --name $functionName `
        --if-match $newETag 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR publishing function:" -ForegroundColor Red
        Write-Host $publishResult
        exit 1
    }
    
    Write-Host "Function published successfully!" -ForegroundColor Green
} else {
    Write-Host "Function not found. Creating new function..." -ForegroundColor Yellow
    
    # Create the function
    $createResult = aws cloudfront create-function `
        --name $functionName `
        --function-code fileb://$functionCodePath `
        --function-config Comment="Redirects www to non-www and rewrites user URLs to user.html",Runtime="cloudfront-js-2.0" 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR creating function:" -ForegroundColor Red
        Write-Host $createResult
        exit 1
    }
    
    Write-Host "Function created successfully!" -ForegroundColor Green
    $functionETag = ($createResult | ConvertFrom-Json).ETag
    
    Write-Host "`nPublishing function..." -ForegroundColor Yellow
    $publishResult = aws cloudfront publish-function `
        --name $functionName `
        --if-match $functionETag 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR publishing function:" -ForegroundColor Red
        Write-Host $publishResult
        exit 1
    }
    
    Write-Host "Function published successfully!" -ForegroundColor Green
}

Write-Host "`nStep 4: Verifying function is associated with distribution..." -ForegroundColor Yellow

# Get current distribution config
$config = aws cloudfront get-distribution-config --id $distributionId | ConvertFrom-Json
$distETag = $config.ETag
$distConfig = $config.DistributionConfig

# Check if function is already associated with default behavior
$defaultBehavior = $distConfig.DefaultCacheBehavior
$functionARN = "arn:aws:cloudfront::$accountId`:function/$functionName"

$functionAssociated = $false
if ($defaultBehavior.FunctionAssociations -and $defaultBehavior.FunctionAssociations.Items) {
    foreach ($assoc in $defaultBehavior.FunctionAssociations.Items) {
        if ($assoc.FunctionARN -eq $functionARN -and $assoc.EventType -eq "viewer-request") {
            $functionAssociated = $true
            Write-Host "Function is already associated with default behavior" -ForegroundColor Green
            break
        }
    }
}

if (-not $functionAssociated) {
    Write-Host "Function is not associated. Adding to default behavior..." -ForegroundColor Yellow
    
    # Ensure FunctionAssociations exists
    if (-not $defaultBehavior.FunctionAssociations) {
        $defaultBehavior | Add-Member -MemberType NoteProperty -Name "FunctionAssociations" -Value @{
            Quantity = 0
            Items = @()
        } -Force
    }
    
    # Add function association
    $functionAssoc = @{
        FunctionARN = $functionARN
        EventType = "viewer-request"
    }
    
    if ($defaultBehavior.FunctionAssociations.Quantity -eq 0) {
        $defaultBehavior.FunctionAssociations.Items = @($functionAssoc)
        $defaultBehavior.FunctionAssociations.Quantity = 1
    } else {
        # Replace existing viewer-request function if any
        $existingItems = $defaultBehavior.FunctionAssociations.Items
        $newItems = @()
        $found = $false
        foreach ($item in $existingItems) {
            if ($item.EventType -eq "viewer-request") {
                $newItems += $functionAssoc
                $found = $true
            } else {
                $newItems += $item
            }
        }
        if (-not $found) {
            $newItems += $functionAssoc
            $defaultBehavior.FunctionAssociations.Quantity = $newItems.Count
        }
        $defaultBehavior.FunctionAssociations.Items = $newItems
    }
    
    # Save updated config
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $json = $distConfig | ConvertTo-Json -Depth 100
    $tempFile = Join-Path $env:TEMP "cloudfront-user-urls-$(Get-Date -Format 'yyyyMMddHHmmss').json"
    [System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
    
    Write-Host "Updating distribution..." -ForegroundColor Yellow
    $updateDistResult = aws cloudfront update-distribution `
        --id $distributionId `
        --distribution-config file://$tempFile `
        --if-match $distETag 2>&1
    
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR updating distribution:" -ForegroundColor Red
        Write-Host $updateDistResult
        exit 1
    }
    
    Write-Host "Distribution updated successfully!" -ForegroundColor Green
    Write-Host "`nThe distribution is now deploying (this takes 5-10 minutes)." -ForegroundColor Yellow
} else {
    Write-Host "`nConfiguration complete! The function is already associated." -ForegroundColor Green
    Write-Host "If you just updated the function code, changes will be live after CloudFront finishes deploying." -ForegroundColor Yellow
}

Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  - User URLs like masky.ai/azizana will now be rewritten to masky.ai/user.html" -ForegroundColor White
Write-Host "  - The function also handles www redirects" -ForegroundColor White
Write-Host "  - Known paths (/api, /assets, etc.) and files with extensions are excluded" -ForegroundColor White
Write-Host "`nTo test after deployment:" -ForegroundColor Cyan
Write-Host "  Visit: https://masky.ai/azizana" -ForegroundColor White

