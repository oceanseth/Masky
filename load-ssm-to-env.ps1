# Load SSM Parameters to .env.local
# This script fetches secrets from AWS SSM Parameter Store and creates .env.local

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Loading SSM Parameters to .env.local" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is installed
try {
    $awsVersion = aws --version 2>&1
    Write-Host "OK AWS CLI found: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: AWS CLI not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install AWS CLI:" -ForegroundColor Yellow
    Write-Host "  https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check AWS credentials
Write-Host ""
Write-Host "Checking AWS credentials..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity 2>&1 | ConvertFrom-Json
    Write-Host "OK Authenticated as: $($identity.Arn)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Not authenticated with AWS!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please configure AWS CLI:" -ForegroundColor Yellow
    Write-Host "  aws configure" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or set environment variables:" -ForegroundColor Yellow
    Write-Host "  `$env:AWS_ACCESS_KEY_ID='your-key'" -ForegroundColor Yellow
    Write-Host "  `$env:AWS_SECRET_ACCESS_KEY='your-secret'" -ForegroundColor Yellow
    Write-Host "  `$env:AWS_DEFAULT_REGION='us-east-1'" -ForegroundColor Yellow
    exit 1
}

# Set stage (default to production)
$stage = "production"
if ($args.Length -gt 0) {
    $stage = $args[0]
}

Write-Host ""
Write-Host "Fetching parameters for stage: $stage" -ForegroundColor Cyan
Write-Host ""

# Function to get SSM parameter
function Get-SSMParam {
    param (
        [string]$Name,
        [string]$DisplayName
    )
    
    Write-Host "  Fetching $DisplayName..." -NoNewline
    try {
        $result = aws ssm get-parameter --name $Name --with-decryption --region us-east-1 2>&1 | ConvertFrom-Json
        $value = $result.Parameter.Value
        Write-Host " OK" -ForegroundColor Green
        return $value
    } catch {
        Write-Host " MISSING (not found or no access)" -ForegroundColor Red
        return $null
    }
}

# Fetch all parameters
$firebaseServiceAccount = Get-SSMParam -Name "/masky/$stage/firebase_service_account" -DisplayName "Firebase Service Account"
$twitchClientId = Get-SSMParam -Name "/masky/$stage/twitch_client_id" -DisplayName "Twitch Client ID"
$twitchClientSecret = Get-SSMParam -Name "/masky/$stage/twitch_client_secret" -DisplayName "Twitch Client Secret"
$stripeSecretKey = Get-SSMParam -Name "/masky/$stage/stripe_secret_key" -DisplayName "Stripe Secret Key"
$stripeWebhookSecret = Get-SSMParam -Name "/masky/$stage/stripe_webhook_secret" -DisplayName "Stripe Webhook Secret"
$heygenApiKey = Get-SSMParam -Name "/masky/$stage/heygen_api_key" -DisplayName "HeyGen API Key"

Write-Host ""

# Check if we got at least some parameters
$hasParams = $false
if ($firebaseServiceAccount -or $twitchClientId -or $stripeSecretKey -or $heygenApiKey) {
    $hasParams = $true
}

if (-not $hasParams) {
    Write-Host "ERROR: Could not fetch any parameters!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible reasons:" -ForegroundColor Yellow
    Write-Host "  1. Parameters don't exist in SSM for stage '$stage'" -ForegroundColor Yellow
    Write-Host "  2. Your AWS credentials don't have SSM read permissions" -ForegroundColor Yellow
    Write-Host "  3. Wrong AWS region (should be us-east-1)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Try a different stage:" -ForegroundColor Yellow
    Write-Host "  .\load-ssm-to-env.ps1 production" -ForegroundColor Cyan
    Write-Host "  .\load-ssm-to-env.ps1 staging" -ForegroundColor Cyan
    exit 1
}

# If Firebase service account is not base64 encoded, encode it
if ($firebaseServiceAccount -and $firebaseServiceAccount.StartsWith("{")) {
    Write-Host "Encoding Firebase service account to base64..." -ForegroundColor Yellow
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($firebaseServiceAccount)
    $firebaseServiceAccount = [Convert]::ToBase64String($bytes)
    Write-Host "  OK Encoded" -ForegroundColor Green
}

# Create .env.local content
$envContent = @"
# Local Development Environment Variables
# Auto-generated from AWS SSM Parameter Store on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Stage: $stage

# Firebase Service Account (base64 encoded JSON)
FIREBASE_SERVICE_ACCOUNT=$firebaseServiceAccount

# Twitch Credentials
TWITCH_CLIENT_ID=$twitchClientId
TWITCH_CLIENT_SECRET=$twitchClientSecret

# Stripe Credentials
STRIPE_SECRET_KEY=$stripeSecretKey
STRIPE_WEBHOOK_SECRET=$stripeWebhookSecret

# HeyGen API Key
HEYGEN_API_KEY=$heygenApiKey

# Stage (for local development)
STAGE=local
"@

# Backup existing .env.local if it exists
if (Test-Path .env.local) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupName = ".env.local.backup.$timestamp"
    Copy-Item .env.local $backupName
    Write-Host "Backed up existing .env.local to $backupName" -ForegroundColor Yellow
    Write-Host ""
}

# Write to .env.local
$envContent | Out-File -FilePath .env.local -Encoding UTF8 -NoNewline

Write-Host "========================================" -ForegroundColor Green
Write-Host "  OK .env.local created successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan

# Firebase Service Account
if ($firebaseServiceAccount) {
    Write-Host "  Firebase Service Account: OK" -ForegroundColor Green
} else {
    Write-Host "  Firebase Service Account: MISSING" -ForegroundColor Red
}

# Twitch Client ID
if ($twitchClientId) {
    Write-Host "  Twitch Client ID:         OK" -ForegroundColor Green
} else {
    Write-Host "  Twitch Client ID:         MISSING" -ForegroundColor Red
}

# Twitch Client Secret
if ($twitchClientSecret) {
    Write-Host "  Twitch Client Secret:     OK" -ForegroundColor Green
} else {
    Write-Host "  Twitch Client Secret:     MISSING" -ForegroundColor Red
}

# Stripe Secret Key
if ($stripeSecretKey) {
    Write-Host "  Stripe Secret Key:        OK" -ForegroundColor Green
} else {
    Write-Host "  Stripe Secret Key:        MISSING" -ForegroundColor Red
}

# Stripe Webhook Secret
if ($stripeWebhookSecret) {
    Write-Host "  Stripe Webhook Secret:    OK" -ForegroundColor Green
} else {
    Write-Host "  Stripe Webhook Secret:    MISSING" -ForegroundColor Red
}

# HeyGen API Key
if ($heygenApiKey) {
    Write-Host "  HeyGen API Key:           OK" -ForegroundColor Green
} else {
    Write-Host "  HeyGen API Key:           MISSING" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review .env.local to verify the values" -ForegroundColor White
Write-Host "  2. Run: npm run api:dev" -ForegroundColor White
Write-Host "  3. Test API endpoint" -ForegroundColor White
Write-Host ""

