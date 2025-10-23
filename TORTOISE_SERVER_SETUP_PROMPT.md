# Tortoise TTS Server Setup Prompt

## Current Issue
Your Tortoise TTS server is running a Gradio interface, but your project expects specific API endpoints that don't exist. The test results show:

- ✅ Server is accessible at `http://127.0.0.1:7860`
- ✅ `/config` endpoint works and shows it's a Gradio app with `api_prefix: "/gradio_api"`
- ❌ All `/api/predict`, `/run/predict`, etc. endpoints return 404
- ❌ Custom voice cloning endpoints are missing

## Recommended Solution: Use Your Custom Flask Server

Instead of using the Gradio interface, replace it with your custom Flask server that has the proper API endpoints your project expects.

### Step 1: Stop the Current Gradio Server
```bash
# Find and stop the current Tortoise TTS process
ps aux | grep tortoise
kill <process_id>
```

### Step 2: Use Your Custom Flask Server
Your project already has a custom Flask server at `utils/tortoiseServer.py` with the correct endpoints:

- `POST /clone_voice_instant` - Clone voice from uploaded audio samples
- `POST /generate_speech` - Generate speech using cloned voice
- `GET /list_voices` - List all available cloned voices
- `POST /delete_voice` - Delete a cloned voice
- `GET /voice_info/<voice_id>` - Get information about a specific voice
- `GET /health` - Health check endpoint

### Step 3: Start Your Custom Server
```bash
cd utils
python tortoiseServer.py
```

### Step 4: Test the Connection
```bash
# Run the updated test script
node test-tortoise.js
```

## Alternative Solution: Configure Gradio for Custom Endpoints

If you prefer to keep using Gradio, you need to modify the Tortoise TTS setup to include custom API endpoints.

### Prompt for Tortoise TTS Configuration:

```
I need to set up Tortoise TTS with custom API endpoints for voice cloning. Please help me configure the server to include these endpoints:

1. **Voice Cloning Endpoint**: `POST /clone_voice_instant`
   - Accept multiple audio files via form data
   - Parameters: user_id, voice_name, voice_sample_1, voice_sample_2, etc.
   - Return: {success: true, voice_id: "voice_name", samples_count: N}

2. **Speech Generation Endpoint**: `POST /generate_speech`
   - Accept JSON with: {text: "string", voice_id: "string", quality: "fast|standard|high_quality"}
   - Return: Audio file (WAV format)

3. **Voice Management Endpoints**:
   - `GET /list_voices` - List all cloned voices
   - `POST /delete_voice` - Delete a voice by ID
   - `GET /voice_info/<voice_id>` - Get voice information

4. **Health Check**: `GET /health`
   - Return server status and Tortoise TTS availability

The server should:
- Run on port 7860
- Enable CORS for frontend requests
- Support file uploads up to 100MB
- Use the existing Tortoise TTS model for voice cloning
- Store voice samples in memory (or persistent storage)
- Return proper JSON responses with error handling

Please provide the complete server setup code or configuration that includes these endpoints while maintaining the Tortoise TTS functionality.
```

## Expected API Structure

Your project expects these specific endpoints:

```javascript
// Voice cloning
POST /clone_voice_instant
Content-Type: multipart/form-data
- user_id: string
- voice_name: string  
- voice_sample_1: file
- voice_sample_2: file (optional)
- voice_sample_3: file (optional)

// Speech generation
POST /generate_speech
Content-Type: application/json
{
  "text": "Hello world",
  "voice_id": "user_voice_123",
  "quality": "fast"
}

// Voice management
GET /list_voices
POST /delete_voice
GET /voice_info/<voice_id>
GET /health
```

## Testing the Setup

After implementing either solution, test with:

```bash
# Test basic connectivity
curl http://127.0.0.1:7860/health

# Test voice cloning (with actual audio file)
curl -X POST http://127.0.0.1:7860/clone_voice_instant \
  -F "user_id=test_user" \
  -F "voice_name=test_voice" \
  -F "voice_sample_1=@audio_sample.wav"

# Test speech generation
curl -X POST http://127.0.0.1:7860/generate_speech \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","voice_id":"test_voice","quality":"fast"}' \
  --output generated_speech.wav
```

## Next Steps

1. **Choose your approach**: Custom Flask server (recommended) or modify Gradio
2. **Implement the solution**
3. **Test the endpoints**
4. **Update your project configuration** if needed
5. **Run the voice cloning feature** in your application

The custom Flask server approach is recommended because:
- ✅ It already has the correct endpoints your project expects
- ✅ It's designed specifically for your use case
- ✅ It includes proper error handling and CORS support
- ✅ It's easier to customize and maintain
