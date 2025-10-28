import { getCurrentUser } from './firebase.js';
import { config } from './config.js';

/**
 * Project Wizard - Single consolidated module for creating and editing projects
 */

// Global wizard instance
let projectWizard = null;

/**
 * Show Project Wizard - Main function to display the wizard
 * @param {Object} options - Configuration options
 * @param {string} options.containerId - ID of container to render wizard in
 * @param {string} options.mode - 'create' or 'edit'
 * @param {Object} options.projectData - Existing project data for editing
 * @param {Function} options.onComplete - Callback when wizard completes
 * @param {Function} options.onCancel - Callback when wizard is cancelled
 */
export function showProjectWizard(options = {}) {
    const defaultOptions = {
        containerId: 'projectWizard',
        mode: 'create',
        projectData: null,
        onComplete: null,
        onCancel: null
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    // Destroy existing wizard if it exists
    if (projectWizard) {
        projectWizard.destroy();
    }
    
    // Create new wizard instance
    projectWizard = new ProjectWizard(finalOptions);
    projectWizard.init();
    
    return projectWizard;
}

/**
 * Project Wizard Class
 */
class ProjectWizard {
    constructor(options = {}) {
        this.options = {
            containerId: 'projectWizard',
            mode: 'create', // 'create' or 'edit'
            projectData: null,
            onComplete: null,
            onCancel: null,
            ...options
        };
        
        this.wizardId = `wizard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.currentStep = 1;
        this.projectData = this.options.projectData || {
            platform: '',
            projectName: '',
            eventType: 'channel.follow', // Set default value
            voiceFile: null,
            avatarFile: null,
            twitchSubscription: null,
            videoUrl: '',
            projectId: null
        };
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.userVoices = [];
    }

    /**
     * Initialize the wizard
     */
    init() {
        this.render();
        this.setupEventListeners();
        this.setDefaultValues();
        this.updateNavigationButtons();
        
        // Check if we're resuming from OAuth callback
        this.checkForOAuthResume();
        
        if (this.options.mode === 'edit' && this.projectData.projectId) {
            this.loadProjectData();
        }
    }

    /**
     * Render the wizard HTML
     */
    render() {
        const container = document.getElementById(this.options.containerId);
        if (!container) {
            console.error('Project wizard container not found:', this.options.containerId);
            return;
        }

        container.innerHTML = `
            <div class="project-wizard" id="projectWizard">
                <div class="wizard-header">
                    <h2 class="section-title">${this.options.mode === 'edit' ? 'Edit Project' : 'New Project Wizard'}</h2>
                    <p class="wizard-subtitle">${this.options.mode === 'edit' ? 'Update your project settings' : 'Create your first AI-powered stream alert in 5 simple steps'}</p>
                </div>

                <div class="wizard-steps">
                    <!-- Step 1: Platform Selection -->
                    <div class="wizard-step active" id="step1">
                        <div class="step-header">
                            <div class="step-number">1</div>
                            <div class="step-title">Choose Platform</div>
                        </div>
                        <div class="step-content">
                            <div class="form-group">
                                <label for="platformSelect">Select your streaming platform:</label>
                                <select id="platformSelect" class="form-select">
                                    <option value="">Choose a platform...</option>
                                    <option value="twitch">Twitch</option>
                                    <option value="youtube">YouTube</option>
                                    <option value="facebook">Facebook</option>
                                    <option value="instagram">Instagram</option>
                                    <option value="tiktok">TikTok</option>
                                    <option value="kick">Kick</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="projectName">Project Name:</label>
                                <input type="text" id="projectName" class="form-input" placeholder="e.g., thankyouthankyouthankyou">
                            </div>
                            <div class="form-group">
                                <label for="eventType">Event Type:</label>
                                <select id="eventType" class="form-select">
                                    <option value="channel.follow">New Follower</option>
                                    <option value="channel.subscribe">New Subscriber</option>
                                    <option value="channel.cheer">New Cheer</option>
                                    <option value="channel.raid">New Raid</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Step 2: Voice Recording -->
                    <div class="wizard-step" id="step2">
                        <div class="step-header">
                            <div class="step-number">2</div>
                            <div class="step-title">Create Your Voice</div>
                        </div>
                        <div class="step-content">
                            <div class="voice-management" id="voiceManagement">
                                <!-- Voice Selection -->
                                <div class="voice-selection" id="voiceSelection">
                                    <h4>Select a Voice</h4>
                                    <div class="voice-list" id="voiceList">
                                        <div class="loading-voices">Loading your voices...</div>
                                    </div>
                                    <div class="voice-actions">
                                        <button class="btn btn-primary" id="recordNewBtn" onclick="projectWizard.startNewRecording()">
                                            <span class="record-icon">🎤</span> Record New Voice
                                        </button>
                                    </div>
                                </div>

                                <!-- Voice Recording -->
                                <div class="voice-recorder" id="voiceRecorder" style="display: none;">
                                    <h4>Record New Voice</h4>
                                    <div class="recorder-controls">
                                        <button class="btn btn-primary" id="recordBtn" onclick="projectWizard.startRecording()">
                                            <span class="record-icon">🎤</span> Start Recording
                                        </button>
                                        <button class="btn btn-secondary" id="stopBtn" onclick="projectWizard.stopRecording()" style="display: none;">
                                            <span class="stop-icon">⏹️</span> Stop Recording
                                        </button>
                                    </div>
                                    <div class="recording-status" id="recordingStatus"></div>
                                    <div class="audio-preview" id="audioPreview" style="display: none;">
                                        <audio controls id="recordedAudio" preload="metadata" onerror="projectWizard.handleAudioError(this, 'recorded')" onloadstart="projectWizard.handleAudioLoadStart(this, 'recorded')"></audio>
                                        <div class="voice-actions">
                                            <div class="voice-naming">
                                                <label for="voiceName">Name your voice:</label>
                                                <input type="text" id="voiceName" placeholder="e.g., Thank You Voice" maxlength="50">
                                            </div>
                                            <div class="voice-buttons">
                                                <button class="btn btn-primary" onclick="projectWizard.saveVoice()">Save Voice</button>
                                                <button class="btn btn-secondary" onclick="projectWizard.retryRecording()">Retry</button>
                                                <button class="btn btn-secondary" onclick="projectWizard.cancelRecording()">Cancel</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Selected Voice Display -->
                                <div class="selected-voice" id="selectedVoice" style="display: none;">
                                    <h4>Selected Voice</h4>
                                    <div class="voice-card selected">
                                        <div class="voice-info">
                                            <div class="voice-name" id="selectedVoiceName"></div>
                                            <div class="voice-duration" id="selectedVoiceDuration"></div>
                                        </div>
                                        <audio controls id="selectedVoiceAudio" preload="metadata" onerror="projectWizard.handleAudioError(this, 'selected')" onloadstart="projectWizard.handleAudioLoadStart(this, 'selected')"></audio>
                                        <div class="voice-actions">
                                            <button class="btn btn-secondary" onclick="projectWizard.changeVoice()">Change Voice</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Step 3: Avatar Upload -->
                    <div class="wizard-step" id="step3">
                        <div class="step-header">
                            <div class="step-number">3</div>
                            <div class="step-title">Upload Avatar Image</div>
                        </div>
                        <div class="step-content">
                            <div class="avatar-upload">
                                <div class="upload-area" id="uploadArea">
                                    <div class="upload-icon">📷</div>
                                    <p>Drag & drop an image here or click to browse</p>
                                    <input type="file" id="avatarFile" accept="image/*" style="display: none;">
                                </div>
                                <div class="image-preview" id="imagePreview" style="display: none;">
                                    <img id="previewImg" alt="Avatar preview">
                                    <div class="image-actions">
                                        <button class="btn btn-primary" onclick="projectWizard.saveAvatar()">Use This Image</button>
                                        <button class="btn btn-secondary" onclick="projectWizard.retryUpload()">Choose Different</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Step 4: Twitch API Connection -->
                    <div class="wizard-step" id="step4">
                        <div class="step-header">
                            <div class="step-number">4</div>
                            <div class="step-title">Connect to Twitch</div>
                        </div>
                        <div class="step-content">
                            <div class="twitch-connection">
                                <div class="connection-status" id="connectionStatus">
                                    <div class="status-icon">🔗</div>
                                    <p>Setting up Twitch EventSub subscription...</p>
                                </div>
                                <div class="connection-result" id="connectionResult" style="display: none;">
                                    <div class="result-icon success">✅</div>
                                    <p class="result-message">Successfully connected to Twitch!</p>
                                    <div class="subscription-details" id="subscriptionDetails"></div>
                                </div>
                                <div class="connection-error" id="connectionError" style="display: none;">
                                    <div class="result-icon error">❌</div>
                                    <p class="error-message"></p>
                                    <button class="btn btn-primary" onclick="projectWizard.retryConnection()">Connect to Twitch</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Step 5: Content Generation -->
                    <div class="wizard-step" id="step5">
                        <div class="step-header">
                            <div class="step-number">5</div>
                            <div class="step-title">Generate Content</div>
                        </div>
                        <div class="step-content">
                            <div class="content-generation">
                                <div class="generation-status" id="generationStatus">
                                    <div class="loading-spinner"></div>
                                    <p>Generating your AI avatar video...</p>
                                </div>
                                <div class="generation-result" id="generationResult" style="display: none;">
                                    <div class="result-icon success">🎬</div>
                                    <p class="result-message">Your AI avatar is ready!</p>
                                    <div class="video-url-section">
                                        <label for="videoUrl">Video URL (for testing):</label>
                                        <input type="text" id="videoUrl" class="form-input" 
                                               value="https://resource2.heygen.ai/video/transcode/db4d10b8bf02461386ac1a4c3b271ca0/vJLetG12gwT1WR81fVZ2VVsCnYQwyppLd/1080x1920.mp4?response-content-disposition=attachment%3B+filename%2A%3DUTF-8%27%27Untitled%2520Video.mp4%3B">
                                        <button class="btn btn-primary" onclick="projectWizard.saveVideoUrl()">Save Video URL</button>
                                    </div>
                                    <div class="project-url" id="projectUrl" style="display: none;">
                                        <h3>Your Project URL:</h3>
                                        <div class="url-display">
                                            <input type="text" id="projectUrlInput" readonly>
                                            <button class="btn btn-secondary" onclick="projectWizard.copyProjectUrl()">Copy URL</button>
                                        </div>
                                        <p class="url-instructions">Add this URL as a Browser Source in OBS to display your alerts!</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="wizard-navigation">
                    <button class="btn btn-secondary" id="prevBtn" onclick="projectWizard.previousStep()" style="display: none;">Previous</button>
                    <button class="btn btn-primary" id="nextBtn" onclick="projectWizard.nextStep()">Next</button>
                    <button class="btn btn-primary" id="finishBtn" onclick="projectWizard.finishWizard()" style="display: none;">Finish</button>
                    ${this.options.mode === 'edit' ? '<button class="btn btn-secondary" id="cancelBtn" onclick="projectWizard.cancel()">Cancel</button>' : ''}
                </div>
            </div>
        `;

        // Make this instance globally available for onclick handlers
        window.projectWizard = this;
    }

    /**
     * Check if we're resuming from OAuth callback
     */
    checkForOAuthResume() {
        // Check for Twitch OAuth callback in URL fragment (access_token)
        const urlFragment = window.location.hash.substring(1);
        const fragmentParams = new URLSearchParams(urlFragment);
        const hasAccessToken = fragmentParams.has('access_token');
        
        // Check for traditional OAuth callback in query params (code)
        const urlParams = new URLSearchParams(window.location.search);
        const hasOAuthCode = urlParams.has('code') && urlParams.has('state');
        
        const savedState = sessionStorage.getItem('projectWizardState');
        
        // Resume if we have saved state and either OAuth callback type
        if (savedState && (hasAccessToken || hasOAuthCode)) {
            try {
                const state = JSON.parse(savedState);
                if (state.wizardId === this.wizardId) {
                    console.log('Resuming wizard from OAuth callback');
                    
                    // Restore wizard state
                    this.currentStep = state.currentStep;
                    this.projectData = { ...this.projectData, ...state.projectData };
                    
                    // Update UI to show the correct step
                    this.showStep(this.currentStep);
                    this.updateNavigationButtons();
                    
                    // Clear the saved state
                    sessionStorage.removeItem('projectWizardState');
                    
                    // If we were on step 4 (Twitch connection), handle the OAuth callback
                    if (this.currentStep === 4) {
                        if (hasAccessToken) {
                            // Handle Twitch OAuth callback with access token
                            this.handleTwitchOAuthCallback();
                        } else {
                            // Handle other OAuth callbacks
                            setTimeout(() => {
                                this.connectToTwitch();
                            }, 1000);
                        }
                    }
                }
            } catch (error) {
                console.error('Error restoring wizard state:', error);
                sessionStorage.removeItem('projectWizardState');
            }
        }
    }

    /**
     * Handle Twitch OAuth callback with access token
     */
    async handleTwitchOAuthCallback() {
        try {
            console.log('Handling Twitch OAuth callback');
            
            // Import the handleTwitchCallback function from firebase.js
            const { handleTwitchCallback } = await import('./firebase.js');
            
            // Handle the OAuth callback
            await handleTwitchCallback();
            
            // Clean up the URL to remove the access token
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Now try to connect to Twitch again
            setTimeout(() => {
                this.connectToTwitch();
            }, 1000);
            
        } catch (error) {
            console.error('Error handling Twitch OAuth callback:', error);
            
            // Show error in the connection UI
            const connectionStatus = document.getElementById('connectionStatus');
            const connectionError = document.getElementById('connectionError');
            const errorMessage = document.querySelector('.error-message');
            
            if (connectionStatus) connectionStatus.style.display = 'none';
            if (connectionError) connectionError.style.display = 'block';
            if (errorMessage) errorMessage.textContent = error.message;
        }
    }

    /**
     * Set default values for form fields
     */
    setDefaultValues() {
        // Set default event type
        const eventTypeSelect = document.getElementById('eventType');
        if (eventTypeSelect && !eventTypeSelect.value) {
            eventTypeSelect.value = 'channel.follow';
            this.projectData.eventType = 'channel.follow';
        }
        
        // Set default project name if empty
        const projectNameInput = document.getElementById('projectName');
        if (projectNameInput && !projectNameInput.value && !this.projectData.projectName) {
            const defaultName = this.getDefaultProjectName(this.projectData.eventType);
            projectNameInput.value = defaultName;
            this.projectData.projectName = defaultName;
        }
        
        // Trigger validation after setting defaults
        setTimeout(() => {
            this.validateStep1();
        }, 100);
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Platform selection
        const platformSelect = document.getElementById('platformSelect');
        if (platformSelect) {
            platformSelect.addEventListener('change', (e) => {
                this.projectData.platform = e.target.value;
                this.validateStep1();
            });
        }

        // Project name
        const projectName = document.getElementById('projectName');
        if (projectName) {
            projectName.addEventListener('input', (e) => {
                this.projectData.projectName = e.target.value;
                this.validateStep1();
            });
        }

        // Event type
        const eventType = document.getElementById('eventType');
        if (eventType) {
            eventType.addEventListener('change', (e) => {
                this.projectData.eventType = e.target.value;
                
                // Update project name if it's still the default
                const projectNameInput = document.getElementById('projectName');
                if (projectNameInput && projectNameInput.value.includes('My ') && projectNameInput.value.includes(' Alert')) {
                    const defaultName = this.getDefaultProjectName(e.target.value);
                    projectNameInput.value = defaultName;
                    this.projectData.projectName = defaultName;
                }
                
                this.validateStep1();
            });
        }

        // Avatar file upload
        const uploadArea = document.getElementById('uploadArea');
        const avatarFile = document.getElementById('avatarFile');

        if (uploadArea && avatarFile) {
            uploadArea.addEventListener('click', () => avatarFile.click());
            uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
            uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
            avatarFile.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Video URL input
        const videoUrl = document.getElementById('videoUrl');
        if (videoUrl) {
            videoUrl.addEventListener('input', (e) => {
                this.projectData.videoUrl = e.target.value;
            });
        }
    }

    /**
     * Load existing project data for editing
     */
    loadProjectData() {
        if (!this.projectData) return;

        // Populate form fields
        const platformSelect = document.getElementById('platformSelect');
        const projectName = document.getElementById('projectName');
        const eventType = document.getElementById('eventType');
        const videoUrl = document.getElementById('videoUrl');

        if (platformSelect) platformSelect.value = this.projectData.platform || '';
        if (projectName) projectName.value = this.projectData.projectName || '';
        if (eventType) eventType.value = this.projectData.eventType || 'channel.follow';
        if (videoUrl) videoUrl.value = this.projectData.videoUrl || '';
        
        // Ensure projectData has the correct values
        this.projectData.eventType = this.projectData.eventType || 'channel.follow';

        // Validate step 1
        this.validateStep1();
    }

    /**
     * Step Navigation
     */
    nextStep() {
        if (this.validateCurrentStep()) {
            if (this.currentStep < 5) {
                this.currentStep++;
                this.showStep(this.currentStep);
                this.updateNavigationButtons();
                
                // Auto-execute step actions
                if (this.currentStep === 4) {
                    this.connectToTwitch();
                } else if (this.currentStep === 5) {
                    this.generateContent();
                }
            }
        }
    }

    previousStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.showStep(this.currentStep);
            this.updateNavigationButtons();
        }
    }

    showStep(stepNumber) {
        // Hide all steps
        document.querySelectorAll('.wizard-step').forEach(step => {
            step.classList.remove('active');
        });
        
        // Show current step
        const stepElement = document.getElementById(`step${stepNumber}`);
        if (stepElement) {
            stepElement.classList.add('active');
        }
        
        // Handle step-specific logic
        if (stepNumber === 2) {
            // Ensure voice management is properly initialized for step 2
            this.initializeVoiceManagement();
        }
    }

    /**
     * Initialize voice management for step 2
     */
    initializeVoiceManagement() {
        console.log('Initializing voice management for step 2');
        
        // Ensure HTML elements are ready
        const voiceManagement = document.getElementById('voiceManagement');
        if (!voiceManagement) {
            console.error('Voice management element not found');
            return;
        }
        
        // Load voices if not already loaded
        if (!this.userVoices || this.userVoices.length === 0) {
            this.loadUserVoices();
        } else {
            // Re-render the voice list to ensure proper display
            this.renderVoiceList();
        }
    }

    updateNavigationButtons() {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const finishBtn = document.getElementById('finishBtn');

        if (prevBtn) {
            prevBtn.style.display = this.currentStep > 1 ? 'block' : 'none';
        }
        
        if (this.currentStep === 5) {
            if (nextBtn) {
                nextBtn.style.display = 'none';
            }
            if (finishBtn) {
                finishBtn.style.display = 'block';
            }
        } else {
            if (nextBtn) {
                nextBtn.style.display = 'block';
            }
            if (finishBtn) {
                finishBtn.style.display = 'none';
            }
        }
    }

    /**
     * Step Validation
     */
    validateCurrentStep() {
        switch (this.currentStep) {
            case 1:
                return this.validateStep1();
            case 2:
                return this.validateStep2();
            case 3:
                return this.validateStep3();
            case 4:
                return true; // Auto-executed
            case 5:
                return true; // Auto-executed
            default:
                return false;
        }
    }

    validateStep1() {
        const platform = this.projectData.platform;
        const projectName = this.projectData.projectName ? this.projectData.projectName.trim() : '';
        const eventType = this.projectData.eventType;

        // All three fields are required for step 1
        const isValid = platform && projectName && eventType;
        
        // Update next button state
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) {
            nextBtn.disabled = !isValid;
            nextBtn.style.opacity = isValid ? '1' : '0.5';
        }
        
        return isValid;
    }

    validateStep2() {
        return this.projectData.voiceUrl !== null;
    }

    validateStep3() {
        return this.projectData.avatarFile !== null || this.projectData.avatarUrl !== null;
    }

    /**
     * Step 2: Voice Recording
     */
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Check what MIME types are supported
            const supportedTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/ogg;codecs=opus',
                'audio/wav'
            ];
            
            // Log all supported types for debugging
            console.log('Checking supported MIME types:');
            supportedTypes.forEach(type => {
                const isSupported = MediaRecorder.isTypeSupported(type);
                console.log(`${type}: ${isSupported ? '✓' : '✗'}`);
            });
            
            let mimeType = 'audio/webm'; // Default fallback
            for (const type of supportedTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    console.log('Using MIME type:', mimeType);
                    break;
                }
            }
            
            this.mediaRecorder = new MediaRecorder(stream, { mimeType });
            this.audioChunks = [];

            // Initialize recording state
            this.recordingState = {
                isRecording: true,
                mediaRecorder: this.mediaRecorder,
                audioChunks: this.audioChunks,
                audioBlob: null,
                duration: 0,
                startTime: Date.now()
            };

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                const duration = this.recordingState ? (Date.now() - this.recordingState.startTime) / 1000 : 0;
                
                // Update recording state
                if (this.recordingState) {
                    this.recordingState.audioBlob = audioBlob;
                    this.recordingState.duration = duration;
                    this.recordingState.isRecording = false;
                }
                
                // Show audio preview
                const audioPreview = document.getElementById('audioPreview');
                const recordedAudio = document.getElementById('recordedAudio');
                const voiceNameInput = document.getElementById('voiceName');
                const voiceNamingDiv = document.querySelector('.voice-naming');
                console.log('Audio preview elements:', { audioPreview, recordedAudio, voiceNameInput, voiceNamingDiv });
                if (audioPreview && recordedAudio) {
                    recordedAudio.src = URL.createObjectURL(audioBlob);
                    audioPreview.style.display = 'block';
                    console.log('Audio preview shown, display:', audioPreview.style.display);
                    console.log('Voice name input found:', voiceNameInput);
                    console.log('Voice naming div found:', voiceNamingDiv);
                    console.log('Audio preview innerHTML:', audioPreview.innerHTML);
                    
                    // Create the voice naming input if it doesn't exist
                    if (!voiceNameInput) {
                        console.log('Creating voice naming input dynamically...');
                        const voiceNamingDiv = document.createElement('div');
                        voiceNamingDiv.className = 'voice-naming';
                        voiceNamingDiv.innerHTML = `
                            <label for="voiceName">Name your voice:</label>
                            <input type="text" id="voiceName" placeholder="e.g., Thank You Voice" maxlength="50">
                        `;
                        
                        // Insert before the voice-actions div
                        const voiceActions = audioPreview.querySelector('.voice-actions');
                        if (voiceActions) {
                            audioPreview.insertBefore(voiceNamingDiv, voiceActions);
                            console.log('Voice naming input created and inserted');
                        }
                    }
                    
                    // Try to find the input field again after showing the preview
                    setTimeout(() => {
                        const voiceNameInputAfter = document.getElementById('voiceName');
                        const voiceNamingDivAfter = document.querySelector('.voice-naming');
                        console.log('Voice name input after timeout:', voiceNameInputAfter);
                        console.log('Voice naming div after timeout:', voiceNamingDivAfter);
                        
                        // Check if the elements exist in the DOM at all
                        const allInputs = document.querySelectorAll('input');
                        const allVoiceNamingDivs = document.querySelectorAll('.voice-naming');
                        console.log('All inputs in DOM:', allInputs);
                        console.log('All voice-naming divs in DOM:', allVoiceNamingDivs);
                        
                        if (voiceNameInputAfter) {
                            console.log('Input field found after timeout!');
                        } else {
                            console.error('Input field still not found after timeout');
                        }
                    }, 100);
                } else {
                    console.error('Audio preview elements not found');
                }
                
                // Update UI
                const recordBtn = document.getElementById('recordBtn');
                const stopBtn = document.getElementById('stopBtn');
                const recordingStatus = document.getElementById('recordingStatus');
                
                if (recordBtn) {
                    recordBtn.style.display = 'none';
                }
                if (stopBtn) {
                    stopBtn.style.display = 'none';
                }
                if (recordingStatus) {
                    recordingStatus.textContent = 'Recording complete! Enter a name and save.';
                }
            };

            this.mediaRecorder.start();
            
            // Update UI
            const recordBtn = document.getElementById('recordBtn');
            const stopBtn = document.getElementById('stopBtn');
            const recordingStatus = document.getElementById('recordingStatus');
            
            if (recordBtn) {
                recordBtn.style.display = 'none';
            }
            if (stopBtn) {
                stopBtn.style.display = 'block';
            }
            if (recordingStatus) {
                recordingStatus.textContent = 'Recording... Speak now!';
            }
            
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Error accessing microphone. Please check permissions.');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            
            // Stop all tracks
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    async saveVoice() {
        if (!this.recordingState || !this.recordingState.audioBlob) {
            alert('No recording to save. Please record a voice first.');
            return;
        }

        const voiceNameInput = document.getElementById('voiceName');
        console.log('Voice name input element:', voiceNameInput);
        if (!voiceNameInput) {
            alert('Voice name input not found. Please try again.');
            return;
        }
        
        const voiceName = voiceNameInput.value.trim();
        if (!voiceName) {
            alert('Please enter a name for your voice.');
            return;
        }

        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const idToken = await user.getIdToken();
            const formData = new FormData();
            
            // Determine file extension based on MIME type
            let fileExtension = 'webm'; // Default
            if (this.recordingState.audioBlob.type.includes('mp4')) {
                fileExtension = 'mp4';
            } else if (this.recordingState.audioBlob.type.includes('ogg')) {
                fileExtension = 'ogg';
            } else if (this.recordingState.audioBlob.type.includes('wav')) {
                fileExtension = 'wav';
            }
            
            console.log('Saving voice with MIME type:', this.recordingState.audioBlob.type);
            console.log('Using file extension:', fileExtension);
            
            formData.append('voice', this.recordingState.audioBlob, `voice.${fileExtension}`);
            formData.append('name', voiceName);
            formData.append('duration', this.recordingState.duration || 0);

            const response = await fetch(`${config.api.baseUrl}/api/upload-voice`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                },
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                
                // Update project data with the new voice
                this.projectData.voiceUrl = result.voiceUrl;
                this.projectData.voiceId = result.voiceId;
                this.projectData.voiceName = result.name;

                // Reload voices list to include the new voice
                await this.loadUserVoices();

                // Show success and go to selected voice view
                const newVoice = {
                    id: result.voiceId,
                    name: result.name,
                    url: result.voiceUrl,
                    duration: this.recordingState.duration || 0
                };
                this.showSelectedVoice(newVoice);
                this.validateStep2();

                // Show success message
                alert(`Voice "${result.name}" saved successfully!`);
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save voice');
            }
        } catch (error) {
            console.error('Error saving voice:', error);
            alert('Error saving voice: ' + error.message);
        }
    }

    retryRecording() {
        const audioPreview = document.getElementById('audioPreview');
        const recordBtn = document.getElementById('recordBtn');
        const recordingStatus = document.getElementById('recordingStatus');
        
        if (audioPreview) {
            audioPreview.style.display = 'none';
        }
        if (recordBtn) {
            recordBtn.style.display = 'block';
        }
        if (recordingStatus) {
            recordingStatus.textContent = '';
        }
        
        this.projectData.voiceFile = null;
    }

    /**
     * Step 3: Avatar Upload
     */
    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.style.borderColor = '#c084fc';
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.handleFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.handleFile(file);
        }
    }

    handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        this.projectData.avatarFile = file;
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewImg = document.getElementById('previewImg');
            const imagePreview = document.getElementById('imagePreview');
            const uploadArea = document.getElementById('uploadArea');
            
            if (previewImg) previewImg.src = e.target.result;
            if (imagePreview) imagePreview.style.display = 'block';
            if (uploadArea) uploadArea.style.display = 'none';
        };
        reader.readAsDataURL(file);
        
        this.validateStep3();
    }

    async saveAvatar() {
        if (this.projectData.avatarFile) {
            try {
                // Save avatar file to Firebase Storage
                const user = getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const idToken = await user.getIdToken();
                const formData = new FormData();
                formData.append('avatar', this.projectData.avatarFile);
                formData.append('projectId', this.projectData.projectId || 'temp');

                const response = await fetch(`${config.api.baseUrl}/api/upload-avatar`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: formData
                });

                if (response.ok) {
                    const result = await response.json();
                    this.projectData.avatarUrl = result.avatarUrl;
                    console.log('Avatar saved:', result.avatarUrl);
                }
            } catch (error) {
                console.error('Error saving avatar:', error);
            }
        }
    }

    retryUpload() {
        const imagePreview = document.getElementById('imagePreview');
        const uploadArea = document.getElementById('uploadArea');
        
        if (imagePreview) {
            imagePreview.style.display = 'none';
        }
        if (uploadArea) {
            uploadArea.style.display = 'block';
        }
        
        this.projectData.avatarFile = null;
    }

    /**
     * Step 4: Twitch API Connection
     */
    async connectToTwitch() {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionResult = document.getElementById('connectionResult');
        const connectionError = document.getElementById('connectionError');
        
        try {
            // Check if user has Twitch connection
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // Check if user has Twitch connection
            // For Twitch users, the UID typically starts with 'twitch:' or contains Twitch info
            const hasTwitch = user.uid.startsWith('twitch:') || 
                             user.providerData.some(provider => 
                                 provider.providerId === 'oidc.twitch' || 
                                 provider.providerId === 'twitch.tv' ||
                                 provider.providerId === 'twitch.com'
                             );

            if (!hasTwitch) {
                // User doesn't have Twitch connected, initiate OAuth flow
                // Store current wizard state so we can resume after OAuth
                sessionStorage.setItem('projectWizardState', JSON.stringify({
                    currentStep: this.currentStep,
                    projectData: this.projectData,
                    wizardId: this.wizardId
                }));
                
                const { signInWithTwitch } = await import('./firebase.js');
                await signInWithTwitch();
                return; // This will redirect to Twitch, so we return here
            }

            // Create EventSub subscription
            const idToken = await user.getIdToken();
            const response = await fetch(`${config.api.baseUrl}/api/twitch-eventsub`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: this.projectData.eventType,
                    version: '2',
                    condition: {
                        broadcaster_user_id: user.uid.replace('twitch:', '')
                    }
                    // Note: projectId will be associated when the project is saved
                })
            });

            if (response.ok) {
                const result = await response.json();
                // Store subscription info for display purposes only
                this.projectData.subscriptionInfo = result.subscription;
                
                // Show success
                if (connectionStatus) connectionStatus.style.display = 'none';
                if (connectionResult) connectionResult.style.display = 'block';
                
                const subscriptionDetails = document.getElementById('subscriptionDetails');
                if (subscriptionDetails) {
                    subscriptionDetails.innerHTML = `
                        <h4>Subscription Details:</h4>
                        <p><strong>Type:</strong> ${result.subscription.type}</p>
                        <p><strong>Status:</strong> ${result.subscription.status}</p>
                        <p><strong>ID:</strong> ${result.subscription.id}</p>
                        <p><strong>Message:</strong> ${result.message}</p>
                    `;
                }
            } else {
                const errorData = await response.json();
                
                // Handle specific case where Twitch token is missing
                if (errorData.code === 'TWITCH_TOKEN_MISSING') {
                    // User needs to reconnect their Twitch account
                    // Store current wizard state so we can resume after OAuth
                    sessionStorage.setItem('projectWizardState', JSON.stringify({
                        currentStep: this.currentStep,
                        projectData: this.projectData,
                        wizardId: this.wizardId
                    }));
                    
                    const { signInWithTwitch } = await import('./firebase.js');
                    await signInWithTwitch();
                    return; // This will redirect to Twitch, so we return here
                }
                
                throw new Error(errorData.error || 'Failed to create Twitch subscription');
            }
            
        } catch (error) {
            console.error('Twitch connection error:', error);
            
            if (connectionStatus) connectionStatus.style.display = 'none';
            if (connectionError) connectionError.style.display = 'block';
            
            const errorMessage = document.querySelector('.error-message');
            if (errorMessage) errorMessage.textContent = error.message;
        }
    }

    retryConnection() {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionResult = document.getElementById('connectionResult');
        const connectionError = document.getElementById('connectionError');
        
        if (connectionStatus) connectionStatus.style.display = 'block';
        if (connectionResult) connectionResult.style.display = 'none';
        if (connectionError) connectionError.style.display = 'none';
        
        this.connectToTwitch();
    }

    /**
     * Load user's voices directly from Firestore
     */
    async loadUserVoices() {
        try {
            const user = getCurrentUser();
            if (!user) {
                console.log('No user found, skipping voice loading');
                return;
            }

            console.log('Loading voices for user:', user.uid);
            console.log('Current step:', this.currentStep);
            console.log('Voice management element exists:', !!document.getElementById('voiceManagement'));
        console.log('Current page URL:', window.location.href);
        console.log('Project wizard element exists:', !!document.getElementById('projectWizard'));
        console.log('Project wizard element display:', document.getElementById('projectWizard')?.style.display);
        console.log('Voice cloning element exists:', !!document.getElementById('voiceCloner'));
        console.log('Voice cloning element display:', document.getElementById('voiceCloner')?.style.display);

            // Import Firestore functions from our firebase module
            const { db, collection, query, where, getDocs } = await import('./firebase.js');
            
            // Query voices collection directly
            const voicesRef = collection(db, 'voices');
            const q = query(voicesRef, where('userId', '==', user.uid));
            const snapshot = await getDocs(q);

            console.log('Voice query snapshot:', snapshot);
            console.log('Number of voices found:', snapshot.size);

            this.userVoices = [];
            snapshot.forEach(doc => {
                const voiceData = doc.data();
                console.log('Voice data:', voiceData);
                this.userVoices.push({
                    id: doc.id,
                    name: voiceData.name || 'Unnamed Voice',
                    url: voiceData.url,
                    duration: voiceData.duration || 0,
                    createdAt: voiceData.createdAt,
                    updatedAt: voiceData.updatedAt
                });
            });

            // Sort by creation date (newest first)
            this.userVoices.sort((a, b) => {
                if (!a.createdAt || !b.createdAt) return 0;
                return b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime();
            });

            this.renderVoiceList();
        } catch (error) {
            console.error('Error loading voices:', error);
            this.userVoices = [];
            this.renderVoiceList();
        }
    }

    /**
     * Render the voice list
     */
    renderVoiceList() {
        const voiceList = document.getElementById('voiceList');
        const voiceManagement = document.getElementById('voiceManagement');
        const voiceSelection = document.getElementById('voiceSelection');
        
        console.log('Rendering voice list, voiceList element:', voiceList);
        console.log('Voice management element:', voiceManagement);
        console.log('Voice selection element:', voiceSelection);
        console.log('User voices:', this.userVoices);
        
        if (!voiceList) {
            console.error('voiceList element not found');
        console.log('Available elements with "voice" in ID:', 
            Array.from(document.querySelectorAll('[id*="voice"]')).map(el => el.id));
        console.log('All elements with "project" in ID:', 
            Array.from(document.querySelectorAll('[id*="project"]')).map(el => el.id));
        console.log('All elements with "wizard" in ID:', 
            Array.from(document.querySelectorAll('[id*="wizard"]')).map(el => el.id));
            return;
        }

        if (this.userVoices.length === 0) {
            voiceList.innerHTML = '<div class="loading-voices">No voices found. Record your first voice!</div>';
            console.log('No voices found, showing empty state');
            
            // Hide voice selection and show voice recorder when no voices exist
            if (voiceSelection) {
                voiceSelection.style.display = 'none';
            }
            const voiceRecorder = document.getElementById('voiceRecorder');
            if (voiceRecorder) {
                voiceRecorder.style.display = 'block';
            }
            return;
        }
        
        // Show voice selection when voices exist
        if (voiceSelection) {
            voiceSelection.style.display = 'block';
        }
        const voiceRecorder = document.getElementById('voiceRecorder');
        if (voiceRecorder) {
            voiceRecorder.style.display = 'none';
        }

        voiceList.innerHTML = this.userVoices.map(voice => `
            <div class="voice-card" onclick="projectWizard.selectVoice('${voice.id}')" data-voice-id="${voice.id}">
                <div class="voice-info">
                    <div class="voice-name">${voice.name}</div>
                    <div class="voice-duration">${this.formatDuration(voice.duration)}</div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Select a voice
     */
    async selectVoice(voiceId) {
        const voice = this.userVoices.find(v => v.id === voiceId);
        if (!voice) return;

        // Show loading state
        this.showVoiceLoading(voiceId);

        // Update selected voice in project data
        this.projectData.voiceUrl = voice.url;
        this.projectData.voiceId = voice.id;
        this.projectData.voiceName = voice.name;

        // Load and show the selected voice with audio player
        await this.loadAndShowSelectedVoice(voice);
        this.validateStep2();
    }

    /**
     * Show loading state for voice selection
     */
    showVoiceLoading(voiceId) {
        const voiceCard = document.querySelector(`[data-voice-id="${voiceId}"]`);
        if (voiceCard) {
            // Add loading class to the voice card
            voiceCard.classList.add('loading');
            
            // Add loading indicator to the voice name
            const voiceName = voiceCard.querySelector('.voice-name');
            if (voiceName) {
                voiceName.innerHTML = `${voiceName.textContent} <span class="voice-loading">(Loading...)</span>`;
            }
        }
    }

    /**
     * Clear loading state for voice selection
     */
    clearVoiceLoading(voiceId) {
        const voiceCard = document.querySelector(`[data-voice-id="${voiceId}"]`);
        if (voiceCard) {
            // Remove loading class
            voiceCard.classList.remove('loading');
            
            // Remove loading indicator from voice name
            const voiceName = voiceCard.querySelector('.voice-name');
            if (voiceName) {
                // Extract just the voice name without the loading text
                const voice = this.userVoices.find(v => v.id === voiceId);
                if (voice) {
                    voiceName.textContent = voice.name;
                }
            }
        }
    }

    /**
     * Load and show selected voice with audio player
     */
    async loadAndShowSelectedVoice(voice) {
        console.log('Loading and showing selected voice:', voice);
        
        // Hide voice selection and recorder
        const voiceSelection = document.getElementById('voiceSelection');
        const voiceRecorder = document.getElementById('voiceRecorder');
        
        if (voiceSelection) voiceSelection.style.display = 'none';
        if (voiceRecorder) voiceRecorder.style.display = 'none';

        // Show selected voice section
        const selectedVoice = document.getElementById('selectedVoice');
        const selectedVoiceName = document.getElementById('selectedVoiceName');
        const selectedVoiceDuration = document.getElementById('selectedVoiceDuration');
        const selectedVoiceAudio = document.getElementById('selectedVoiceAudio');
        
        if (selectedVoiceName) selectedVoiceName.textContent = voice.name;
        if (selectedVoiceDuration) selectedVoiceDuration.textContent = this.formatDuration(voice.duration);
        
        // Create and load audio player
        if (selectedVoiceAudio) {
            try {
                // Clear any previous sources
                selectedVoiceAudio.innerHTML = '';
                
                // Determine MIME type based on file extension
                let mimeType = 'audio/webm'; // Default
                if (voice.url.includes('.mp4')) {
                    mimeType = 'audio/mp4';
                } else if (voice.url.includes('.ogg')) {
                    mimeType = 'audio/ogg';
                } else if (voice.url.includes('.wav')) {
                    mimeType = 'audio/wav';
                } else if (voice.url.includes('.webm')) {
                    mimeType = 'audio/webm';
                }
                
                console.log('Loading audio with MIME type:', mimeType, 'for URL:', voice.url);
                
                // Add the correct source format
                const source = document.createElement('source');
                source.src = voice.url;
                source.type = mimeType;
                selectedVoiceAudio.appendChild(source);
                
                // Add fallback text
                selectedVoiceAudio.appendChild(document.createTextNode('Your browser does not support the audio element.'));
                
                // Add loading event listeners
                selectedVoiceAudio.addEventListener('loadstart', () => {
                    console.log('Audio loading started for selected voice:', voice.url);
                });
                
                selectedVoiceAudio.addEventListener('canplay', () => {
                    console.log('Audio can play for selected voice');
                    // Remove loading state
                    this.clearVoiceLoading(voice.id);
                });
                
                selectedVoiceAudio.addEventListener('error', (e) => {
                    console.error('Audio loading error for selected voice:', e, selectedVoiceAudio.error);
                    console.error('Audio URL:', voice.url);
                    console.error('Error details:', {
                        code: selectedVoiceAudio.error?.code,
                        message: selectedVoiceAudio.error?.message
                    });
                    this.handleAudioError(selectedVoiceAudio, 'selected');
                    this.clearVoiceLoading(voice.id);
                });
                
                // Force load the audio
                selectedVoiceAudio.load();
                
            } catch (error) {
                console.error('Error setting up audio player:', error);
                this.clearVoiceLoading(voice.id);
            }
        }
        
        if (selectedVoice) selectedVoice.style.display = 'block';

        // Update voice cards to show selection
        document.querySelectorAll('.voice-card').forEach(card => {
            card.classList.remove('selected', 'loading');
            if (card.dataset.voiceId === voice.id) {
                card.classList.add('selected');
                // Update the voice name to show it's selected
                const voiceName = card.querySelector('.voice-name');
                if (voiceName) {
                    voiceName.innerHTML = `${voice.name} <span class="voice-selected">✓</span>`;
                }
            }
        });
    }

    /**
     * Show selected voice (legacy method for compatibility)
     */
    showSelectedVoice(voice) {
        // This method is kept for compatibility but now calls the new method
        this.loadAndShowSelectedVoice(voice);
    }

    /**
     * Start new recording
     */
    startNewRecording() {
        const voiceSelection = document.getElementById('voiceSelection');
        const selectedVoice = document.getElementById('selectedVoice');
        const voiceRecorder = document.getElementById('voiceRecorder');
        
        if (voiceSelection) voiceSelection.style.display = 'none';
        if (selectedVoice) selectedVoice.style.display = 'none';
        if (voiceRecorder) voiceRecorder.style.display = 'block';
        
        // Reset recording state
        this.recordingState = {
            isRecording: false,
            mediaRecorder: null,
            audioChunks: [],
            audioBlob: null
        };
    }

    /**
     * Cancel recording and go back to voice selection
     */
    cancelRecording() {
        const voiceRecorder = document.getElementById('voiceRecorder');
        const voiceSelection = document.getElementById('voiceSelection');
        
        if (voiceRecorder) voiceRecorder.style.display = 'none';
        
        // If user has voices, show voice selection, otherwise keep recorder visible
        if (this.userVoices && this.userVoices.length > 0) {
            if (voiceSelection) voiceSelection.style.display = 'block';
        } else {
            // No voices exist, keep recorder visible
            if (voiceRecorder) voiceRecorder.style.display = 'block';
        }
        
        // Reset recording state
        this.recordingState = {
            isRecording: false,
            mediaRecorder: null,
            audioChunks: [],
            audioBlob: null
        };
    }

    /**
     * Change voice (go back to selection)
     */
    changeVoice() {
        const selectedVoice = document.getElementById('selectedVoice');
        const voiceSelection = document.getElementById('voiceSelection');
        
        if (selectedVoice) selectedVoice.style.display = 'none';
        
        // Reset all voice cards to their original state
        document.querySelectorAll('.voice-card').forEach(card => {
            card.classList.remove('selected', 'loading');
            const voiceName = card.querySelector('.voice-name');
            if (voiceName) {
                // Reset to just the voice name
                const voiceId = card.dataset.voiceId;
                const voice = this.userVoices.find(v => v.id === voiceId);
                if (voice) {
                    voiceName.textContent = voice.name;
                }
            }
        });
        
        // If user has voices, show voice selection, otherwise show recorder
        if (this.userVoices && this.userVoices.length > 0) {
            if (voiceSelection) voiceSelection.style.display = 'block';
        } else {
            // No voices exist, show recorder
            const voiceRecorder = document.getElementById('voiceRecorder');
            if (voiceRecorder) voiceRecorder.style.display = 'block';
        }
        
        // Clear selected voice
        this.projectData.voiceUrl = null;
        this.projectData.voiceId = null;
        this.projectData.voiceName = null;
        
        this.validateStep2();
    }

    /**
     * Handle audio loading errors
     */
    handleAudioError(audioElement, voiceId) {
        const error = audioElement.error;
        console.error('Audio loading error for voice:', voiceId, error);
        
        // Log detailed error information
        if (error) {
            const errorMessages = {
                1: 'MEDIA_ERR_ABORTED - The user aborted the loading of the audio',
                2: 'MEDIA_ERR_NETWORK - A network error occurred while loading the audio',
                3: 'MEDIA_ERR_DECODE - An error occurred while decoding the audio',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - The audio format is not supported'
            };
            
            console.error('Error code:', error.code);
            console.error('Error message:', errorMessages[error.code] || 'Unknown error');
            console.error('Audio sources:', Array.from(audioElement.querySelectorAll('source')).map(s => s.src));
        }
        
        // Show error message in the selected voice section
        const selectedVoice = document.getElementById('selectedVoice');
        if (selectedVoice) {
            let errorMsg = selectedVoice.querySelector('.audio-error');
            if (!errorMsg) {
                errorMsg = document.createElement('div');
                errorMsg.className = 'audio-error';
                errorMsg.style.color = '#ff6b6b';
                errorMsg.style.fontSize = '0.9rem';
                errorMsg.style.marginTop = '1rem';
                errorMsg.style.padding = '0.5rem';
                errorMsg.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
                errorMsg.style.borderRadius = '4px';
                errorMsg.style.border = '1px solid rgba(255, 107, 107, 0.3)';
                selectedVoice.appendChild(errorMsg);
            }
            
            if (error && error.code === 4) {
                errorMsg.innerHTML = '❌ Audio format not supported. Please try a different voice or contact support.';
            } else {
                errorMsg.innerHTML = '❌ Audio playback error. Please try again or select a different voice.';
            }
        }
    }

    /**
     * Handle audio loading start
     */
    handleAudioLoadStart(audioElement, voiceId) {
        console.log('Audio loading started for voice:', voiceId);
        // Remove any existing error messages
        const existingError = audioElement.parentNode.querySelector('.audio-error');
        if (existingError) {
            existingError.remove();
        }
    }

    /**
     * Test if an audio URL is accessible
     */
    async testAudioUrl(url, index) {
        try {
            console.log(`Testing audio URL ${index}:`, url);
            const response = await fetch(url, { method: 'HEAD' });
            console.log(`Audio URL ${index} response:`, response.status, response.statusText);
            
            if (!response.ok) {
                console.error(`Audio URL ${index} is not accessible:`, response.status);
            }
        } catch (error) {
            console.error(`Error testing audio URL ${index}:`, error);
        }
    }

    /**
     * Manually set audio source for debugging
     */
    setAudioSource(audioElement, url) {
        console.log('Setting audio source:', url);
        audioElement.src = url;
        audioElement.load();
    }

    /**
     * Format duration in seconds to readable format
     */
    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0s';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    /**
     * Get default project name based on event type
     */
    getDefaultProjectName(eventType) {
        const eventNames = {
            'channel.follow': 'Follow',
            'channel.subscribe': 'Subscribe',
            'channel.cheer': 'Cheer',
            'channel.bits.use': 'Bits Use',
            'channel.raid': 'Raid'
        };
        
        const eventName = eventNames[eventType] || eventType.replace('channel.', '').replace('_', ' ');
        return `My ${eventName} Alert`;
    }

    /**
     * Step 5: Content Generation
     */
    async generateContent() {
        const generationStatus = document.getElementById('generationStatus');
        const generationResult = document.getElementById('generationResult');
        
        try {
            // Simulate content generation
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Show result
            if (generationStatus) generationStatus.style.display = 'none';
            if (generationResult) generationResult.style.display = 'block';
            
            // Show project URL - use Firebase UID only
            const projectUrl = document.getElementById('projectUrl');
            const projectUrlInput = document.getElementById('projectUrlInput');
            if (projectUrl && projectUrlInput) {
                const user = getCurrentUser();
                let projectUrlValue;
                
                if (user && user.uid) {
                    // Use Firebase UID as the identifier for all user's projects
                    projectUrlValue = `${window.location.origin}/twitchevent.html#${user.uid}`;
                } else {
                    // Fallback to a temporary ID if user is not authenticated
                    const tempId = `temp_${Date.now()}`;
                    projectUrlValue = `${window.location.origin}/twitchevent.html#${tempId}`;
                }
                
                projectUrlInput.value = projectUrlValue;
                projectUrl.style.display = 'block';
            }
            
        } catch (error) {
            console.error('Content generation error:', error);
        }
    }

    async saveVideoUrl() {
        const videoUrl = document.getElementById('videoUrl');
        if (!videoUrl || !videoUrl.value.trim()) {
            alert('Please enter a video URL');
            return;
        }

        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // Save directly to Firestore
            const { db, doc, updateDoc } = await import('./firebase.js');
            if (!this.projectData.projectId) {
                throw new Error('Project ID missing. Save the project first.');
            }
            const projectRef = doc(db, 'projects', this.projectData.projectId);
            await updateDoc(projectRef, {
                videoUrl: videoUrl.value.trim(),
                updatedAt: new Date()
            });

            this.projectData.videoUrl = videoUrl.value.trim();
            console.log('Video URL saved directly to Firestore');
        } catch (error) {
            console.error('Error saving video URL:', error);
            alert('Error saving video URL: ' + error.message);
        }
    }

    copyProjectUrl() {
        const projectUrlInput = document.getElementById('projectUrlInput');
        if (projectUrlInput) {
            projectUrlInput.select();
            document.execCommand('copy');
            alert('Project URL copied to clipboard!');
        }
    }

    /**
     * Finish Wizard
     */
    async finishWizard() {
        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // Create project directly in Firestore
            const { db, addDoc, collection } = await import('./firebase.js');
            const projectData = {
                userId: user.uid,
                platform: this.projectData.platform,
                projectName: this.projectData.projectName,
                eventType: this.projectData.eventType,
                voiceUrl: this.projectData.voiceUrl || null,
                voiceId: this.projectData.voiceId || null,
                voiceName: this.projectData.voiceName || null,
                avatarFile: this.projectData.avatarFile || null,
                avatarUrl: this.projectData.avatarUrl || null,
                videoUrl: this.projectData.videoUrl || null,
                alertConfig: this.projectData.alertConfig || {},
                twitchSubscription: this.projectData.twitchSubscription || null,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const projectsRef = collection(db, 'projects');
            const createdRef = await addDoc(projectsRef, projectData);
            this.projectData.projectId = createdRef.id;

            // Update the project URL with the user's UID (not project ID)
            const projectUrl = document.getElementById('projectUrl');
            const projectUrlInput = document.getElementById('projectUrlInput');
            if (projectUrl && projectUrlInput) {
                const projectUrlValue = `${window.location.origin}/twitchevent.html#${user.uid}`;
                projectUrlInput.value = projectUrlValue;
                projectUrl.style.display = 'block';
            }

            if (this.options.onComplete) {
                this.options.onComplete(this.projectData);
            }

            alert('Project saved successfully!');
        } catch (error) {
            console.error('Error finishing wizard:', error);
            alert('Error creating project: ' + error.message);
        }
    }

    /**
     * Cancel wizard
     */
    cancel() {
        if (this.options.onCancel) {
            this.options.onCancel();
        }
    }

    /**
     * Destroy the wizard
     */
    destroy() {
        const container = document.getElementById(this.options.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clean up global reference
        if (window.projectWizard === this) {
            delete window.projectWizard;
        }
    }
}

// Global functions for HTML onclick handlers
window.startNewRecording = function() {
    if (window.projectWizard) {
        window.projectWizard.startNewRecording();
    }
};

window.cancelRecording = function() {
    if (window.projectWizard) {
        window.projectWizard.cancelRecording();
    }
};

window.changeVoice = function() {
    if (window.projectWizard) {
        window.projectWizard.changeVoice();
    }
};

window.saveVoice = function() {
    if (window.projectWizard) {
        window.projectWizard.saveVoice();
    }
};

window.retryRecording = function() {
    if (window.projectWizard) {
        window.projectWizard.retryRecording();
    }
};

// Legacy functions for backward compatibility
export function initProjectWizard() {
    return showProjectWizard({
        containerId: 'projectWizard',
        mode: 'create',
        onComplete: (projectData) => {
            // Hide wizard and show recent projects
            document.getElementById('projectWizard').style.display = 'none';
            document.getElementById('recentProjects').style.display = 'block';
            
            // Load recent projects
            loadRecentProjects();
        }
    });
}

// Load Recent Projects
async function loadRecentProjects() {
    try {
        const user = getCurrentUser();
        if (!user) return;

        const idToken = await user.getIdToken();
        const response = await fetch(`${config.api.baseUrl}/api/recent-projects`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            renderRecentProjects(data.projects);
        }
    } catch (error) {
        console.error('Error loading recent projects:', error);
    }
}

function renderRecentProjects(projects) {
    const projectsGrid = document.getElementById('projectsGrid');
    
    if (!projects || projects.length === 0) {
        projectsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✨</div>
                <p>No projects yet. Create your first project to get started!</p>
            </div>
        `;
        return;
    }

    projectsGrid.innerHTML = projects.map(project => `
        <div class="project-card">
            <div class="project-name">${project.projectName}</div>
            <div class="project-platform">${project.platform.charAt(0).toUpperCase() + project.platform.slice(1)} - ${project.eventType}</div>
            <div class="project-actions">
                <button class="btn btn-primary" onclick="openProject('${project.projectId}')">Open</button>
                <button class="btn btn-secondary" onclick="copyProjectUrl('${project.projectId}')">Copy URL</button>
            </div>
        </div>
    `).join('');
}

// Start New Project
window.startNewProject = function() {
    // Reset wizard state
    if (projectWizard) {
        projectWizard.destroy();
    }

    // Reset UI
    document.getElementById('projectWizard').style.display = 'block';
    document.getElementById('recentProjects').style.display = 'none';
    
    // Initialize new wizard
    initProjectWizard();
};

window.openProject = function(projectId) {
    // Get the current user's UID for the URL since we listen for all user's projects
    const user = getCurrentUser();
    if (user && user.uid) {
        window.open(`/twitchevent.html#${user.uid}`, '_blank');
    } else {
        alert('Please log in to view your project');
    }
};

window.copyProjectUrl = function(projectId) {
    // Get the current user's UID for the URL since we listen for all user's projects
    const user = getCurrentUser();
    if (user && user.uid) {
        const url = `${window.location.origin}/twitchevent.html#${user.uid}`;
        navigator.clipboard.writeText(url).then(() => {
            alert('Project URL copied to clipboard!');
        });
    } else {
        alert('Please log in to copy your project URL');
    }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only auto-initialize if we're on the dashboard page
    if (document.getElementById('projectWizard') && !document.getElementById('projectsGrid')) {
        initProjectWizard();
    }
});