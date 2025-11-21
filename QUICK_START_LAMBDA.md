# Quick Start: Lambda Deployment

## TL;DR - Recommended Workflow

### For Production Deployments (Recommended)
```bash
# Use SAM build (automatically uses Docker if available)
npm run lambda:package:sam

# Deploy with Terraform
npm run terraform:apply
```

Or use the all-in-one command:
```bash
npm run deploy
```

### For Local Development (Fast Iteration)
```bash
# Build Lambda function (uses SAM cache for speed)
npm run lambda:package:sam

# Deploy
npm run deploy
```

## What Changed?

### ✅ Optimizations Added

1. **Dependency Caching**
   - Skips `npm install` when `package.json` hasn't changed
   - Cache stored in `.lambda-cache/`
   - Saves 2-3 minutes per build

2. **Docker Builds**
   - Linux-compatible packages (matches AWS Lambda runtime)
   - Consistent across Windows/Mac/Linux
   - Automatic package size optimization

3. **GitHub Actions CI/CD**
   - Automatic caching of dependencies
   - Only rebuilds when code changes
   - Separate workflow for Lambda deployments

4. **Incremental Terraform Updates**
   - Only updates Lambda when code actually changes
   - Uses `source_code_hash` for change detection

## Build Methods Comparison

| Method | Speed | Compatibility | Use Case |
|--------|-------|---------------|----------|
| SAM Build (`npm run lambda:package:sam`) | ⚡ Fast (5-10s cached, 30-60s first build) | ✅ Linux-compatible (uses Docker if available) | Production & Development |

## Common Commands

```bash
# Build Lambda package
npm run lambda:package:sam          # SAM build (Linux-compatible, uses Docker if available)
npm run lambda:layer                # Build Lambda Layer (cached if unchanged)

# Deploy
npm run deploy                      # Build + Deploy
npm run deploy:plan                 # Preview changes

# Terraform only
npm run terraform:plan              # Preview
npm run terraform:apply             # Deploy
```

## Troubleshooting

**Build fails on Windows?**
→ Start Docker Desktop and run `npm run lambda:package:sam` (Docker is auto-detected)

**Package too large?**
→ Use Lambda Layers for dependencies (already configured - see `layer-dependencies/`)

**Cache issues?**
→ Clear SAM cache: `rm -rf .aws-sam/build` and rebuild

**Terraform not detecting changes?**
→ Ensure `lambda-package.zip` exists and is updated

## Next Steps

See [LAMBDA_BUILD_OPTIMIZATION.md](./LAMBDA_BUILD_OPTIMIZATION.md) for detailed documentation.

