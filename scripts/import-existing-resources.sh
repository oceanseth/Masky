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

# Check if already in Terraform state
STATE_CHECK=$(terraform state show aws_iam_role.lambda_execution_role 2>&1)
if [ $? -eq 0 ]; then
    echo "   ✅ IAM Role already in Terraform state"
    echo "   State info: $(echo "$STATE_CHECK" | head -n 3)"
else
    # Check if role exists in AWS
    if aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
        echo "   Role exists in AWS, importing..."
        echo "   Using role name: $ROLE_NAME"
        
        # Try importing with just the role name
        # Note: Some Terraform versions may have issues, so we'll catch and handle errors
        IMPORT_OUTPUT=$(terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
            aws_iam_role.lambda_execution_role "$ROLE_NAME" 2>&1)
        IMPORT_EXIT_CODE=$?
        
        # Check if import succeeded
        if [ $IMPORT_EXIT_CODE -eq 0 ]; then
            echo "   ✅ IAM Role imported successfully"
        else
            # Check for specific error patterns
            if echo "$IMPORT_OUTPUT" | grep -qi "already managed by Terraform\|already in state\|Resource already managed"; then
                echo "   ✅ IAM Role already in state (import skipped)"
            elif echo "$IMPORT_OUTPUT" | grep -qi "ValidationError.*roleName"; then
                echo "   ⚠️  Import failed with ValidationError - role may be in state with different format"
                echo "   Attempting to verify state..."
                # Check state again after failed import
                if terraform state show aws_iam_role.lambda_execution_role &> /dev/null; then
                    echo "   ✅ Role is actually in state (import error was misleading)"
                else
                    echo "   ❌ IAM Role import failed with ValidationError"
                    echo "   Error: $IMPORT_OUTPUT"
                    echo "   This may be a Terraform AWS provider issue. Role exists but import format is incorrect."
                    # Don't exit - let Terraform try to create it, it will fail gracefully with EntityAlreadyExists
                    echo "   Continuing - Terraform will handle this during apply"
                fi
            else
                echo "   ❌ IAM Role import failed!"
                echo "   Error: $IMPORT_OUTPUT"
                # Don't exit - let Terraform handle it during apply
                echo "   Continuing - Terraform will handle this during apply"
            fi
        fi
    else
        echo "   ⚠️  IAM Role doesn't exist in AWS (will be created)"
    fi
fi

# Import Lambda Log Group
echo "2. Importing Lambda CloudWatch Log Group..."
LOG_GROUP_NAME="/aws/lambda/masky-api-$STAGE"

# Check if already in Terraform state
if terraform state show aws_cloudwatch_log_group.lambda_logs &> /dev/null; then
    echo "   ✅ Lambda Log Group already in Terraform state"
else
    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_NAME" --query "logGroups[?logGroupName=='$LOG_GROUP_NAME']" --output text | grep -q "$LOG_GROUP_NAME"; then
        echo "   Log group exists in AWS, importing..."
        IMPORT_OUTPUT=$(terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
            aws_cloudwatch_log_group.lambda_logs "$LOG_GROUP_NAME" 2>&1)
        IMPORT_EXIT_CODE=$?
        echo "$IMPORT_OUTPUT"
        
        if [ $IMPORT_EXIT_CODE -eq 0 ]; then
            echo "   ✅ Lambda Log Group imported successfully"
        elif echo "$IMPORT_OUTPUT" | grep -qi "already managed by Terraform\|already in state"; then
            echo "   ✅ Lambda Log Group already in state (import skipped)"
        else
            echo "   ⚠️  Lambda Log Group import failed (will be created if needed)"
        fi
    else
        echo "   ⚠️  Lambda Log Group doesn't exist in AWS (will be created)"
    fi
fi

# Import API Gateway Log Group
echo "3. Importing API Gateway CloudWatch Log Group..."
API_LOG_GROUP_NAME="/aws/apigateway/masky-api-$STAGE"

