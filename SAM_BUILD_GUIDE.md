# SAM Build Guide

This project uses AWS SAM (Serverless Application Model) for fast, optimized Lambda builds.

## Why SAM?

- ⚡ **Faster builds** - Built-in caching and parallel builds
- 🐳 **Linux compatibility** - Automatic Docker builds
- 📦 **Optimized packages** - Handles dependencies efficiently
- 🔄 **Incremental builds** - Only rebuilds what changed

## Prerequisites

Install SAM CLI:

**macOS:**
```bash
brew install aws-sam-cli
```

**Linux:**
```bash
pip install aws-sam-cli
```

**Windows:**
```bash
pip install aws-sam-cli
```

Verify installation:
```bash
sam --version
```

## Usage

### Build Lambda Package

**All Platforms:**
```bash
npm run lambda:package:sam
```

This script automatically detects your platform and uses Docker if available.

**Note:** The build script will automatically use Docker if Docker Desktop is running, or fall back to local build if not.

### Deploy

```bash
npm run deploy
```

Or manually:
```bash
npm run lambda:package:sam
npm run terraform:apply
```

## How It Works

1. **SAM Build** (`sam build --use-container --cached`)
   - Uses Docker for Linux-compatible builds
   - Installs production dependencies only
   - Caches build artifacts in `.aws-sam/`
   - Outputs to `.aws-sam/build/MaskyApiFunction/`

2. **Package Preparation**
   - Copies SAM output to `lambda-package/` for Terraform compatibility
   - Fixes aws-sdk `licensemanager.js` require path issue
   - Creates `lambda-package.zip` for Terraform

3. **Terraform Deployment**
   - Uses `lambda-package/` directory or `lambda-package.zip`
   - Deploys to AWS Lambda

## Build Performance

### First Build
- **Time**: ~3-5 minutes
- **Reason**: Docker image download, npm install

### Cached Builds
- **Time**: ~30-60 seconds
- **Reason**: Uses cached dependencies and build artifacts

### Incremental Builds
- **Time**: ~10-30 seconds
- **Reason**: Only rebuilds changed files

## Cache Management

SAM caches:
- Docker images
- `node_modules`
- Build artifacts in `.aws-sam/`

Clear cache:
```bash
rm -rf .aws-sam lambda-package lambda-package.zip
```

## Troubleshooting

### SAM Not Found
```bash
# Install SAM CLI (see Prerequisites)
pip install aws-sam-cli
# or
brew install aws-sam-cli
```

### Docker Not Running
SAM uses Docker for Linux compatibility. Ensure Docker is running:
```bash
docker ps
```

### Build Fails
1. Clear cache: `rm -rf .aws-sam`
2. Check Docker: `docker ps`
3. Verify SAM: `sam --version`
4. Check logs: `sam build --debug`

### Package Too Large
- SAM automatically optimizes dependencies
- Check size: `ls -lh lambda-package.zip`
- Consider Lambda Layers for very large packages

## Comparison with Other Methods

| Method | Speed | Compatibility | Use Case |
|--------|-------|---------------|----------|
| **SAM** | ⚡⚡⚡ Fast | ✅ Linux | **Recommended** |
| Docker Build | ⚡⚡ Medium | ✅ Linux | Alternative |
| Local Build | ⚡ Fastest | ⚠️ Platform-dependent | Development only |

## Files

- `template.yaml` - SAM template (build configuration)
- `samconfig.toml` - SAM CLI configuration
- `.samignore` - Files to exclude from SAM builds
- `scripts/build-lambda-sam.sh` - Build script (Linux/Mac)
- `scripts/build-lambda-sam.ps1` - Build script (Windows)

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy-lambda.yml`) uses SAM with:
- Automatic SAM CLI setup
- Build artifact caching
- Fast incremental builds

## Next Steps

See [LAMBDA_BUILD_OPTIMIZATION.md](./LAMBDA_BUILD_OPTIMIZATION.md) for detailed optimization guide.

