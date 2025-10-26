# CORS Solution Cost Analysis

## Problem
Audio files stored in Firebase Storage cannot be accessed directly from the web application due to CORS policy restrictions, causing audio playback failures.

## Solution Comparison

### ❌ Lambda Proxy Solution (REMOVED)
**Cost Impact:**
- **Lambda Invocations**: Every audio play = 1 Lambda invocation
- **Data Transfer**: Audio files go through Lambda → CloudFront → Client (double bandwidth)
- **No Caching**: Each request hits Lambda, no caching benefits
- **Cold Starts**: Audio playback delays due to Lambda cold starts
- **Storage Costs**: Lambda temporary storage for file buffering

**Estimated Monthly Cost for 10,000 audio plays:**
- Lambda invocations: ~$0.20
- Data transfer: ~$0.90 (double bandwidth)
- CloudFront requests: ~$0.85
- **Total: ~$1.95/month** (just for audio playback)

### ✅ Direct Firebase Storage Access (RECOMMENDED)
**Cost Impact:**
- **No Lambda Invocations**: Direct client-to-storage access
- **Single Data Transfer**: Client → Firebase Storage (no proxy)
- **Built-in Caching**: Firebase Storage has built-in CDN caching
- **No Cold Starts**: Immediate audio playback
- **No Additional Storage**: Uses existing Firebase Storage

**Estimated Monthly Cost for 10,000 audio plays:**
- Firebase Storage egress: ~$0.12
- **Total: ~$0.12/month** (94% cost reduction!)

## Implementation

### 1. Configure Firebase Storage CORS
Run the provided script to configure CORS:
```bash
# Windows
configure-storage-cors.bat

# Linux/Mac
chmod +x configure-storage-cors.sh
./configure-storage-cors.sh
```

### 2. CORS Configuration
The `iac/cors_config` file allows access from:
- `http://localhost:3000` (development)
- `http://localhost:5173` (Vite dev server)
- `http://localhost:8080` (alternative dev port)
- `https://masky.net` (production)
- `https://www.masky.net` (production with www)
- `https://masky.io` (alternative domain)
- `https://www.masky.io` (alternative domain with www)

### 3. Benefits of Direct Access
- **94% Cost Reduction**: From $1.95 to $0.12 per month
- **Better Performance**: No Lambda cold starts
- **Simpler Architecture**: Direct client-to-storage
- **Better Caching**: Firebase Storage CDN caching
- **Lower Latency**: Fewer network hops

## Prerequisites
- Google Cloud SDK installed (`gcloud`)
- Authenticated with Google Cloud (`gcloud auth login`)
- Proper permissions on the Firebase Storage bucket

## Verification
After running the CORS configuration script:
1. Audio files should load directly from Firebase Storage URLs
2. No CORS errors in browser console
3. Audio playback should work immediately
4. Check browser Network tab to confirm direct Firebase Storage requests

## Cost Savings Summary
- **Lambda Proxy**: $1.95/month for 10K plays
- **Direct Access**: $0.12/month for 10K plays
- **Savings**: $1.83/month (94% reduction)
- **Annual Savings**: ~$22 for 10K plays/month

For higher usage (100K plays/month):
- **Lambda Proxy**: ~$19.50/month
- **Direct Access**: ~$1.20/month
- **Annual Savings**: ~$220

This solution provides significant cost savings while improving performance and simplifying the architecture.
