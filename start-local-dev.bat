@echo off
echo ========================================
echo   Masky Local Development Server
echo ========================================
echo.

REM Check if .env.local exists
if not exist .env.local (
    echo ERROR: .env.local not found!
    echo.
    echo Please create .env.local from env.local.example:
    echo   1. Copy env.local.example to .env.local
    echo   2. Fill in your API credentials
    echo.
    echo See LOCAL_DEVELOPMENT.md for detailed instructions.
    pause
    exit /b 1
)

echo Starting serverless-offline on port 3001...
echo API will be available at: http://localhost:3001/api/*
echo.
echo Setting environment: IS_OFFLINE=true, STAGE=local
echo Press Ctrl+C to stop the server
echo.

npm run api:dev

