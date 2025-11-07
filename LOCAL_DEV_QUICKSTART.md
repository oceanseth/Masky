# Local Development - Quick Start

## Setup (First Time Only)

### Option A: Auto-Load from AWS SSM (Recommended)

If you have AWS CLI configured with access to SSM parameters:

**Windows PowerShell:**
```powershell
.\load-ssm-to-env.ps1
```

**Mac/Linux:**
```bash
chmod +x load-ssm-to-env.sh
./load-ssm-to-env.sh
```

This automatically fetches all credentials from AWS and creates `.env.local`!

### Option B: Manual Setup

1. **Copy environment template:**
   ```bash
   # Windows PowerShell
   Copy-Item env.local.example .env.local
   
   # Mac/Linux
   cp env.local.example .env.local
   ```

2. **Edit `.env.local`** and add your credentials (see LOCAL_DEVELOPMENT.md for details)

3. **Install dependencies:**
   ```bash
   npm install
   ```

## Daily Usage

### Start API Server

**Option 1 - Windows:**
```bash
.\start-local-dev.bat
```

**Option 2 - Mac/Linux:**
```bash
chmod +x start-local-dev.sh
./start-local-dev.sh
```

**Option 3 - NPM Script:**
```bash
npm run api:dev
```

### Start Frontend (Separate Terminal)

```bash
npm run dev
```

### Start Both Together

```bash
npm run dev:full  # (requires: npm install --save-dev concurrently)
```

## Endpoints

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/*`

The frontend automatically detects localhost and uses the local API!

## Common Commands

```bash
# Start API server
npm run api:dev

# Start frontend
npm run dev

# Restart API (Windows)
npm run api:restart

# Build for production
npm run build

# Deploy to AWS
serverless deploy
```

## Troubleshooting

### "Firebase service account not found"
- Check `.env.local` exists
- Verify `FIREBASE_SERVICE_ACCOUNT` is base64-encoded

### "Port 3001 already in use"
```bash
# Windows
taskkill /F /IM node.exe /FI "WINDOWTITLE eq serverless*"

# Mac/Linux
lsof -ti:3001 | xargs kill -9
```

### Changes not reflecting
- serverless-offline auto-reloads most changes
- If stuck, press `Ctrl+C` and restart: `npm run api:dev`

## Key Files

- `serverless.yml` - Lambda & API Gateway config
- `api/api.js` - Main API handler
- `src/config.js` - Frontend config (dynamic API URL)
- `.env.local` - Your local credentials (gitignored)
- `local-env-loader.js` - Loads .env.local for Lambda

## Production vs Local

| | Local | Production |
|---|---|---|
| API URL | `http://localhost:3001` | `https://masky.ai` |
| Secrets | `.env.local` | AWS SSM |
| Deploy | Just save & auto-reload | `serverless deploy` |

See **LOCAL_DEVELOPMENT.md** for complete documentation.