# Check if already in Terraform state
if terraform state show aws_cloudwatch_log_group.api_gateway_logs &> /dev/null; then
    echo "   ✅ API Gateway Log Group already in Terraform state"
else
    if aws logs describe-log-groups --log-group-name-prefix "$API_LOG_GROUP_NAME" --query "logGroups[?logGroupName=='$API_LOG_GROUP_NAME']" --output text | grep -q "$API_LOG_GROUP_NAME"; then
        echo "   Log group exists in AWS, importing..."
        IMPORT_OUTPUT=$(terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
            aws_cloudwatch_log_group.api_gateway_logs "$API_LOG_GROUP_NAME" 2>&1)
        IMPORT_EXIT_CODE=$?
        echo "$IMPORT_OUTPUT"
        
        if [ $IMPORT_EXIT_CODE -eq 0 ]; then
            echo "   ✅ API Gateway Log Group imported successfully"
        elif echo "$IMPORT_OUTPUT" | grep -qi "already managed by Terraform\|already in state"; then
            echo "   ✅ API Gateway Log Group already in state (import skipped)"
        else
            echo "   ⚠️  API Gateway Log Group import failed (will be created if needed)"
        fi
    else
        echo "   ⚠️  API Gateway Log Group doesn't exist in AWS (will be created)"
    fi
fi

# Check if Lambda function exists and needs importing
echo "4. Checking Lambda function..."
LAMBDA_NAME="masky-api-$STAGE"

# Check if already in Terraform state
if terraform state show aws_lambda_function.api &> /dev/null; then
    echo "   ✅ Lambda function already in Terraform state"
else
    if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" &> /dev/null; then
        echo "   Lambda function exists, importing..."
        IMPORT_OUTPUT=$(terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
            aws_lambda_function.api "$LAMBDA_NAME" 2>&1)
        IMPORT_EXIT_CODE=$?
        echo "$IMPORT_OUTPUT"
        
        if [ $IMPORT_EXIT_CODE -eq 0 ]; then
            echo "   ✅ Lambda function imported successfully"
        elif echo "$IMPORT_OUTPUT" | grep -qi "already managed by Terraform\|already in state"; then
            echo "   ✅ Lambda function already in state (import skipped)"
        else
            echo "   ⚠️  Lambda function import failed (will be created if needed)"
        fi
    else
        echo "   ⚠️  Lambda function doesn't exist yet (will be created)"
    fi
fi

# Check if API Gateway exists and needs importing
echo "5. Checking API Gateway..."
API_NAME="masky-api-$STAGE"

# Check if already in Terraform state
if terraform state show aws_apigatewayv2_api.api &> /dev/null; then
    echo "   ✅ API Gateway already in Terraform state"
else
    # Get API IDs, filter by name, take first result only
    API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId" --output text 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "")
    
    if [ -n "$API_ID" ] && [ "$API_ID" != "None" ] && [ "$API_ID" != "" ]; then
        # Validate API ID format (should be alphanumeric, no spaces/tabs)
        if echo "$API_ID" | grep -qE '^[a-zA-Z0-9]+$'; then
            echo "   API Gateway exists (ID: $API_ID), importing..."
            IMPORT_OUTPUT=$(terraform import -var="stage=$STAGE" -var="aws_region=$REGION" \
                aws_apigatewayv2_api.api "$API_ID" 2>&1)
            IMPORT_EXIT_CODE=$?
            echo "$IMPORT_OUTPUT"
            
            if [ $IMPORT_EXIT_CODE -eq 0 ]; then
                echo "   ✅ API Gateway imported successfully"
            elif echo "$IMPORT_OUTPUT" | grep -qi "already managed by Terraform\|already in state"; then
                echo "   ✅ API Gateway already in state (import skipped)"
            else
                echo "   ⚠️  API Gateway import failed (will be created if needed)"
            fi
        else
            echo "   ⚠️  Invalid API Gateway ID format: '$API_ID' (skipping import)"
        fi
    else
        echo "   ⚠️  API Gateway doesn't exist yet (will be created)"
    fi
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

