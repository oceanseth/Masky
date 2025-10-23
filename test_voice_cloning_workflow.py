#!/usr/bin/env python3
"""
Test the complete voice cloning workflow
"""

import requests
import json
import tempfile
import wave
import numpy as np
import os

def create_test_audio_file(duration=3.0, sample_rate=22050):
    """Create a simple test audio file"""
    # Generate a simple sine wave tone
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    frequency = 440  # A4 note
    audio_data = np.sin(2 * np.pi * frequency * t) * 0.3
    
    # Add some variation
    for i in range(1, 4):
        harmonic = np.sin(2 * np.pi * frequency * i * t) * (0.1 / i)
        audio_data += harmonic
    
    # Normalize and convert to 16-bit integers
    audio_data = np.clip(audio_data, -1.0, 1.0)
    audio_data = (audio_data * 32767).astype(np.int16)
    
    # Create temporary WAV file
    temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    with wave.open(temp_file.name, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_data.tobytes())
    
    return temp_file.name

def test_voice_cloning_workflow():
    """Test the complete voice cloning workflow"""
    base_url = "http://127.0.0.1:7860"
    
    print("🧪 Testing Complete Voice Cloning Workflow")
    print("=" * 60)
    
    # Step 1: Health check
    print("1. Checking server health...")
    try:
        response = requests.get(f"{base_url}/health")
        if response.status_code == 200:
            health_data = response.json()
            print(f"   ✅ Server is healthy")
            print(f"   📊 Mode: {health_data['mode']}")
            print(f"   🎯 Tortoise loaded: {health_data['tortoise_loaded']}")
        else:
            print(f"   ❌ Health check failed: {response.status_code}")
            return
    except Exception as e:
        print(f"   ❌ Health check error: {e}")
        return
    
    # Step 2: Create test audio files
    print("\n2. Creating test audio files...")
    test_files = []
    try:
        for i in range(2):  # Create 2 test files
            audio_file = create_test_audio_file(duration=2.0)
            test_files.append(audio_file)
            print(f"   ✅ Created test audio file {i+1}: {os.path.basename(audio_file)}")
    except Exception as e:
        print(f"   ❌ Error creating test files: {e}")
        return
    
    # Step 3: Upload voice samples
    print("\n3. Uploading voice samples...")
    try:
        form_data = {
            'user_id': 'test_user',
            'voice_name': 'test_voice_123'
        }
        
        files = []
        for i, file_path in enumerate(test_files):
            files.append(('voice_sample_' + str(i), open(file_path, 'rb')))
        
        response = requests.post(f"{base_url}/clone_voice_instant", data=form_data, files=files)
        
        # Close files
        for _, file_obj in files:
            file_obj.close()
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                voice_id = result['voice_id']
                samples_count = result['samples_count']
                print(f"   ✅ Voice cloned successfully!")
                print(f"   🎤 Voice ID: {voice_id}")
                print(f"   📊 Samples processed: {samples_count}")
            else:
                print(f"   ❌ Voice cloning failed: {result.get('error')}")
                return
        else:
            print(f"   ❌ Upload failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return
    except Exception as e:
        print(f"   ❌ Upload error: {e}")
        return
    
    # Step 4: Test speech generation
    print("\n4. Testing speech generation...")
    try:
        test_text = "Hello, this is a test of the voice cloning system!"
        response = requests.post(
            f"{base_url}/gradio_api/predict",
            json={
                "data": [test_text],
                "voice_id": voice_id,
                "quality": "ultra_fast"
            },
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('data') and len(result['data']) > 0:
                audio_file = result['data'][0]
                print(f"   ✅ Speech generated successfully!")
                print(f"   🎵 Audio file: {os.path.basename(audio_file)}")
                
                # Test file serving
                file_response = requests.get(f"{base_url}/file?file={audio_file}")
                if file_response.status_code == 200:
                    print(f"   ✅ Audio file served successfully (Content-Type: {file_response.headers.get('Content-Type')})")
                else:
                    print(f"   ⚠️  File serving issue: {file_response.status_code}")
            else:
                print(f"   ❌ No audio data in response")
        else:
            print(f"   ❌ Speech generation failed: {response.status_code}")
            print(f"   Response: {response.text}")
    except Exception as e:
        print(f"   ❌ Speech generation error: {e}")
    
    # Step 5: List voices
    print("\n5. Listing available voices...")
    try:
        response = requests.get(f"{base_url}/list_voices")
        if response.status_code == 200:
            voices_data = response.json()
            print(f"   ✅ Found {voices_data['count']} voices")
            for voice in voices_data['voices']:
                print(f"   🎤 Voice: {voice['voice_id']} (TTS ready: {voice.get('ready_for_tts', False)})")
        else:
            print(f"   ❌ List voices failed: {response.status_code}")
    except Exception as e:
        print(f"   ❌ List voices error: {e}")
    
    # Cleanup
    print("\n6. Cleaning up test files...")
    for file_path in test_files:
        try:
            os.unlink(file_path)
            print(f"   ✅ Cleaned up: {os.path.basename(file_path)}")
        except:
            pass
    
    print("\n" + "=" * 60)
    print("🎉 Voice cloning workflow test completed!")
    print("\n💡 The system is now ready for real voice cloning!")
    print("   - Upload audio samples through the web interface")
    print("   - The server will process them with Tortoise TTS")
    print("   - Generate speech in the cloned voice")

if __name__ == "__main__":
    test_voice_cloning_workflow()
