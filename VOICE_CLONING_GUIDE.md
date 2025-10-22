# Voice Cloning Quick Start Guide 🎤

## 1. Start the Voice Server

### On macOS/Linux:
```bash
./start-voice-server.sh
```

### On Windows:
```bash
start-voice-server.bat
```

### Manual Installation:
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start server
cd utils
python tortoiseServer.py
```

## 2. Start Your Web Application

```bash
npm run dev
# or
yarn dev
```

## 3. Test Voice Cloning

1. **Open your web application** in the browser
2. **Navigate to the dashboard** (sign in if needed)
3. **Find the "🎤 Create Your AI Voice" section**
4. **Upload 2-5 audio samples** (10-30 seconds each):
   - Use clear, high-quality recordings
   - Speak naturally with different tones
   - Minimize background noise
   - Supported formats: WAV, MP3, M4A

5. **Click "🧬 Clone Voice"** and wait for processing
6. **Test your cloned voice** with the text input
7. **Save your voice** to use throughout the app

**Note:** The server runs on http://127.0.0.1:7860

## 4. Testing Audio Samples

### Good Sample Characteristics:
- **Clear speech** without background noise
- **Natural speaking** pace and tone
- **10-30 seconds** in length
- **High audio quality** (not compressed/low bitrate)
- **Different emotions** across samples

### Sample Text for Testing:
- "Hello everyone, welcome to my stream!"
- "Thanks for watching, don't forget to follow!"
- "Let's play some games together today."

## 5. Troubleshooting

### Server Won't Start:
- Check Python installation: `python3 --version`
- Install missing dependencies: `pip install -r requirements.txt`
- Check for CUDA if using GPU: `python -c "import torch; print(torch.cuda.is_available())"`

### Voice Cloning Fails:
- Ensure audio files are valid formats (WAV, MP3, M4A)
- Check file sizes (under 100MB total)
- Verify audio samples are clear speech
- Try with shorter audio clips (10-15 seconds)

### Speech Generation Slow:
- This is normal for CPU inference (5-15 minutes per sentence)
- For faster generation, use a GPU with 6GB+ VRAM
- Try "fast" quality setting for quicker results

### No Audio Playback:
- Check browser permissions for audio
- Ensure speakers/headphones are connected
- Try a different browser

## 6. Expected Performance

### CPU Mode:
- Voice cloning: 30 seconds - 2 minutes
- Speech generation: 5-15 minutes per sentence

### GPU Mode (6GB+ VRAM):
- Voice cloning: 15-60 seconds
- Speech generation: 30 seconds - 2 minutes per sentence

## 7. Using Your Cloned Voice

Once your voice is cloned and saved:

1. **VOD Narration**: Click 🗣️ on VOD cards
2. **Chat Reading**: Use voice features in chat
3. **Custom Text**: Generate speech from any text
4. **Integration**: Voice features appear throughout the app

## 8. Next Steps

- Experiment with different audio samples for better quality
- Try different quality settings (fast, standard, high_quality)
- Use voice features throughout your streaming workflow
- Create multiple voices for different purposes

---

**Need help?** Check the console logs in both the server terminal and browser developer tools for error messages.