# Deployment & Debugging Guide

## Quick Deploy

```bash
# 1. Build frontend
npm run build

# 2. Deploy backend API
serverless deploy --stage production

# 3. After deployment, note your API endpoint URL
# Example: https://abcd1234.execute-api.us-east-1.amazonaws.com/production
```

## Check CloudWatch Logs

### View Real-time Logs
```bash
# Follow logs in real-time
serverless logs -f api -t --stage production

# Or use AWS CLI
aws logs tail /aws/lambda/masky-production-api --follow
```

### Check Recent Logs
```bash
# View last 100 lines
serverless logs -f api --stage production

# Or specific time range
aws logs tail /aws/lambda/masky-production-api --since 10m
```

## Common Issues & Solutions

### 401 Unauthorized Error

**Symptoms:** 
- Browser console shows: `401 (Unauthorized)`
- Endpoint: `/api/subscription/status`

**Possible Causes & Solutions:**

1. **Authorization header not being sent**
   ```javascript
   // Check in browser console if token exists
   const user = firebase.auth().currentUser;
   const token = await user.getIdToken();
   console.log('Token:', token);
   ```

2. **API Gateway not passing headers**
   - Check if CORS is configured properly in API Gateway
   - Verify `Access-Control-Allow-Headers` includes `Authorization`

3. **Token expired**
   ```javascript
   // Force token refresh
   const token = await user.getIdToken(true);
   ```

4. **Wrong API endpoint**
   - Check `src/config.js` has correct `api.baseUrl`
   - Should be your deployed API Gateway URL

### Check What's in CloudWatch

After you see the 401 error, check CloudWatch logs for these messages:

```bash
serverless logs -f api --stage production
```

Look for:
- `"Getting subscription status, headers:"` - Shows what headers the API received
- `"No authorization header found"` - Header missing
- `"Invalid authorization header format"` - Header format wrong
- Firebase token verification errors

### Verify SSM Parameters

Make sure your SSM parameters are set correctly:

```bash
# Check if parameters exist
aws ssm get-parameter --name "/voicecert/production/STRIPE_SECRET_KEY" --with-decryption
aws ssm get-parameter --name "/masky/production/stripe_webhook_secret" --with-decryption

# If using different stage
aws ssm get-parameter --name "/voicecert/YOUR_STAGE/STRIPE_SECRET_KEY" --with-decryption
aws ssm get-parameter --name "/masky/YOUR_STAGE/stripe_webhook_secret" --with-decryption
```

### Test API Directly

Test if the API is working with curl:

```bash
# Get a token from Firebase (copy from browser console)
TOKEN="your-firebase-id-token"

# Test subscription status endpoint
curl -X GET \
  https://YOUR-API-GATEWAY-URL/api/subscription/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Expected responses:
- **200 OK**: Working correctly
- **401 Unauthorized**: Token issue
- **500 Error**: Backend error (check CloudWatch)

## Debug Mode

### Enable Detailed Logging

The code now includes detailed logging. After deployment, check logs to see:

1. **Headers received by API:**
   ```
   Getting subscription status, headers: {"authorization":"Bearer eyJ..."}
   ```

2. **Token validation:**
   ```
   No authorization header found
   OR
   Invalid authorization header format
   ```

3. **Firebase initialization:**
   ```
   Initializing Firebase Admin...
   Firebase Admin initialized successfully
   ```

### Check Frontend Console

Open browser DevTools Console and check:

```javascript
// 1. Check if user is logged in
console.log('User:', firebase.auth().currentUser);

// 2. Check config
import { config } from './config';
console.log('API Base URL:', config.api.baseUrl);

// 3. Check if token is being sent
const user = firebase.auth().currentUser;
if (user) {
  const token = await user.getIdToken();
  console.log('Token length:', token.length);
  console.log('Token starts with:', token.substring(0, 20));
}
```

### Check Network Tab

1. Open DevTools → Network tab
2. Reload page
3. Find the `/api/subscription/status` request
4. Check:
   - **Request Headers:** Should have `Authorization: Bearer ...`
   - **Response Status:** 401, 200, 500?
   - **Response Body:** Error message details

## Deployment Checklist

Before testing, make sure:

- [ ] Frontend built: `npm run build`
- [ ] Backend deployed: `serverless deploy --stage production`
- [ ] SSM parameters set (both Stripe secret key and webhook secret)
- [ ] Firestore enabled in Firebase Console
- [ ] Firebase Admin SDK service account configured in SSM
- [ ] API Gateway URL updated in `src/config.js` if needed
- [ ] CORS configured properly in API

## Quick Fixes

### If you see "No authorization header found":

**Option 1: Check API Base URL**
```javascript
// src/config.js
const getApiBaseUrl = () => {
  // If running on localhost, use the deployed API URL
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'https://YOUR-API-GATEWAY-URL.amazonaws.com/production'; // Update this!
  }
  return window.location.origin;
};
```

**Option 2: Check if logged in**
```javascript
// Make sure user is actually logged in
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    console.log('Logged in:', user.email);
  } else {
    console.log('Not logged in');
  }
});
```

### If you see "Token verification failed":

```bash
# Check Firebase Admin is properly configured
aws ssm get-parameter --name "/masky/production/firebase_service_account" --with-decryption
```

### If nothing appears in logs:

```bash
# Make sure you're checking the right function and stage
serverless info --stage production

# This will show you:
# - Function name
# - API Gateway endpoint
# - Log group name
```

## Get Help

If you're still stuck:

1. **Copy the error from CloudWatch logs**
2. **Copy the network request/response from browser DevTools**
3. **Check that all SSM parameters are set correctly**
4. **Verify your stage matches**: production vs prod vs dev

---

## Quick Commands Reference

```bash
# Deploy
serverless deploy --stage production

# View logs (real-time)
serverless logs -f api -t --stage production

# View logs (recent)
serverless logs -f api --stage production

# Get API info
serverless info --stage production

# Check SSM params
aws ssm get-parameter --name "/voicecert/production/STRIPE_SECRET_KEY" --with-decryption
aws ssm get-parameter --name "/masky/production/stripe_webhook_secret" --with-decryption
aws ssm get-parameter --name "/masky/production/firebase_service_account" --with-decryption
```

