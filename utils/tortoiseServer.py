#!/usr/bin/env python3
"""
Tortoise TTS Server for Voice Cloning
Provides REST API for instant voice cloning and speech generation
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import tempfile
import os
import sys
import logging
from werkzeug.utils import secure_filename

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max

# Global variables
tts = None
user_voices = {}  # Store voice samples per user

def initialize_tortoise():
    """Initialize Tortoise TTS model"""
    global tts
    try:
        logger.info("Initializing Tortoise TTS...")
        from tortoise.api import TextToSpeech
        
        # Initialize with optimizations for speed
        tts = TextToSpeech(
            use_deepspeed=True,
            half=True,  # Use half precision for faster inference
            device='cuda' if check_cuda() else 'cpu'
        )
        logger.info("Tortoise TTS initialized successfully")
        return True
    except ImportError as e:
        logger.error(f"Failed to import Tortoise TTS: {e}")
        logger.error("Please install tortoise-tts: pip install tortoise-tts")
        return False
    except Exception as e:
        logger.error(f"Failed to initialize Tortoise TTS: {e}")
        return False

def check_cuda():
    """Check if CUDA is available"""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False

def load_audio_sample(file_path):
    """Load audio file for Tortoise processing"""
    try:
        from tortoise.utils.audio import load_audio
        return load_audio(file_path, 22050)
    except Exception as e:
        logger.error(f"Error loading audio {file_path}: {e}")
        return None

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'tortoise_loaded': tts is not None,
        'cuda_available': check_cuda()
    })

@app.route('/clone_voice_instant', methods=['POST'])
def clone_voice_instant():
    """Clone voice from uploaded audio samples"""
    try:
        if tts is None:
            return jsonify({'success': False, 'error': 'Tortoise TTS not initialized'})

        user_id = request.form.get('user_id', 'anonymous')
        voice_name = request.form.get('voice_name', f'voice_{user_id}')
        
        logger.info(f"Processing voice cloning request for user: {user_id}")
        
        # Get uploaded audio files
        voice_samples = []
        sample_files = []
        
        for key in request.files:
            if key.startswith('voice_sample_'):
                file = request.files[key]
                if file and file.filename:
                    # Save temporary file
                    filename = secure_filename(file.filename)
                    temp_path = os.path.join(tempfile.gettempdir(), f"{voice_name}_{filename}")
                    file.save(temp_path)
                    sample_files.append(temp_path)
                    
                    # Load audio for Tortoise
                    audio = load_audio_sample(temp_path)
                    if audio is not None:
                        voice_samples.append(audio)
                        logger.info(f"Loaded audio sample: {filename}")
                    else:
                        logger.warning(f"Failed to load audio sample: {filename}")
        
        if len(voice_samples) == 0:
            return jsonify({'success': False, 'error': 'No valid audio samples provided'})
        
        # Store voice samples for this user
        user_voices[voice_name] = {
            'samples': voice_samples,
            'files': sample_files,
            'user_id': user_id
        }
        
        logger.info(f"Voice cloned successfully: {voice_name} with {len(voice_samples)} samples")
        
        return jsonify({
            'success': True,
            'voice_id': voice_name,
            'samples_count': len(voice_samples),
            'message': 'Voice cloned successfully!'
        })
        
    except Exception as e:
        logger.error(f"Error in voice cloning: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/generate_speech', methods=['POST'])
def generate_speech():
    """Generate speech using cloned voice"""
    try:
        if tts is None:
            return jsonify({'success': False, 'error': 'Tortoise TTS not initialized'})

        data = request.json
        text = data.get('text', '').strip()
        voice_id = data.get('voice_id')
        quality = data.get('quality', 'standard')
        
        if not text:
            return jsonify({'success': False, 'error': 'No text provided'})
        
        if voice_id not in user_voices:
            return jsonify({'success': False, 'error': 'Voice not found'})
        
        logger.info(f"Generating speech for voice: {voice_id}, text length: {len(text)}")
        
        # Get voice samples
        voice_samples = user_voices[voice_id]['samples']
        
        # Map quality settings to Tortoise presets
        preset_map = {
            'fast': 'fast',
            'standard': 'standard', 
            'high_quality': 'high_quality',
            'ultra_fast': 'ultra_fast'
        }
        
        preset = preset_map.get(quality, 'standard')
        
        # Generate speech with Tortoise
        gen = tts.tts_with_preset(
            text, 
            voice_samples=voice_samples,
            preset=preset
        )
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            import torchaudio
            torchaudio.save(f.name, gen.squeeze(0).cpu(), 22050)
            
            logger.info(f"Speech generated successfully for voice: {voice_id}")
            return send_file(f.name, mimetype='audio/wav', as_attachment=False)
            
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
            'created': True
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
        'available': True
    })

@app.errorhandler(413)
def too_large(e):
    return jsonify({'success': False, 'error': 'File too large. Maximum size is 100MB'}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'success': False, 'error': 'Internal server error'}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🎤 Tortoise TTS Voice Cloning Server")
    print("=" * 60)
    
    # Check dependencies
    try:
        import torch
        import torchaudio
        print(f"✅ PyTorch {torch.__version__} detected")
        print(f"✅ TorchAudio {torchaudio.__version__} detected")
        if torch.cuda.is_available():
            print(f"✅ CUDA available: {torch.cuda.get_device_name()}")
        else:
            print("⚠️  CUDA not available, using CPU (slower)")
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please install required packages:")
        print("pip install torch torchaudio tortoise-tts")
        sys.exit(1)
    
    # Initialize Tortoise
    if not initialize_tortoise():
        print("❌ Failed to initialize Tortoise TTS")
        print("\nTroubleshooting:")
        print("1. Install tortoise-tts: pip install tortoise-tts")
        print("2. Make sure you have enough GPU memory (6GB+ recommended)")
        print("3. Try running with CPU if GPU fails")
        sys.exit(1)
    
    print("✅ Tortoise TTS initialized successfully")
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