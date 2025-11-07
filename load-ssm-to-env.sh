#!/bin/bash

# Load SSM Parameters to .env.local
# This script fetches secrets from AWS SSM Parameter Store and creates .env.local

echo "========================================"
echo "  Loading SSM Parameters to .env.local"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}✗ ERROR: AWS CLI not found!${NC}"
    echo ""
    echo -e "${YELLOW}Please install AWS CLI:${NC}"
    echo -e "${YELLOW}  https://aws.amazon.com/cli/${NC}"
    exit 1
fi

echo -e "${GREEN}✓ AWS CLI found: $(aws --version)${NC}"

# Check AWS credentials
echo ""
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}✗ ERROR: Not authenticated with AWS!${NC}"
    echo ""
    echo -e "${YELLOW}Please configure AWS CLI:${NC}"
    echo -e "${YELLOW}  aws configure${NC}"
    echo ""
    echo -e "${YELLOW}Or set environment variables:${NC}"
    echo -e "${YELLOW}  export AWS_ACCESS_KEY_ID='your-key'${NC}"
    echo -e "${YELLOW}  export AWS_SECRET_ACCESS_KEY='your-secret'${NC}"
    echo -e "${YELLOW}  export AWS_DEFAULT_REGION='us-east-1'${NC}"
    exit 1
fi

IDENTITY=$(aws sts get-caller-identity --query 'Arn' --output text)
echo -e "${GREEN}✓ Authenticated as: $IDENTITY${NC}"

# Set stage (default to production)
STAGE="${1:-production}"

echo ""
echo -e "${CYAN}Fetching parameters for stage: $STAGE${NC}"
echo ""

# Function to get SSM parameter
get_ssm_param() {
    local name=$1
    local display_name=$2
    
    echo -n "  Fetching $display_name..."
    
    local value=$(aws ssm get-parameter \
        --name "$name" \
        --with-decryption \
        --region us-east-1 \
        --query 'Parameter.Value' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$value" ]; then
        echo -e " ${GREEN}✓${NC}"
        echo "$value"
    else
        echo -e " ${RED}✗ (not found or no access)${NC}"
        echo ""
    fi
}

# Fetch all parameters
FIREBASE_SERVICE_ACCOUNT=$(get_ssm_param "/masky/$STAGE/firebase_service_account" "Firebase Service Account")
TWITCH_CLIENT_ID=$(get_ssm_param "/masky/$STAGE/twitch_client_id" "Twitch Client ID")
TWITCH_CLIENT_SECRET=$(get_ssm_param "/masky/$STAGE/twitch_client_secret" "Twitch Client Secret")
STRIPE_SECRET_KEY=$(get_ssm_param "/masky/$STAGE/stripe_secret_key" "Stripe Secret Key")
STRIPE_WEBHOOK_SECRET=$(get_ssm_param "/masky/$STAGE/stripe_webhook_secret" "Stripe Webhook Secret")
HEYGEN_API_KEY=$(get_ssm_param "/masky/$STAGE/heygen_api_key" "HeyGen API Key")

echo ""

# Check if we got at least some parameters
if [ -z "$FIREBASE_SERVICE_ACCOUNT" ] && [ -z "$TWITCH_CLIENT_ID" ] && [ -z "$STRIPE_SECRET_KEY" ] && [ -z "$HEYGEN_API_KEY" ]; then
    echo -e "${RED}✗ ERROR: Could not fetch any parameters!${NC}"
    echo ""
    echo -e "${YELLOW}Possible reasons:${NC}"
    echo -e "${YELLOW}  1. Parameters don't exist in SSM for stage '$STAGE'${NC}"
    echo -e "${YELLOW}  2. Your AWS credentials don't have SSM read permissions${NC}"
    echo -e "${YELLOW}  3. Wrong AWS region (should be us-east-1)${NC}"
    echo ""
    echo -e "${YELLOW}Try a different stage:${NC}"
    echo -e "${CYAN}  ./load-ssm-to-env.sh production${NC}"
    echo -e "${CYAN}  ./load-ssm-to-env.sh staging${NC}"
    exit 1
fi

# If Firebase service account is not base64 encoded, encode it
if [ -n "$FIREBASE_SERVICE_ACCOUNT" ] && [[ "$FIREBASE_SERVICE_ACCOUNT" == "{"* ]]; then
    echo -e "${YELLOW}Encoding Firebase service account to base64...${NC}"
    FIREBASE_SERVICE_ACCOUNT=$(echo -n "$FIREBASE_SERVICE_ACCOUNT" | base64 | tr -d '\n')
    echo -e "  ${GREEN}✓ Encoded${NC}"
fi

# Backup existing .env.local if it exists
if [ -f .env.local ]; then
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_NAME=".env.local.backup.$TIMESTAMP"
    cp .env.local "$BACKUP_NAME"
    echo -e "${YELLOW}Backed up existing .env.local to $BACKUP_NAME${NC}"
    echo ""
fi

# Create .env.local content
cat > .env.local << EOF
# Local Development Environment Variables
# Auto-generated from AWS SSM Parameter Store on $(date +"%Y-%m-%d %H:%M:%S")
# Stage: $STAGE

# Firebase Service Account (base64 encoded JSON)
FIREBASE_SERVICE_ACCOUNT=$FIREBASE_SERVICE_ACCOUNT

# Twitch Credentials
TWITCH_CLIENT_ID=$TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET=$TWITCH_CLIENT_SECRET

# Stripe Credentials
STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET

# HeyGen API Key
HEYGEN_API_KEY=$HEYGEN_API_KEY

# Stage (for local development)
STAGE=local
EOF

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✓ .env.local created successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Summary:${NC}"
echo -e "  Firebase Service Account: $([ -n "$FIREBASE_SERVICE_ACCOUNT" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo -e "  Twitch Client ID:         $([ -n "$TWITCH_CLIENT_ID" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo -e "  Twitch Client Secret:     $([ -n "$TWITCH_CLIENT_SECRET" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo -e "  Stripe Secret Key:        $([ -n "$STRIPE_SECRET_KEY" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo -e "  Stripe Webhook Secret:    $([ -n "$STRIPE_WEBHOOK_SECRET" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo -e "  HeyGen API Key:           $([ -n "$HEYGEN_API_KEY" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}")"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Review .env.local to verify the values"
echo "  2. Run: npm run api:dev"
echo "  3. Test: curl http://localhost:3001/api/heygen/avatars"
echo ""


