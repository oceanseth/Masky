# Tortoise TTS Voice Cloning Server

This Python server provides voice cloning capabilities using Tortoise TTS.

## Installation

### 1. Install Python Dependencies

```bash
# Install PyTorch (choose based on your system)
# For CUDA (recommended for speed):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# For CPU only:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install Tortoise TTS
pip install tortoise-tts

# Install Flask for the web server
pip install flask flask-cors
```

### 2. Alternative Installation with Conda

```bash
# Create conda environment
conda create -n tortoise-tts python=3.9
conda activate tortoise-tts

# Install dependencies
conda install pytorch torchaudio pytorch-cuda=11.8 -c pytorch -c nvidia
pip install tortoise-tts flask flask-cors
```

## Running the Server

### Start the server:
```bash
cd utils
python tortoiseServer.py
```

### Expected output:
```
============================================================
🎤 Tortoise TTS Voice Cloning Server
============================================================
✅ PyTorch 2.0.1 detected
✅ TorchAudio 2.0.1 detected
✅ CUDA available: NVIDIA GeForce RTX 3080
✅ Tortoise TTS initialized successfully

Server starting on http://localhost:8080
Ready to accept voice cloning requests!
============================================================
```

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:7860/health
```

### Clone Voice
```bash
curl -X POST \
  -F "voice_sample_0=@voice1.wav" \
  -F "voice_sample_1=@voice2.wav" \
  -F "user_id=user123" \
  -F "voice_name=my_voice" \
  http://127.0.0.1:7860/clone_voice_instant
```

### Generate Speech
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice_id": "my_voice", "quality": "standard"}' \
  http://127.0.0.1:7860/generate_speech
```

## Hardware Requirements

### Minimum (CPU):
- 8GB RAM
- Generation time: 5-15 minutes per sentence

### Recommended (GPU):
- NVIDIA GPU with 6GB+ VRAM
- 16GB+ system RAM
- Generation time: 30 seconds - 2 minutes per sentence

### Optimal (High-end GPU):
- NVIDIA RTX 3080/4080 or better
- 32GB+ system RAM
- Generation time: 10-30 seconds per sentence

## Troubleshooting

### CUDA Issues
```bash
# Check CUDA installation
python -c "import torch; print(torch.cuda.is_available())"

# If CUDA not working, install CPU version
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

### Memory Issues
```bash
# Reduce memory usage by disabling DeepSpeed
# Edit tortoiseServer.py and change:
# use_deepspeed=False
```

### Audio Format Issues
- Supported formats: WAV, MP3, M4A
- Recommended: WAV files, 22kHz, mono
- Duration: 10-30 seconds per sample

## Quality Settings

- `ultra_fast`: Fastest, lower quality (~10 seconds)
- `fast`: Good balance (~30 seconds)
- `standard`: Better quality (~1-2 minutes)
- `high_quality`: Best quality (~5-10 minutes)

## Tips for Best Results

1. **Audio Quality**: Use clear, high-quality recordings
2. **Multiple Samples**: Upload 2-5 different voice samples
3. **Variety**: Include different emotions and speaking styles
4. **Length**: 10-30 seconds per sample is optimal
5. **Background Noise**: Minimize or remove background noise