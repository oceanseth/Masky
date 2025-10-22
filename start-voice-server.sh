#!/bin/bash

# Voice Cloning Server Startup Script
echo "🎤 Starting Tortoise TTS Voice Cloning Server..."
echo "================================================"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip."
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Install dependencies if not already installed
if [ ! -f "venv/installed.flag" ]; then
    echo "📥 Installing Python dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt
    touch venv/installed.flag
    echo "✅ Dependencies installed successfully"
else
    echo "✅ Dependencies already installed"
fi

# Start the server
echo "🚀 Starting Tortoise TTS server..."
echo "Server will be available at: http://127.0.0.1:7860"
echo "Press Ctrl+C to stop the server"
echo "================================================"

cd utils
python tortoiseServer.py