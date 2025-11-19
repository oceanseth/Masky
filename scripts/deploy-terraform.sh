#!/bin/bash
# Deploy Lambda function using Terraform (Linux/Mac)

set -e

STAGE="${1:-production}"
REGION="${2:-us-east-1}"
AUTO_APPROVE="${3:-false}"

echo "🚀 Starting Terraform deployment..."
echo "   Stage: $STAGE"
echo "   Region: $REGION"
echo ""

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed. Please install Terraform first."
    echo "   Download from: https://www.terraform.io/downloads"
    exit 1
fi

# Check if AWS CLI is configured
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install AWS CLI first."
    echo "   Download from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

# Package Lambda function
echo "📦 Packaging Lambda function..."
npm run lambda:package

# Change to terraform directory
cd terraform

# Initialize Terraform (always run to ensure backend is configured)
echo "🔧 Initializing Terraform..."
terraform init
if [ $? -ne 0 ]; then
    echo "❌ Terraform init failed. If using S3 backend, ensure it's configured in terraform/main.tf"
    exit 1
fi

# Plan deployment
echo "📋 Planning Terraform deployment..."
echo ""
terraform plan -var="stage=$STAGE" -var="aws_region=$REGION"

# Apply changes
echo ""
if [ "$AUTO_APPROVE" = "true" ]; then
    echo "🚀 Applying Terraform changes (auto-approve)..."
    terraform apply -auto-approve -var="stage=$STAGE" -var="aws_region=$REGION"
else
    echo "🚀 Applying Terraform changes..."
    read -p "Do you want to apply these changes? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        terraform apply -var="stage=$STAGE" -var="aws_region=$REGION"
    else
        echo "❌ Deployment cancelled."
        exit 0
    fi
fi

# Show outputs
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Terraform outputs:"
terraform output

cd ..

