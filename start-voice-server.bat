@echo off
echo 🎤 Starting Tortoise TTS Voice Cloning Server...
echo ================================================

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python is not installed. Please install Python 3.8 or higher.
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv" (
    echo 📦 Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo 🔄 Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies if not already installed
if not exist "venv\installed.flag" (
    echo 📥 Installing Python dependencies...
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    echo. > venv\installed.flag
    echo ✅ Dependencies installed successfully
) else (
    echo ✅ Dependencies already installed
)

REM Start the server
echo 🚀 Starting Tortoise TTS server...
echo Server will be available at: http://127.0.0.1:7860
echo Press Ctrl+C to stop the server
echo ================================================

cd utils
python tortoiseServer.py

pause