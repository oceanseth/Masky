# Deployment Summary

## 🎯 One Command to Deploy

```bash
npm run deploy
```

That's it! This single command:
1. ✅ Checks if Lambda Layer needs rebuilding (skips if unchanged)
2. ✅ Builds Lambda function with SAM (uses cache for speed)
3. ✅ Deploys via Terraform
4. ✅ Updates CloudFront configuration

## 📊 What Gets Cached

### Lambda Layer (`lambda-layer.zip`)
- **Cached when**: `layer-dependencies/package.json` hasn't changed
- **Cache file**: `.layer-hash` (stores hash of package.json)
- **Size**: ~28-30 MB
- **Rebuild time**: ~30-60 seconds (only when dependencies change)
- **Skip time**: <1 second (when cached)

### Lambda Function (`lambda-package.zip`)
- **Cached by**: SAM's internal cache (`.aws-sam/build/`)
- **Cache key**: File timestamps of `api/`, `utils/`, `local-env-loader.js`
- **Size**: ~0.08 MB
- **Rebuild time**: ~5-10 seconds (with cache), ~30-60 seconds (without cache)

## 🔄 When Things Rebuild

| Change | Layer Rebuilds? | Function Rebuilds? |
|--------|----------------|-------------------|
| Edit `api/api.js` | ❌ No | ✅ Yes (~5-10s) |
| Edit `utils/*.js` | ❌ No | ✅ Yes (~5-10s) |
| Edit `layer-dependencies/package.json` | ✅ Yes (~30-60s) | ✅ Yes (~5-10s) |
| Edit `terraform/*.tf` | ❌ No | ❌ No |
| No changes | ❌ No | ❌ No |

## 🐳 Docker Usage

**Docker is automatically detected and used:**
- If Docker Desktop is running → Uses `--use-container` (Linux-compatible)
- If Docker is not running → Falls back to local build (may have compatibility issues)

**To ensure Linux compatibility:**
- Start Docker Desktop before running `npm run deploy`

## 📁 Key Files

### Build Scripts
- `scripts/build-layer.js` - Builds Lambda Layer (with caching)
- `scripts/build-lambda-sam.js` - Builds Lambda Function (uses SAM cache)

### SAM Templates
- `template.yaml` - Lambda function configuration
- `template-layer.yaml` - Lambda Layer configuration

### Output Files
- `lambda-layer.zip` - Layer package (cached when unchanged)
- `lambda-package.zip` - Function package (always rebuilt, but fast with SAM cache)
- `.layer-hash` - Cache file for layer (gitignored)

## 🚀 GitHub Actions

The `.github/workflows/deploy-lambda.yml` workflow:
- Automatically caches Lambda Layer and SAM builds
- Triggers on changes to `api/`, `utils/`, `terraform/`, or `package.json`
- Deploys automatically on push to `production` branch

## ⚡ Performance

### Typical Deployment Times

**First deployment (no cache):**
- Layer build: ~60s
- Function build: ~60s
- Terraform: ~30s
- **Total: ~2.5 minutes**

**Subsequent deployments (API code changes only):**
- Layer build: <1s (cached)
- Function build: ~5-10s (SAM cache)
- Terraform: ~30s
- **Total: ~40-45 seconds**

**Subsequent deployments (no changes):**
- Layer build: <1s (cached)
- Function build: <1s (cached)
- Terraform: ~5s (no changes)
- **Total: ~6-10 seconds**

## 🛠️ Troubleshooting

### "Layer dependencies unchanged, skipping rebuild"
✅ **This is good!** The layer hasn't changed, so it's using the cached version.

### "Docker is not running"
⚠️ **Warning only** - Build continues without Docker. For production, start Docker Desktop.

### Build seems slow
- Check if SAM cache is working (look for "Cache is invalid" vs "Using cache")
- First build is always slower (~60s)
- Subsequent builds should be fast (~5-10s)

### Need to force rebuild
```bash
# Force layer rebuild
rm lambda-layer.zip .layer-hash
npm run lambda:layer

# Force function rebuild
rm -rf .aws-sam/build
npm run lambda:package:sam
```

## 📚 Documentation

- `DEPLOYMENT.md` - Full deployment guide
- `CLEANUP_GUIDE.md` - Files that can be deleted
- `DEPLOYMENT_SUMMARY.md` - This file (quick reference)

