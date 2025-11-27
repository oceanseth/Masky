# Deploy Lambda function using Terraform (PowerShell)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting deployment..." -ForegroundColor Cyan

# Check if Terraform is installed
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Terraform is not installed. Please install Terraform first." -ForegroundColor Red
    exit 1
}

# Package Lambda function
Write-Host "📦 Packaging Lambda function..." -ForegroundColor Cyan
npm run lambda:package

# Initialize Terraform (if needed)
if (-not (Test-Path "terraform\.terraform")) {
    Write-Host "🔧 Initializing Terraform..." -ForegroundColor Cyan
    Set-Location terraform
    terraform init
    Set-Location ..
}

# Plan deployment
Write-Host "📋 Planning Terraform deployment..." -ForegroundColor Cyan
Set-Location terraform
terraform plan

# Ask for confirmation
$confirmation = Read-Host "Do you want to apply these changes? (y/n)"
if ($confirmation -eq 'y' -or $confirmation -eq 'Y') {
    terraform apply
    Write-Host "✅ Deployment complete!" -ForegroundColor Green
    terraform output
} else {
    Write-Host "❌ Deployment cancelled." -ForegroundColor Red
    exit 1
}

Set-Location ..




