# Cleanup Guide - Files to Remove

This guide lists files that can be safely deleted as they've been replaced by the optimized SAM-based build process.

## ✅ Safe to Delete (Replaced by SAM)

These files are no longer used and can be deleted:

### Old Build Scripts
- `scripts/build-lambda-docker.sh` - Replaced by `scripts/build-lambda-sam.js`
- `scripts/build-lambda-docker.ps1` - Replaced by `scripts/build-lambda-sam.js`
- `scripts/build-lambda-sam.sh` - Replaced by cross-platform `scripts/build-lambda-sam.js`
- `scripts/build-lambda-sam.ps1` - Replaced by cross-platform `scripts/build-lambda-sam.js`
- `scripts/package-lambda.js` - Replaced by SAM build process

### Old Docker Files
- `Dockerfile.lambda` - SAM handles Docker internally

### Old Package Scripts (from package.json)
These npm scripts were removed from `package.json`:
- `lambda:package` - Use `lambda:package:sam` instead
- `lambda:package:sam:bash` - Use `lambda:package:sam` instead
- `lambda:package:sam:win` - Use `lambda:package:sam` instead
- `lambda:package:sam:local` - Use `lambda:package:sam` instead
- `lambda:package:sam:nodocker` - Use `lambda:package:sam` instead
- `lambda:package:docker` - Use `lambda:package:sam` instead
- `lambda:package:docker:win` - Use `lambda:package:sam` instead
- `deploy:docker` - Use `deploy` instead
- `deploy:sam` - Use `deploy` instead

## ✅ Keep (Active)

These files are actively used:

### Build Scripts
- `scripts/build-lambda-sam.js` ✅ - Main Lambda function build script
- `scripts/build-layer.js` ✅ - Lambda Layer build script

### SAM Templates
- `template.yaml` ✅ - SAM template for Lambda function
- `template-layer.yaml` ✅ - SAM template for Lambda Layer
- `samconfig.toml` ✅ - SAM configuration
- `.samignore` ✅ - SAM ignore patterns

### Deployment Scripts
- `scripts/deploy.sh` / `scripts/deploy.ps1` ✅ - General deployment scripts
- `scripts/deploy-terraform.sh` / `scripts/deploy-terraform.ps1` ✅ - Terraform deployment
- `scripts/update-cloudfront-api-gateway.sh` / `.ps1` ✅ - CloudFront updates

## How to Clean Up

### Option 1: Manual Deletion
```bash
# Delete old build scripts
rm scripts/build-lambda-docker.sh
rm scripts/build-lambda-docker.ps1
rm scripts/build-lambda-sam.sh
rm scripts/build-lambda-sam.ps1
rm scripts/package-lambda.js

# Delete old Docker file
rm Dockerfile.lambda
```

### Option 2: Git Cleanup (Recommended)
```bash
# Review what would be deleted
git status

# Stage deletions
git rm scripts/build-lambda-docker.sh
git rm scripts/build-lambda-docker.ps1
git rm scripts/build-lambda-sam.sh
git rm scripts/build-lambda-sam.ps1
git rm scripts/package-lambda.js
git rm Dockerfile.lambda

# Commit cleanup
git commit -m "chore: remove old build scripts, replaced by SAM"
```

## Verification

After cleanup, verify everything still works:

```bash
# Test layer build (should use cache if unchanged)
npm run lambda:layer

# Test function build
npm run lambda:package:sam

# Test full deployment (dry run)
npm run deploy:plan
```

