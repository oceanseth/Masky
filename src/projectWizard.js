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
            platform: 'twitch', // Default to Twitch
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
        this.userAvatars = [];
        this.avatarGroups = [];
        
        // Dirty flags to track changes that need to be persisted
        this.dirtyFlags = {
            commandTrigger: false,
            voice: false,
            avatar: false
        };
    }

    /**
     * Initialize the wizard
     */
    init() {
        this.render();
        this.setupEventListeners();
        this.setDefaultValues();
        this.updateNavigationButtons();
        
        // Resume wizard state after Twitch OAuth popup
        const storedStateRaw = sessionStorage.getItem('projectWizardState');
        if (storedStateRaw) {
            try {
                const stored = JSON.parse(storedStateRaw);
                if (stored && stored.projectData) {
                    this.projectData = stored.projectData;
                    this.currentStep = stored.currentStep || this.currentStep;
                    this.showStep(this.currentStep);
                    this.updateNavigationButtons();
                }
            } catch (e) {
                console.error('Failed to parse stored wizard state:', e);
            }
        }

        // Listen for OAuth popup success and resume Step 4 seamlessly
        window.addEventListener('message', (event) => {
            if (!event || !event.data) return;
            if (event.data.type === 'TWITCH_OAUTH_SUCCESS') {
                // Restore saved state
                const stateRaw = sessionStorage.getItem('projectWizardState');
                if (stateRaw) {
                    try {
                        const saved = JSON.parse(stateRaw);
                        if (saved && saved.projectData) {
                            this.projectData = saved.projectData;
                            this.currentStep = saved.currentStep || 4;
                        }
                    } catch (e) {
                        console.error('Failed to parse saved wizard state after OAuth:', e);
                    }
                }
                this.showStep(4);
                this.updateNavigationButtons();
                sessionStorage.removeItem('projectWizardState');
                this.connectToTwitch();
            }
        });
        
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
                    <div class="wizard-header-content">
                        <div>
                            <h2 class="section-title">${this.options.mode === 'edit' ? 'Edit Project' : 'New Project Wizard'}</h2>
                            <p class="wizard-subtitle">${this.options.mode === 'edit' ? 'Update your project settings' : 'Create your first AI-powered stream alert in 5 simple steps'}</p>
                        </div>
                        <button class="wizard-close-btn" onclick="projectWizard.close()" title="Close Wizard">×</button>
                    </div>
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
                                    <option value="twitch" selected>Twitch</option>
                                    <option value="youtube" disabled>YouTube (Coming Soon)</option>
                                    <option value="facebook" disabled>Facebook (Coming Soon)</option>
                                    <option value="instagram" disabled>Instagram (Coming Soon)</option>
                                    <option value="tiktok" disabled>TikTok (Coming Soon)</option>
                                    <option value="kick" disabled>Kick (Coming Soon)</option>
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
                                    <option value="channel.channel_points_custom_reward_redemption">Channel Points Redeem</option>
                                    <option value="channel.chat_command">Chat Command</option>
                                </select>
                            </div>
                            <div class="form-group" id="commandTriggerGroup" style="display: none;">
                                <label for="commandTriggerInput">Command Trigger (text after !maskyai):</label>
                                <input type="text" id="commandTriggerInput" class="form-input" placeholder="e.g., bacon">
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
                                <div class="avatar-library" id="avatarLibrary" style="margin-bottom: 16px;">
                                    <h4>Your Avatars</h4>
                                    <div id="avatarList" class="avatar-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px;"></div>
                                </div>
                                <div class="upload-area" id="uploadArea">
                                    <div class="upload-icon">📷</div>
                                    <p>Drag & drop an image here or click to browse</p>
                                    <input type="file" id="avatarFile" accept="image/*" style="display: none;">
                                </div>
                                <div class="image-preview" id="imagePreview" style="display: none;">
                                    <img id="previewImg" alt="Avatar preview">
                                    <div class="image-actions">
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
                                    <p class="result-message">Your AI avatar video is ready!</p>
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
                </div>
            </div>
        `;

        // Make this instance globally available for onclick handlers
        window.projectWizard = this;
    }


    /**
     * Set default values for form fields
     */
    setDefaultValues() {
        // Set default platform to Twitch
        const platformSelect = document.getElementById('platformSelect');
        if (platformSelect && !platformSelect.value) {
            platformSelect.value = 'twitch';
            this.projectData.platform = 'twitch';
        }
        
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
                
                // Show/hide command trigger field for chat commands
                const cmdGroup = document.getElementById('commandTriggerGroup');
                if (cmdGroup) {
                    cmdGroup.style.display = (e.target.value === 'channel.chat_command') ? 'block' : 'none';
                }
                
                this.validateStep1();
            });
        }

        // Command trigger input
        const commandTriggerInput = document.getElementById('commandTriggerInput');
        if (commandTriggerInput) {
            commandTriggerInput.addEventListener('input', (e) => {
                this.projectData.commandTrigger = e.target.value.trim();
                this.dirtyFlags.commandTrigger = true;
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
        const commandTriggerInput = document.getElementById('commandTriggerInput');

        if (platformSelect) platformSelect.value = this.projectData.platform || '';
        if (projectName) projectName.value = this.projectData.projectName || '';
        if (eventType) eventType.value = this.projectData.eventType || 'channel.follow';
        if (videoUrl) videoUrl.value = this.projectData.videoUrl || '';
        if (commandTriggerInput) commandTriggerInput.value = this.projectData.commandTrigger || '';
        
        // Ensure projectData has the correct values
        this.projectData.eventType = this.projectData.eventType || 'channel.follow';

        // Ensure command trigger group visibility matches current event type
        const cmdGroup = document.getElementById('commandTriggerGroup');
        if (cmdGroup) {
            cmdGroup.style.display = (this.projectData.eventType === 'channel.chat_command') ? 'block' : 'none';
        }

        // Reset dirty flags when loading existing data
        this.dirtyFlags.commandTrigger = false;
        this.dirtyFlags.voice = false;
        this.dirtyFlags.avatar = false;

        // Validate step 1
        this.validateStep1();
    }

    /**
     * Persist dirty fields to Firestore if in edit mode
     */
    async persistDirtyFields() {
        // Only persist if we're in edit mode and have a project ID
        if (this.options.mode !== 'edit' || !this.projectData.projectId) {
            return;
        }

        // Build update object with only dirty fields
        const updates = { updatedAt: new Date() };
        let hasUpdates = false;

        if (this.dirtyFlags.commandTrigger) {
            updates.commandTrigger = this.projectData.commandTrigger || null;
            hasUpdates = true;
        }

        if (this.dirtyFlags.voice) {
            updates.voiceUrl = this.projectData.voiceUrl || null;
            updates.voiceId = this.projectData.voiceId || null;
            updates.voiceName = this.projectData.voiceName || null;
            hasUpdates = true;
        }

        if (this.dirtyFlags.avatar) {
            updates.avatarUrl = this.projectData.avatarUrl || null;
            updates.avatarGroupId = this.projectData.avatarGroupId || null;
            updates.avatarAssetId = this.projectData.avatarAssetId || null;
            updates.avatarGroupName = this.projectData.avatarGroupName || null;
            hasUpdates = true;
        }

        // Only update if there are dirty fields
        if (hasUpdates) {
            try {
                const { db, doc, updateDoc } = await import('./firebase.js');
                const projectRef = doc(db, 'projects', this.projectData.projectId);
                await updateDoc(projectRef, updates);
                
                // Clear dirty flags after successful persistence
                if (this.dirtyFlags.commandTrigger) this.dirtyFlags.commandTrigger = false;
                if (this.dirtyFlags.voice) this.dirtyFlags.voice = false;
                if (this.dirtyFlags.avatar) this.dirtyFlags.avatar = false;
                
                console.log('Persisted dirty fields to project:', updates);
            } catch (error) {
                console.error('Error persisting dirty fields:', error);
                // Don't throw - allow navigation to continue
            }
        }
    }

    /**
     * Step Navigation
     */
    async nextStep() {
        if (this.validateCurrentStep()) {
            // Persist dirty fields before moving to next step
            await this.persistDirtyFields();
            
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
        } else if (stepNumber === 3) {
            // Load user's existing avatars when entering step 3
            this.loadUserAvatars();
        } else if (stepNumber === 4) {
            // Show chat bot info box if event type is chat command
            const chatBotInfo = document.getElementById('chatBotInfo');
            const isChatCommand = this.projectData.eventType === 'channel.chat_command';
            if (chatBotInfo) {
                chatBotInfo.style.display = isChatCommand ? 'block' : 'none';
            }
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
        const commandOk = (eventType !== 'channel.chat_command') || (this.projectData.commandTrigger && this.projectData.commandTrigger.trim().length > 0);

        // All three fields are required for step 1
        const isValid = platform && projectName && eventType && commandOk;
        
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
                this.dirtyFlags.voice = true;

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

            // Immediately upload and save the avatar; no separate confirmation button
            this.saveAvatar();
        };
        reader.readAsDataURL(file);
        
        this.validateStep3();
    }

    async saveAvatar() {
        if (!this.projectData.avatarFile) return;
        
        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // Ask user to select or create an avatar group
            const groupId = await this.promptForAvatarGroup();
            if (!groupId) {
                // User cancelled
                this.retryUpload();
                return;
            }

            // Upload directly to Firebase Storage
            const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
            const storage = getStorage();
            const fileExt = this.projectData.avatarFile.name.split('.').pop() || 'jpg';
            const objectPath = `avatars/avatar_${user.uid}_${Date.now()}.${fileExt}`;
            const storageRef = ref(storage, objectPath);
            await uploadBytes(storageRef, this.projectData.avatarFile, { 
                contentType: this.projectData.avatarFile.type || 'image/jpeg' 
            });
            const imageUrl = await getDownloadURL(storageRef);

            // Save asset to Firestore
            const { db, collection, addDoc, doc, updateDoc } = await import('./firebase.js');
            const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupId, 'assets');
            const assetDocRef = await addDoc(assetsRef, {
                url: imageUrl,
                fileName: this.projectData.avatarFile.name,
                userId: user.uid,
                createdAt: new Date()
            });
            const assetId = assetDocRef.id;
            
            // Update the group's avatarUrl
            await updateDoc(doc(db, 'users', user.uid, 'heygenAvatarGroups', groupId), { 
                avatarUrl: imageUrl, 
                updatedAt: new Date() 
            });

            // Call HeyGen API to add the look to the avatar group
            try {
                const idToken = await user.getIdToken();
                const resp = await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/add-look`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupDocId: groupId, assetId })
                });
                
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    console.warn('HeyGen add-look failed (non-critical):', err);
                }
            } catch (heygenErr) {
                console.warn('HeyGen integration failed (non-critical):', heygenErr);
            }

            // Reload avatars and auto-select the newly uploaded
            await this.loadUserAvatars();
            
            // Find and select the newly created asset
            const group = this.avatarGroups?.find(g => g.id === groupId);
            if (group) {
                const asset = group.assets.find(a => a.id === assetId);
                if (asset) {
                    this.selectAvatarAsset(groupId, assetId, imageUrl, group.displayName);
                }
            }
            
            console.log('Avatar uploaded successfully to group:', groupId);
        } catch (error) {
            console.error('Error saving avatar:', error);
            alert('Failed to upload avatar: ' + error.message);
            this.retryUpload();
        }
    }
    
    async promptForAvatarGroup() {
        // Show a modal to select existing group or create new one
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
            
            const content = document.createElement('div');
            content.style.cssText = 'background:#1a1a1a;border-radius:12px;padding:2rem;max-width:500px;width:90%;border:1px solid rgba(255,255,255,0.1);';
            
            const existingGroups = this.avatarGroups || [];
            
            content.innerHTML = `
                <h3 style="margin:0 0 1rem 0;color:#fff;">Select Avatar Group</h3>
                <p style="color:rgba(255,255,255,0.7);margin:0 0 1rem 0;font-size:0.9rem;">Choose an existing avatar group or create a new one.</p>
                
                ${existingGroups.length > 0 ? `
                    <div style="margin-bottom:1rem;">
                        <label style="color:rgba(255,255,255,0.9);display:block;margin-bottom:0.5rem;">Existing Groups:</label>
                        <select id="groupSelect" class="form-select" style="width:100%;padding:0.5rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;">
                            <option value="">-- Create New Group --</option>
                            ${existingGroups.map(g => `<option value="${g.id}">${this.escapeHtml(g.displayName)}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
                
                <div id="newGroupSection" style="${existingGroups.length > 0 ? 'display:none;' : ''}">
                    <label style="color:rgba(255,255,255,0.9);display:block;margin-bottom:0.5rem;">New Avatar Group Name:</label>
                    <input type="text" id="newGroupName" class="form-input" placeholder="e.g., My Character" style="width:100%;padding:0.5rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;margin-bottom:1rem;">
                </div>
                
                <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.5rem;">
                    <button class="btn btn-secondary" id="cancelBtn" style="padding:0.5rem 1rem;">Cancel</button>
                    <button class="btn btn-primary" id="confirmBtn" style="padding:0.5rem 1rem;">Confirm</button>
                </div>
            `;
            
            modal.appendChild(content);
            document.body.appendChild(modal);
            
            const groupSelect = content.querySelector('#groupSelect');
            const newGroupSection = content.querySelector('#newGroupSection');
            const newGroupInput = content.querySelector('#newGroupName');
            const cancelBtn = content.querySelector('#cancelBtn');
            const confirmBtn = content.querySelector('#confirmBtn');
            
            if (groupSelect) {
                groupSelect.addEventListener('change', () => {
                    if (newGroupSection) {
                        newGroupSection.style.display = groupSelect.value ? 'none' : 'block';
                    }
                });
            }
            
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
            
            confirmBtn.addEventListener('click', async () => {
                let selectedGroupId = groupSelect?.value;
                
                if (!selectedGroupId) {
                    // Create new group
                    const groupName = newGroupInput?.value?.trim();
                    if (!groupName) {
                        alert('Please enter a name for the new avatar group');
                        return;
                    }
                    
                    try {
                        const user = getCurrentUser();
                        const { db, collection, addDoc } = await import('./firebase.js');
                        const groupsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups');
                        const ref = await addDoc(groupsRef, {
                            userId: user.uid,
                            displayName: groupName,
                            createdAt: new Date()
                        });
                        selectedGroupId = ref.id;
                        
                        // Initialize HeyGen group
                        try {
                            const idToken = await user.getIdToken();
                            await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/init`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ groupDocId: selectedGroupId, displayName: groupName })
                            });
                        } catch (e) {
                            console.warn('Failed to init HeyGen group (non-critical):', e);
                        }
                    } catch (error) {
                        console.error('Failed to create avatar group:', error);
                        alert('Failed to create avatar group: ' + error.message);
                        return;
                    }
                }
                
                document.body.removeChild(modal);
                resolve(selectedGroupId);
            });
        });
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
                // User doesn't have Twitch connected, initiate popup OAuth flow
                const { signInWithTwitch } = await import('./firebase.js');
                
                try {
                    // Show loading state
                    if (connectionStatus) {
                        connectionStatus.innerHTML = `
                            <div class="status-icon">🔗</div>
                            <p>Opening Twitch authentication...</p>
                        `;
                    }
                    
                    console.log('Starting Twitch popup authentication...');
                    
                    // Sign in with Twitch using popup
                    const user = await signInWithTwitch();
                    
                    // User is now authenticated, continue with EventSub subscription
                    console.log('Twitch authentication successful:', user);
                    
                } catch (error) {
                    console.error('Twitch authentication failed:', error);
                    console.error('Error details:', {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    });
                    
                    // Show error in the connection UI
                    if (connectionStatus) connectionStatus.style.display = 'none';
                    if (connectionError) connectionError.style.display = 'block';
                    
                    const errorMessage = document.querySelector('.error-message');
                    if (errorMessage) errorMessage.textContent = error.message;
                    return;
                }
            }

            // For chat commands, ensure chatbot instead of EventSub
            const currentUser = getCurrentUser();
            if (!currentUser) throw new Error('User not authenticated');
            
            const idToken = await currentUser.getIdToken();
            if (this.projectData.eventType === 'channel.chat_command') {
                // Ensure chatbot via user token
                const connectionError = document.getElementById('connectionError');
                const response = await fetch(`${config.api.baseUrl}/api/twitch-chatbot-ensure`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({})
                });

                if (response.ok) {
                    const result = await response.json();
                    // Hide any previous error messages
                    if (connectionError) connectionError.style.display = 'none';
                    
                    // Treat as connected
                    if (connectionStatus) connectionStatus.style.display = 'none';
                    if (connectionResult) connectionResult.style.display = 'block';
                    const subscriptionDetails = document.getElementById('subscriptionDetails');
                    if (subscriptionDetails) {
                        let detailsHtml = `
                            <h4>Chat Bot Status:</h4>
                            <p><strong>Established:</strong> ${result.chatbotEstablished ? 'Yes' : 'No'}</p>
                        `;
                        if (result.subscription) {
                            detailsHtml += `
                                <p><strong>Subscription ID:</strong> ${result.subscription.id}</p>
                                <p><strong>Status:</strong> ${result.subscription.status}</p>
                            `;
                        }
                        detailsHtml += `<p><strong>Note:</strong> Chat commands are handled via the chat bot connection.</p>`;
                        subscriptionDetails.innerHTML = detailsHtml;
                    }
                    return;
                } else {
                    const errorData = await response.json();
                    
                    // Handle bot account authorization error
                    if (errorData.code === 'BOT_ACCOUNT_NOT_AUTHORIZED') {
                        if (connectionStatus) connectionStatus.style.display = 'none';
                        if (connectionResult) connectionResult.style.display = 'none';
                        if (connectionError) {
                            connectionError.style.display = 'block';
                            const errorMessage = document.querySelector('.error-message');
                            if (errorMessage && errorData.botAuthUrl) {
                                errorMessage.innerHTML = `
                                    <p><strong>${errorData.error}</strong></p>
                                    <p>${errorData.message}</p>
                                    <div style="margin-top: 1rem;">
                                        <p><strong>Instructions:</strong></p>
                                        <ol style="text-align: left; margin: 0.5rem 0;">
                                            ${errorData.instructions?.map(inst => `<li>${inst}</li>`).join('') || ''}
                                        </ol>
                                        <a href="${errorData.botAuthUrl}" target="_blank" class="btn btn-primary" style="margin-top: 1rem; display: inline-block;">
                                            Authorize Bot Account
                                        </a>
                                    </div>
                                `;
                            } else if (errorMessage) {
                                errorMessage.textContent = errorData.message || errorData.error;
                            }
                        }
                        return; // Don't throw - we've handled the error
                    }
                    
                    // If missing chat scopes or channel:bot scope, prompt re-auth with Twitch to grant required scopes
                    if (errorData.code === 'TWITCH_CHAT_SCOPES_MISSING' || 
                        errorData.code === 'TWITCH_TOKEN_MISSING' || 
                        errorData.code === 'TWITCH_CHANNEL_BOT_SCOPE_MISSING') {
                        // Save current wizard state so we can resume after OAuth
                        sessionStorage.setItem('projectWizardState', JSON.stringify({
                            currentStep: this.currentStep,
                            projectData: this.projectData,
                            wizardId: this.wizardId
                        }));
                        const { signInWithTwitch } = await import('./firebase.js');
                        if (connectionStatus) {
                            connectionStatus.innerHTML = `
                                <div class="status-icon">🔗</div>
                                <p>Requesting Twitch chat permissions...</p>
                            `;
                        }
                        await signInWithTwitch();
                        return; // Popup will send a message; we'll resume on receipt
                    }
                    // Bubble other errors to standard handler below
                    throw new Error(errorData.error || 'Failed to ensure chat bot');
                }
            }

            // Determine EventSub type based on selected event
            const eventsubType = this.projectData.eventType;

            const response = await fetch(`${config.api.baseUrl}/api/twitch-eventsub`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: eventsubType,
                    version: this.getEventSubVersionForType(eventsubType),
                    condition: {
                        broadcaster_user_id: currentUser.uid.replace('twitch:', '')
                    }
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
                
                // Handle "subscription already exists" as success
                if (errorData.message && errorData.message.includes('subscription already exists')) {
                    console.log('Subscription already exists, treating as success');
                    
                    // Show success
                    if (connectionStatus) connectionStatus.style.display = 'none';
                    if (connectionResult) connectionResult.style.display = 'block';
                    
                    const subscriptionDetails = document.getElementById('subscriptionDetails');
                    if (subscriptionDetails) {
                        subscriptionDetails.innerHTML = `
                            <h4>Subscription Details:</h4>
                            <p><strong>Type:</strong> ${eventsubType}</p>
                            <p><strong>Status:</strong> Active (Already Exists)</p>
                            <p><strong>Message:</strong> This event subscription is already set up and working.</p>
                        `;
                    }
                    return;
                }
                
                // Special handling: treat websocket-required for chat messages as connected guidance
                if (errorData.code === 'TWITCH_CHAT_WEBSOCKET_REQUIRED') {
                    if (connectionStatus) connectionStatus.style.display = 'none';
                    if (connectionResult) connectionResult.style.display = 'block';
                    const subscriptionDetails = document.getElementById('subscriptionDetails');
                    if (subscriptionDetails) {
                        subscriptionDetails.innerHTML = `
                            <h4>Chat Bot Required:</h4>
                            <p><strong>Status:</strong> WebSocket required by Twitch for chat messages.</p>
                            <p><strong>Action:</strong> Chat bot will handle commands using your user token.</p>
                        `;
                    }
                    return;
                }

                // If required Twitch scopes are missing (or token missing), re-request with the right scopes for this event
                if (errorData.code === 'TWITCH_SCOPES_MISSING' || errorData.code === 'TWITCH_TOKEN_MISSING') {
                    // Save current wizard state so we can resume after OAuth
                    sessionStorage.setItem('projectWizardState', JSON.stringify({
                        currentStep: this.currentStep,
                        projectData: this.projectData,
                        wizardId: this.wizardId
                    }));

                    // Determine extra scopes needed for the selected event type
                    const extraScopes = this.getRequiredTwitchScopesForEvent(this.projectData.eventType);

                    const { signInWithTwitch } = await import('./firebase.js');
                    if (connectionStatus) {
                        connectionStatus.innerHTML = `
                            <div class="status-icon">🔗</div>
                            <p>Requesting required Twitch permissions...</p>
                        `;
                    }
                    await signInWithTwitch(extraScopes);
                    return; // Popup will handle and we'll resume on message
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

    /**
     * Map event types to required Twitch OAuth scopes
     */
    getRequiredTwitchScopesForEvent(eventType) {
        const map = {
            'channel.subscribe': ['channel:read:subscriptions'],
            'channel.cheer': ['bits:read'],
            'channel.channel_points_custom_reward_redemption': ['channel:read:redemptions'],
            // channel.follow handled by moderator:read:followers which is already in base scopes
            'channel.follow': ['moderator:read:followers']
        };
        return map[eventType] || [];
    }

    /**
     * Map event types to the correct EventSub version
     */
    getEventSubVersionForType(eventType) {
        const versions = {
            'channel.follow': '2',
            'channel.subscribe': '1',
            'channel.cheer': '1',
            'channel.raid': '1',
            'channel.channel_points_custom_reward_redemption': '1'
        };
        return versions[eventType] || '1';
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
            
            // Query user's voices subcollection
            const voicesRef = collection(db, 'users', user.uid, 'voices');
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
     * Load user's avatar groups and their assets from Firestore
     */
    async loadUserAvatars() {
        try {
            const user = getCurrentUser();
            if (!user) return;

            console.log('Loading avatar groups for user:', user.uid);
            const { db, collection, getDocs } = await import('./firebase.js');
            
            // Load avatar groups
            const groupsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups');
            const groupsSnapshot = await getDocs(groupsRef);

            console.log('Avatar groups found:', groupsSnapshot.size);
            
            // Load each group with its assets
            this.avatarGroups = [];
            for (const groupDoc of groupsSnapshot.docs) {
                const groupData = groupDoc.data();
                const group = {
                    id: groupDoc.id,
                    displayName: groupData.displayName || 'Untitled Avatar',
                    avatarUrl: groupData.avatarUrl,
                    avatar_group_id: groupData.avatar_group_id,
                    assets: []
                };
                
                // Load assets for this group
                const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupDoc.id, 'assets');
                const assetsSnapshot = await getDocs(assetsRef);
                
                group.assets = assetsSnapshot.docs.map(assetDoc => ({
                    id: assetDoc.id,
                    groupId: groupDoc.id,
                    groupName: group.displayName,
                    ...assetDoc.data()
                }));
                
                this.avatarGroups.push(group);
            }
            
            // Sort groups by creation date (newest first)
            this.avatarGroups.sort((a, b) => {
                if (!a.createdAt || !b.createdAt) return 0;
                try {
                    return b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime();
                } catch {
                    return 0;
                }
            });

            console.log('Avatar groups loaded:', this.avatarGroups.length);
            this.renderAvatarGroupsList(this.avatarGroups);
        } catch (e) {
            console.error('Error loading avatar groups:', e);
            this.avatarGroups = [];
            this.renderAvatarGroupsList([]);
        }
    }

    renderAvatarGroupsList(avatarGroups) {
        const avatarList = document.getElementById('avatarList');
        if (!avatarList) return;
        
        if (!avatarGroups || avatarGroups.length === 0) {
            avatarList.innerHTML = '<div style="color: rgba(255,255,255,0.6); grid-column: 1/-1; text-align: center; padding: 2rem;">No saved avatar groups yet. Upload a new avatar to get started.</div>';
            return;
        }
        
        const selectedUrl = this.projectData.avatarUrl;
        
        // Render each avatar group with its assets
        avatarList.innerHTML = avatarGroups.map(group => {
            if (!group.assets || group.assets.length === 0) {
                // Skip groups with no assets
                return '';
            }
            
            return `
                <div class="avatar-group" style="grid-column: 1/-1; margin-bottom: 1rem;">
                    <h4 style="color: rgba(255,255,255,0.8); margin: 0 0 0.5rem 0; font-size: 0.9rem;">${this.escapeHtml(group.displayName)}</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px;">
                        ${group.assets.map(asset => `
                            <div class="avatar-card${selectedUrl && asset.url === selectedUrl ? ' selected' : ''}" 
                                 data-asset-id="${asset.id}" 
                                 data-group-id="${group.id}"
                                 style="position: relative; cursor: pointer; border-radius: 6px; overflow: hidden; border: 2px solid ${selectedUrl && asset.url === selectedUrl ? '#16a34a' : 'rgba(255,255,255,0.1)'};"
                                 onclick="projectWizard.selectAvatarAsset('${group.id}', '${asset.id}', '${asset.url}', '${this.escapeHtml(group.displayName)}')">
                                <img src="${asset.url}" 
                                     alt="${this.escapeHtml(group.displayName)}" 
                                     style="width: 100%; height: 100px; object-fit: cover; display: block;" />
                                ${selectedUrl && asset.url === selectedUrl ? '<div class="avatar-selected" style="position:absolute;top:4px;right:4px;background:#16a34a;color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:12px;">✓</div>' : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).filter(html => html).join('');
        
        // If a selection exists, update the preview
        if (selectedUrl) {
            this.selectAvatarByUrl(selectedUrl);
        }
    }
    
    escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, s => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[s]);
    }

    selectAvatarAsset(groupId, assetId, url, groupName) {
        this.projectData.avatarUrl = url;
        this.projectData.avatarGroupId = groupId;
        this.projectData.avatarAssetId = assetId;
        this.projectData.avatarGroupName = groupName;
        this.dirtyFlags.avatar = true;
        
        // Show preview section
        const imagePreview = document.getElementById('imagePreview');
        const uploadArea = document.getElementById('uploadArea');
        const previewImg = document.getElementById('previewImg');
        if (previewImg) previewImg.src = url;
        if (imagePreview) imagePreview.style.display = 'block';
        if (uploadArea) uploadArea.style.display = 'none';
        
        // Update selection classes in the list
        document.querySelectorAll('#avatarList .avatar-card').forEach(card => {
            card.classList.remove('selected');
            card.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        const selectedCard = document.querySelector(`#avatarList .avatar-card[data-asset-id="${assetId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            selectedCard.style.borderColor = '#16a34a';
        }
        
        this.validateStep3();
    }

    selectAvatar(avatarId, url) {
        // Legacy method - redirect to new method
        this.selectAvatarAsset('', avatarId, url, 'Unknown Group');
    }

    selectAvatarByUrl(url) {
        // Find the asset with this URL
        if (this.avatarGroups) {
            for (const group of this.avatarGroups) {
                const asset = group.assets.find(a => a.url === url);
                if (asset) {
                    this.selectAvatarAsset(group.id, asset.id, url, group.displayName);
                    return;
                }
            }
        }
        // Fallback to legacy method
        this.selectAvatar('', url);
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

        // Auto-select if project already has a voice set (edit mode)
        if (this.projectData && (this.projectData.voiceId || this.projectData.voiceUrl)) {
            const target = this.userVoices.find(v => v.id === this.projectData.voiceId) ||
                           this.userVoices.find(v => v.url === this.projectData.voiceUrl);
            if (target) {
                this.loadAndShowSelectedVoice(target);
            }
        }
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
        this.dirtyFlags.voice = true;

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
            'channel.raid': 'Raid',
            'channel.channel_points_custom_reward_redemption': 'Channel Points',
            'channel.chat_command': 'Chat Command'
        };
        
        const eventName = eventNames[eventType] || eventType.replace('channel.', '').replace('_', ' ');
        return `My ${eventName} Alert`;
    }

    /**
     * Retry content generation
     */
    async retryGeneration() {
        const generationStatus = document.getElementById('generationStatus');
        const generationResult = document.getElementById('generationResult');
        if (generationStatus) {
            generationStatus.innerHTML = `
                <div class="loading-spinner"></div>
                <p>Generating your AI avatar video...</p>
            `;
            generationStatus.style.display = 'block';
        }
        if (generationResult) {
            generationResult.style.display = 'none';
        }
        await this.generateContent();
    }

    /**
     * Step 5: Content Generation
     */
    async generateContent() {
        const generationStatus = document.getElementById('generationStatus');
        const generationResult = document.getElementById('generationResult');
        
        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // First, ensure the project is saved to Firestore if it doesn't exist
            if (!this.projectData.projectId) {
                await this.saveProjectToFirestore();
            }

            // Check if we already have a completed video
            if (this.projectData.videoUrl && this.projectData.heygenVideoId) {
                console.log('Video already exists, showing preview');
                
                // Show the existing video
                if (generationStatus) generationStatus.style.display = 'none';
                if (generationResult) {
                    generationResult.style.display = 'block';
                    
                    // Create video preview section
                    let videoPreviewSection = generationResult.querySelector('.video-preview-section');
                    if (!videoPreviewSection) {
                        const resultMessage = generationResult.querySelector('.result-message');
                        if (resultMessage) {
                            videoPreviewSection = document.createElement('div');
                            videoPreviewSection.className = 'video-preview-section';
                            videoPreviewSection.style.cssText = 'margin: 1.5rem 0; text-align: center;';
                            resultMessage.insertAdjacentElement('afterend', videoPreviewSection);
                        }
                    }
                    
                    if (videoPreviewSection) {
                        videoPreviewSection.innerHTML = `
                            <h4 style="color: rgba(255,255,255,0.9); margin-bottom: 1rem;">Video Preview</h4>
                            <video controls autoplay muted style="width: 100%; max-width: 600px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                                <source src="${this.projectData.videoUrl}" type="video/mp4">
                                Your browser does not support the video tag.
                            </video>
                        `;
                    }
                }
                
                // Show project URL
                const projectUrl = document.getElementById('projectUrl');
                const projectUrlInput = document.getElementById('projectUrlInput');
                if (projectUrl && projectUrlInput) {
                    const projectUrlValue = `${window.location.origin}/twitchevent.html#${user.uid}`;
                    projectUrlInput.value = projectUrlValue;
                    projectUrl.style.display = 'block';
                }
                
                return; // Don't generate a new video
            }
            
            // Check if we have a video ID but no URL (video might still be processing)
            if (this.projectData.heygenVideoId && !this.projectData.videoUrl) {
                console.log('Video ID exists but no URL, checking status');
                await this.pollVideoStatus();
                return;
            }
            
            // Need to generate a new video
            if (generationStatus) {
                generationStatus.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p>Generating your AI avatar video...</p>
                `;
                generationStatus.style.display = 'block';
            }

            const requestPayload = {
                projectId: this.projectData.projectId,
                voiceUrl: this.projectData.voiceUrl,
                heygenAvatarId: this.projectData.avatarAssetId || null,
                avatarGroupId: this.projectData.avatarGroupId || null,
                avatarUrl: this.projectData.avatarUrl || null
            };

            // Attempt generation, waiting for avatar training if necessary
            while (true) {
                const idToken = await user.getIdToken();
                const generateResp = await fetch(`${config.api.baseUrl}/api/heygen/generate`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestPayload)
                });

                let generateData = {};
                try {
                    generateData = await generateResp.json();
                } catch (parseErr) {
                    console.warn('Failed to parse HeyGen generate response:', parseErr);
                    generateData = {};
                }

                if (generateResp.status === 202 && generateData?.status === 'training_pending') {
                    const groupDocIdForPolling =
                        generateData.groupId ||
                        requestPayload.avatarGroupId ||
                        this.projectData.avatarGroupId ||
                        null;

                    if (!this.projectData.avatarGroupId && generateData.groupId) {
                        this.projectData.avatarGroupId = generateData.groupId;
                    }

                    requestPayload.avatarGroupId =
                        this.projectData.avatarGroupId ||
                        generateData.groupId ||
                        requestPayload.avatarGroupId ||
                        null;

                    await this.waitForAvatarTraining(groupDocIdForPolling, generateData);
                    continue;
                }

                if (!generateResp.ok) {
                    throw new Error(generateData.message || generateData.error || 'Failed to generate video');
                }

                this.projectData.heygenVideoId = generateData.videoId || generateData.video_id;

                const { db, doc, updateDoc } = await import('./firebase.js');
                const projectRef = doc(db, 'projects', this.projectData.projectId);
                await updateDoc(projectRef, {
                    heygenVideoId: this.projectData.heygenVideoId,
                    updatedAt: new Date()
                });

                console.log('HeyGen video generation started:', this.projectData.heygenVideoId);

                await this.pollVideoStatus();
                return;
            }
            
        } catch (error) {
            console.error('Content generation error:', error);
            
            // Show error in generation status
            if (generationStatus) {
                generationStatus.innerHTML = `
                    <div class="result-icon error">❌</div>
                    <p class="error-message"><strong>Error:</strong> ${error.message}</p>
                    <button class="btn btn-primary" onclick="projectWizard.retryGeneration()">Retry</button>
                `;
                generationStatus.style.display = 'block';
            }
            
            if (generationResult) {
                generationResult.style.display = 'none';
            }
        }
    }

    async waitForAvatarTraining(groupDocId, serverPayload = {}) {
        const generationStatus = document.getElementById('generationStatus');

        const setStatusMessage = (message) => {
            if (generationStatus) {
                generationStatus.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p>${message}</p>
                `;
                generationStatus.style.display = 'block';
            }
        };

        setStatusMessage('Training your avatar. We\'ll generate your video as soon as it\'s ready...');

        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const retryAfterSeconds = Number.isFinite(serverPayload.retryAfterSeconds)
            ? Math.max(serverPayload.retryAfterSeconds, 3)
            : 10;
        const pollIntervalMs = retryAfterSeconds * 1000;
        const maxAttempts = Number.isFinite(serverPayload.maxPollAttempts)
            ? serverPayload.maxPollAttempts
            : 60; // ~10 minutes at default interval

        if (!groupDocId) {
            console.warn('waitForAvatarTraining called without groupDocId; waiting before retrying generation.');
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            return;
        }

        const statusPath = serverPayload.statusEndpoint
            ? serverPayload.statusEndpoint
            : `/api/heygen/avatar-group/training-status?group_id=${encodeURIComponent(groupDocId)}`;

        const baseApiUrl = config.api.baseUrl.endsWith('/')
            ? config.api.baseUrl.slice(0, -1)
            : config.api.baseUrl;

        const statusUrl = statusPath.startsWith('http')
            ? statusPath
            : `${baseApiUrl}${statusPath.startsWith('/') ? '' : '/'}${statusPath}`;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const idToken = await user.getIdToken();
            let statusResp;

            try {
                statusResp = await fetch(statusUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${idToken}`
                    }
                });
            } catch (statusErr) {
                console.warn('Error polling avatar training status:', statusErr);
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                continue;
            }

            if (statusResp.status === 404) {
                throw new Error('Avatar group not found while checking training status.');
            }

            if (statusResp.status === 401) {
                throw new Error('Authentication failed while checking avatar training status.');
            }

            let statusData = {};
            try {
                statusData = await statusResp.json();
            } catch (parseErr) {
                console.warn('Could not parse avatar training status response:', parseErr);
            }

            const statusValue =
                statusData?.status ||
                statusData?.trainingStatus ||
                statusData?.data?.status ||
                null;
            const progressValue = typeof statusData?.progress === 'number'
                ? Math.round(statusData.progress)
                : (typeof statusData?.data?.progress === 'number'
                    ? Math.round(statusData.data.progress)
                    : null);

            const avatarsArray = Array.isArray(statusData?.avatars)
                ? statusData.avatars
                : (Array.isArray(statusData?.data?.avatars) ? statusData.data.avatars : []);
            const avatarsCount = typeof statusData?.avatars_count === 'number'
                ? statusData.avatars_count
                : (typeof statusData?.data?.avatars_count === 'number'
                    ? statusData.data.avatars_count
                    : avatarsArray.length);

            if (statusResp.ok) {
                const progressText = progressValue !== null ? ` (${progressValue}%)` : '';
                setStatusMessage(`Training your avatar${progressText}. We'll generate your video as soon as it's ready...`);

                if (statusValue === 'completed' || statusValue === 'ready') {
                    const hasAvatars = avatarsCount > 0 || avatarsArray.length > 0;
                    if (hasAvatars) {
                        setStatusMessage('Avatar ready! Generating your video...');
                        if (!this.projectData.avatarGroupId && groupDocId) {
                            this.projectData.avatarGroupId = groupDocId;
                        }
                        return;
                    }
                }

                if (statusValue === 'failed' || statusValue === 'error') {
                    throw new Error('Avatar training failed. Please try uploading your avatar again.');
                }
            } else {
                console.warn('Non-success status while polling avatar training:', statusResp.status, statusResp.statusText);
            }

            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error('Avatar training is taking longer than expected. Please try again in a few minutes.');
    }

    /**
     * Save project to Firestore (used when creating project during generation)
     */
    async saveProjectToFirestore() {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const { db, addDoc, collection } = await import('./firebase.js');
        
        const projectData = {
            userId: user.uid,
            platform: this.projectData.platform,
            projectName: this.projectData.projectName,
            eventType: this.projectData.eventType,
            commandTrigger: this.projectData.commandTrigger || null,
            voiceUrl: this.projectData.voiceUrl || null,
            voiceId: this.projectData.voiceId || null,
            voiceName: this.projectData.voiceName || null,
            avatarUrl: this.projectData.avatarUrl || null,
            avatarGroupId: this.projectData.avatarGroupId || null,
            avatarAssetId: this.projectData.avatarAssetId || null,
            avatarGroupName: this.projectData.avatarGroupName || null,
            videoUrl: null,
            heygenVideoId: null,
            alertConfig: this.projectData.alertConfig || {},
            twitchSubscription: true, // Set to true since we connected in step 4
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const projectsRef = collection(db, 'projects');
        const createdRef = await addDoc(projectsRef, projectData);
        this.projectData.projectId = createdRef.id;
        
        console.log('Project saved to Firestore:', this.projectData.projectId);
    }

    /**
     * Poll HeyGen video status until complete
     */
    async pollVideoStatus() {
        const generationStatus = document.getElementById('generationStatus');
        const generationResult = document.getElementById('generationResult');
        
        let attempts = 0;
        const maxAttempts = 120; // 20 minutes maximum (120 * 10 seconds)
        
        const checkStatus = async () => {
            try {
                const user = getCurrentUser();
                if (!user) throw new Error('User not authenticated');

                const idToken = await user.getIdToken();
                const statusResp = await fetch(
                    `${config.api.baseUrl}/api/heygen/video_status.get?video_id=${encodeURIComponent(this.projectData.heygenVideoId)}`,
                    {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    }
                );

                if (!statusResp.ok) {
                    throw new Error('Failed to check video status');
                }

                const statusData = await statusResp.json();
                const data = statusData.data || statusData;
                const status = data.status;
                const videoUrl = data.video_url;

                console.log('Video status:', status, 'Attempt:', attempts + 1);

                // Update UI based on status
                if (status === 'completed' && videoUrl) {
                    // Video is ready!
                    this.projectData.videoUrl = videoUrl;
                    
                    // Save video URL to Firestore
                    const { db, doc, updateDoc } = await import('./firebase.js');
                    const projectRef = doc(db, 'projects', this.projectData.projectId);
                    await updateDoc(projectRef, {
                        videoUrl: videoUrl,
                        updatedAt: new Date()
                    });

                    // Show success with video preview
                    if (generationStatus) generationStatus.style.display = 'none';
                    if (generationResult) {
                        generationResult.style.display = 'block';
                        
                        // Update or create the video preview section
                        let videoPreviewSection = generationResult.querySelector('.video-preview-section');
                        if (!videoPreviewSection) {
                            // Add video preview section if it doesn't exist
                            const resultMessage = generationResult.querySelector('.result-message');
                            if (resultMessage) {
                                videoPreviewSection = document.createElement('div');
                                videoPreviewSection.className = 'video-preview-section';
                                videoPreviewSection.style.cssText = 'margin: 1.5rem 0; text-align: center;';
                                resultMessage.insertAdjacentElement('afterend', videoPreviewSection);
                            }
                        }
                        
                        // Set or update the video content
                        if (videoPreviewSection) {
                            videoPreviewSection.innerHTML = `
                                <h4 style="color: rgba(255,255,255,0.9); margin-bottom: 1rem;">Video Preview</h4>
                                <video controls autoplay muted style="width: 100%; max-width: 600px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                                    <source src="${videoUrl}" type="video/mp4">
                                    Your browser does not support the video tag.
                                </video>
                            `;
                        }
                    }

                    // Show project URL
                    const projectUrl = document.getElementById('projectUrl');
                    const projectUrlInput = document.getElementById('projectUrlInput');
                    if (projectUrl && projectUrlInput) {
                        const projectUrlValue = `${window.location.origin}/twitchevent.html#${user.uid}`;
                        projectUrlInput.value = projectUrlValue;
                        projectUrl.style.display = 'block';
                    }

                } else if (status === 'failed') {
                    // Video generation failed
                    const errorMsg = data.error?.message || data.error?.detail || 'Video generation failed';
                    throw new Error(errorMsg);

                } else if (status === 'processing' || status === 'pending' || status === 'waiting') {
                    // Still processing, update status and check again
                    attempts++;
                    
                    if (attempts >= maxAttempts) {
                        throw new Error('Video generation timed out. Please try again.');
                    }

                    // Update status message
                    if (generationStatus) {
                        const statusMessages = {
                            'pending': 'Video is in queue...',
                            'waiting': 'Waiting to start processing...',
                            'processing': 'Generating your AI avatar video...'
                        };
                        
                        generationStatus.innerHTML = `
                            <div class="loading-spinner"></div>
                            <p>${statusMessages[status] || 'Processing...'}</p>
                            <p style="font-size: 0.9rem; color: rgba(255,255,255,0.6); margin-top: 0.5rem;">
                                This may take a few minutes. Checking status... (${attempts}/${maxAttempts})
                            </p>
                        `;
                    }

                    // Check again in 10 seconds
                    setTimeout(checkStatus, 10000);
                }

            } catch (error) {
                console.error('Error checking video status:', error);
                
                if (generationStatus) {
                    generationStatus.innerHTML = `
                        <div class="result-icon error">❌</div>
                        <p class="error-message"><strong>Error:</strong> ${error.message}</p>
                        <button class="btn btn-primary" onclick="projectWizard.retryGeneration()">Retry</button>
                    `;
                    generationStatus.style.display = 'block';
                }
            }
        };

        // Start checking
        await checkStatus();
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

            // Persist any dirty fields before finishing (for edit mode)
            await this.persistDirtyFields();

            const { db, doc, updateDoc } = await import('./firebase.js');
            
            // Project should already be created in step 5, just update it
            if (this.projectData.projectId) {
                const projectRef = doc(db, 'projects', this.projectData.projectId);
                const projectData = {
                    platform: this.projectData.platform,
                    projectName: this.projectData.projectName,
                    eventType: this.projectData.eventType,
                    commandTrigger: this.projectData.commandTrigger || null,
                    voiceUrl: this.projectData.voiceUrl || null,
                    voiceId: this.projectData.voiceId || null,
                    voiceName: this.projectData.voiceName || null,
                    avatarUrl: this.projectData.avatarUrl || null,
                    avatarGroupId: this.projectData.avatarGroupId || null,
                    avatarAssetId: this.projectData.avatarAssetId || null,
                    avatarGroupName: this.projectData.avatarGroupName || null,
                    videoUrl: this.projectData.videoUrl || null,
                    heygenVideoId: this.projectData.heygenVideoId || null,
                    alertConfig: this.projectData.alertConfig || {},
                    twitchSubscription: true, // Always true since we connected in step 4
                    updatedAt: new Date()
                };
                await updateDoc(projectRef, projectData);
            } else {
                // Fallback: create project if it somehow wasn't created in step 5
                console.warn('Project was not created in step 5, creating now...');
                await this.saveProjectToFirestore();
            }

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
            alert('Error saving project: ' + error.message);
        }
    }

    /**
     * Close wizard
     */
    close() {
        // Hide the wizard
        const container = document.getElementById(this.options.containerId);
        if (container) {
            container.style.display = 'none';
        }
        
        // Show projects view (dashboard and projects manager)
        const dashboard = document.getElementById('dashboard');
        const projectsManager = document.getElementById('projectsManager');
        const recentProjects = document.getElementById('recentProjects');
        
        // If projects manager exists, show it; otherwise try to show recent projects or dashboard
        if (projectsManager) {
            if (dashboard) dashboard.style.display = 'block';
            // Projects manager should already be visible if it exists
        } else if (recentProjects) {
            if (dashboard) dashboard.style.display = 'block';
            recentProjects.style.display = 'block';
        } else if (dashboard) {
            dashboard.style.display = 'block';
            // Try to render projects manager if dashboard is available
            const dashboardContainer = dashboard.querySelector('.dashboard-container');
            if (dashboardContainer) {
                import('./projects.js').then(({ renderProjectsManager }) => {
                    renderProjectsManager('#dashboard .dashboard-container');
                }).catch(err => {
                    console.warn('Failed to load projects manager on close:', err);
                });
            }
        }
        
        // Call cancel callback if provided
        if (this.options.onCancel) {
            this.options.onCancel();
        }
        
        // Destroy the wizard instance
        this.destroy();
    }

    /**
     * Cancel wizard (kept for backward compatibility)
     */
    cancel() {
        this.close();
    }

    /**
     * Destroy the wizard
     */
    destroy() {
        const container = document.getElementById(this.options.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        // Clean up global references
        if (window.projectWizard === this) {
            delete window.projectWizard;
        }
        
        // Clean up module-level reference
        if (projectWizard === this) {
            projectWizard = null;
        }
    }
}

// Global functions for HTML onclick handlers
window.selectAvatarAsset = function(groupId, assetId, url, groupName) {
    if (window.projectWizard) {
        window.projectWizard.selectAvatarAsset(groupId, assetId, url, groupName);
    }
};

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

        // Query Firestore directly for the user's projects
        const { db, collection, query, where, orderBy, getDocs } = await import('./firebase.js');
        const projectsRef = collection(db, 'projects');
        const q = query(projectsRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        const projects = snapshot.docs.map(doc => ({ projectId: doc.id, ...doc.data() }));
        renderRecentProjects(projects);
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
        <div class="project-card" onclick='openProjectEditor(${JSON.stringify(project)})' style="cursor: pointer;">
            <div class="project-name">${project.projectName}</div>
            <div class="project-platform">${project.platform?.charAt(0).toUpperCase() + project.platform?.slice(1) || ''} - ${project.eventType || ''}</div>
            <div class="project-preview" style="position: relative; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.03);">
                ${project.videoUrl ? `
                <video src="${project.videoUrl}" preload="metadata" style="width: 100%; display: block; max-height: 200px; object-fit: cover;" muted></video>
                <button class="btn btn-secondary" style="position: absolute; left: 12px; bottom: 12px;" onclick="event.stopPropagation(); this.previousElementSibling.play();">▶ Play</button>
                ` : `
                <div style=\"padding: 24px; color: rgba(255,255,255,0.6);\">No video saved yet</div>
                `}
            </div>
        </div>
    `).join('');
}

// Open project in editor
window.openProjectEditor = function(project) {
    // Destroy any existing wizard instance cleanly
    if (projectWizard) {
        projectWizard.destroy();
    }
    // Show wizard and hide recent projects
    const wiz = document.getElementById('projectWizard');
    const recent = document.getElementById('recentProjects');
    if (wiz) wiz.style.display = 'block';
    if (recent) recent.style.display = 'none';
    showProjectWizard({
        containerId: 'projectWizard',
        mode: 'edit',
        projectData: project
    });
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