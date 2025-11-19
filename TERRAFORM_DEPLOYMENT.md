# Terraform Deployment Guide

This guide explains how to deploy your infrastructure using Terraform locally, since Terraform deployment was removed from GitHub Actions.

## Prerequisites

1. **Terraform** installed (version >= 1.0)
   - Download from: https://www.terraform.io/downloads
   - Verify: `terraform version`

2. **AWS CLI** configured with credentials
   - Install: https://aws.amazon.com/cli/
   - Configure: `aws configure`
   - Verify: `aws sts get-caller-identity`

3. **Node.js** and npm installed
   - Required for packaging Lambda function

4. **AWS Permissions** - Your AWS credentials need:
   - `lambda:*` - Create/update Lambda functions
   - `iam:*` - Create/update IAM roles and policies
   - `apigateway:*` - Create/update API Gateway
   - `logs:*` - Create CloudWatch log groups
   - `ssm:GetParameter` - Read SSM parameters for Lambda environment

## Quick Start

### Windows (PowerShell)

```powershell
# Deploy to production (interactive)
.\scripts\deploy-terraform.ps1

# Deploy to production (auto-approve)
.\scripts\deploy-terraform.ps1 -AutoApprove

# Deploy to staging
.\scripts\deploy-terraform.ps1 -Stage staging

# Deploy to different region
.\scripts\deploy-terraform.ps1 -Region us-west-2
```

### Linux/Mac (Bash)

```bash
# Make script executable (first time only)
chmod +x scripts/deploy-terraform.sh

# Deploy to production (interactive)
./scripts/deploy-terraform.sh

# Deploy to production (auto-approve)
./scripts/deploy-terraform.sh production us-east-1 true

# Deploy to staging
./scripts/deploy-terraform.sh staging

# Deploy to different region
./scripts/deploy-terraform.sh production us-west-2
```

### Using NPM Scripts

```bash
# Package Lambda and deploy
npm run deploy

# Or step by step:
npm run lambda:package    # Package Lambda function
npm run terraform:init    # Initialize Terraform (first time)
npm run terraform:plan    # Preview changes
npm run terraform:apply   # Apply changes
```

## Deployment Process

The deployment process consists of these steps:

1. **Package Lambda Function**
   - Copies Lambda code to `lambda-package/`
   - Installs production dependencies
   - Creates `lambda-package.zip`

2. **Terraform Init** (first time only)
   - Downloads Terraform providers
   - Initializes backend (if configured)

3. **Terraform Plan**
   - Shows what changes will be made
   - Validates configuration

4. **Terraform Apply**
   - Creates/updates AWS resources:
     - Lambda function
     - IAM roles and policies
     - API Gateway (HTTP API)
     - CloudWatch log groups

5. **Outputs**
   - Displays API Gateway endpoint URL
   - Shows Lambda function ARN

## Configuration

### Terraform Variables

Create `terraform/terraform.tfvars` (or use command-line flags):

```hcl
aws_region         = "us-east-1"
stage              = "production"
lambda_package_path = "../lambda-package.zip"
```

### Environment Variables

Terraform reads AWS credentials from:
- AWS CLI configuration (`aws configure`)
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- IAM roles (if running on EC2)

### Backend Configuration

The Terraform backend is configured in `terraform/main.tf`. By default, it's commented out. To use remote state:

1. Create an S3 bucket for Terraform state
2. Uncomment and configure the backend in `terraform/main.tf`:

```hcl
backend "s3" {
  bucket = "your-terraform-state-bucket"
  key    = "masky/terraform.tfstate"
  region = "us-east-1"
}
```

## What Gets Deployed

Terraform creates/updates:

- **Lambda Function**: `masky-api-{stage}`
  - Runtime: Node.js 18.x
  - Handler: `api/api.handler`
  - Timeout: 30 seconds
  - Memory: 512 MB

- **IAM Role**: `masky-lambda-execution-role-{stage}`
  - CloudWatch Logs permissions
  - SSM Parameter Store read permissions

- **API Gateway**: HTTP API
  - Endpoint: `/api/{proxy+}`
  - CORS enabled
  - Auto-deploy enabled

- **CloudWatch Log Groups**:
  - `/aws/lambda/masky-api-{stage}`
  - `/aws/apigateway/masky-api-{stage}`

## Troubleshooting

### "Terraform is not installed"
```bash
# Install Terraform
# Windows: Use Chocolatey
choco install terraform

# Mac: Use Homebrew
brew install terraform

# Linux: Download from terraform.io
```

### "AWS credentials not configured"
```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region: us-east-1
# Enter default output format: json
```

### "Permission denied" errors
- Check your AWS IAM permissions
- Ensure you have Lambda, IAM, API Gateway, and CloudWatch permissions
- Verify SSM parameter access for `/masky/{stage}/*`

### "Lambda package not found"
```bash
# Package Lambda first
npm run lambda:package
```

### "Terraform state locked"
- Another deployment might be in progress
- Check for stale locks in S3 (if using remote backend)
- Wait a few minutes and try again

### "API Gateway endpoint not working"
- Check CloudWatch logs: `/aws/lambda/masky-api-{stage}`
- Verify Lambda function is deployed correctly
- Check API Gateway logs: `/aws/apigateway/masky-api-{stage}`

## Manual Deployment Steps

If you prefer to run Terraform commands manually:

```bash
# 1. Package Lambda
npm run lambda:package

# 2. Navigate to terraform directory
cd terraform

# 3. Initialize (first time only)
terraform init

# 4. Plan changes
terraform plan -var="stage=production" -var="aws_region=us-east-1"

# 5. Apply changes
terraform apply -var="stage=production" -var="aws_region=us-east-1"

# 6. View outputs
terraform output

# 7. Return to project root
cd ..
```

## Destroying Infrastructure

⚠️ **Warning**: This will delete all resources!

```bash
cd terraform
terraform destroy -var="stage=production" -var="aws_region=us-east-1"
```

## Updating Lambda Code

To update just the Lambda function code:

```bash
# 1. Package new Lambda code
npm run lambda:package

# 2. Apply Terraform (it will detect the new package hash)
npm run terraform:apply
```

Terraform automatically detects when `lambda-package.zip` changes and updates the Lambda function.

## Multiple Environments

To deploy to different stages (dev, staging, production):

```bash
# Development
./scripts/deploy-terraform.sh dev

# Staging
./scripts/deploy-terraform.sh staging

# Production
./scripts/deploy-terraform.sh production
```

Each stage creates separate resources:
- `masky-api-dev`
- `masky-api-staging`
- `masky-api-production`

## CI/CD Integration

If you want to add Terraform back to GitHub Actions, add these steps:

```yaml
- name: Terraform Init
  run: terraform init
  working-directory: terraform

- name: Terraform Apply
  run: terraform apply -auto-approve -var="stage=production" -var="aws_region=us-east-1"
  working-directory: terraform
```

## Next Steps

After deployment:

1. **Update Frontend Config**: Update `src/config.js` with the new API Gateway URL
2. **Test API**: Verify endpoints are working
3. **Monitor Logs**: Check CloudWatch logs for any errors
4. **Update Documentation**: Update any hardcoded API URLs

## Related Files

- `terraform/main.tf` - Main Terraform configuration
- `terraform/variables.tf` - Variable definitions
- `terraform/data.tf` - Data sources (SSM, archive)
- `terraform/outputs.tf` - Output values
- `scripts/package-lambda.js` - Lambda packaging script
- `scripts/deploy-terraform.ps1` - Windows deployment script
- `scripts/deploy-terraform.sh` - Linux/Mac deployment script

