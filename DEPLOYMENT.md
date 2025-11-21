# Lambda Deployment Guide

## Quick Start

**When you change API code (`api/`, `utils/`):**
```bash
npm run deploy
```

That's it! The build process automatically:
- ✅ Checks if Lambda Layer needs rebuilding (only if `layer-dependencies/package.json` changed)
- ✅ Builds Lambda function with SAM (uses Docker for Linux compatibility)
- ✅ Uses SAM cache for fast rebuilds (only rebuilds what changed)
- ✅ Deploys via Terraform
- ✅ Updates CloudFront configuration

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Lambda Layer (lambda-layer.zip)                        │
│ - Large dependencies: aws-sdk, firebase-admin, stripe │
│ - Rebuilt only when layer-dependencies/package.json     │
│   changes                                               │
└─────────────────────────────────────────────────────────┘
                    ↓ attached to
┌─────────────────────────────────────────────────────────┐
│ Lambda Function (lambda-package.zip)                   │
│ - Your code: api/, utils/, local-env-loader.js          │
│ - Small package (~0.08 MB)                              │
│ - Rebuilt on every API code change                     │
└─────────────────────────────────────────────────────────┘
```

### Build Process

1. **Lambda Layer Build** (`npm run lambda:layer`)
   - Checks if `layer-dependencies/package.json` changed
   - If unchanged, skips rebuild (uses existing `lambda-layer.zip`)
   - If changed, rebuilds with SAM (uses Docker for Linux compatibility)
   - Output: `lambda-layer.zip` (~50-100 MB)

2. **Lambda Function Build** (`npm run lambda:package:sam`)
   - Always runs (but SAM cache makes it fast)
   - Uses AWS SAM with Docker for Linux compatibility
   - SAM caches `node_modules` and build artifacts
   - Only copies your code (`api/`, `utils/`, `local-env-loader.js`)
   - Output: `lambda-package.zip` (~0.08 MB)

3. **Terraform Deploy** (`npm run terraform:apply`)
   - Uploads both zips to S3
   - Updates Lambda function and layer
   - Updates API Gateway if needed

4. **CloudFront Update** (`npm run cloudfront:update`)
   - Ensures CloudFront points to correct API Gateway

### Docker Usage

**Docker is used for:**
- Building Lambda packages with Linux-compatible binaries
- SAM uses Docker containers to ensure Lambda runtime compatibility

**Docker is NOT required if:**
- You're on Linux and don't mind potential compatibility issues
- The build script will detect Docker and fall back gracefully

**To use Docker:**
- Start Docker Desktop before running `npm run deploy`
- The build script automatically detects and uses Docker

## Scripts Reference

### Main Commands

| Command | What It Does |
|---------|-------------|
| `npm run deploy` | Full deployment: build layer + function + deploy |
| `npm run deploy:plan` | Preview changes without deploying |
| `npm run lambda:layer` | Build Lambda Layer only |
| `npm run lambda:package:sam` | Build Lambda Function only |

### Advanced Commands

| Command | Use Case |
|---------|----------|
| `npm run terraform:plan` | Preview Terraform changes |
| `npm run terraform:apply` | Deploy Terraform only (skip builds) |
| `npm run cloudfront:update` | Update CloudFront config only |

## Caching Strategy

### Lambda Layer Caching
- **Cache key**: Hash of `layer-dependencies/package.json`
- **Cache location**: `lambda-layer.zip` (checked before rebuild)
- **When it rebuilds**: Only when `layer-dependencies/package.json` changes

### Lambda Function Caching
- **Cache key**: SAM's internal cache (based on file timestamps)
- **Cache location**: `.aws-sam/build/` directory
- **When it rebuilds**: When `api/`, `utils/`, or `local-env-loader.js` changes
- **Speed**: ~5-10 seconds with cache, ~30-60 seconds without

### GitHub Actions Caching
- Caches SAM build artifacts (`.aws-sam/`)
- Caches `lambda-package.zip` and `lambda-layer.zip`
- Cache key includes file hashes for invalidation

## File Structure

```
minime/
├── api/                          # Lambda function code
│   └── api.js                    # Main handler
├── utils/                        # Utility functions
├── layer-dependencies/           # Lambda Layer dependencies
│   ├── package.json             # Layer dependencies only
│   └── node_modules/            # Installed by npm run lambda:layer
├── lambda-layer/                 # Built layer structure
│   └── nodejs/
│       └── node_modules/        # Copied from layer-dependencies
├── lambda-layer.zip              # Layer package (for Terraform)
├── lambda-package/               # Built function code
│   ├── api/
│   ├── utils/
│   └── local-env-loader.js
├── lambda-package.zip            # Function package (for Terraform)
├── .aws-sam/                     # SAM build cache (gitignored)
│   └── build/
├── template.yaml                 # SAM template for function
├── template-layer.yaml           # SAM template for layer
└── scripts/
    ├── build-lambda-sam.js      # Main build script (cross-platform)
    └── build-layer.js            # Layer build script
```

## Troubleshooting

### "Docker is not running"
- **Solution**: Start Docker Desktop, or the build will continue without Docker (may have compatibility issues)

### "SAM CLI is not installed"
- **Install**: `pip install aws-sam-cli` (or `brew install aws-sam-cli` on macOS)

### Build is slow
- **Check**: Is SAM cache working? Look for "Cache is invalid" vs "Using cache" in output
- **Tip**: First build is always slower (~60s), subsequent builds are fast (~5-10s)

### Layer not updating
- **Check**: Did `layer-dependencies/package.json` actually change?
- **Force rebuild**: Delete `lambda-layer.zip` and rebuild

### Function not updating
- **Check**: Terraform logs - is it uploading the new zip?
- **Verify**: Check Lambda function code in AWS Console

## GitHub Actions

The `.github/workflows/deploy-lambda.yml` workflow:
- Triggers on changes to `api/`, `utils/`, `terraform/`, or `package.json`
- Uses GitHub Actions cache for SAM builds
- Automatically deploys on push to `production` branch

## What Files Can Be Deleted?

### Safe to Delete (Old/Unused)
- `scripts/build-lambda-docker.sh` / `.ps1` (replaced by SAM)
- `scripts/package-lambda.js` (replaced by SAM)
- `Dockerfile.lambda` (SAM handles Docker internally)
- `scripts/build-lambda-sam.sh` / `.ps1` (replaced by `.js` version)

### Keep (Active)
- `scripts/build-lambda-sam.js` ✅ (main build script)
- `scripts/build-layer.js` ✅ (layer build script)
- `template.yaml` ✅ (SAM function template)
- `template-layer.yaml` ✅ (SAM layer template)
- `samconfig.toml` ✅ (SAM configuration)
- `.samignore` ✅ (SAM ignore file)

