# Lambda Build Optimization Guide

This document describes the optimized Lambda build and deployment process using Terraform with caching and Docker support.

## Architecture Overview

The Lambda deployment uses a multi-stage approach:

1. **Local Development**: Fast iteration with caching
2. **Docker Builds**: Linux-compatible packages (recommended for production)
3. **Terraform Deployment**: Infrastructure as Code with incremental updates

## Build Methods

### Method 1: Local Build (Fast, Good for Development)

```bash
npm run lambda:package
```

**Features:**
- ✅ Fast builds with dependency caching
- ✅ Skips npm install if package.json unchanged
- ✅ Works on all platforms
- ⚠️ May have platform-specific issues on Windows/Mac

**When to use:**
- Local development
- Quick iterations
- CI/CD on Linux runners

### Method 2: SAM Build (Recommended for Production)

**All Platforms:**
```bash
npm run lambda:package:sam
```

**Features:**
- ✅ Linux-compatible builds (uses Docker automatically if available)
- ✅ Consistent across all platforms
- ✅ Optimized package size
- ✅ Built-in caching for fast rebuilds
- ✅ Automatically detects Docker and uses it if available

**When to use:**
- Production deployments
- Cross-platform builds
- Ensuring runtime compatibility

## Optimization Features

### 1. Dependency Caching

The build script caches `node_modules` based on `package.json` and `package-lock.json` hashes:

- **Cache Location**: `.lambda-cache/manifest.json`
- **Cache Key**: SHA256 hash of package files
- **Benefit**: Skips npm install when dependencies haven't changed

### 2. Incremental Builds

- Only rebuilds when source files change
- Terraform's `source_code_hash` detects changes automatically
- Lambda only updates when code actually changes

### 3. Package Size Optimization

The Docker build automatically removes:
- Test files (`*.test.js`, `*.spec.js`)
- TypeScript definitions (`*.d.ts`)
- Source maps (`*.map`)
- Documentation (`*.md`, `*.txt`)
- Test directories (`test/`, `tests/`, `__tests__/`)

### 4. GitHub Actions Caching

The CI/CD workflow caches:
- `lambda-package/node_modules` - Dependencies
- `.lambda-cache` - Build metadata

**Cache Key**: `lambda-deps-{os}-{package-hash}`

## Deployment Workflow

### Local Deployment

```bash
# Build and deploy
npm run deploy

# Preview changes first
npm run deploy:plan
```

### CI/CD Deployment

The GitHub Actions workflow (`deploy-lambda.yml`) automatically:
1. Checks out code
2. Caches dependencies
3. Builds Lambda package
4. Runs Terraform plan/apply
5. Deploys to AWS

**Triggered by:**
- Pushes to `production` branch
- Changes to `api/`, `utils/`, `package.json`, or `terraform/`
- Manual workflow dispatch

## Best Practices

### 1. Use SAM Build for Production

Always use SAM builds for production deployments to ensure Linux compatibility:

```bash
npm run lambda:package:sam
```

The build script automatically uses Docker if Docker Desktop is running, ensuring Linux compatibility.

### 2. Monitor Package Size

Lambda has a 50MB limit for direct uploads. If your package exceeds this:
- Consider using Lambda Layers for dependencies
- Use S3 for larger packages (Terraform handles this automatically)

### 3. Cache Management

The cache is automatically invalidated when:
- `package.json` changes
- `package-lock.json` changes
- Cache directory is deleted

To force a rebuild:
```bash
rm -rf .lambda-cache lambda-package/node_modules
npm run lambda:package
```

### 4. Terraform State

Terraform tracks changes via `source_code_hash`:
- Only updates Lambda when code actually changes
- Prevents unnecessary deployments
- Reduces AWS API calls

### 5. Environment Variables

Lambda reads configuration from:
- **SSM Parameter Store**: Production secrets (configured via IAM)
- **Environment Variables**: Non-sensitive config (STAGE, etc.)

## Troubleshooting

### Build Fails on Windows

**Solution**: Start Docker Desktop and run SAM build (Docker is auto-detected):
```powershell
npm run lambda:package:sam
```

### Package Too Large

**Solutions**:
1. Check package size: `ls -lh lambda-package.zip`
2. Use Docker build (more aggressive optimization)
3. Consider Lambda Layers for large dependencies

### Cache Issues

**Clear cache**:
```bash
rm -rf .lambda-cache lambda-package/node_modules
```

### Terraform Not Detecting Changes

**Check**:
1. Verify `source_code_hash` in Terraform plan
2. Ensure `lambda-package` directory is updated
3. Check Terraform state: `terraform show`

## Performance Metrics

### Build Times (Approximate)

- **First Build**: ~2-3 minutes (npm install)
- **Cached Build**: ~10-30 seconds (no npm install)
- **Docker Build**: ~3-5 minutes (includes image build)

### Package Sizes

- **Typical**: 15-30 MB
- **With Firebase Admin**: 25-40 MB
- **Optimized**: 10-20 MB (after Docker cleanup)

## Advanced: Lambda Layers

For very large dependencies, consider Lambda Layers:

1. Create a layer with shared dependencies
2. Reference layer in Terraform
3. Reduce function package size

Example Terraform:
```hcl
resource "aws_lambda_layer_version" "dependencies" {
  filename   = "layer.zip"
  layer_name = "masky-dependencies"
  # ...
}

resource "aws_lambda_function" "api" {
  # ...
  layers = [aws_lambda_layer_version.dependencies.arn]
}
```

## References

- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Terraform AWS Lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function)
- [Docker Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

