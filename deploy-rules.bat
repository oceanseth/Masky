@echo off
echo 🔥 Deploying Firebase Security Rules...

REM Check if Firebase CLI is installed
firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Firebase CLI is not installed. Please install it first:
    echo npm install -g firebase-tools
    pause
    exit /b 1
)

REM Check if user is logged in
firebase projects:list >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Not logged in to Firebase. Please login first:
    echo firebase login
    pause
    exit /b 1
)

REM Deploy Firestore rules
echo 📝 Deploying Firestore rules...
firebase deploy --only firestore:rules
if %errorlevel% neq 0 (
    echo ❌ Failed to deploy Firestore rules
    pause
    exit /b 1
)
echo ✅ Firestore rules deployed successfully!

REM Deploy Storage rules
echo 📁 Deploying Storage rules...
firebase deploy --only storage
if %errorlevel% neq 0 (
    echo ❌ Failed to deploy Storage rules
    pause
    exit /b 1
)
echo ✅ Storage rules deployed successfully!

echo 🎉 All security rules deployed successfully!
echo.
echo 📋 Security Rules Summary:
echo   • Users can only access their own user documents
echo   • Users can only access projects they own
echo   • Users can only access alerts for their own projects
echo   • Users can only upload/access their own voice and avatar files
echo   • All other access is denied
pause
