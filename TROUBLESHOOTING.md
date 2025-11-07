# Troubleshooting Guide

Common issues and solutions for local development with serverless-offline.

## Lambda Timeout Issues

### Symptom
API calls to `http://localhost:3001/api/*` hang or timeout after 30+ seconds.

### Root Cause
The Lambda functions are trying to reach real AWS SSM Parameter Store instead of using your `.env.local` file. This happens when `IS_OFFLINE` environment variable is not set.

### Solution ✅

The issue has been fixed! The npm scripts now automatically set `IS_OFFLINE=true`.

**Restart your server:**
```bash
# Stop current server (Ctrl+C)
npm run api:dev
```

### Verify the Fix

When you start the server, you should see logs like this:

```
✅ Loaded local environment variables from .env.local
✅ SSM mocked for local development
🔧 Running in local mode - loading Firebase from environment
🔧 Running in local mode - loading Stripe from environment
🔧 Running in local mode - loading Twitch from environment
🔧 Running in local mode - loading HeyGen from environment
```

If you see these logs, your local environment is working correctly!

### Manual Test

Test an endpoint that doesn't require authentication:

```bash
curl http://localhost:3001/api/heygen/avatars
```

Should respond in < 1 second (not 30+ seconds).

---

## Other Common Issues

### Error: "FIREBASE_SERVICE_ACCOUNT not found in .env.local"

**Cause:** `.env.local` doesn't exist or is empty

**Solution:**
```bash
# Run the SSM loader
.\load-ssm-to-env.ps1

# Or copy manually
Copy-Item env.local.example .env.local
# Then edit .env.local with your credentials
```

### Error: "Port 3001 already in use"

**Cause:** Another process is using port 3001

**Solution - Windows:**
```powershell
taskkill /F /IM node.exe /FI "WINDOWTITLE eq serverless*"
```

**Solution - Mac/Linux:**
```bash
lsof -ti:3001 | xargs kill -9
```

### Error: "Cannot find module 'cross-env'"

**Cause:** Missing dependency

**Solution:**
```bash
npm install --save-dev cross-env
```

### AWS SDK Still Trying to Connect

**Symptoms:**
- Long delays before errors
- "CredentialsError: Missing credentials in config"
- Timeout errors

**Verify IS_OFFLINE is set:**

Add this to the top of `api/api.js` temporarily:

```javascript
console.log('🔍 DEBUG - Environment Check:');
console.log('  IS_OFFLINE:', process.env.IS_OFFLINE);
console.log('  STAGE:', process.env.STAGE);
console.log('  FIREBASE_SERVICE_ACCOUNT exists:', !!process.env.FIREBASE_SERVICE_ACCOUNT);
console.log('  TWITCH_CLIENT_ID:', process.env.TWITCH_CLIENT_ID);
```

Restart the server and check the logs. You should see:
```
🔍 DEBUG - Environment Check:
  IS_OFFLINE: true
  STAGE: local
  FIREBASE_SERVICE_ACCOUNT exists: true
  TWITCH_CLIENT_ID: sgb17aslo6gesnetuqfnf6qql6jrae
```

If `IS_OFFLINE` is `undefined`, the environment variable isn't being set correctly.

### Firebase Initialization Hanging

**Symptoms:**
- First API call takes 30+ seconds
- "Firebase service account not found in SSM" error

**Verify base64 encoding:**

```bash
# Windows PowerShell
$decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FIREBASE_SERVICE_ACCOUNT))
$decoded

# Should show JSON starting with {"type":"service_account"...
```

**Re-encode if needed:**
```bash
.\load-ssm-to-env.ps1
```

### Stripe/Twitch/HeyGen Timeouts

Same root cause as Firebase - verify these environment variables exist:

```bash
# Check .env.local
cat .env.local

# Or on Windows
Get-Content .env.local
```

Should contain:
- `FIREBASE_SERVICE_ACCOUNT=...` (long base64 string)
- `TWITCH_CLIENT_ID=...`
- `TWITCH_CLIENT_SECRET=...`
- `STRIPE_SECRET_KEY=sk_live_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `HEYGEN_API_KEY=sk_...`
- `STAGE=local`

### Changes Not Reflecting

**Solution 1:** Clear serverless cache
```bash
rm -rf .serverless
npm run api:dev
```

**Solution 2:** Hard restart
```bash
# Windows
taskkill /F /IM node.exe
npm run api:dev

# Mac/Linux
killall node
npm run api:dev
```

### CORS Errors

**Symptom:** Browser console shows CORS errors

**Solution:**
The Lambda function handles CORS. Make sure you're calling the API correctly:

```javascript
// Frontend code
const response = await fetch(`${config.api.baseUrl}/api/heygen/avatars`, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${firebaseToken}` // If needed
  }
});
```

The `config.api.baseUrl` should automatically be `http://localhost:3001` when running on localhost.

### Network Errors

**Symptom:** ERR_CONNECTION_REFUSED

**Causes:**
1. API server not running - Start it: `npm run api:dev`
2. Wrong port - Check it's `http://localhost:3001` not `3000` or `5173`
3. Frontend on different port - Frontend should be on `5173`, API on `3001`

### serverless-offline Not Starting

**Error:** "Cannot find module 'serverless-offline'"

**Solution:**
```bash
npm install --save-dev serverless-offline@^13.3.0
```

**Error:** "Serverless plugin 'serverless-offline' not found"

**Solution:** Check `serverless.yml` has:
```yaml
plugins:
  - serverless-offline
```

---

## Debug Mode

For detailed debugging, run with verbose logging:

```bash
# Windows
$env:SLS_DEBUG="*"
npm run api:dev

# Mac/Linux
SLS_DEBUG=* npm run api:dev
```

This shows all serverless-offline internal logs.

---

## Performance Issues

### First Request Slow (10-30 seconds)

**Normal behavior:** First request initializes:
- Firebase Admin SDK
- Stripe client
- AWS SDK
- Other services

Subsequent requests should be fast (< 1 second).

**If all requests are slow:**
- Check `IS_OFFLINE=true` is set
- Verify `.env.local` exists
- Restart the server

### Every Request Slow

**Cause:** Services re-initializing on each request

**Check:** Look for "Initializing..." logs on every request

**Solution:** The initializers should cache instances. Verify:
```javascript
// In utils/firebaseInit.js
if (this.firebaseApp) return this.firebaseApp; // Should hit this on subsequent calls
```

---

## Verification Checklist

Run through this checklist to ensure everything is set up correctly:

- [ ] `.env.local` exists in project root
- [ ] `.env.local` contains all 6 required variables
- [ ] `IS_OFFLINE=true` when running `npm run api:dev` (check logs)
- [ ] Server starts without errors
- [ ] Logs show "🔧 Running in local mode" messages
- [ ] Test endpoint responds in < 5 seconds: `curl http://localhost:3001/api/heygen/avatars`
- [ ] No AWS credential errors in logs

---

## Still Having Issues?

1. **Check the logs** - Most issues show clear error messages
2. **Verify environment variables** - Add debug logs (see above)
3. **Restart everything** - Kill all node processes and restart
4. **Re-fetch credentials** - Run `.\load-ssm-to-env.ps1` again
5. **Check for typos** - Especially in `.env.local`

## Getting Help

When asking for help, include:

1. Output of `npm run api:dev` (first 50 lines)
2. Output of `Get-Content .env.local` (remove sensitive values)
3. Error message from browser/curl
4. Node.js version: `node --version`
5. npm version: `npm --version`

---

**Updated:** After fixing IS_OFFLINE environment variable setup


