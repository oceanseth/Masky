# Local Development Guide

This guide explains how to run and test the Lambda API functions locally on your development machine.

## Overview

We use **serverless-offline** to simulate AWS Lambda and API Gateway locally. This approach:
- ✅ No Docker required
- ✅ Fast iteration cycle
- ✅ Same code runs locally and in production
- ✅ Easy debugging with console.log
- ✅ Automatic reload on code changes

## Prerequisites

1. **Node.js** 20.x or later
2. **npm** installed
3. **Firebase Service Account** credentials
4. **API Keys** for Twitch, Stripe, and HeyGen

## Initial Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Local Environment

You have two options for setting up your local environment:

#### Option A: Auto-Load from AWS SSM (Recommended)

If you have AWS CLI configured with access to your AWS account:

**On Windows (PowerShell):**
```powershell
.\load-ssm-to-env.ps1
```

**On Mac/Linux:**
```bash
chmod +x load-ssm-to-env.sh
./load-ssm-to-env.sh
```

**Load from a different stage:**
```bash
# Windows
.\load-ssm-to-env.ps1 staging

# Mac/Linux
./load-ssm-to-env.sh staging
```

This script will:
- ✅ Fetch all secrets from AWS SSM Parameter Store
- ✅ Automatically base64-encode Firebase service account
- ✅ Create `.env.local` with proper formatting
- ✅ Backup existing `.env.local` if it exists

**Prerequisites for AWS SSM auto-load:**
1. AWS CLI installed: `aws --version`
2. AWS credentials configured: `aws configure`
3. IAM permissions for `ssm:GetParameter` on `/masky/production/*`

Skip to [Running the Local Server](#running-the-local-server) after this!

#### Option B: Manual Setup

If you don't have AWS access or prefer manual setup:

**On Windows (PowerShell):**
```powershell
Copy-Item env.local.example .env.local
```

**On Mac/Linux:**
```bash
cp env.local.example .env.local
```

Then continue to step 3 below.

### 3. Get Your API Credentials (Manual Setup Only)

Edit `.env.local` and fill in the following values:

#### Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Save the JSON file
6. Convert to base64:

**On Windows (PowerShell):**
```powershell
$content = Get-Content -Path "path\to\serviceAccountKey.json" -Raw
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($content))
```

**On Mac/Linux:**
```bash
base64 -i serviceAccountKey.json | tr -d '\n'
```

7. Paste the base64 string into `FIREBASE_SERVICE_ACCOUNT` in `.env.local`

#### Twitch Credentials

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Click **Register Your Application**
3. Set OAuth Redirect URL to `http://localhost:3001/api/twitch_oauth` (for local testing)
4. Copy **Client ID** → `TWITCH_CLIENT_ID`
5. Copy **Client Secret** → `TWITCH_CLIENT_SECRET`

#### Stripe Credentials

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
2. Copy **Secret key** → `STRIPE_SECRET_KEY`
3. Go to **Developers** → **Webhooks**
4. Use test webhook secret → `STRIPE_WEBHOOK_SECRET`

#### HeyGen API Key

1. Go to HeyGen Dashboard
2. Copy your API key → `HEYGEN_API_KEY`

## Running the Local Server

### Option 1: API Server Only

Start just the Lambda API server on port 3001:

```bash
npm run api:dev
```

The API will be available at: `http://localhost:3001/api/*`

### Option 2: Frontend + API Together

Run both frontend (Vite) and backend (Lambda) in separate terminals:

**Terminal 1 - Frontend:**
```bash
npm run dev
```

**Terminal 2 - API:**
```bash
npm run api:dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/*`

### Option 3: Both with One Command (Recommended)

If you install `concurrently` first:

```bash
npm install --save-dev concurrently
```

Then run both together:

```bash
npm run dev:full
```

## How It Works

### Dynamic API URL Detection

The frontend (`src/config.js`) automatically detects the environment:

```javascript
api: {
  get baseUrl() {
    const hostname = window.location.hostname;
    
    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    
    // Production
    return 'https://masky.ai';
  }
}
```

When you access `http://localhost:5173`, it will automatically use `http://localhost:3001` for API calls.

### Environment Variable Loading

The utility files automatically detect local mode:

```javascript
// utils/firebaseInit.js, stripeInit.js, twitchInit.js, heygen.js
if (process.env.IS_OFFLINE === 'true') {
  const { loadLocalEnv, mockSSMForLocal } = require('../local-env-loader');
  loadLocalEnv();
  mockSSMForLocal();
}
```

This loads your `.env.local` file and mocks AWS SSM Parameter Store.

## Available API Endpoints

Once running, you can test these endpoints at `http://localhost:3001/api/*`:

### Twitch
- `POST /api/twitch_oauth` - OAuth authentication
- `POST /api/twitch-eventsub` - Create EventSub subscription
- `POST /api/twitch-webhook` - Webhook handler
- `POST /api/twitch-chatbot-ensure` - Setup chatbot

### HeyGen
- `GET /api/heygen/avatars` - List avatars
- `GET /api/heygen/voices` - List voices
- `POST /api/heygen/generate` - Generate video
- `GET /api/heygen/video_status.get?video_id=XXX` - Check video status
- `POST /api/heygen/avatar-group/init` - Initialize avatar group
- `POST /api/heygen/avatar-group/add-look` - Add look to group

### Stripe Subscriptions
- `GET /api/subscription/status` - Get subscription status
- `POST /api/subscription/create-checkout` - Create checkout session
- `POST /api/subscription/cancel` - Cancel subscription
- `POST /api/subscription/portal` - Customer portal

### File Uploads
- `POST /api/upload-voice` - Upload voice file
- `POST /api/upload-avatar` - Upload avatar image

## Testing API Endpoints

### Using cURL

```bash
# Test API is running
curl http://localhost:3001/api/heygen/avatars

# Test with authorization
curl -X POST http://localhost:3001/api/subscription/status \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

### Using the Browser

Just navigate to `http://localhost:5173` and use the app normally. All API calls will automatically go to your local server.

## Restarting After Code Changes

### serverless-offline Auto-Reload

serverless-offline automatically watches for changes in your Lambda function files. When you edit:
- `api/api.js`
- `utils/*.js`
- Any imported files

The server will automatically reload the function.

### Manual Restart (if needed)

**On Windows:**
```bash
npm run api:restart
```

**On Mac/Linux:**
Stop the server (`Ctrl+C`) and restart:
```bash
npm run api:dev
```

### Frontend Changes

Vite has Hot Module Replacement (HMR). Just save your files and the browser will update automatically.

## Debugging

### Console Logs

All `console.log()` statements in your Lambda functions will appear in the terminal where you ran `npm run api:dev`.

```javascript
// api/api.js
console.log('Request received:', event.path);
```

### Request/Response Inspection

serverless-offline logs all requests:

```
[HTTP] POST /api/heygen/generate
[INFO] Invoke handler: api/api.handler
[DEBUG] Request body: {...}
[DEBUG] Response: 200 {...}
```

### Using VS Code Debugger

1. Add this to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Serverless Offline",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/serverless/bin/serverless.js",
      "args": ["offline", "start", "--stage", "local"],
      "env": {
        "IS_OFFLINE": "true",
        "STAGE": "local"
      }
    }
  ]
}
```

2. Set breakpoints in `api/api.js`
3. Press `F5` to start debugging

## Common Issues

### Error: "Firebase service account not found"

Make sure:
1. `.env.local` exists
2. `FIREBASE_SERVICE_ACCOUNT` is set with base64-encoded JSON
3. The base64 string has no line breaks

### Error: "Port 3001 already in use"

Kill the existing process:

**Windows:**
```powershell
taskkill /F /IM node.exe /FI "WINDOWTITLE eq serverless*"
```

**Mac/Linux:**
```bash
lsof -ti:3001 | xargs kill -9
```

Or change the port in `serverless.yml`:
```yaml
custom:
  serverless-offline:
    httpPort: 3002  # Change to any available port
