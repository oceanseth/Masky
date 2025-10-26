@echo off
echo Configuring Firebase Storage CORS for audio file access...

REM Check if gcloud is installed
gcloud version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Google Cloud SDK (gcloud) is not installed or not in PATH
    echo Please install it from: https://cloud.google.com/sdk/docs/install
    echo Then run: gcloud auth login
    pause
    exit /b 1
)

REM Check if user is authenticated
gcloud auth list --filter=status:ACTIVE --format="value(account)" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Not authenticated with Google Cloud
    echo Please run: gcloud auth login
    pause
    exit /b 1
)

REM Set the bucket name
set BUCKET_NAME=maskydotnet.firebasestorage.app

echo Applying CORS configuration to bucket: %BUCKET_NAME%
echo This will allow audio files to be accessed from localhost:3000 and production domains

REM Apply CORS configuration
gsutil cors set iac\cors_config gs://%BUCKET_NAME%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo SUCCESS: CORS configuration applied!
    echo Audio files can now be accessed directly from Firebase Storage
    echo No more Lambda proxy needed - this saves significant costs
    echo.
    echo Benefits:
    echo - Direct client access to Firebase Storage
    echo - No Lambda invocations for audio playback
    echo - Better caching and performance
    echo - Lower costs
) else (
    echo.
    echo ERROR: Failed to apply CORS configuration
    echo Please check:
    echo 1. You have the correct permissions on the bucket
    echo 2. The bucket name is correct
    echo 3. The CORS config file exists at iac\cors_config
)

echo.
pause
