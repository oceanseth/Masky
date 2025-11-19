#!/bin/bash
# Import existing AWS resources into Terraform state
# Run this if you get "already exists" errors during terraform apply

set -e

STAGE="${1:-production}"
REGION="${2:-us-east-1}"

echo "📥 Importing existing AWS resources into Terraform state..."
echo "   Stage: $STAGE"
echo "   Region: $REGION"
echo ""

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed."
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Change to terraform directory
cd terraform

# Initialize Terraform first
echo "🔧 Initializing Terraform..."
terraform init

echo ""
echo "📥 Importing resources..."
echo ""

# Import IAM Role
echo "1. Importing IAM Role..."
ROLE_NAME="masky-lambda-execution-role-$STAGE"
terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
    aws_iam_role.lambda_execution_role "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}" || \
    echo "   ⚠️  IAM Role import failed (may already be in state)"

# Import Lambda Log Group
echo "2. Importing Lambda CloudWatch Log Group..."
terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
    aws_cloudwatch_log_group.lambda_logs "/aws/lambda/masky-api-$STAGE" || \
    echo "   ⚠️  Lambda Log Group import failed (may already be in state)"

# Import API Gateway Log Group
echo "3. Importing API Gateway CloudWatch Log Group..."
terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
    aws_cloudwatch_log_group.api_gateway_logs "/aws/apigateway/masky-api-$STAGE" || \
    echo "   ⚠️  API Gateway Log Group import failed (may already be in state)"

# Check if Lambda function exists and needs importing
echo "4. Checking Lambda function..."
LAMBDA_NAME="masky-api-$STAGE"
if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" &> /dev/null; then
    echo "   Lambda function exists, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_lambda_function.api "$LAMBDA_NAME" || \
        echo "   ⚠️  Lambda function import failed (may already be in state)"
else
    echo "   Lambda function doesn't exist yet (will be created)"
fi

# Check if API Gateway exists and needs importing
echo "5. Checking API Gateway..."
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='masky-api-$STAGE'].ApiId" --output text 2>/dev/null || echo "")
if [ -n "$API_ID" ]; then
    echo "   API Gateway exists, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_apigatewayv2_api.api "$API_ID" || \
        echo "   ⚠️  API Gateway import failed (may already be in state)"
else
    echo "   API Gateway doesn't exist yet (will be created)"
fi

echo ""
echo "✅ Import complete!"
echo ""
echo "Next steps:"
echo "1. Run: terraform plan -var=\"stage=$STAGE\" -var=\"aws_region=$REGION\""
echo "2. Review the plan to ensure it matches your expectations"
echo "3. Run: terraform apply -var=\"stage=$STAGE\" -var=\"aws_region=$REGION\""

cd ..

