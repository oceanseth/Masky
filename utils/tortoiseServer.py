#!/usr/bin/env python3
"""
Enhanced Tortoise TTS Server for Voice Cloning
Integrates with the real Tortoise TTS implementation for actual voice cloning
"""

import sys
import os
sys.path.insert(0, r'C:\Users\PC\Documents\tortoise-tts')

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import tempfile
import logging
from werkzeug.utils import secure_filename
import json
import wave
import numpy as np
import io
import torch
import torchaudio
from datetime import datetime
import shutil
import librosa
import soundfile as sf

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configure CORS to allow all origins, methods, and headers
CORS(app, 
     origins="*",  # Allow all origins
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],  # Allow all methods
     allow_headers=["Content-Type", "Authorization", "Access-Control-Allow-Credentials"],
     supports_credentials=True)

app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max

# Global variables
user_voices = {}  # Store voice samples per user
server_status = {
    'tortoise_loaded': False,
    'cuda_available': False,
    'mode': 'simulation'
}

# Tortoise TTS components
tts = None
tortoise_voices_dir = None

def check_cuda():
    """Check if CUDA is available"""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False

def initialize_tortoise():
    """Initialize Tortoise TTS if available"""
    global tts, tortoise_voices_dir, server_status
    
    try:
        # Add the tortoise-tts directory to Python path
        tortoise_path = r"C:\Users\PC\Documents\tortoise-tts"
        if tortoise_path not in sys.path:
            sys.path.insert(0, tortoise_path)
        
        from tortoise.api import TextToSpeech
        from tortoise.utils.audio import load_audio, load_voice, load_voices
        
        # Clear CUDA cache before initialization
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        
        # Initialize Tortoise TTS
        tts = TextToSpeech(kv_cache=True, use_deepspeed=False, half=True)
        
        # Set up custom voices directory
        tortoise_voices_dir = os.path.join(tempfile.gettempdir(), "tortoise_custom_voices")
        os.makedirs(tortoise_voices_dir, exist_ok=True)
        
        server_status['tortoise_loaded'] = True
        server_status['mode'] = 'full'
        
        logger.info("✅ Tortoise TTS initialized successfully")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize Tortoise TTS: {e}")
        server_status['mode'] = 'simulation'
        return False

def generate_simple_audio(text, duration=3.0, sample_rate=22050):
    """Generate a simple audio file with a tone for testing purposes"""
    try:
        # Generate a simple sine wave tone
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        # Create a simple melody pattern
        frequency = 440  # A4 note
        audio_data = np.sin(2 * np.pi * frequency * t) * 0.3
        
        # Add some variation to make it more interesting
        for i in range(1, 4):
            harmonic = np.sin(2 * np.pi * frequency * i * t) * (0.1 / i)
            audio_data += harmonic
        
        # Normalize and convert to 16-bit integers
        audio_data = np.clip(audio_data, -1.0, 1.0)
        audio_data = (audio_data * 32767).astype(np.int16)
        
        # Create WAV file in memory
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_data.tobytes())
        
        buffer.seek(0)
        return buffer
    except Exception as e:
        logger.error(f"Error generating audio: {e}")
        return None

def load_audio_file(file_path, target_sample_rate=22050):
    """Load and preprocess audio file for Tortoise TTS using librosa"""
    try:
        # Load audio file with librosa (handles resampling and mono conversion automatically)
        audio, sample_rate = librosa.load(file_path, sr=target_sample_rate, mono=True)
        
        # Convert to torch tensor with proper dimensions for Tortoise TTS
        # Tortoise expects shape [1, samples] (batch_size=1, channels=1)
        waveform = torch.from_numpy(audio).float().unsqueeze(0)
        
        return waveform
    except Exception as e:
        logger.error(f"Error loading audio file {file_path}: {e}")
        return None

def create_voice_directory(voice_name):
    """Create a directory for storing voice samples"""
    voice_dir = os.path.join(tortoise_voices_dir, voice_name)
    os.makedirs(voice_dir, exist_ok=True)
    return voice_dir

