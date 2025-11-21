#!/bin/bash
# Import existing AWS resources into Terraform state
# Run this if you get "already exists" errors during terraform apply

# Don't use set -e, we want to continue even if some imports fail
set +e

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
if [ -z "$ACCOUNT_ID" ]; then
    echo "❌ Failed to get AWS account ID"
    exit 1
fi

# Change to terraform directory
cd terraform

# Initialize Terraform first
echo "🔧 Initializing Terraform..."
terraform init
if [ $? -ne 0 ]; then
    echo "❌ Terraform init failed"
    exit 1
fi

echo ""
echo "📥 Importing resources..."
echo ""

# Import IAM Role
echo "1. Importing IAM Role..."
ROLE_NAME="masky-lambda-execution-role-$STAGE"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# Check if role exists in AWS
if aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
    echo "   Role exists in AWS, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_iam_role.lambda_execution_role "$ROLE_ARN" 2>&1
    if [ $? -eq 0 ]; then
        echo "   ✅ IAM Role imported successfully"
    else
        echo "   ⚠️  IAM Role import failed (may already be in state)"
    fi
else
    echo "   ⚠️  IAM Role doesn't exist in AWS (will be created)"
fi

# Import Lambda Log Group
echo "2. Importing Lambda CloudWatch Log Group..."
LOG_GROUP_NAME="/aws/lambda/masky-api-$STAGE"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_NAME" --query "logGroups[?logGroupName=='$LOG_GROUP_NAME']" --output text | grep -q "$LOG_GROUP_NAME"; then
    echo "   Log group exists in AWS, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_cloudwatch_log_group.lambda_logs "$LOG_GROUP_NAME" 2>&1
    if [ $? -eq 0 ]; then
        echo "   ✅ Lambda Log Group imported successfully"
    else
        echo "   ⚠️  Lambda Log Group import failed (may already be in state)"
    fi
else
    echo "   ⚠️  Lambda Log Group doesn't exist in AWS (will be created)"
fi

# Import API Gateway Log Group
echo "3. Importing API Gateway CloudWatch Log Group..."
API_LOG_GROUP_NAME="/aws/apigateway/masky-api-$STAGE"
if aws logs describe-log-groups --log-group-name-prefix "$API_LOG_GROUP_NAME" --query "logGroups[?logGroupName=='$API_LOG_GROUP_NAME']" --output text | grep -q "$API_LOG_GROUP_NAME"; then
    echo "   Log group exists in AWS, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_cloudwatch_log_group.api_gateway_logs "$API_LOG_GROUP_NAME" 2>&1
    if [ $? -eq 0 ]; then
        echo "   ✅ API Gateway Log Group imported successfully"
    else
        echo "   ⚠️  API Gateway Log Group import failed (may already be in state)"
    fi
else
    echo "   ⚠️  API Gateway Log Group doesn't exist in AWS (will be created)"
fi

# Check if Lambda function exists and needs importing
echo "4. Checking Lambda function..."
LAMBDA_NAME="masky-api-$STAGE"
if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" &> /dev/null; then
    echo "   Lambda function exists, importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_lambda_function.api "$LAMBDA_NAME" 2>&1
    if [ $? -eq 0 ]; then
        echo "   ✅ Lambda function imported successfully"
    else
        echo "   ⚠️  Lambda function import failed (may already be in state)"
    fi
else
    echo "   ⚠️  Lambda function doesn't exist yet (will be created)"
fi

# Check if API Gateway exists and needs importing
echo "5. Checking API Gateway..."
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='masky-api-$STAGE'].ApiId" --output text 2>/dev/null || echo "")
if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
    echo "   API Gateway exists (ID: $API_ID), importing..."
    terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
        aws_apigatewayv2_api.api "$API_ID" 2>&1
    if [ $? -eq 0 ]; then
        echo "   ✅ API Gateway imported successfully"
    else
        echo "   ⚠️  API Gateway import failed (may already be in state)"
    fi
else
    echo "   ⚠️  API Gateway doesn't exist yet (will be created)"
fi

echo ""
echo "📋 Verifying imports..."
echo ""

# Check what's in Terraform state
echo "Resources in Terraform state:"
terraform state list 2>&1 | grep -E "(aws_iam_role.lambda_execution_role|aws_cloudwatch_log_group|aws_lambda_function.api|aws_apigatewayv2_api.api)" || echo "   (none found)"

echo ""
echo "✅ Import process complete!"
echo ""
echo "Note: If resources still show as needing creation, they may need to be manually imported."
echo "Next steps:"
echo "1. Run: terraform plan -var=\"stage=$STAGE\" -var=\"aws_region=$REGION\""
echo "2. Review the plan to ensure it matches your expectations"
echo "3. Run: terraform apply -var=\"stage=$STAGE\" -var=\"aws_region=$REGION\""

cd ..

