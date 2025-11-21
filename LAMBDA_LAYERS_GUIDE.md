# Lambda Layers Optimization Guide

This guide explains how Lambda Layers are used to optimize package size and deployment speed.

## Overview

Lambda Layers allow you to package dependencies separately from your function code. This provides several benefits:

- ✅ **Smaller function packages** - Reduces from ~40-50MB to ~1-5MB
- ✅ **Faster deployments** - Only deploy code changes, not dependencies
- ✅ **Shared dependencies** - Reuse layers across multiple functions
- ✅ **Better caching** - Layers are cached separately from function code

## Architecture

```
┌─────────────────────────────────────┐
│   Lambda Function Package          │
│   (~1-5MB)                         │
│   - api/                           │
│   - utils/                         │
│   - local-env-loader.js            │
│   (No node_modules)                │
└─────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────┐
│   Lambda Layer                       │
│   (~40-50MB)                        │
│   - nodejs/node_modules/            │
│     - aws-sdk                       │
│     - firebase-admin                │
│     - stripe                        │
│     - @aws-sdk/*                    │
└─────────────────────────────────────┘
```

## Dependencies in Layer

The following large dependencies are packaged in the Lambda Layer:

- `aws-sdk` (~40MB)
- `firebase-admin` (~50MB)
- `stripe` (~5MB)
- `@aws-sdk/client-kms`
- `@aws-sdk/client-ssm`
- `xml2js`
- `jmespath`

## Build Process

### 1. Build Lambda Layer

```bash
npm run lambda:layer
```

This:
- Builds the layer using SAM
- Packages dependencies into `lambda-layer.zip`
- Fixes aws-sdk `licensemanager.js` issue
- Outputs to `lambda-layer/` directory

### 2. Build Lambda Function

```bash
npm run lambda:package:sam
```

This:
- Builds the function code (without dependencies)
- Excludes `node_modules` (dependencies are in layer)
- Creates `lambda-package.zip` (~1-5MB)

### 3. Deploy

```bash
npm run deploy
```

This:
- Builds both layer and function
- Deploys via Terraform
- Terraform creates/updates the layer and function

## Package Size Comparison

### Without Layers
- Function package: ~40-50MB
- Deployment time: ~2-3 minutes
- Cold start: ~3-5 seconds

### With Layers
- Function package: ~1-5MB
- Layer package: ~40-50MB (cached separately)
- Deployment time: ~30-60 seconds (code only)
- Cold start: ~3-5 seconds (same)

## Layer Updates

Layers are versioned. When you update dependencies:

1. Build new layer: `npm run lambda:layer`
2. Terraform creates new layer version
3. Lambda function automatically uses latest version

**Note:** Old layer versions are retained (up to 5 versions). Clean up old versions manually if needed.

## Terraform Configuration

The layer is defined in `terraform/data.tf`:

```hcl
resource "aws_lambda_layer_version" "dependencies" {
  filename            = var.lambda_layer_path
  layer_name          = "masky-dependencies-${var.stage}"
  compatible_runtimes = ["nodejs18.x"]
}
```

The function references the layer in `terraform/main.tf`:

```hcl
resource "aws_lambda_function" "api" {
  # ...
  layers = [aws_lambda_layer_version.dependencies.arn]
}
```

## Local Development

For local development, dependencies are still installed normally:

```bash
npm install
npm run dev:api
```

Layers only affect AWS Lambda deployment, not local development.

## Troubleshooting

### Layer Not Found

If you get "Layer not found" errors:
1. Ensure layer is built: `npm run lambda:layer`
2. Check Terraform applies the layer: `terraform plan`
3. Verify layer exists: `aws lambda list-layers`

### Function Can't Find Dependencies

If the function can't find dependencies:
1. Check layer is attached: `aws lambda get-function --function-name masky-api-production`
2. Verify layer structure: `unzip -l lambda-layer.zip`
3. Ensure `nodejs/node_modules/` structure is correct

### Layer Too Large

Lambda Layers have a 50MB limit (unzipped). If your layer exceeds this:
1. Remove unnecessary dependencies
2. Use multiple layers
3. Consider using Lambda Container Images instead

## Best Practices

1. **Update layer only when dependencies change** - Don't rebuild layer on every deployment
2. **Version dependencies** - Use exact versions in `layer-dependencies/package.json`
3. **Monitor layer size** - Keep under 50MB unzipped
4. **Clean up old versions** - Delete unused layer versions to save space

## Files

- `template-layer.yaml` - SAM template for layer build
- `layer-dependencies/package.json` - Layer dependencies
- `scripts/build-layer.js` - Layer build script
- `terraform/data.tf` - Terraform layer resource
- `terraform/main.tf` - Lambda function with layer reference

## Next Steps

See [SAM_BUILD_GUIDE.md](./SAM_BUILD_GUIDE.md) for SAM build details.

