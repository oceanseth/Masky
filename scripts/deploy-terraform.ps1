# Deploy Lambda function using Terraform (Windows PowerShell)

param(
    [string]$Stage = "production",
    [string]$Region = "us-east-1",
    [switch]$AutoApprove = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting Terraform deployment..." -ForegroundColor Cyan
Write-Host "   Stage: $Stage" -ForegroundColor Gray
Write-Host "   Region: $Region" -ForegroundColor Gray
Write-Host ""

# Check if Terraform is installed
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Terraform is not installed. Please install Terraform first." -ForegroundColor Red
    Write-Host "   Download from: https://www.terraform.io/downloads" -ForegroundColor Yellow
    exit 1
}

# Check if AWS CLI is configured
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "❌ AWS CLI is not installed. Please install AWS CLI first." -ForegroundColor Red
    Write-Host "   Download from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check AWS credentials
try {
    $null = aws sts get-caller-identity 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "AWS credentials not configured"
    }
} catch {
    Write-Host "❌ AWS credentials not configured. Please run 'aws configure' first." -ForegroundColor Red
    exit 1
}

# Package Lambda function
Write-Host "📦 Packaging Lambda function..." -ForegroundColor Cyan
npm run lambda:package
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to package Lambda function" -ForegroundColor Red
    exit 1
}

# Change to terraform directory
Push-Location terraform

try {
    # Initialize Terraform (always run to ensure backend is configured)
    Write-Host "🔧 Initializing Terraform..." -ForegroundColor Cyan
    terraform init
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Terraform init failed. If using S3 backend, ensure it's configured in terraform/main.tf" -ForegroundColor Red
        exit 1
    }

    # Plan deployment
    Write-Host "📋 Planning Terraform deployment..." -ForegroundColor Cyan
    Write-Host ""
    terraform plan -var="stage=$Stage" -var="aws_region=$Region"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Terraform plan failed" -ForegroundColor Red
        exit 1
    }

    # Apply changes
    Write-Host ""
    if ($AutoApprove) {
        Write-Host "🚀 Applying Terraform changes (auto-approve)..." -ForegroundColor Cyan
        terraform apply -auto-approve -var="stage=$Stage" -var="aws_region=$Region"
    } else {
        Write-Host "🚀 Applying Terraform changes..." -ForegroundColor Cyan
        $confirmation = Read-Host "Do you want to apply these changes? (y/n)"
        if ($confirmation -eq 'y' -or $confirmation -eq 'Y') {
            terraform apply -var="stage=$Stage" -var="aws_region=$Region"
        } else {
            Write-Host "❌ Deployment cancelled." -ForegroundColor Yellow
            exit 0
        }
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Terraform apply failed" -ForegroundColor Red
        exit 1
    }

    # Show outputs
    Write-Host ""
    Write-Host "✅ Deployment complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Terraform outputs:" -ForegroundColor Cyan
    terraform output

} finally {
    Pop-Location
}