```

### CORS Errors in Browser

serverless-offline handles CORS automatically, but if you see issues:

1. Make sure `cors: true` is in `serverless.yml`:
```yaml
custom:
  serverless-offline:
    cors: true
```

2. The Lambda function handles CORS headers (already implemented in `api/api.js`)

### Changes Not Reflecting

1. Check if the file is being watched by serverless-offline
2. Try manual restart: `npm run api:restart`
3. Clear browser cache or use incognito mode
4. Check for syntax errors in terminal

## Project Structure

```
minime/
├── api/
│   ├── api.js              # Main Lambda handler
│   └── multipartParser.js  # File upload parser
├── utils/
│   ├── firebaseInit.js     # Firebase initialization
│   ├── stripeInit.js       # Stripe initialization
│   ├── twitchInit.js       # Twitch OAuth & EventSub
│   └── heygen.js           # HeyGen API client
├── src/
│   ├── config.js           # Frontend config (with dynamic API URL)
│   └── ...                 # Frontend source files
├── local-env-loader.js     # Local environment loader
├── .env.local              # Your local credentials (gitignored)
├── env.local.example       # Template for .env.local
└── serverless.yml          # Serverless Framework config
```

## Best Practices

### 1. Keep .env.local Private

**NEVER commit `.env.local`** to git. It's already in `.gitignore`.

### 2. Use Production-like Data

Test with realistic data to catch issues early. Use Stripe test mode, Twitch sandbox, etc.

### 3. Test All Endpoints

Before deploying to production, test critical paths locally:
- User authentication
- Subscription flow
- Video generation
- File uploads

### 4. Monitor Console Output

Watch the terminal for errors, warnings, and debug logs. This is your primary debugging tool.

### 5. Hot Reload for Speed

Take advantage of auto-reload. You don't need to restart the server for most changes.

## Deployment vs Local Development

| Feature | Local (serverless-offline) | Production (AWS Lambda) |
|---------|---------------------------|-------------------------|
| Environment | `IS_OFFLINE=true`, `STAGE=local` | `STAGE=production` |
| Secrets | `.env.local` file | AWS SSM Parameter Store |
| API URL | `http://localhost:3001` | `https://masky.ai` |
| Logs | Terminal console | CloudWatch Logs |
| Restart | Automatic / `npm run api:restart` | Deploy with `serverless deploy` |

## Next Steps

1. **Set up `.env.local`** with your credentials
2. **Start the server**: `npm run api:dev`
3. **Test an endpoint**: Visit `http://localhost:3001/api/heygen/avatars`
4. **Run the frontend**: `npm run dev` in another terminal
5. **Make changes** and watch them reload automatically

## Need Help?

- Check the [Serverless Offline docs](https://github.com/dherault/serverless-offline)
- Review AWS Lambda documentation
- Look at the console logs - they're very informative!

Happy coding! 🚀

