# Fix CloudFront Authorization Header Issue

## Problem
CloudFront is not forwarding the `Authorization` header to your API Gateway/Lambda, causing 401 errors.

## Solution Options

### Option 1: Configure CloudFront Cache Behavior (Recommended)

1. **Go to AWS CloudFront Console**
   - https://console.aws.amazon.com/cloudfront/

2. **Find your distribution** (the one serving masky.net)

3. **Click on the distribution ID**

4. **Go to "Behaviors" tab**

5. **Edit the behavior** for `/api/*` paths (or create one if it doesn't exist)

6. **Scroll to "Cache key and origin requests"**
   - Select "Legacy cache settings" or "Cache policy and origin request policy"
   
7. **Under "Headers"**:
   - Select "Include the following headers" (or "Whitelist")
   - Add these headers:
     - `Authorization`
     - `Origin`
     - `Access-Control-Request-Headers`
     - `Access-Control-Request-Method`

8. **Save changes**

9. **Wait for CloudFront to deploy** (takes 5-10 minutes)

### Option 2: Use Origin Request Policy (Newer Method)

1. **Go to CloudFront Console → Policies → Origin request**

2. **Create a new policy**:
   - Name: `APIGatewayAuthPolicy`
   - Headers: Include the following headers
     - Add: `Authorization`
     - Add: `Origin`
   - Query strings: All
   - Cookies: None

3. **Go back to your distribution → Behaviors**

4. **Edit the `/api/*` behavior**

5. **Under "Origin request policy"**:
   - Select your new `APIGatewayAuthPolicy`

6. **Save and wait for deployment**

### Option 3: Forward All Headers (Quick but not optimal)

⚠️ **This disables caching for API requests**

1. **Go to CloudFront → Your distribution → Behaviors**

2. **Edit the `/api/*` behavior**

3. **Under "Cache key and origin requests"**:
   - Headers: Select "All"

4. **Save changes**

## Verify the Fix

After CloudFront finishes deploying (5-10 minutes):

1. **Test in browser console**:
```javascript
const user = firebase.auth().currentUser;
const token = await user.getIdToken();

fetch('https://masky.net/api/subscription/status', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log);
```

2. **Check CloudWatch logs again**:
```bash
aws logs tail /aws/lambda/masky-production-api --since 5m
```

You should now see the `Authorization` header in the logs!

## Alternative: Bypass CloudFront for API Calls

If you want API calls to skip CloudFront entirely:

1. **Update `src/config.js`**:
```javascript
const getApiBaseUrl = () => {
  // Always use API Gateway directly (not through CloudFront)
  return 'https://YOUR-API-GATEWAY-ID.execute-api.us-east-1.amazonaws.com/production';
};
```

2. **Get your API Gateway URL**:
```bash
serverless info --stage production
# Look for: endpoint: GET - https://XXXXXX.execute-api.us-east-1.amazonaws.com/production/...
```

3. **Update the URL in config.js**

This bypasses CloudFront and sends requests directly to API Gateway, which will preserve all headers.

## Quick Check: Find Your Setup

```bash
# Get your API Gateway endpoint
serverless info --stage production

# Check if you have CloudFront
aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[?contains(@, 'masky.net')]].{ID:Id,Domain:DomainName,Status:Status}" --output table
```

## Current Issue Summary

Based on CloudWatch logs:
- ✅ Requests ARE reaching your Lambda
- ✅ Lambda is executing correctly
- ❌ `Authorization` header is NOT present in requests
- 🎯 CloudFront is stripping it before it reaches Lambda

**Fix CloudFront configuration to forward the `Authorization` header.**

