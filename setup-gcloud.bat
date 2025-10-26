@echo off
echo Setting up Google Cloud SDK for Firebase Storage CORS configuration...
echo.

echo Step 1: Download Google Cloud SDK
echo Please download the installer from:
echo https://cloud.google.com/sdk/docs/install
echo.
echo For Windows, download: GoogleCloudSDKInstaller.exe
echo.

set /p continue="Have you downloaded the installer? (y/n): "
if /i "%continue%" neq "y" (
    echo Please download the installer first, then run this script again.
    pause
    exit /b 1
)

echo.
echo Step 2: Install Google Cloud SDK
echo Please run the installer you downloaded and follow the setup wizard.
echo Make sure to check "Add gcloud to PATH" during installation.
echo.

set /p continue="Have you installed Google Cloud SDK? (y/n): "
if /i "%continue%" neq "y" (
    echo Please install Google Cloud SDK first, then run this script again.
    pause
    exit /b 1
)

echo.
echo Step 3: Authenticate with Google Cloud
echo This will open a browser window for authentication.
echo.
pause

gcloud auth login

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Authentication failed
    echo Please try running: gcloud auth login
    pause
    exit /b 1
)

echo.
echo Step 4: Set your Firebase project
echo Please enter your Firebase project ID (usually found in firebase.json or .firebaserc):
echo.

set /p project_id="Enter your Firebase project ID: "
if "%project_id%"=="" (
    echo ERROR: Project ID cannot be empty
    pause
    exit /b 1
)

gcloud config set project %project_id%

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to set project
    echo Please check your project ID and try again
    pause
    exit /b 1
)

echo.
echo SUCCESS: Google Cloud SDK is now set up!
echo.
echo You can now run: configure-storage-cors.bat
echo.
pause