def generate_speech_with_tortoise(text, voice_samples, quality="ultra_fast"):
    """Generate speech using Tortoise TTS with custom voice samples"""
    try:
        if not tts:
            raise Exception("Tortoise TTS not initialized")
        
        logger.info(f"Getting conditioning latents from {len(voice_samples)} voice samples")
        # Get conditioning latents from voice samples
        conditioning_latents = tts.get_conditioning_latents(voice_samples)
        logger.info(f"Conditioning latents obtained: {conditioning_latents is not None}")
        
        # Generate speech
        logger.info(f"Starting TTS generation with preset: {quality}")
        audio_generator = tts.tts_with_preset(
            text,
            voice_samples=voice_samples,
            conditioning_latents=conditioning_latents,
            preset=quality,
            k=1
        )
        logger.info(f"Audio generator created: {audio_generator is not None}")
        
        # Collect all audio frames
        audio_frames = []
        frame_count = 0
        for audio_frame in audio_generator:
            if audio_frame is None:
                logger.warning(f"Received None audio frame at position {frame_count}")
                continue
            audio_frames.append(audio_frame.cpu())
            frame_count += 1
            logger.info(f"Collected audio frame {frame_count}")
        
        if not audio_frames:
            raise Exception("No audio generated")
        
        # Concatenate all frames
        full_audio = torch.cat(audio_frames, dim=0)
        
        # Save to temporary file using soundfile instead of torchaudio to avoid TorchCodec
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            # Convert to numpy and save with soundfile
            audio_np = full_audio.unsqueeze(0).numpy()
            sf.write(temp_file.name, audio_np.T, 24000)  # soundfile expects (samples, channels)
            return temp_file.name
            
    except Exception as e:
        logger.error(f"Error generating speech with Tortoise: {e}")
        return None

@app.route('/health', methods=['GET', 'OPTIONS'])
def health_check():
    """Health check endpoint"""
    if request.method == 'OPTIONS':
        return '', 200
    return jsonify({
        'status': 'healthy',
        'tortoise_loaded': server_status['tortoise_loaded'],
        'cuda_available': check_cuda(),
        'mode': server_status['mode'],
        'message': 'Enhanced Tortoise TTS Server is running'
    })

