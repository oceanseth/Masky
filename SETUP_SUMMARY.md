# 🎉 Local Development Setup - Complete!

Your project is now fully configured for local Lambda testing with AWS SSM integration.

## 📦 What Was Added

### New Files

| File | Description |
|------|-------------|
| **`load-ssm-to-env.ps1`** | Windows PowerShell script to fetch SSM parameters |
| **`load-ssm-to-env.sh`** | Mac/Linux bash script to fetch SSM parameters |
| **`AWS_SSM_SETUP.md`** | Complete guide for AWS SSM integration |
| **`LOCAL_DEVELOPMENT.md`** | Full local development guide |
| **`LOCAL_DEV_QUICKSTART.md`** | Quick reference card |
| **`local-env-loader.js`** | Node.js module to load `.env.local` |
| **`env.local.example`** | Template for manual credential setup |
| **`start-local-dev.bat`** | Windows startup script |
| **`start-local-dev.sh`** | Mac/Linux startup script |

### Modified Files

- **`serverless.yml`** - Added `serverless-offline` plugin
- **`package.json`** - Added npm scripts for local dev
- **`src/config.js`** - Dynamic API URL detection
- **`utils/firebaseInit.js`** - Local environment support
- **`utils/stripeInit.js`** - Local environment support
- **`utils/twitchInit.js`** - Local environment support
- **`utils/heygen.js`** - Local environment support
- **`.gitignore`** - Added `.env.local.backup.*`

## 🚀 Quick Start

### Option 1: Auto-Load from AWS SSM (Recommended)

```powershell
# Windows PowerShell
.\load-ssm-to-env.ps1
npm run api:dev
```

```bash
# Mac/Linux
./load-ssm-to-env.sh
npm run api:dev
```

### Option 2: Manual Setup

```powershell
# Windows
Copy-Item env.local.example .env.local
# Edit .env.local with your credentials
npm run api:dev
```

## 🔧 Available Commands

```bash
# Start API server only
npm run api:dev

# Start frontend only
npm run dev

# Restart API server (Windows)
npm run api:restart

# Build for production
npm run build

# Deploy to AWS
serverless deploy
```

## 🌐 URLs

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3001/api/*

The frontend automatically detects localhost and uses the local API!

## 📚 Documentation

Read these in order:

1. **`LOCAL_DEV_QUICKSTART.md`** - Quick reference (start here!)
2. **`AWS_SSM_SETUP.md`** - AWS SSM integration guide
3. **`LOCAL_DEVELOPMENT.md`** - Complete development guide

## ✅ Features

- ✅ **No Docker required** - Runs on Node.js directly
- ✅ **Auto-reload** - Changes reload automatically
- ✅ **AWS SSM integration** - One command to load all secrets
- ✅ **Dynamic API URLs** - Automatically uses localhost in development
- ✅ **Same code** - Identical code runs locally and in production
- ✅ **Easy debugging** - Console logs, VS Code debugger support
- ✅ **Backup protection** - Existing `.env.local` backed up before overwrite

## 🔐 Security

- ✅ `.env.local` is gitignored (never committed)
- ✅ Backup files are gitignored (`.env.local.backup.*`)
- ✅ AWS SSM uses encrypted parameters (SecureString)
- ✅ IAM permissions can be scoped to specific parameters

## 📝 Example Workflow

```bash
# Day 1: Initial setup
.\load-ssm-to-env.ps1              # Load credentials from AWS
npm run api:dev                     # Start API server
# In another terminal:
npm run dev                         # Start frontend

# Day 2+: Just start the servers
npm run api:dev
npm run dev

# When credentials change in AWS:
.\load-ssm-to-env.ps1              # Refresh local credentials
# API server auto-reloads
```

## 🧪 Testing

```bash
# Test API is running
curl http://localhost:3001/api/heygen/avatars

# Test with authorization
curl -X GET http://localhost:3001/api/subscription/status \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"

# Or just use the frontend
# Open http://localhost:5173 and use the app normally
```

## 🐛 Troubleshooting

### AWS SSM Issues

**"Not authenticated with AWS"**
```bash
aws configure
# Enter your AWS credentials
```

**"Could not fetch any parameters"**
- Check parameter names: `/masky/production/*`
- Verify IAM permissions for `ssm:GetParameter`
- Confirm region is `us-east-1`

### Local Server Issues

**"Port 3001 already in use"**
```powershell
# Windows
taskkill /F /IM node.exe /FI "WINDOWTITLE eq serverless*"

# Mac/Linux
lsof -ti:3001 | xargs kill -9
```

**"Firebase service account not found"**
- Ensure `.env.local` exists
- Verify `FIREBASE_SERVICE_ACCOUNT` is base64-encoded
- Re-run: `.\load-ssm-to-env.ps1`

### Code Changes Not Reflecting

- serverless-offline auto-reloads most changes
- If stuck, restart: `Ctrl+C` then `npm run api:dev`
- Frontend has HMR (just save the file)

## 📊 Architecture

```
Frontend (http://localhost:5173)
    ↓
    ↓ (API calls automatically routed to localhost)
    ↓
API Server (http://localhost:3001)
    ↓
    ↓ (loads from .env.local)
    ↓
Local Environment Variables
    ↓
    ↓ (same handlers as production)
    ↓
AWS Services (Firebase, Stripe, HeyGen, etc.)
```

## 🔄 Development Workflow

1. **Code Changes**
   - Edit files in `api/`, `utils/`, `src/`
   - Server auto-reloads
   - Frontend HMR updates browser

2. **Test Locally**
   - Use the frontend at http://localhost:5173
   - Check terminal logs for debugging
   - API responds at http://localhost:3001/api/*

3. **Deploy to Production**
   ```bash
   npm run build
   serverless deploy
   ```

## 🎯 Best Practices

1. **Always test locally first** before deploying to production
2. **Never commit `.env.local`** - it's gitignored for security
3. **Use AWS SSM for team collaboration** - everyone can fetch the same credentials
4. **Watch the console logs** - they're your primary debugging tool
5. **Refresh credentials regularly** - re-run `load-ssm-to-env` when they change

## 🆘 Need Help?

1. Check **`LOCAL_DEV_QUICKSTART.md`** for common tasks
2. Read **`AWS_SSM_SETUP.md`** for AWS SSM issues
3. Review **`LOCAL_DEVELOPMENT.md`** for detailed explanations
4. Check console logs - they're very informative!

## 🎊 Next Steps

1. ✅ Run `.\load-ssm-to-env.ps1` to load credentials
2. ✅ Start API: `npm run api:dev`
3. ✅ Start frontend: `npm run dev` (in another terminal)
4. ✅ Open http://localhost:5173
5. ✅ Make changes and watch them reload!

---

**Happy coding! 🚀**

Your local development environment is production-ready, with automatic AWS SSM integration and hot reload capabilities.


