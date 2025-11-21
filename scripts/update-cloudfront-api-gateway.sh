#!/bin/bash
# Update CloudFront to point to the correct API Gateway
# This script updates the API Gateway origin to use the Terraform-managed API Gateway

set -e

DISTRIBUTION_ID="E33L46W61GEWHI"

# Get API Gateway ID from environment variable or Terraform
if [ -z "$API_GATEWAY_ID" ]; then
    echo "[INFO] Getting API Gateway ID from Terraform..."
    if command -v terraform &> /dev/null; then
        cd terraform
        API_GATEWAY_ID=$(terraform output -raw api_gateway_id)
        cd ..
    else
        echo "[ERROR] Terraform not found and API_GATEWAY_ID not provided"
        exit 1
    fi
fi

if [ -z "$API_GATEWAY_ID" ]; then
    echo "[ERROR] Could not get API Gateway ID"
    exit 1
fi

echo "[OK] API Gateway ID: $API_GATEWAY_ID"

echo "[INFO] Fetching CloudFront distribution configuration..."

# Get current CloudFront config
CONFIG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
ETAG=$(echo "$CONFIG" | jq -r '.ETag')
DIST_CONFIG=$(echo "$CONFIG" | jq '.DistributionConfig')

# Extract current API Gateway domain
CURRENT_DOMAIN=$(echo "$DIST_CONFIG" | jq -r '.Origins.Items[] | select(.Id == "api-gateway-origin") | .DomainName')
NEW_DOMAIN="${API_GATEWAY_ID}.execute-api.us-east-1.amazonaws.com"

echo "[INFO] Current API Gateway origin: $CURRENT_DOMAIN"
echo "[INFO] New API Gateway origin: $NEW_DOMAIN"

if [ "$CURRENT_DOMAIN" != "$NEW_DOMAIN" ] || [ "$(echo "$DIST_CONFIG" | jq -r '.Origins.Items[] | select(.Id == "api-gateway-origin") | .OriginPath')" != "/production" ]; then
    echo "[UPDATE] Updating API Gateway origin..."
    
    # Update the origin
    UPDATED_CONFIG=$(echo "$DIST_CONFIG" | jq \
        --arg domain "$NEW_DOMAIN" \
        --arg path "/production" \
        '.Origins.Items[] |= if .Id == "api-gateway-origin" then .DomainName = $domain | .OriginPath = $path else . end')
    
    # Save to temp file
    TEMP_FILE=$(mktemp)
    echo "$UPDATED_CONFIG" > "$TEMP_FILE"
    
    # Update CloudFront
    echo "[UPDATE] Applying CloudFront configuration..."
    aws cloudfront update-distribution \
        --id "$DISTRIBUTION_ID" \
        --distribution-config "file://$TEMP_FILE" \
        --if-match "$ETAG"
    
    if [ $? -eq 0 ]; then
        echo "[SUCCESS] CloudFront distribution updated!"
        echo "[INFO] Changes are propagating (may take 15-20 minutes)"
    else
        echo "[ERROR] Failed to update CloudFront distribution"
        rm "$TEMP_FILE"
        exit 1
    fi
    
    rm "$TEMP_FILE"
else
    echo "[OK] API Gateway origin is already correct"
fi

