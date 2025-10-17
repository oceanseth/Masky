@echo off
echo ================================
echo Deploying to Production
echo ================================
echo.

echo Switching to production branch...
git checkout production
if %errorlevel% neq 0 (
    echo ERROR: Failed to checkout production branch
    pause
    exit /b 1
)
echo.

echo Merging main branch into production...
git merge main
if %errorlevel% neq 0 (
    echo ERROR: Failed to merge main branch
    echo Please resolve conflicts manually
    pause
    exit /b 1
)
echo.

echo Pushing changes to remote...
git push
if %errorlevel% neq 0 (
    echo ERROR: Failed to push changes
    pause
    exit /b 1
)
echo.

echo ================================
echo Successfully deployed to production!
echo GitHub Actions will now deploy the changes.
echo ================================
pause

