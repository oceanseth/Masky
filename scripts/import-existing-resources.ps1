# Import existing AWS resources into Terraform state
# Run this if you get "already exists" errors during terraform apply

param(
    [string]$Stage = "production",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Continue"

Write-Host "Importing existing AWS resources into Terraform state..." -ForegroundColor Cyan
Write-Host "   Stage: $Stage" -ForegroundColor Gray
Write-Host "   Region: $Region" -ForegroundColor Gray
Write-Host ""

# Check if Terraform is installed
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Terraform is not installed." -ForegroundColor Red
    exit 1
}

# Change to terraform directory
Push-Location terraform

# Initialize Terraform first
Write-Host "Initializing Terraform..." -ForegroundColor Cyan
terraform init
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Terraform init failed" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host ""
Write-Host "Importing resources..." -ForegroundColor Cyan
Write-Host ""

# Import IAM Role
Write-Host "1. Importing IAM Role..." -ForegroundColor Yellow
$roleName = "masky-lambda-execution-role-$Stage"
$accountId = aws sts get-caller-identity --query Account --output text
terraform import -var="stage=$Stage" -var="aws_region=$Region" `
    aws_iam_role.lambda_execution_role "arn:aws:iam::${accountId}:role/$roleName" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "   SUCCESS: IAM Role imported" -ForegroundColor Green
} else {
    Write-Host "   WARNING: IAM Role import failed (may already be in state)" -ForegroundColor Yellow
}

# Import Lambda Log Group
Write-Host "2. Importing Lambda CloudWatch Log Group..." -ForegroundColor Yellow
terraform import -var="stage=$Stage" -var="aws_region=$Region" `
    aws_cloudwatch_log_group.lambda_logs "/aws/lambda/masky-api-$Stage" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "   SUCCESS: Lambda Log Group imported" -ForegroundColor Green
} else {
    Write-Host "   WARNING: Lambda Log Group import failed (may already be in state)" -ForegroundColor Yellow
}

# Import API Gateway Log Group
Write-Host "3. Importing API Gateway CloudWatch Log Group..." -ForegroundColor Yellow
terraform import -var="stage=$Stage" -var="aws_region=$Region" `
    aws_cloudwatch_log_group.api_gateway_logs "/aws/apigateway/masky-api-$Stage" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "   SUCCESS: API Gateway Log Group imported" -ForegroundColor Green
} else {
    Write-Host "   WARNING: API Gateway Log Group import failed (may already be in state)" -ForegroundColor Yellow
}

# Check if Lambda function exists and needs importing
Write-Host "4. Checking Lambda function..." -ForegroundColor Yellow
$lambdaName = "masky-api-$Stage"
$null = aws lambda get-function --function-name $lambdaName --region $Region 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   Lambda function exists, importing..." -ForegroundColor Yellow
    terraform import -var="stage=$Stage" -var="aws_region=$Region" `
        aws_lambda_function.api $lambdaName 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   SUCCESS: Lambda function imported" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: Lambda function import failed (may already be in state)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   Lambda function doesn't exist yet (will be created)" -ForegroundColor Gray
}

# Check if API Gateway exists and needs importing
Write-Host "5. Checking API Gateway..." -ForegroundColor Yellow
$apiGateways = aws apigatewayv2 get-apis --region $Region --query "Items[?Name=='masky-api-$Stage'].ApiId" --output text 2>&1
if ($LASTEXITCODE -eq 0 -and $apiGateways) {
    Write-Host "   API Gateway exists, importing..." -ForegroundColor Yellow
    terraform import -var="stage=$Stage" -var="aws_region=$Region" `
        aws_apigatewayv2_api.api $apiGateways 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   SUCCESS: API Gateway imported" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: API Gateway import failed (may already be in state)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   API Gateway doesn't exist yet (will be created)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Import complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Run: terraform plan -var=`"stage=$Stage`" -var=`"aws_region=$Region`"" -ForegroundColor White
Write-Host "2. Review the plan to ensure it matches your expectations" -ForegroundColor White
Write-Host "3. Run: terraform apply -var=`"stage=$Stage`" -var=`"aws_region=$Region`"" -ForegroundColor White

Pop-Location
