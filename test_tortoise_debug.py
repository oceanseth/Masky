#!/usr/bin/env python3
"""
Debug script for Tortoise TTS voice cloning issues
"""

import sys
import os
import tempfile
import torch
import librosa
import soundfile as sf
import logging

# Add tortoise-tts to path
sys.path.insert(0, r'C:\Users\PC\Documents\tortoise-tts')

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def load_audio_file(file_path, target_sample_rate=22050):
    """Load and preprocess audio file for Tortoise TTS using librosa"""
    try:
        logger.info(f"Loading audio file: {file_path}")
        # Load audio file with librosa (handles resampling and mono conversion automatically)
        audio, sample_rate = librosa.load(file_path, sr=target_sample_rate, mono=True)
        logger.info(f"Loaded audio: shape={audio.shape}, sample_rate={sample_rate}")
        
        # Convert to torch tensor with proper dimensions for Tortoise TTS
        # Tortoise expects shape [1, samples] (batch_size=1, channels=1)
        waveform = torch.from_numpy(audio).float().unsqueeze(0)
        logger.info(f"Converted to torch tensor: shape={waveform.shape}")
        
        return waveform
    except Exception as e:
        logger.error(f"Error loading audio file {file_path}: {e}")
        return None

def test_voice_cloning(audio_file_path, text="Hello, this is a test of voice cloning."):
    """Test voice cloning with a specific audio file"""
    try:
        logger.info("=" * 60)
        logger.info("🎤 Tortoise TTS Debug Test")
        logger.info("=" * 60)
        
        # Check if file exists
        if not os.path.exists(audio_file_path):
            logger.error(f"Audio file not found: {audio_file_path}")
            return False
        
        logger.info(f"Testing with audio file: {audio_file_path}")
        logger.info(f"Text to synthesize: {text}")
        
        # Load the audio file
        logger.info("\n1. Loading audio file...")
        audio_data = load_audio_file(audio_file_path)
        if audio_data is None:
            logger.error("Failed to load audio file")
            return False
        
        logger.info(f"✅ Audio loaded successfully: {audio_data.shape}")
        
        # Initialize Tortoise TTS
        logger.info("\n2. Initializing Tortoise TTS...")
        from tortoise.api import TextToSpeech
        
        tts = TextToSpeech(kv_cache=True, use_deepspeed=False, half=True)
        logger.info("✅ Tortoise TTS initialized successfully")
        
        # Get conditioning latents
        logger.info("\n3. Getting conditioning latents...")
        voice_samples = [audio_data]
        logger.info(f"Voice samples: {len(voice_samples)} samples")
        
        conditioning_latents = tts.get_conditioning_latents(voice_samples)
        logger.info(f"✅ Conditioning latents obtained: {conditioning_latents is not None}")
        if conditioning_latents is not None:
            logger.info(f"Conditioning latents shape: {conditioning_latents.shape}")
        
        # Generate speech
        logger.info("\n4. Generating speech...")
        logger.info(f"Using preset: ultra_fast")
        
        audio_generator = tts.tts_with_preset(
            text,
            voice_samples=voice_samples,
            conditioning_latents=conditioning_latents,
            preset="ultra_fast",
            k=1
        )
        logger.info(f"✅ Audio generator created: {audio_generator is not None}")
        
        # Collect audio frames
        logger.info("\n5. Collecting audio frames...")
        audio_frames = []
        frame_count = 0
        
        for audio_frame in audio_generator:
            if audio_frame is None:
                logger.warning(f"⚠️ Received None audio frame at position {frame_count}")
                continue
            
            logger.info(f"✅ Collected audio frame {frame_count}: shape={audio_frame.shape}")
            audio_frames.append(audio_frame.cpu())
            frame_count += 1
            
            # Limit to first few frames for testing
            if frame_count >= 3:
                logger.info("Stopping after 3 frames for testing")
                break
        
        logger.info(f"Total frames collected: {len(audio_frames)}")
        
        if not audio_frames:
            logger.error("❌ No audio frames generated")
            return False
        
        # Concatenate frames
        logger.info("\n6. Concatenating audio frames...")
        full_audio = torch.cat(audio_frames, dim=0)
        logger.info(f"✅ Full audio shape: {full_audio.shape}")
        
        # Save to file
        logger.info("\n7. Saving audio...")
        output_path = os.path.join(tempfile.gettempdir(), "test_output.wav")
        
        # Convert to numpy and save with soundfile
        audio_np = full_audio.unsqueeze(0).numpy()
        sf.write(output_path, audio_np.T, 24000)
        logger.info(f"✅ Audio saved to: {output_path}")
        
        logger.info("\n🎉 Voice cloning test completed successfully!")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error during voice cloning test: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return False

if __name__ == "__main__":
    # You can provide the audio file path as a command line argument
    if len(sys.argv) > 1:
        audio_file_path = sys.argv[1]
    else:
        # Default to a common location - you can change this
        audio_file_path = input("Enter the path to your test audio file: ").strip()
    
    if not audio_file_path:
        print("No audio file path provided. Exiting.")
        sys.exit(1)
    
    success = test_voice_cloning(audio_file_path)
    if success:
        print("\n✅ Test completed successfully!")
    else:
        print("\n❌ Test failed!")
        sys.exit(1)
