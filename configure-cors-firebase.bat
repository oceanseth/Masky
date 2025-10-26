@echo off
echo Configuring Firebase Storage CORS using Firebase CLI...

REM Check if Firebase CLI is installed
firebase --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Firebase CLI is not installed
    echo Please install it with: npm install -g firebase-tools
    echo Then run: firebase login
    pause
    exit /b 1
)

REM Check if user is authenticated
firebase projects:list >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Not authenticated with Firebase
    echo Please run: firebase login
    pause
    exit /b 1
)

echo.
echo WARNING: Firebase CLI doesn't directly support CORS configuration for Storage.
echo You need to use Google Cloud SDK (gcloud) for this.
echo.
echo Please install Google Cloud SDK:
echo 1. Go to: https://cloud.google.com/sdk/docs/install
echo 2. Download and install GoogleCloudSDKInstaller.exe
echo 3. Run: gcloud auth login
echo 4. Then run: configure-storage-cors.bat
echo.
pause
