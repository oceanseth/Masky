#!/bin/bash
# Configure CloudFront to route user URLs (/{username}) to user.html
# This script updates the existing CloudFront function to handle user URL rewriting

DISTRIBUTION_ID="E33L46W61GEWHI"
FUNCTION_NAME="www-redirect-masky"
ACCOUNT_ID="218827615080"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_CODE_PATH="$SCRIPT_DIR/iac/user-url-function.js"

echo "Configuring CloudFront for user URLs..."
echo "Distribution ID: $DISTRIBUTION_ID"
echo "Function Name: $FUNCTION_NAME"

if [ ! -f "$FUNCTION_CODE_PATH" ]; then
    echo "ERROR: Function code file not found at $FUNCTION_CODE_PATH"
    exit 1
fi

echo ""
echo "Step 1: Getting current function configuration..."
FUNCTION_CONFIG=$(aws cloudfront get-function --name "$FUNCTION_NAME" 2>&1)
FUNCTION_EXISTS=$?

if [ $FUNCTION_EXISTS -ne 0 ]; then
    echo "Function not found. Creating new function..."
    
    CREATE_RESULT=$(aws cloudfront create-function \
        --name "$FUNCTION_NAME" \
        --function-code "fileb://$FUNCTION_CODE_PATH" \
        --function-config "Comment=Redirects www to non-www and rewrites user URLs to user.html,Runtime=cloudfront-js-1.0" 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "ERROR creating function:"
        echo "$CREATE_RESULT"
        exit 1
    fi
    
    echo "Function created successfully!"
    FUNCTION_ETAG=$(echo "$CREATE_RESULT" | jq -r '.ETag')
else
    FUNCTION_ETAG=$(echo "$FUNCTION_CONFIG" | jq -r '.ETag')
    echo "Found existing function (ETag: $FUNCTION_ETAG)"
    
    echo ""
    echo "Step 2: Publishing updated function code..."
    
    UPDATE_RESULT=$(aws cloudfront update-function \
        --name "$FUNCTION_NAME" \
        --function-code "fileb://$FUNCTION_CODE_PATH" \
        --function-config "Comment=Redirects www to non-www and rewrites user URLs to user.html,Runtime=cloudfront-js-1.0" \
        --if-match "$FUNCTION_ETAG" 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "ERROR updating function:"
        echo "$UPDATE_RESULT"
        exit 1
    fi
    
    echo "Function updated successfully!"
    NEW_ETAG=$(echo "$UPDATE_RESULT" | jq -r '.ETag')
    
    echo ""
    echo "Step 3: Publishing function..."
    PUBLISH_RESULT=$(aws cloudfront publish-function \
        --name "$FUNCTION_NAME" \
        --if-match "$NEW_ETAG" 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "ERROR publishing function:"
        echo "$PUBLISH_RESULT"
        exit 1
    fi
    
    echo "Function published successfully!"
fi

echo ""
echo "Step 4: Verifying function is associated with distribution..."

# Get current distribution config
CONFIG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
DIST_ETAG=$(echo "$CONFIG" | jq -r '.ETag')
DIST_CONFIG=$(echo "$CONFIG" | jq -r '.DistributionConfig')

FUNCTION_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:function/${FUNCTION_NAME}"

# Check if function is already associated
FUNCTION_ASSOCIATED=$(echo "$DIST_CONFIG" | jq -r --arg arn "$FUNCTION_ARN" '
    .DefaultCacheBehavior.FunctionAssociations.Items[]? | 
    select(.FunctionARN == $arn and .EventType == "viewer-request") | 
    .FunctionARN
')

if [ -z "$FUNCTION_ASSOCIATED" ]; then
    echo "Function is not associated. Adding to default behavior..."
    
    # Update the distribution config to include the function
    UPDATED_CONFIG=$(echo "$DIST_CONFIG" | jq --arg arn "$FUNCTION_ARN" '
        .DefaultCacheBehavior.FunctionAssociations.Quantity = 1 |
        .DefaultCacheBehavior.FunctionAssociations.Items = [{
            FunctionARN: $arn,
            EventType: "viewer-request"
        }]
    ')
    
    TEMP_FILE=$(mktemp)
    echo "$UPDATED_CONFIG" > "$TEMP_FILE"
    
    echo "Updating distribution..."
    UPDATE_DIST_RESULT=$(aws cloudfront update-distribution \
        --id "$DISTRIBUTION_ID" \
        --distribution-config "file://$TEMP_FILE" \
        --if-match "$DIST_ETAG" 2>&1)
    
    rm -f "$TEMP_FILE"
    
    if [ $? -ne 0 ]; then
        echo "ERROR updating distribution:"
        echo "$UPDATE_DIST_RESULT"
        exit 1
    fi
    
    echo "Distribution updated successfully!"
    echo ""
    echo "The distribution is now deploying (this takes 5-10 minutes)."
else
    echo "Configuration complete! The function is already associated."
    echo "If you just updated the function code, changes will be live after CloudFront finishes deploying."
fi

echo ""
echo "Summary:"
echo "  - User URLs like masky.ai/azizana will now be rewritten to masky.ai/user.html"
echo "  - The function also handles www redirects"
echo "  - Known paths (/api, /assets, etc.) and files with extensions are excluded"
echo ""
echo "To test after deployment:"
echo "  Visit: https://masky.ai/azizana"