@app.route('/clone_voice_instant', methods=['POST', 'OPTIONS'])
def clone_voice_instant():
    """Clone voice from uploaded audio samples"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        user_id = request.form.get('user_id', 'anonymous')
        voice_name = request.form.get('voice_name', f'voice_{user_id}')
        
        logger.info(f"Processing voice cloning request for user: {user_id}")
        logger.info(f"Received files: {list(request.files.keys())}")
        
        # Get uploaded audio files
        voice_samples = []
        sample_files = []
        
        logger.info(f"Processing {len(request.files)} files from request")
        
        for key in request.files:
            logger.info(f"Processing file key: {key}")
            if key.startswith('voice_sample_'):
                file = request.files[key]
                logger.info(f"File details - filename: {file.filename}, content_type: {file.content_type}")
                if file and file.filename:
                    # Save temporary file
                    filename = secure_filename(file.filename)
                    temp_path = os.path.join(tempfile.gettempdir(), f"{voice_name}_{filename}")
                    file.save(temp_path)
                    sample_files.append(temp_path)
                    
                    # Load and validate audio
                    try:
                        audio_data = load_audio_file(temp_path)
                        if audio_data is not None:
                            voice_samples.append({
                                'filename': filename,
                                'path': temp_path,
                                'size': os.path.getsize(temp_path),
                                'audio_data': audio_data
                            })
                            logger.info(f"Loaded audio sample: {filename}")
                        else:
                            logger.warning(f"Failed to load audio sample with torchaudio: {filename}")
                            # Still add the file even if we can't load it with torchaudio
                            # The server can still use it for basic operations
                            voice_samples.append({
                                'filename': filename,
                                'path': temp_path,
                                'size': os.path.getsize(temp_path),
                                'audio_data': None
                            })
                            logger.info(f"Added audio sample (without torchaudio processing): {filename}")
                    except Exception as e:
                        logger.warning(f"Error loading audio sample {filename}: {e}")
                        # Still add the file even if we can't load it with torchaudio
                        # The server can still use it for basic operations
                        voice_samples.append({
                            'filename': filename,
                            'path': temp_path,
                            'size': os.path.getsize(temp_path),
                            'audio_data': None
                        })
                        logger.info(f"Added audio sample (without torchaudio processing): {filename}")
        
        if len(voice_samples) == 0:
            return jsonify({'success': False, 'error': 'No valid audio samples provided'})
        
        # Store voice samples for this user
        user_voices[voice_name] = {
            'samples': voice_samples,
            'files': sample_files,
            'user_id': user_id,
            'created_at': str(datetime.now()),
            'ready_for_tts': True
        }
        
        # If Tortoise TTS is available, create voice directory and copy samples
        if tts and tortoise_voices_dir:
            voice_dir = create_voice_directory(voice_name)
            for sample in voice_samples:
                dest_path = os.path.join(voice_dir, sample['filename'])
                shutil.copy2(sample['path'], dest_path)
            logger.info(f"Voice samples copied to Tortoise directory: {voice_dir}")
        
        logger.info(f"Voice cloned successfully: {voice_name} with {len(voice_samples)} samples")
        
        return jsonify({
            'success': True,
            'voice_id': voice_name,
            'samples_count': len(voice_samples),
            'message': f'Voice cloned successfully! ({server_status["mode"]} mode)'
        })
        
    except Exception as e:
        logger.error(f"Error in voice cloning: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/generate_speech', methods=['POST', 'OPTIONS'])
def generate_speech():
    """Generate speech using cloned voice"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.json
        text = data.get('text', '').strip()
        voice_id = data.get('voice_id')
        quality = data.get('quality', 'ultra_fast')
        
        if not text:
            return jsonify({'success': False, 'error': 'No text provided'})
        
        if voice_id not in user_voices:
            return jsonify({'success': False, 'error': 'Voice not found'})
        
        logger.info(f"Generating speech for voice: {voice_id}, text length: {len(text)}")
        
        voice_data = user_voices[voice_id]
        
        # Try to use real Tortoise TTS if available
        if tts and voice_data.get('ready_for_tts', False):
            try:
                # Extract audio data from voice samples, filtering out None values
                audio_samples = [sample['audio_data'] for sample in voice_data['samples'] if sample['audio_data'] is not None]
                logger.info(f"Extracted {len(audio_samples)} valid audio samples for TTS")
                
                if not audio_samples:
                    logger.warning("No valid audio samples found, falling back to simulation")
                else:
                    # Generate speech with Tortoise TTS
                    audio_file_path = generate_speech_with_tortoise(text, audio_samples, quality)
                    
                    if audio_file_path:
                        logger.info(f"Speech generated successfully with Tortoise TTS for voice: {voice_id}")
                        return send_file(audio_file_path, mimetype='audio/wav', as_attachment=True, download_name='generated_speech.wav')
                    else:
                        logger.warning("Tortoise TTS generation failed, falling back to simulation")
            except Exception as e:
                logger.warning(f"Tortoise TTS generation failed: {e}, falling back to simulation")
        
        # Fallback to simulation mode
        duration = min(len(text) * 0.1, 10.0)
        audio_buffer = generate_simple_audio(text, duration=duration)
        
        if audio_buffer is None:
            return jsonify({'success': False, 'error': 'Failed to generate audio'})
        
        # Create a temporary audio file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_file.write(audio_buffer.getvalue())
            temp_file_path = temp_file.name
        
        logger.info(f"Speech generated successfully for voice: {voice_id} (simulation)")
        
        # Return the audio file
        return send_file(temp_file_path, mimetype='audio/wav', as_attachment=True, download_name='generated_speech.wav')
            
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/list_voices', methods=['GET'])
def list_voices():
    """List all available cloned voices"""
    voices = []
    for voice_id, voice_data in user_voices.items():
        voices.append({
            'voice_id': voice_id,
            'user_id': voice_data['user_id'],
            'samples_count': len(voice_data['samples']),
            'created': True,
            'created_at': voice_data.get('created_at', 'unknown'),
            'ready_for_tts': voice_data.get('ready_for_tts', False)
        })
    return jsonify({'voices': voices, 'count': len(voices)})

