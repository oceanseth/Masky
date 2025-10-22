// Voice cloning system for instant TTS from uploaded audio
class InstantVoiceCloner {
    constructor() {
        this.tortoiseServerUrl = 'http://127.0.0.1:7860';
        this.userVoices = new Map();
        this.currentVoiceId = null;
        this.selectedFiles = [];
        this.recordedSamples = [];
        this.mediaRecorder = null;
        this.recordingStream = null;
        this.recordingStartTime = null;
        this.recordingTimer = null;
    }

    init() {
        this.setupUploadInterface();
        return this;
    }

    setupUploadInterface() {
        // Create voice upload section in dashboard
        const voiceSection = document.createElement('div');
        voiceSection.className = 'voice-upload-section';
        voiceSection.innerHTML = `
            <div class="voice-cloner">
                <h3>🎤 Create Your AI Voice</h3>
                <p>Upload 10-30 seconds of clear speech to clone your voice</p>
                
                <div class="upload-methods">
                    <div class="method-tabs">
                        <button class="method-tab active" id="upload-tab">📁 Upload Files</button>
                        <button class="method-tab" id="record-tab">🎙️ Record Audio</button>
                    </div>
                    
                    <div class="upload-area" id="voice-upload-area">
                        <input type="file" id="voice-file" accept="audio/*" multiple style="display: none;">
                        <div class="upload-label" id="upload-label">
                            <div class="upload-icon">📁</div>
                            <div class="upload-text">Choose Audio Files (or drag & drop)</div>
                            <div class="upload-subtitle">WAV, MP3, M4A supported</div>
                        </div>
                    </div>
                    
                    <div class="record-area" id="voice-record-area" style="display: none;">
                        <div class="record-controls">
                            <button class="record-btn" id="start-record-btn">
                                <span class="record-icon">🎙️</span>
                                <span class="record-text">Start Recording</span>
                            </button>
                            <button class="record-btn stop" id="stop-record-btn" style="display: none;">
                                <span class="record-icon">⏹️</span>
                                <span class="record-text">Stop Recording</span>
                            </button>
                        </div>
                        
                        <div class="recording-status" id="recording-status" style="display: none;">
                            <div class="recording-indicator">
                                <div class="recording-dot"></div>
                                <span class="recording-time" id="recording-time">00:00</span>
                            </div>
                            <div class="recording-tips">Speak clearly and naturally. 10-30 seconds recommended.</div>
                        </div>
                        
                        <div class="recorded-samples" id="recorded-samples"></div>
                    </div>
                </div>
                
                <div class="selected-files" id="selected-files" style="display: none;"></div>
                
                <div class="upload-tips">
                    <h4>Tips for best results:</h4>
                    <ul>
                        <li>Use clear, high-quality audio (upload or record)</li>
                        <li>Speak naturally and vary your tone</li>
                        <li>Minimize background noise</li>
                        <li>Create 2-5 different samples (10-30 seconds each)</li>
                        <li>For recording: speak close to microphone in a quiet room</li>
                    </ul>
                </div>
                
                <button id="clone-voice-btn" class="btn-primary" disabled>🧬 Clone Voice</button>
                <button id="test-connection-btn" class="btn-secondary">🔧 Test Connection</button>
                
                <div id="cloning-progress" class="progress-container" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress-fill" id="progress-fill"></div>
                    </div>
                    <div class="progress-text" id="progress-text">Processing audio...</div>
                </div>
                
                <div id="voice-preview" class="voice-preview" style="display: none;">
                    <h4>🎯 Test Your Cloned Voice:</h4>
                    <div class="test-voice-container">
                        <textarea id="test-text" placeholder="Enter text to speak in your voice..." rows="3"></textarea>
                        <div class="test-controls">
                            <button id="test-voice-btn" class="btn-secondary">🔊 Test Voice</button>
                            <button id="save-voice-btn" class="btn-primary">💾 Save Voice</button>
                        </div>
                    </div>
                </div>
                
                <div id="voice-status" class="voice-status"></div>
            </div>
        `;
        
        // Insert after existing dashboard content
        const dashboard = document.querySelector('.dashboard') || document.querySelector('.main-content');
        if (dashboard) {
            dashboard.appendChild(voiceSection);
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        const fileInput = document.getElementById('voice-file');
        const uploadLabel = document.getElementById('upload-label');
        const uploadArea = document.getElementById('voice-upload-area');
        const cloneBtn = document.getElementById('clone-voice-btn');
        const testBtn = document.getElementById('test-voice-btn');
        const saveBtn = document.getElementById('save-voice-btn');
        
        // Tab switching
        const uploadTab = document.getElementById('upload-tab');
        const recordTab = document.getElementById('record-tab');
        const recordArea = document.getElementById('voice-record-area');
        
        // Recording controls
        const startRecordBtn = document.getElementById('start-record-btn');
        const stopRecordBtn = document.getElementById('stop-record-btn');
        const testConnectionBtn = document.getElementById('test-connection-btn');

        // Tab switching
        uploadTab.addEventListener('click', () => this.switchToUpload());
        recordTab.addEventListener('click', () => this.switchToRecord());

        // File input click
        uploadLabel.addEventListener('click', () => {
            fileInput.click();
        });

        // File selection
        fileInput.addEventListener('change', (e) => {
            this.handleFileSelection(e.target.files);
        });

        // Drag & drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            this.handleFileSelection(e.dataTransfer.files);
        });

