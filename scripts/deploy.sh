#!/bin/bash
# Deploy Lambda function using Terraform

set -e

echo "🚀 Starting deployment..."

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed. Please install Terraform first."
    exit 1
fi

# Package Lambda function
echo "📦 Packaging Lambda function..."
npm run lambda:package

# Initialize Terraform (if needed)
if [ ! -d "terraform/.terraform" ]; then
    echo "🔧 Initializing Terraform..."
    cd terraform
    terraform init
    cd ..
fi

# Plan deployment
echo "📋 Planning Terraform deployment..."
cd terraform
terraform plan

# Ask for confirmation
read -p "Do you want to apply these changes? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    terraform apply
    echo "✅ Deployment complete!"
    terraform output
else
    echo "❌ Deployment cancelled."
    exit 1
fi

cd ..

