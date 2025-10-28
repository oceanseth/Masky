# Twitch Custom OAuth Setup Guide

## Overview

Your application now uses a **custom OAuth flow** for Twitch authentication instead of Firebase's built-in OIDC provider (which doesn't support Twitch). This resolves the `auth/operation-not-allowed` error you were experiencing.

## What Was Implemented

### Backend Changes (api/api.js)
1. ✅ Added `handleTwitchOAuthCallback()` function to exchange authorization codes for access tokens
2. ✅ Added `/api/twitch_oauth_callback` endpoint
3. ✅ Kept legacy `/api/twitch_oauth` endpoint for backward compatibility

### Frontend Changes
1. ✅ Created `src/config.js` for centralized configuration
2. ✅ Updated `src/firebase.js`:
   - Removed Firebase OIDC provider for Twitch
   - Implemented custom OAuth flow with `signInWithTwitch()`
   - Added `handleTwitchCallback()` to process OAuth callbacks
   - Added CSRF protection with state parameter
3. ✅ Updated `src/main.js` to handle OAuth callbacks on page load

## Setup Instructions

### Step 1: Configure Twitch Developer Console

1. Go to https://dev.twitch.tv/console/apps
2. Select your existing app or create a new one
3. Add OAuth Redirect URLs:
   - **Production**: `https://masky.ai/auth/callback`
   - **Local Dev**: `http://localhost:5173/auth/callback`
   - **Any other environments you use**
4. Copy your **Client ID** (you'll need this next)
5. Copy your **Client Secret** (keep this secure!)

### Step 2: Create Environment Variables

Create a `.env` file in your project root:

```bash
# Copy this content to your .env file
VITE_TWITCH_CLIENT_ID=your_client_id_here
```

**Important**: Replace `your_client_id_here` with your actual Twitch Client ID from Step 1.

### Step 3: Update AWS SSM Parameters

Store your Twitch Client Secret in AWS SSM (if not already done):

```bash
# Twitch Client ID (for backend verification)
aws ssm put-parameter \
  --name "/masky/production/twitch_client_id" \
  --value "your_twitch_client_id" \
  --type "SecureString" \
  --region us-east-1

# Twitch Client Secret (for token exchange)
aws ssm put-parameter \
  --name "/masky/production/twitch_client_secret" \
  --value "your_twitch_client_secret" \
  --type "SecureString" \
  --region us-east-1
```

### Step 4: Update src/config.js (Optional)

If you need to change the redirect URI or scopes, edit `src/config.js`:

```javascript
export const config = {
  twitch: {
    clientId: import.meta.env.VITE_TWITCH_CLIENT_ID || 'YOUR_TWITCH_CLIENT_ID',
    redirectUri: window.location.origin + '/auth/callback',
    scopes: ['user:read:email', 'channel:manage:videos', 'user:read:broadcast']
  },
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || window.location.origin
  }
};
```

### Step 5: Deploy Backend

Deploy the updated API to AWS Lambda:

```bash
serverless deploy --stage production
```

This will deploy the new `/api/twitch_oauth_callback` endpoint.

### Step 6: Build and Deploy Frontend

If using Vite:

```bash
npm run build
```

Then sync to S3:

```bash
aws s3 sync dist/ s3://masky.net --region us-east-1

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

## How the OAuth Flow Works

1. **User clicks "Sign in with Twitch"**
   - App redirects to Twitch authorization page
   - CSRF state token is stored in sessionStorage

2. **User authorizes the app on Twitch**
   - Twitch redirects back to `https://masky.ai/auth/callback?code=xxx&state=yyy`

3. **App receives callback**
   - `main.js` detects the `code` and `state` parameters
   - Calls `handleTwitchCallback()`

4. **Backend exchanges code for token**
   - Frontend sends authorization code to `/api/twitch_oauth_callback`
   - Backend exchanges code for access token with Twitch
   - Backend verifies token and gets user info
   - Backend creates Firebase custom token

5. **User is signed in**
   - Frontend receives Firebase custom token
   - Signs in with `signInWithCustomToken()`
   - User is now authenticated!

## Testing the Integration

### Local Testing

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Open browser to `http://localhost:5173`

3. Click "Sign in with Twitch"

4. You should be redirected to Twitch, then back to your app

5. Check browser console for any errors

### Production Testing

1. Visit https://masky.ai
2. Click "Sign in with Twitch"
3. Authorize the app
4. You should be signed in and see the dashboard

## Troubleshooting

### Error: "Invalid redirect URI"
- **Solution**: Make sure the redirect URI in your Twitch app settings exactly matches `https://masky.ai/auth/callback`

### Error: "Invalid state parameter"
- **Solution**: This is CSRF protection. Clear your browser's sessionStorage and try again.

### Error: "Missing authorization code"
- **Solution**: Check if the Twitch redirect is working properly. The URL should contain `?code=...&state=...`

### Error: "Failed to exchange token"
- **Solution**: 
  - Verify Client Secret is correct in AWS SSM
  - Check CloudWatch logs for detailed error messages
  - Ensure the redirect URI sent to backend matches the one in Twitch settings

### Still getting `auth/operation-not-allowed`
- **Solution**: You might be using cached code. Hard refresh your browser (Ctrl+Shift+R) or clear cache.

## Security Features

✅ **CSRF Protection**: Uses state parameter to prevent cross-site request forgery  
✅ **Secure Token Exchange**: Client secret never exposed to frontend  
✅ **Firebase Custom Tokens**: Leverages Firebase's secure authentication  
✅ **HTTPS Only**: All OAuth flows use secure connections  

## Files Modified

- ✅ `api/api.js` - Added OAuth callback handler
- ✅ `src/firebase.js` - Implemented custom OAuth flow
- ✅ `src/main.js` - Added callback handler
- ✅ `src/config.js` - NEW: Configuration file
- ✅ `README.md` - Updated documentation
- ✅ `TWITCH_OAUTH_SETUP.md` - NEW: This guide

## Next Steps

1. Create your `.env` file with `VITE_TWITCH_CLIENT_ID`
2. Update AWS SSM parameters
3. Deploy backend and frontend
4. Test the sign-in flow
5. Monitor CloudWatch logs for any issues

## Need Help?

If you encounter any issues:
1. Check CloudWatch logs: `serverless logs --function api --tail`
2. Check browser console for frontend errors
3. Verify all environment variables are set correctly
4. Ensure Twitch app settings match your configuration

---

**That's it! Your Twitch custom OAuth is now set up.** 🎉