        // Recording controls
        startRecordBtn.addEventListener('click', () => this.startRecording());
        stopRecordBtn.addEventListener('click', () => this.stopRecording());

        // Test connection button
        testConnectionBtn.addEventListener('click', () => this.runConnectionTests());

        // Clone voice button
        cloneBtn.addEventListener('click', () => {
            this.cloneVoiceFromFiles();
        });

        // Test voice button
        testBtn.addEventListener('click', () => {
            this.testClonedVoice();
        });

        // Save voice button
        saveBtn.addEventListener('click', () => {
            this.saveVoicePermanently();
        });
    }

    handleFileSelection(files) {
        const fileList = Array.from(files).filter(file => 
            file.type.startsWith('audio/') || 
            file.name.toLowerCase().endsWith('.wav') ||
            file.name.toLowerCase().endsWith('.mp3') ||
            file.name.toLowerCase().endsWith('.m4a')
        );

        if (fileList.length > 0) {
            this.selectedFiles = fileList;
            this.updateCloneButton();
            
            // Show selected files
            this.displaySelectedFiles(fileList);
            this.showStatus(`${fileList.length} file(s) selected. Ready to clone!`, 'success');
        } else {
            this.showStatus('Please select valid audio files', 'error');
        }
    }

    displaySelectedFiles(files) {
        const selectedFilesDiv = document.getElementById('selected-files');
        selectedFilesDiv.style.display = 'block';
        
        const fileList = files.map(file => 
            `<div class="selected-file">
                <span class="file-name">${file.name}</span>
                <span class="file-size">(${(file.size / 1024 / 1024).toFixed(1)}MB)</span>
            </div>`
        ).join('');
        
        selectedFilesDiv.innerHTML = `
            <h4>Selected Files:</h4>
            ${fileList}
        `;
    }

    async cloneVoiceFromFiles() {
        const allSamples = [...this.selectedFiles, ...this.recordedSamples];
        
        if (allSamples.length === 0) {
            this.showStatus('Please select audio files or record samples first', 'error');
            return;
        }

        try {
            this.showProgress('Preparing voice samples for Tortoise TTS...', 0);
            
            // For Tortoise TTS, we don't actually "clone" in the traditional sense
            // Instead, we prepare the samples to be used as reference voices
            
            // Convert recorded samples to proper files
            const processedSamples = [];
            
            // Add uploaded files
            this.selectedFiles.forEach(file => {
                processedSamples.push(file);
            });
            
            // Add recorded samples as files
            this.recordedSamples.forEach((sample, index) => {
                const file = new File([sample.blob], `recording_${index}.wav`, { type: 'audio/wav' });
                processedSamples.push(file);
            });
            
            this.showProgress('Voice samples ready for use...', 50);
            
            // Store the processed samples
            const userId = window.currentUser?.id || `user_${Date.now()}`;
            const voiceName = `tortoise_voice_${userId}_${Date.now()}`;
            
            this.currentVoiceId = voiceName;
            this.userVoices.set('current', voiceName);
            this.userVoices.set(voiceName, {
                samples: processedSamples,
                type: 'tortoise_ready'
            });
            
            this.showProgress('Voice ready for generation!', 100);
            
            // Show test interface
            setTimeout(() => {
                document.getElementById('cloning-progress').style.display = 'none';
                document.getElementById('voice-preview').style.display = 'block';
                this.showStatus('Voice samples prepared! Test speech generation below.', 'success');
            }, 1000);
            
        } catch (error) {
            document.getElementById('cloning-progress').style.display = 'none';
            this.showStatus('Processing failed: ' + error.message, 'error');
            
            // Automatically run connection tests on failure
            console.log('🔧 Running automatic diagnostics...');
            setTimeout(() => {
                this.runConnectionTests();
            }, 1000);
        }
    }

    async detectGradioAPI() {
        try {
            // Try to get the Gradio config to understand the API structure
            const configResponse = await fetch(`${this.tortoiseServerUrl}/config`);
            if (configResponse.ok) {
                const config = await configResponse.json();
                console.log('Gradio config:', config);
                this.showStatus('Detected Gradio interface. Check console for API details.', 'info');
                
                // Try to find the correct API endpoint
                if (config.dependencies) {
                    config.dependencies.forEach((dep, index) => {
                        console.log(`API endpoint ${index}:`, dep);
                    });
                }
            }
            
            // Also try common Gradio endpoints
            await this.testGradioEndpoints();
            
        } catch (error) {
            console.error('Could not detect Gradio API:', error);
            this.showStatus('Could not connect to Tortoise TTS. Please check if the server is running on port 7860.', 'error');
        }
    }

    async runConnectionTests() {
        this.showStatus('Running connection tests...', 'info');
        console.log('=== Tortoise TTS Connection Tests ===');
        
        const testResults = {
            baseUrl: this.tortoiseServerUrl,
            timestamp: new Date().toISOString(),
            tests: []
        };

        // Test 1: Basic connectivity
        await this.testBasicConnectivity(testResults);
        
        // Test 2: Common endpoints
        await this.testCommonEndpoints(testResults);
        
        // Test 3: Gradio-specific endpoints  
        await this.testGradioEndpoints(testResults);
        
        // Test 4: Try to get server info
        await this.testServerInfo(testResults);
        
        // Display results
        this.displayTestResults(testResults);
    }

    async testBasicConnectivity(results) {
        console.log('\n--- Basic Connectivity Test ---');
        
        const test = {
            name: 'Basic Connectivity',
            url: this.tortoiseServerUrl,
            method: 'GET',
            status: 'failed',
            details: {}
        };

        try {
            const response = await fetch(this.tortoiseServerUrl, {
                method: 'GET',
                mode: 'cors'
            });
            
            test.status = 'success';
            test.details = {
                statusCode: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                contentType: response.headers.get('content-type')
            };
            
            console.log('✅ Base URL accessible:', response.status, response.statusText);
            
            if (response.ok) {
                const text = await response.text();
                test.details.responseLength = text.length;
                test.details.containsGradio = text.includes('gradio') || text.includes('Gradio');
                console.log('📄 Response length:', text.length);
                console.log('🎯 Contains Gradio?', test.details.containsGradio);
            }
            
        } catch (error) {
            test.status = 'error';
            test.details.error = error.message;
            console.log('❌ Base URL failed:', error.message);
        }
        
        results.tests.push(test);
    }

    async testCommonEndpoints(results) {
        console.log('\n--- Common Endpoints Test ---');
        
        const endpoints = [
            '/',
            '/api',
            '/docs',
            '/config',
            '/api/predict',
            '/run/predict',
            '/predict',
            '/api/predict/0',
            '/api/predict/1',
            '/upload',
            '/file',
            '/health',
            '/status'
        ];

        for (const endpoint of endpoints) {
            const test = {
                name: `Endpoint: ${endpoint}`,
                url: `${this.tortoiseServerUrl}${endpoint}`,
                method: 'GET',
                status: 'failed',
                details: {}
            };

            try {
                const response = await fetch(`${this.tortoiseServerUrl}${endpoint}`, {
                    method: 'GET',
                    mode: 'cors'
                });
                
                test.details.statusCode = response.status;
                test.details.statusText = response.statusText;
                test.details.contentType = response.headers.get('content-type');
                
                if (response.status === 200) {
                    test.status = 'success';
                    console.log(`✅ ${endpoint}: ${response.status}`);
                } else if (response.status === 404) {
                    test.status = 'not_found';
                    console.log(`❌ ${endpoint}: 404 Not Found`);
                } else {
                    test.status = 'error';
                    console.log(`⚠️ ${endpoint}: ${response.status} ${response.statusText}`);
                }
                
            } catch (error) {
                test.status = 'error';
                test.details.error = error.message;
                console.log(`💥 ${endpoint}: ${error.message}`);
            }
            
            results.tests.push(test);
            
            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async testGradioEndpoints(results) {
        console.log('\n--- Gradio-Specific Tests ---');
        
        // Test POST requests to common Gradio endpoints
        const gradioTests = [
            {
                endpoint: '/api/predict',
                data: { data: ["test"] }
            },
            {
                endpoint: '/run/predict',
                data: { data: ["test"] }
            },
            {
                endpoint: '/api/predict/0',
                data: { data: ["test"] }
            }
        ];

        for (const gradioTest of gradioTests) {
            const test = {
                name: `Gradio POST: ${gradioTest.endpoint}`,
                url: `${this.tortoiseServerUrl}${gradioTest.endpoint}`,
                method: 'POST',
                status: 'failed',
                details: {}
            };

            try {
                const response = await fetch(`${this.tortoiseServerUrl}${gradioTest.endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(gradioTest.data),
                    mode: 'cors'
                });
                
                test.details.statusCode = response.status;
                test.details.statusText = response.statusText;
                
                if (response.ok) {
                    test.status = 'success';
                    const responseData = await response.json();
                    test.details.response = responseData;
                    console.log(`✅ Gradio ${gradioTest.endpoint}: Working!`, responseData);
                } else {
                    test.status = 'error';
                    console.log(`❌ Gradio ${gradioTest.endpoint}: ${response.status}`);
                }
                
            } catch (error) {
                test.status = 'error';
                test.details.error = error.message;
                console.log(`💥 Gradio ${gradioTest.endpoint}: ${error.message}`);
            }
            
            results.tests.push(test);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    async testServerInfo(results) {
        console.log('\n--- Server Info Test ---');
        
        const infoEndpoints = ['/config', '/api', '/docs', '/info'];
        
        for (const endpoint of infoEndpoints) {
            try {
                const response = await fetch(`${this.tortoiseServerUrl}${endpoint}`);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`📋 Server info from ${endpoint}:`, data);
                    
                    results.serverInfo = results.serverInfo || {};
                    results.serverInfo[endpoint] = data;
                }
            } catch (error) {
                console.log(`ℹ️ No info from ${endpoint}: ${error.message}`);
            }
        }
    }

    displayTestResults(results) {
        console.log('\n=== TEST RESULTS SUMMARY ===');
        console.log('🌐 Base URL:', results.baseUrl);
        console.log('⏰ Test Time:', results.timestamp);
        
        const successCount = results.tests.filter(t => t.status === 'success').length;
        const totalCount = results.tests.length;
        
        console.log(`📊 Success Rate: ${successCount}/${totalCount} (${Math.round(successCount/totalCount*100)}%)`);
        
        // Show working endpoints
        const workingEndpoints = results.tests.filter(t => t.status === 'success');
        if (workingEndpoints.length > 0) {
            console.log('\n✅ Working Endpoints:');
            workingEndpoints.forEach(test => {
                console.log(`  - ${test.url} (${test.details.statusCode})`);
            });
        }
        
        // Show potential API endpoints
        const apiEndpoints = results.tests.filter(t => 
            t.status === 'success' && 
            (t.url.includes('/api') || t.url.includes('/predict'))
        );
        
        if (apiEndpoints.length > 0) {
            console.log('\n🎯 Potential API Endpoints:');
            apiEndpoints.forEach(test => {
                console.log(`  - ${test.url}`);
            });
            
            this.showStatus(`Found ${apiEndpoints.length} potential API endpoints! Check console for details.`, 'success');
        } else {
            this.showStatus('No working API endpoints found. Check console for full details.', 'error');
        }
        
        // Recommendations
        console.log('\n💡 Recommendations:');
        if (results.tests.some(t => t.details.containsGradio)) {
            console.log('  - This appears to be a Gradio app');
        }
        if (workingEndpoints.some(t => t.url.includes('/config'))) {
            console.log('  - Try checking /config endpoint for API structure');
        }
        if (workingEndpoints.length === 0) {
            console.log('  - Server may not be running on port 7860');
            console.log('  - Check if Tortoise TTS is accessible in browser');
            console.log('  - Verify CORS settings if running locally');
        }
        
        console.log('\n=== END TEST RESULTS ===');
        
        // Store results for debugging
        window.tortoiseTestResults = results;
        console.log('💾 Full results stored in window.tortoiseTestResults');
        
        // Auto-suggest next steps
        this.suggestNextSteps(results);
    }

    suggestNextSteps(results) {
        const workingEndpoints = results.tests.filter(t => t.status === 'success');
        const apiEndpoints = workingEndpoints.filter(t => 
            t.url.includes('/api') || t.url.includes('/predict')
        );

        if (apiEndpoints.length > 0) {
            console.log('\n🚀 SUGGESTED ACTIONS:');
            console.log('1. Found working endpoints - updating API calls...');
            
            // Try to use the first working API endpoint
            const bestEndpoint = apiEndpoints[0];
            this.tortoiseApiEndpoint = bestEndpoint.url.replace(this.tortoiseServerUrl, '');
            
            console.log(`2. Set API endpoint to: ${this.tortoiseApiEndpoint}`);
            this.showStatus(`Updated API endpoint to: ${this.tortoiseApiEndpoint}`, 'success');
            
        } else if (workingEndpoints.length > 0) {
            console.log('\n🔍 NEXT STEPS:');
            console.log('1. Server is accessible but no API endpoints found');
            console.log('2. Try opening the Tortoise TTS interface in your browser:');
            console.log(`   ${this.tortoiseServerUrl}`);
            console.log('3. Look for the correct API structure in the browser interface');
            
            this.showStatus('Server accessible but no API found. Check browser interface.', 'info');
        } else {
            console.log('\n❌ TROUBLESHOOTING:');
            console.log('1. Check if Tortoise TTS server is running');
            console.log('2. Verify the correct port (7860)');
            console.log('3. Try accessing in browser first');
            console.log(`4. Expected URL: ${this.tortoiseServerUrl}`);
            
            this.showStatus('Cannot connect to Tortoise TTS. Check if server is running.', 'error');
        }
    }

    async tryWithDiscoveredEndpoint(text, referenceSample) {
        if (!this.tortoiseApiEndpoint) {
            throw new Error('No API endpoint discovered');
        }

        console.log(`🎯 Trying discovered endpoint: ${this.tortoiseApiEndpoint}`);
        
        const methods = [
            // Method 1: JSON POST
            async () => {
                const response = await fetch(`${this.tortoiseServerUrl}${this.tortoiseApiEndpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: [text, referenceSample, "standard"]
                    })
                });
                return response;
            },
            
            // Method 2: FormData POST
            async () => {
                const formData = new FormData();
                formData.append('data', JSON.stringify([text, referenceSample, "standard"]));
                
                const response = await fetch(`${this.tortoiseServerUrl}${this.tortoiseApiEndpoint}`, {
                    method: 'POST',
                    body: formData
                });
                return response;
            },
            
            // Method 3: Direct file upload
            async () => {
                const formData = new FormData();
                formData.append('text', text);
                formData.append('voice_sample', referenceSample);
                formData.append('preset', 'standard');
                
                const response = await fetch(`${this.tortoiseServerUrl}${this.tortoiseApiEndpoint}`, {
                    method: 'POST',
                    body: formData
                });
                return response;
            }
        ];

        for (let i = 0; i < methods.length; i++) {
            try {
                console.log(`📡 Trying method ${i + 1}...`);
                const response = await methods[i]();
                
                if (response.ok) {
                    const result = await response.json();
                    console.log(`✅ Method ${i + 1} succeeded:`, result);
                    
                    if (result.data && result.data[0]) {
                        const audio = new Audio(result.data[0]);
                        audio.play();
                        return true;
                    }
                }
            } catch (error) {
                console.log(`❌ Method ${i + 1} failed:`, error.message);
            }
        }
        
        throw new Error('All methods failed with discovered endpoint');
    }

    // Alternative method that works with file-based Gradio interfaces
    async uploadFileToGradio(file) {
        try {
            const formData = new FormData();
            formData.append('files', file);
            
            const response = await fetch(`${this.tortoiseServerUrl}/upload`, {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                return result; // Usually returns file path or ID
            } else {
                throw new Error(`Upload failed: ${response.status}`);
            }
        } catch (error) {
            console.error('File upload failed:', error);
            throw error;
        }
    }

    switchToUpload() {
        document.getElementById('upload-tab').classList.add('active');
        document.getElementById('record-tab').classList.remove('active');
        document.getElementById('voice-upload-area').style.display = 'block';
        document.getElementById('voice-record-area').style.display = 'none';
        this.updateCloneButton();
    }

    switchToRecord() {
        document.getElementById('upload-tab').classList.remove('active');
        document.getElementById('record-tab').classList.add('active');
        document.getElementById('voice-upload-area').style.display = 'none';
        document.getElementById('voice-record-area').style.display = 'block';
        this.updateCloneButton();
    }

    async startRecording() {
        try {
            // Request microphone access
            this.recordingStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 22050,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.recordingStream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            const chunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                this.handleRecordedAudio(blob);
                chunks.length = 0;
            };

            // Start recording
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            
            // Update UI
            document.getElementById('start-record-btn').style.display = 'none';
            document.getElementById('stop-record-btn').style.display = 'block';
            document.getElementById('recording-status').style.display = 'block';
            
            // Start timer
            this.startRecordingTimer();
            
            this.showStatus('Recording started. Speak clearly!', 'success');

        } catch (error) {
            this.showStatus('Could not access microphone: ' + error.message, 'error');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }

        if (this.recordingStream) {
            this.recordingStream.getTracks().forEach(track => track.stop());
        }

        // Update UI
        document.getElementById('start-record-btn').style.display = 'block';
        document.getElementById('stop-record-btn').style.display = 'none';
        document.getElementById('recording-status').style.display = 'none';
        
        // Stop timer
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }

        this.showStatus('Recording stopped and saved!', 'success');
    }

    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            const seconds = Math.floor(elapsed / 1000);
            const minutes = Math.floor(seconds / 60);
            const displaySeconds = seconds % 60;
            
            const timeString = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
            document.getElementById('recording-time').textContent = timeString;
            
            // Auto-stop after 30 seconds
            if (seconds >= 30) {
                this.stopRecording();
                this.showStatus('Recording automatically stopped at 30 seconds', 'info');
            }
        }, 100);
    }

    handleRecordedAudio(blob) {
        const recordingId = Date.now();
        const duration = (Date.now() - this.recordingStartTime) / 1000;
        
        const recordedSample = {
            id: recordingId,
            blob: blob,
            duration: duration,
            name: `Recording ${this.recordedSamples.length + 1}`
        };

        this.recordedSamples.push(recordedSample);
        this.displayRecordedSample(recordedSample);
        this.updateCloneButton();
    }

    displayRecordedSample(sample) {
        const samplesContainer = document.getElementById('recorded-samples');
        
        const sampleDiv = document.createElement('div');
        sampleDiv.className = 'recorded-sample';
        sampleDiv.innerHTML = `
            <div class="sample-info">
                <span class="sample-name">${sample.name}</span>
                <span class="sample-duration">${sample.duration.toFixed(1)}s</span>
            </div>
            <div class="sample-controls">
                <button class="play-btn" onclick="window.voiceCloner.playRecordedSample('${sample.id}')">▶️</button>
                <button class="delete-btn" onclick="window.voiceCloner.deleteRecordedSample('${sample.id}')">🗑️</button>
            </div>
        `;
        
        samplesContainer.appendChild(sampleDiv);
    }

    playRecordedSample(sampleId) {
        const sample = this.recordedSamples.find(s => s.id == sampleId);
        if (sample) {
            const audio = new Audio(URL.createObjectURL(sample.blob));
            audio.play();
        }
    }

    deleteRecordedSample(sampleId) {
        const index = this.recordedSamples.findIndex(s => s.id == sampleId);
        if (index !== -1) {
            this.recordedSamples.splice(index, 1);
            
            // Remove from UI
            const sampleElement = document.querySelector(`[onclick*="${sampleId}"]`).closest('.recorded-sample');
            if (sampleElement) {
                sampleElement.remove();
            }
            
            this.updateCloneButton();
            this.showStatus('Recording deleted', 'info');
        }
    }

    updateCloneButton() {
        const totalSamples = this.selectedFiles.length + this.recordedSamples.length;
        document.getElementById('clone-voice-btn').disabled = totalSamples === 0;
    }

    async testClonedVoice() {
        const text = document.getElementById('test-text').value.trim();
        if (!text) {
            this.showStatus('Enter some text to test', 'error');
            return;
        }

        if (!this.currentVoiceId) {
            this.showStatus('No voice available yet', 'error');
            return;
        }

        try {
            const testBtn = document.getElementById('test-voice-btn');
            testBtn.disabled = true;
            testBtn.textContent = '⏳ Generating...';

            await this.generateSpeechWithGradio(text);
            this.showStatus('Speech generated successfully!', 'success');

        } catch (error) {
            this.showStatus('Generation failed: ' + error.message, 'error');
        } finally {
            const testBtn = document.getElementById('test-voice-btn');
            testBtn.disabled = false;
            testBtn.textContent = '🔊 Test Voice';
        }
    }

    async generateSpeech(text) {
        if (!this.currentVoiceId) {
            this.showStatus('No voice available. Please process your voice first.', 'error');
            return;
        }

        try {
            await this.generateSpeechWithGradio(text);
        } catch (error) {
            this.showStatus('Failed to generate speech: ' + error.message, 'error');
        }
    }

    async generateSpeechWithGradio(text) {
        // Get the reference samples for this voice
        const voiceData = this.userVoices.get(this.currentVoiceId);
        if (!voiceData || !voiceData.samples || voiceData.samples.length === 0) {
            throw new Error('No reference voice samples available');
        }

        // Use the first sample as reference
        const referenceSample = voiceData.samples[0];

        console.log('🎯 Using Tortoise TTS /predict endpoint');
        
        // Based on the API structure discovered:
        // 1. Text (Textbox)
        // 2. Upload a text file (File) - null
        // 3. Select voice (Dropdown) - need to upload custom voice
        // 4. Optional second voice (Dropdown) - null
        // 5. Split by newline (Radio) - "No"
        // 6. Seed (Number) - null/random
        
        try {
            // First, try to upload the reference voice sample
            const voiceFile = await this.prepareVoiceFile(referenceSample);
            
            // Prepare the API call according to Tortoise TTS structure
            const formData = new FormData();
            
            // The Gradio API expects an array of parameters in order
            const apiData = [
                text,           // Text input
                null,           // Text file upload (not using)
                voiceFile,      // Voice selection (our uploaded sample)
                null,           // Second voice (optional)
                "No",           // Split by newline
                null            // Seed (random)
            ];
            
            formData.append('data', JSON.stringify(apiData));
            
            console.log('📡 Making request to /predict endpoint...');
            
            const response = await fetch(`${this.tortoiseServerUrl}/predict`, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Tortoise TTS response:', result);
                
                if (result.data && result.data.length > 0) {
                    // The generated audio is typically the first item in the response
                    const audioResult = result.data[0];
                    
                    if (audioResult && typeof audioResult === 'string') {
                        // If it's a URL or file path
                        const audioUrl = audioResult.startsWith('http') ? audioResult : `${this.tortoiseServerUrl}/file=${audioResult}`;
                        console.log('🔊 Playing generated audio:', audioUrl);
                        
                        const audio = new Audio(audioUrl);
                        audio.play();
                        return true;
                    } else if (audioResult && audioResult.url) {
                        // If it's an object with URL property
                        const audio = new Audio(audioResult.url);
                        audio.play();
                        return true;
                    }
                }
                
                throw new Error('No audio generated in response');
            } else {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
        } catch (error) {
            console.error('❌ Tortoise TTS generation failed:', error);
            throw error;
        }
    }

    async prepareVoiceFile(audioSample) {
        // Convert the audio sample to a format suitable for Tortoise TTS
        if (audioSample instanceof File) {
            return audioSample;
        } else if (audioSample instanceof Blob) {
            // Convert blob to file with proper name
            return new File([audioSample], 'voice_sample.wav', { type: 'audio/wav' });
        } else {
            throw new Error('Invalid audio sample format');
        }
    }

    async tryGradioAPI1(text, referenceSample) {
        // Method 1: Standard Gradio prediction API
        const formData = new FormData();
        formData.append('data', JSON.stringify([
            text,
            referenceSample,
            "standard"
        ]));

        const response = await fetch(`${this.tortoiseServerUrl}/api/predict`, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data[0]) {
                const audio = new Audio(result.data[0]);
                audio.play();
                return true;
            }
        }
        throw new Error(`API1 failed: ${response.status}`);
    }

    async tryGradioAPI2(text, referenceSample) {
        // Method 2: File upload first, then predict
        const uploadResult = await this.uploadFileToGradio(referenceSample);
        
        const response = await fetch(`${this.tortoiseServerUrl}/api/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: [text, uploadResult, "standard"]
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data[0]) {
                const audio = new Audio(result.data[0]);
                audio.play();
                return true;
            }
        }
        throw new Error(`API2 failed: ${response.status}`);
    }

    async tryGradioAPI3(text, referenceSample) {
        // Method 3: Direct form submission (like browser form)
        const formData = new FormData();
        formData.append('text', text);
        formData.append('voice_sample', referenceSample);
        formData.append('preset', 'standard');

        const response = await fetch(`${this.tortoiseServerUrl}/api/predict/0`, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data[0]) {
                const audio = new Audio(result.data[0]);
                audio.play();
                return true;
            }
        }
        throw new Error(`API3 failed: ${response.status}`);
    }

    async saveVoicePermanently() {
        if (!this.currentVoiceId) {
            this.showStatus('No voice to save', 'error');
            return;
        }

        try {
            // Save voice to local storage or send to server
            localStorage.setItem('savedVoiceId', this.currentVoiceId);
            localStorage.setItem('savedVoiceTime', Date.now());
            
            this.showStatus('Voice saved! You can now use it throughout the app.', 'success');
            
            // Enable voice features throughout the app
            this.enableVoiceFeatures();
            
        } catch (error) {
            this.showStatus('Failed to save voice: ' + error.message, 'error');
        }
    }

    enableVoiceFeatures() {
        // Add voice buttons to existing elements
        this.addVoiceToChat();
        this.addVoiceToVODs();
        
        // Dispatch event for other modules to listen
        window.dispatchEvent(new CustomEvent('voiceCloned', {
            detail: { voiceId: this.currentVoiceId }
        }));
    }

    addVoiceToChat() {
        // Add TTS buttons to chat messages (if chat exists)
        const chatContainer = document.querySelector('#chat-messages, .chat-container');
        if (chatContainer) {
            const speakChatBtn = document.createElement('button');
            speakChatBtn.innerHTML = '🗣️ Speak Last Message';
            speakChatBtn.className = 'voice-chat-btn';
            speakChatBtn.onclick = () => {
                const lastMessage = chatContainer.lastElementChild?.textContent;
                if (lastMessage) {
                    this.generateSpeech(lastMessage);
                }
            };
            chatContainer.parentNode.appendChild(speakChatBtn);
        }
    }

    addVoiceToVODs() {
        // Add voice narration to VOD cards
        document.querySelectorAll('.vod-card').forEach(card => {
            const existingBtn = card.querySelector('.voice-narrate-btn');
            if (!existingBtn) {
                const narrateBtn = document.createElement('button');
                narrateBtn.innerHTML = '🗣️';
                narrateBtn.className = 'voice-narrate-btn';
                narrateBtn.title = 'Narrate VOD title';
                narrateBtn.onclick = () => {
                    const title = card.querySelector('.vod-title, h3, h4')?.textContent;
                    if (title) {
                        this.generateSpeech(`This VOD is titled: ${title}`);
                    }
                };
                card.appendChild(narrateBtn);
            }
        });
    }

    async generateSpeech(text) {
        if (!this.currentVoiceId) {
            this.showStatus('No voice available. Please clone a voice first.', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.tortoiseServerUrl}/generate_speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    voice_id: this.currentVoiceId,
                    quality: 'fast'
                })
            });

            if (response.ok) {
                const audioBlob = await response.blob();
                this.playAudio(audioBlob);
            } else {
                throw new Error('Failed to generate speech');
            }

        } catch (error) {
            this.showStatus('Failed to generate speech: ' + error.message, 'error');
        }
    }

    playAudio(audioBlob) {
        const audio = new Audio(URL.createObjectURL(audioBlob));
        audio.play().catch(error => {
            console.error('Error playing audio:', error);
            this.showStatus('Could not play audio. Check browser permissions.', 'error');
        });
    }

    showProgress(message, percent = 0) {
        const progressContainer = document.getElementById('cloning-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        progressContainer.style.display = 'block';
        progressFill.style.width = percent + '%';
        progressText.textContent = message;
    }

    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('voice-status');
        statusDiv.className = `voice-status ${type}`;
        statusDiv.textContent = message;
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'voice-status';
        }, 5000);
    }

    // Load saved voice on page load
    loadSavedVoice() {
        const savedVoiceId = localStorage.getItem('savedVoiceId');
        const savedTime = localStorage.getItem('savedVoiceTime');
        
        if (savedVoiceId && savedTime) {
            // Check if voice is less than 24 hours old
            const ageHours = (Date.now() - parseInt(savedTime)) / (1000 * 60 * 60);
            if (ageHours < 24) {
                this.currentVoiceId = savedVoiceId;
                this.userVoices.set('current', savedVoiceId);
                this.enableVoiceFeatures();
                this.showStatus('Saved voice loaded and ready to use!', 'success');
            } else {
                // Clean up old voice
                localStorage.removeItem('savedVoiceId');
                localStorage.removeItem('savedVoiceTime');
            }
        }
    }
}

// Export for use in other modules
window.InstantVoiceCloner = InstantVoiceCloner;