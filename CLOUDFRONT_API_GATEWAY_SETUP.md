# CloudFront API Gateway Configuration

This document describes how CloudFront is configured to route `/api/*` requests to the Lambda API Gateway.

## Architecture

```
CloudFront (E33L46W61GEWHI)
├── Origin: masky.net S3 bucket (static files)
└── Origin: API Gateway (p0y27jfup0) - /api/* requests
    └── Lambda Function (masky-api-production)
```

## API Gateway

**Active API Gateway:** `p0y27jfup0`
- Managed by: Terraform
- Stage: `production`
- Endpoint: `https://p0y27jfup0.execute-api.us-east-1.amazonaws.com/production`

**Old API Gateway:** `nz39po3rvl` (deleted)

## CloudFront Configuration

**Distribution ID:** `E33L46W61GEWHI`

**API Gateway Origin:**
- **ID:** `api-gateway-origin`
- **Domain:** `p0y27jfup0.execute-api.us-east-1.amazonaws.com`
- **Origin Path:** `/production`
- **Protocol:** HTTPS only

**Cache Behavior:**
- **Path Pattern:** `/api/*`
- **Target Origin:** `api-gateway-origin`
- **Cache Policy:** `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`
- **Origin Request Policy:** `216adef6-5c7f-47e4-b989-5492eafa07d3` (AllViewer - forwards all headers)

## Updating CloudFront

When Terraform creates/updates the API Gateway, CloudFront needs to be updated to point to it:

```bash
npm run cloudfront:update
```

Or manually:
```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts\update-cloudfront-api-gateway.ps1

# Linux/Mac
bash scripts/update-cloudfront-api-gateway.sh
```

The script:
1. Gets the API Gateway ID from Terraform output
2. Updates CloudFront origin domain name
3. Sets OriginPath to `/production`
4. Applies the changes

## CI/CD Integration

The GitHub Actions workflows automatically update CloudFront:
- `.github/workflows/deploy.yml` - Updates CloudFront after S3 deployment
- `.github/workflows/deploy-lambda.yml` - Updates CloudFront after Lambda deployment

## Troubleshooting

### API Gateway Not Found

If you get "API Gateway not found" errors:
1. Check Terraform output: `cd terraform && terraform output api_gateway_id`
2. Verify API Gateway exists: `aws apigatewayv2 get-api --api-id <id>`
3. Update CloudFront: `npm run cloudfront:update`

### Wrong Origin Path

If requests are failing:
1. Check CloudFront origin: `aws cloudfront get-distribution-config --id E33L46W61GEWHI`
2. Verify OriginPath is `/production`
3. Update if needed: `npm run cloudfront:update`

### Multiple API Gateways

If you see duplicate API Gateways:
1. Identify which one Terraform manages (check Terraform state)
2. Delete the old one: `aws apigatewayv2 delete-api --api-id <old-id>`
3. Update CloudFront to point to the correct one

## Files

- `scripts/update-cloudfront-api-gateway.ps1` - CloudFront update script (Windows)
- `scripts/update-cloudfront-api-gateway.sh` - CloudFront update script (Linux/Mac)
- `terraform/main.tf` - API Gateway Terraform configuration
- `.github/workflows/deploy.yml` - CI/CD workflow with CloudFront update
- `.github/workflows/deploy-lambda.yml` - Lambda deployment workflow with CloudFront update