@app.route('/delete_voice', methods=['POST'])
def delete_voice():
    """Delete a cloned voice"""
    try:
        data = request.json
        voice_id = data.get('voice_id')
        
        if voice_id not in user_voices:
            return jsonify({'success': False, 'error': 'Voice not found'})
        
        # Clean up temporary files
        for file_path in user_voices[voice_id]['files']:
            try:
                os.unlink(file_path)
            except:
                pass
        
        # Clean up Tortoise voice directory if it exists
        if tortoise_voices_dir:
            voice_dir = os.path.join(tortoise_voices_dir, voice_id)
            if os.path.exists(voice_dir):
                shutil.rmtree(voice_dir)
        
        del user_voices[voice_id]
        logger.info(f"Voice deleted: {voice_id}")
        
        return jsonify({'success': True, 'message': 'Voice deleted successfully'})
        
    except Exception as e:
        logger.error(f"Error deleting voice: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/voice_info/<voice_id>', methods=['GET'])
def voice_info(voice_id):
    """Get information about a specific voice"""
    if voice_id not in user_voices:
        return jsonify({'success': False, 'error': 'Voice not found'})
    
    voice_data = user_voices[voice_id]
    return jsonify({
        'success': True,
        'voice_id': voice_id,
        'user_id': voice_data['user_id'],
        'samples_count': len(voice_data['samples']),
        'available': True,
        'created_at': voice_data.get('created_at', 'unknown'),
        'ready_for_tts': voice_data.get('ready_for_tts', False)
    })

@app.route('/gradio_api/predict', methods=['POST', 'OPTIONS'])
def gradio_predict():
    """Gradio API predict endpoint for compatibility"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        # Get the request data
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Extract parameters (this mimics the Gradio interface)
        text = data.get('data', [''])[0] if isinstance(data.get('data'), list) else ''
        voice_id = data.get('voice_id', 'default_voice')
        quality = data.get('quality', 'ultra_fast')
        
        logger.info(f"Gradio predict request - Text: {text[:50]}..., Voice: {voice_id}")
        
        # Generate audio using the same logic as generate_speech
        if not text:
            return jsonify({
                'data': ['No text provided'],
                'is_generating': False
            })
        
        # Create a simple voice if it doesn't exist
        if voice_id not in user_voices:
            user_voices[voice_id] = {
                'samples': [{'filename': 'default.wav', 'path': '/tmp/default.wav', 'size': 1000}],
                'files': ['/tmp/default.wav'],
                'user_id': 'default',
                'created_at': 'now',
                'ready_for_tts': False
            }
        
        voice_data = user_voices[voice_id]
        
        # Try to use real Tortoise TTS if available
        logger.info(f"Checking TTS availability - tts: {tts is not None}, ready_for_tts: {voice_data.get('ready_for_tts', False)}")
        if tts and voice_data.get('ready_for_tts', False):
            try:
                # Extract audio data from voice samples
                audio_samples = [sample['audio_data'] for sample in voice_data['samples'] if sample['audio_data'] is not None]
                logger.info(f"Extracted {len(audio_samples)} valid audio samples for TTS")
                
                if not audio_samples:
                    logger.warning("No valid audio samples found, falling back to simulation")
                else:
                    # Generate speech with Tortoise TTS
                    logger.info("Attempting to generate speech with Tortoise TTS...")
                    audio_file_path = generate_speech_with_tortoise(text, audio_samples, quality)
                    
                    if audio_file_path:
                        logger.info("✅ Successfully generated speech with Tortoise TTS!")
                        return jsonify({
                            'data': [audio_file_path],
                            'is_generating': False
                        })
                    else:
                        logger.warning("Tortoise TTS returned None, falling back to simulation")
            except Exception as e:
                logger.error(f"Tortoise TTS generation failed: {e}, falling back to simulation")
                import traceback
                logger.error(f"Full traceback: {traceback.format_exc()}")
        else:
            logger.info(f"Not using Tortoise TTS - tts available: {tts is not None}, ready_for_tts: {voice_data.get('ready_for_tts', False)}")
        
        # Fallback to simulation mode
        duration = min(len(text) * 0.1, 10.0)
        audio_buffer = generate_simple_audio(text, duration=duration)
        
        if audio_buffer is None:
            return jsonify({
                'data': ['Failed to generate audio'],
                'is_generating': False
            })
        
        # Create a temporary audio file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_file.write(audio_buffer.getvalue())
            temp_file_path = temp_file.name
        
        # Return the file path in the expected format
        return jsonify({
            'data': [temp_file_path],
            'is_generating': False
        })
        
    except Exception as e:
        logger.error(f"Error in gradio predict: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_file():
    """File upload endpoint for compatibility"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        # Handle file uploads
        if 'files' in request.files:
            files = request.files.getlist('files')
            uploaded_files = []
            for file in files:
                if file and file.filename:
                    filename = secure_filename(file.filename)
                    temp_path = os.path.join(tempfile.gettempdir(), filename)
                    file.save(temp_path)
                    uploaded_files.append(temp_path)
            return jsonify({'files': uploaded_files})
        return jsonify({'error': 'No files provided'}), 400
    except Exception as e:
        logger.error(f"Error in file upload: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/file', methods=['GET'])
def serve_file():
    """Serve generated audio files"""
    try:
        file_path = request.args.get('file')
        if not file_path:
            return jsonify({'error': 'No file specified'}), 400
        
        # Security check - only serve files from temp directory
        if not file_path.startswith(tempfile.gettempdir()):
            return jsonify({'error': 'Invalid file path'}), 403
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(file_path, mimetype='audio/wav')
    except Exception as e:
        logger.error(f"Error serving file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/file', methods=['POST', 'OPTIONS'])
def file_endpoint():
    """File endpoint for compatibility"""
    if request.method == 'OPTIONS':
        return '', 200
    return jsonify({'message': 'File endpoint (simulation mode)'})

@app.route('/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify server is working"""
    return jsonify({
        'status': 'success',
        'message': 'Enhanced Tortoise TTS Server is working!',
        'tortoise_loaded': server_status['tortoise_loaded'],
        'mode': server_status['mode'],
        'endpoints': [
            'GET /health',
            'POST /clone_voice_instant',
            'POST /generate_speech',
            'GET /list_voices',
            'POST /delete_voice',
            'GET /voice_info/<voice_id>',
            'POST /gradio_api/predict',
            'POST /upload',
            'POST /file',
            'GET /test'
        ]
    })

@app.errorhandler(413)
def too_large(e):
    return jsonify({'success': False, 'error': 'File too large. Maximum size is 100MB'}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'success': False, 'error': 'Internal server error'}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🎤 Enhanced Tortoise TTS Voice Cloning Server")
    print("=" * 60)
    
    # Check dependencies
    try:
        import torch
        print(f"✅ PyTorch {torch.__version__} detected")
        if torch.cuda.is_available():
            print(f"✅ CUDA available: {torch.cuda.get_device_name()}")
            server_status['cuda_available'] = True
        else:
            print("⚠️  CUDA not available, using CPU (slower)")
    except ImportError as e:
        print(f"⚠️  PyTorch not available: {e}")
        print("Running in simulation mode")
    
    # Try to initialize Tortoise TTS
    if initialize_tortoise():
        print("✅ Tortoise TTS initialized successfully")
        print("🎯 Real voice cloning is available!")
    else:
        print("⚠️  Tortoise TTS not available - running in simulation mode")
        print("💡 To enable real voice cloning, ensure Tortoise TTS is properly installed")
    
    print("✅ Enhanced server initialized successfully")
    print("\nServer starting on http://127.0.0.1:7860")
    print("Ready to accept voice cloning requests!")
    print("=" * 60)
    
    # Start Flask server
    app.run(
        host='127.0.0.1', 
        port=7860, 
        debug=False,  # Set to True for development
        threaded=True
    )