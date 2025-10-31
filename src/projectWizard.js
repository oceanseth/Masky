import { getCurrentUser } from './firebase.js';
import { config } from './config.js';

/**
 * Mask Wizard - Single consolidated module for creating and editing alert masks
 */

// Global wizard instance
let projectWizard = null;

/**
 * Show Mask Wizard - Main function to display the wizard
 * @param {Object} options - Configuration options
 * @param {string} options.containerId - ID of container to render wizard in
 * @param {string} options.mode - 'create' or 'edit'
 * @param {Object} options.projectData - Existing mask data for editing (kept as projectData for backend compatibility)
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
 * Mask Wizard Class
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
        
        // No need to check for OAuth resume with popup flow
        
        // Add global message listener for debugging
        window.addEventListener('message', (event) => {
            console.log('Global message listener received:', event.data);
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
            console.error('Mask wizard container not found:', this.options.containerId);
            return;
        }

        container.innerHTML = `
            <div class="project-wizard" id="projectWizard">
                <div class="wizard-header">
                    <h2 class="section-title">${this.options.mode === 'edit' ? 'Edit Mask' : 'New Mask Wizard'}</h2>
                    <p class="wizard-subtitle">${this.options.mode === 'edit' ? 'Update your mask settings' : 'Create your first AI-powered stream alert mask in 5 simple steps'}</p>
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
                                    <option value="streamelements">StreamElements (Donations)</option>
                                    <option value="youtube">YouTube</option>
                                    <option value="facebook">Facebook</option>
                                    <option value="instagram">Instagram</option>
                                    <option value="tiktok">TikTok</option>
                                    <option value="kick">Kick</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="projectName">Mask Name:</label>
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
                                </select>
                            </div>

                            <!-- Conditional Settings -->
                            <div class="conditional-settings" id="conditionalSettings" style="display: none; background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 1rem; margin-top: 1rem; border: 1px solid rgba(255, 255, 255, 0.1);">
                                <h4 style="margin: 0 0 0.5rem 0; color: #c084fc;">🎯 Alert Conditions</h4>
                                <p class="settings-description" style="margin: 0 0 1rem 0; color: rgba(255, 255, 255, 0.7); font-size: 0.9rem;">Set conditions for when this alert should trigger</p>
                                
                                <!-- Bits/Cheer Settings -->
                                <div class="condition-group" id="bitsSettings" style="display: none; margin-bottom: 1rem;">
                                    <div class="form-row" style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                                        <div class="form-group" style="flex: 1;">
                                            <label for="minimumBits">Minimum Bits:</label>
                                            <input type="number" id="minimumBits" class="form-input" placeholder="e.g., 100" min="1">
                                            <small>Only trigger for cheers with at least this many bits</small>
                                        </div>
                                        <div class="form-group" style="flex: 1;">
                                            <label for="maximumBits">Maximum Bits (optional):</label>
                                            <input type="number" id="maximumBits" class="form-input" placeholder="e.g., 1000" min="1">
                                            <small>Only trigger for cheers up to this many bits</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- Channel Points Settings -->
                                <div class="condition-group" id="channelPointsSettings" style="display: none; margin-bottom: 1rem;">
                                    <div class="form-row" style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                                        <div class="form-group" style="flex: 1;">
                                            <label for="minimumCost">Minimum Cost:</label>
                                            <input type="number" id="minimumCost" class="form-input" placeholder="e.g., 5000" min="1">
                                            <small>Only trigger for rewards costing at least this many channel points</small>
                                        </div>
                                        <div class="form-group" style="flex: 1;">
                                            <label for="maximumCost">Maximum Cost (optional):</label>
                                            <input type="number" id="maximumCost" class="form-input" placeholder="e.g., 10000" min="1">
                                            <small>Only trigger for rewards up to this many channel points</small>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="specificRewardIds">Specific Reward IDs (optional):</label>
                                        <input type="text" id="specificRewardIds" class="form-input" placeholder="reward-id-1,reward-id-2">
                                        <small>Comma-separated list of reward IDs to trigger for (leave empty for all rewards)</small>
                                    </div>
                                </div>

                                <!-- Raid Settings -->
                                <div class="condition-group" id="raidSettings" style="display: none; margin-bottom: 1rem;">
                                    <div class="form-group">
                                        <label for="minimumViewers">Minimum Viewers:</label>
                                        <input type="number" id="minimumViewers" class="form-input" placeholder="e.g., 10" min="1">
                                        <small>Only trigger for raids with at least this many viewers</small>
                                    </div>
                                </div>

                                <!-- Donation Settings -->
                                <div class="condition-group" id="donationSettings" style="display: none; margin-bottom: 1rem;">
                                    <div class="form-row" style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                                        <div class="form-group" style="flex: 1;">
                                            <label for="minimumAmount">Minimum Amount:</label>
                                            <input type="number" id="minimumAmount" class="form-input" placeholder="e.g., 5.00" min="0" step="0.01">
                                            <small>Only trigger for donations of at least this amount</small>
                                        </div>
                                        <div class="form-group" style="flex: 1;">
                                            <label for="maximumAmount">Maximum Amount (optional):</label>
                                            <input type="number" id="maximumAmount" class="form-input" placeholder="e.g., 100.00" min="0" step="0.01">
                                            <small>Only trigger for donations up to this amount</small>
                                        </div>
                                    </div>
                                    <div class="form-group" style="margin-bottom: 1rem;">
                                        <label for="currency">Currency:</label>
                                        <select id="currency" class="form-select">
                                            <option value="USD">USD ($)</option>
                                            <option value="EUR">EUR (€)</option>
                                            <option value="GBP">GBP (£)</option>
                                            <option value="CAD">CAD ($)</option>
                                            <option value="AUD">AUD ($)</option>
                                        </select>
                                        <small>Currency for donation amount filtering</small>
                                    </div>
                                    
                                    <!-- Text-to-Speech Settings -->
                                    <div class="tts-settings" style="border: 1px solid #e1e5e9; border-radius: 8px; padding: 1rem; background: #f8f9fa; margin-top: 1rem; color: #2c3e50;">
                                        <h5 style="margin: 0 0 1rem 0; color: #2c3e50;">💬 Tip Message Settings</h5>
                                        
                                        <div class="form-group" style="margin-bottom: 1rem;">
                                            <label for="readDonationMessages" style="color: #2c3e50;">
                                                <input type="checkbox" id="readDonationMessages" style="margin-right: 0.5rem;" checked>
                                                Read donation messages aloud (Text-to-Speech)
                                            </label>
                                            <small style="color: #6c757d;">When enabled, tip messages will be read after your alert audio</small>
                                        </div>
                                        
                                        <div id="ttsOptions" style="margin-left: 1.5rem;">
                                            <div class="form-group" style="margin-bottom: 1rem;">
                                                <label for="ttsDelay" style="color: #2c3e50;">Delay before reading message:</label>
                                                <select id="ttsDelay" class="form-select">
                                                    <option value="0">Immediately after alert</option>
                                                    <option value="2" selected>2 seconds after alert</option>
                                                    <option value="3">3 seconds after alert</option>
                                                    <option value="5">5 seconds after alert</option>
                                                </select>
                                                <small style="color: #6c757d;">How long to wait after your alert audio finishes</small>
                                            </div>
                                            
                                            <div class="form-group" style="margin-bottom: 1rem;">
                                                <label for="ttsVoice" style="color: #2c3e50;">Text-to-Speech Voice:</label>
                                                <select id="ttsVoice" class="form-select">
                                                    <optgroup label="Browser Default">
                                                        <option value="browser-default">Browser Default</option>
                                                    </optgroup>
                                                    <optgroup label="StreamElements TTS (High Quality)">
                                                        <option value="Brian">Brian (Male, British)</option>
                                                        <option value="Amy" selected>Amy (Female, British)</option>
                                                        <option value="Emma">Emma (Female, British)</option>
                                                        <option value="Geraint">Geraint (Male, Welsh)</option>
                                                        <option value="Russell">Russell (Male, Australian)</option>
                                                        <option value="Nicole">Nicole (Female, Australian)</option>
                                                        <option value="Joey">Joey (Male, American)</option>
                                                        <option value="Joanna">Joanna (Female, American)</option>
                                                        <option value="Kendra">Kendra (Female, American)</option>
                                                        <option value="Kimberly">Kimberly (Female, American)</option>
                                                        <option value="Salli">Salli (Female, American)</option>
                                                        <option value="Matthew">Matthew (Male, American)</option>
                                                        <option value="Justin">Justin (Male, American)</option>
                                                        <option value="Ivy">Ivy (Female, American, Child)</option>
                                                    </optgroup>
                                                    <optgroup label="International Voices">
                                                        <option value="Mizuki">Mizuki (Female, Japanese)</option>
                                                        <option value="Chantal">Chantal (Female, French)</option>
                                                        <option value="Mathieu">Mathieu (Male, French)</option>
                                                        <option value="Marlene">Marlene (Female, German)</option>
                                                        <option value="Hans">Hans (Male, German)</option>
                                                        <option value="Lucia">Lucia (Female, Spanish)</option>
                                                        <option value="Enrique">Enrique (Male, Spanish)</option>
                                                    </optgroup>
                                                    <optgroup label="Custom Voice">
                                                        <option value="custom">Use My Cloned Voice</option>
                                                    </optgroup>
                                                </select>
                                                <small style="color: #6c757d;">StreamElements TTS provides high-quality voices (recommended)</small>
                                            </div>
                                            
                                            <div class="form-row" style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                                                <div class="form-group" style="flex: 1;">
                                                    <label for="ttsSpeed" style="color: #2c3e50;">Reading Speed:</label>
                                                    <select id="ttsSpeed" class="form-select">
                                                        <option value="0.8">Slow</option>
                                                        <option value="1.0" selected>Normal</option>
                                                        <option value="1.2">Fast</option>
                                                        <option value="1.5">Very Fast</option>
                                                    </select>
                                                </div>
                                                <div class="form-group" style="flex: 1;">
                                                    <label for="messageMaxLength" style="color: #2c3e50;">Max Message Length:</label>
                                                    <input type="number" id="messageMaxLength" class="form-input" value="200" min="50" max="500">
                                                    <small style="color: #6c757d;">Characters</small>
                                                </div>
                                            </div>
                                            
                                            <div class="form-group">
                                                <label for="messageFilter" style="color: #2c3e50;">Message Filtering:</label>
                                                <select id="messageFilter" class="form-select">
                                                    <option value="none">Read all messages</option>
                                                    <option value="profanity" selected>Filter profanity</option>
                                                    <option value="links">Filter links and profanity</option>
                                                    <option value="strict">Strict filtering (safe words only)</option>
                                                </select>
                                                <small style="color: #6c757d;">How to filter inappropriate content from messages</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>
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
                                        <h3>Your Mask URL:</h3>
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
     * Set default values for form fields
     */
    setDefaultValues() {
        // Set default event type
        const eventTypeSelect = document.getElementById('eventType');
        if (eventTypeSelect && !eventTypeSelect.value) {
            eventTypeSelect.value = 'channel.follow';
            this.projectData.eventType = 'channel.follow';
        }
        
        // Set default mask name if empty
        const projectNameInput = document.getElementById('projectName');
        if (projectNameInput && !projectNameInput.value && !this.projectData.projectName) {
            const defaultName = this.getDefaultProjectName(this.projectData.eventType);
            projectNameInput.value = defaultName;
            this.projectData.projectName = defaultName;
        }
        
        // Update conditional settings based on current event type
        this.updateConditionalSettings(this.projectData.eventType);
        
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
                this.updateEventTypeOptions(e.target.value);
                this.validateStep1();
            });
        }

        // Mask name
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
                
                // Update mask name if it's still the default
                const projectNameInput = document.getElementById('projectName');
                if (projectNameInput && projectNameInput.value.includes('My ') && projectNameInput.value.includes(' Alert')) {
                    const defaultName = this.getDefaultProjectName(e.target.value);
                    projectNameInput.value = defaultName;
                    this.projectData.projectName = defaultName;
                }
                
                // Show/hide conditional settings based on event type
                this.updateConditionalSettings(e.target.value);
                
                this.validateStep1();
            });
        }

        // Conditional settings event listeners
        this.setupConditionalSettingsListeners();

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
     * Setup conditional settings event listeners
     */
    setupConditionalSettingsListeners() {
        // Minimum bits
        const minimumBits = document.getElementById('minimumBits');
        if (minimumBits) {
            minimumBits.addEventListener('input', (e) => {
                this.projectData.minimumBits = parseInt(e.target.value) || null;
            });
        }

        // Maximum bits
        const maximumBits = document.getElementById('maximumBits');
        if (maximumBits) {
            maximumBits.addEventListener('input', (e) => {
                this.projectData.maximumBits = parseInt(e.target.value) || null;
            });
        }

        // Minimum cost (channel points)
        const minimumCost = document.getElementById('minimumCost');
        if (minimumCost) {
            minimumCost.addEventListener('input', (e) => {
                this.projectData.minimumCost = parseInt(e.target.value) || null;
            });
        }

        // Maximum cost (channel points)
        const maximumCost = document.getElementById('maximumCost');
        if (maximumCost) {
            maximumCost.addEventListener('input', (e) => {
                this.projectData.maximumCost = parseInt(e.target.value) || null;
            });
        }

        // Specific reward IDs
        const specificRewardIds = document.getElementById('specificRewardIds');
        if (specificRewardIds) {
            specificRewardIds.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                this.projectData.specificRewardIds = value ? value.split(',').map(id => id.trim()).filter(id => id) : null;
            });
        }

        // Minimum viewers (raids)
        const minimumViewers = document.getElementById('minimumViewers');
        if (minimumViewers) {
            minimumViewers.addEventListener('input', (e) => {
                this.projectData.minimumViewers = parseInt(e.target.value) || null;
            });
        }

        // Minimum amount (donations)
        const minimumAmount = document.getElementById('minimumAmount');
        if (minimumAmount) {
            minimumAmount.addEventListener('input', (e) => {
                this.projectData.minimumAmount = parseFloat(e.target.value) || null;
            });
        }

        // Maximum amount (donations)
        const maximumAmount = document.getElementById('maximumAmount');
        if (maximumAmount) {
            maximumAmount.addEventListener('input', (e) => {
                this.projectData.maximumAmount = parseFloat(e.target.value) || null;
            });
        }

        // Currency (donations)
        const currency = document.getElementById('currency');
        if (currency) {
            currency.addEventListener('change', (e) => {
                this.projectData.currency = e.target.value || 'USD';
            });
        }

        // Text-to-Speech settings for donations
        this.setupTTSListeners();
    }

    /**
     * Setup Text-to-Speech event listeners for donation messages
     */
    setupTTSListeners() {
        // Read donation messages checkbox
        const readDonationMessages = document.getElementById('readDonationMessages');
        if (readDonationMessages) {
            readDonationMessages.addEventListener('change', (e) => {
                this.projectData.readDonationMessages = e.target.checked;
                this.toggleTTSOptions(e.target.checked);
            });
        }

        // TTS delay
        const ttsDelay = document.getElementById('ttsDelay');
        if (ttsDelay) {
            ttsDelay.addEventListener('change', (e) => {
                this.projectData.ttsDelay = parseFloat(e.target.value) || 2;
            });
        }

        // TTS voice
        const ttsVoice = document.getElementById('ttsVoice');
        if (ttsVoice) {
            ttsVoice.addEventListener('change', (e) => {
                this.projectData.ttsVoice = e.target.value || 'browser-default';
            });
        }

        // TTS speed
        const ttsSpeed = document.getElementById('ttsSpeed');
        if (ttsSpeed) {
            ttsSpeed.addEventListener('change', (e) => {
                this.projectData.ttsSpeed = parseFloat(e.target.value) || 1.0;
            });
        }

        // Message max length
        const messageMaxLength = document.getElementById('messageMaxLength');
        if (messageMaxLength) {
            messageMaxLength.addEventListener('input', (e) => {
                this.projectData.messageMaxLength = parseInt(e.target.value) || 200;
            });
        }

        // Message filtering
        const messageFilter = document.getElementById('messageFilter');
        if (messageFilter) {
            messageFilter.addEventListener('change', (e) => {
                this.projectData.messageFilter = e.target.value || 'profanity';
            });
        }
    }

    /**
     * Toggle TTS options visibility
     */
    toggleTTSOptions(show) {
        const ttsOptions = document.getElementById('ttsOptions');
        if (ttsOptions) {
            ttsOptions.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Update event type options based on selected platform
     */
    updateEventTypeOptions(platform) {
        const eventTypeSelect = document.getElementById('eventType');
        if (!eventTypeSelect) return;

        // Clear existing options
        eventTypeSelect.innerHTML = '';

        let options = [];
        
        switch (platform) {
            case 'twitch':
                options = [
                    { value: 'channel.follow', text: 'New Follower' },
                    { value: 'channel.subscribe', text: 'New Subscriber' },
                    { value: 'channel.cheer', text: 'New Cheer' },
                    { value: 'channel.raid', text: 'New Raid' },
                    { value: 'channel.channel_points_custom_reward_redemption', text: 'Channel Points Redeem' }
                ];
                break;
            case 'streamelements':
                options = [
                    { value: 'donation', text: 'New Donation' },
                    { value: 'follower', text: 'New Follower' },
                    { value: 'subscriber', text: 'New Subscriber' },
                    { value: 'cheer', text: 'New Cheer' },
                    { value: 'raid', text: 'New Raid' }
                ];
                break;
            default:
                options = [
                    { value: 'follow', text: 'New Follower' },
                    { value: 'subscribe', text: 'New Subscriber' },
                    { value: 'donation', text: 'New Donation' }
                ];
                break;
        }

        // Add options to select
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.text;
            eventTypeSelect.appendChild(optionElement);
        });

        // Set default selection
        if (options.length > 0) {
            eventTypeSelect.value = options[0].value;
            this.projectData.eventType = options[0].value;
            this.updateConditionalSettings(options[0].value);
        }
    }

    /**
     * Update conditional settings visibility based on event type
     */
    updateConditionalSettings(eventType) {
        const conditionalSettings = document.getElementById('conditionalSettings');
        const bitsSettings = document.getElementById('bitsSettings');
        const channelPointsSettings = document.getElementById('channelPointsSettings');
        const raidSettings = document.getElementById('raidSettings');
        const donationSettings = document.getElementById('donationSettings');

        // Hide all settings first
        if (bitsSettings) bitsSettings.style.display = 'none';
        if (channelPointsSettings) channelPointsSettings.style.display = 'none';
        if (raidSettings) raidSettings.style.display = 'none';
        if (donationSettings) donationSettings.style.display = 'none';

        // Show relevant settings based on event type
        switch (eventType) {
            case 'channel.cheer':
            case 'cheer':
                if (conditionalSettings) conditionalSettings.style.display = 'block';
                if (bitsSettings) bitsSettings.style.display = 'block';
                break;
            case 'channel.channel_points_custom_reward_redemption':
                if (conditionalSettings) conditionalSettings.style.display = 'block';
                if (channelPointsSettings) channelPointsSettings.style.display = 'block';
                break;
            case 'channel.raid':
            case 'raid':
                if (conditionalSettings) conditionalSettings.style.display = 'block';
                if (raidSettings) raidSettings.style.display = 'block';
                break;
            case 'donation':
                if (conditionalSettings) conditionalSettings.style.display = 'block';
                if (donationSettings) donationSettings.style.display = 'block';
                break;
            default:
                // Hide conditional settings for follow and subscribe events
                if (conditionalSettings) conditionalSettings.style.display = 'none';
                break;
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
        
        // Load conditional settings
        const minimumBits = document.getElementById('minimumBits');
        const maximumBits = document.getElementById('maximumBits');
        const minimumCost = document.getElementById('minimumCost');
        const maximumCost = document.getElementById('maximumCost');
        const specificRewardIds = document.getElementById('specificRewardIds');
        const minimumViewers = document.getElementById('minimumViewers');
        const minimumAmount = document.getElementById('minimumAmount');
        const maximumAmount = document.getElementById('maximumAmount');
        const currency = document.getElementById('currency');

        if (minimumBits) minimumBits.value = this.projectData.minimumBits || '';
        if (maximumBits) maximumBits.value = this.projectData.maximumBits || '';
        if (minimumCost) minimumCost.value = this.projectData.minimumCost || '';
        if (maximumCost) maximumCost.value = this.projectData.maximumCost || '';
        if (specificRewardIds) specificRewardIds.value = this.projectData.specificRewardIds ? this.projectData.specificRewardIds.join(',') : '';
        if (minimumViewers) minimumViewers.value = this.projectData.minimumViewers || '';
        if (minimumAmount) minimumAmount.value = this.projectData.minimumAmount || '';
        if (maximumAmount) maximumAmount.value = this.projectData.maximumAmount || '';
        if (currency) currency.value = this.projectData.currency || 'USD';

        // Load TTS settings
        const readDonationMessages = document.getElementById('readDonationMessages');
        const ttsDelay = document.getElementById('ttsDelay');
        const ttsVoice = document.getElementById('ttsVoice');
        const ttsSpeed = document.getElementById('ttsSpeed');
        const messageMaxLength = document.getElementById('messageMaxLength');
        const messageFilter = document.getElementById('messageFilter');

        if (readDonationMessages) {
            readDonationMessages.checked = this.projectData.readDonationMessages !== false; // default true
            this.toggleTTSOptions(readDonationMessages.checked);
        }
        if (ttsDelay) ttsDelay.value = this.projectData.ttsDelay || '2';
        if (ttsVoice) ttsVoice.value = this.projectData.ttsVoice || 'browser-default';
        if (ttsSpeed) ttsSpeed.value = this.projectData.ttsSpeed || '1.0';
        if (messageMaxLength) messageMaxLength.value = this.projectData.messageMaxLength || '200';
        if (messageFilter) messageFilter.value = this.projectData.messageFilter || 'profanity';
        
        // Ensure projectData has the correct values
        this.projectData.eventType = this.projectData.eventType || 'channel.follow';

        // Update conditional settings visibility
        this.updateConditionalSettings(this.projectData.eventType);

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
                    this.connectToPlatform();
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
     * Step 4: Platform Connection
     */
    async connectToPlatform() {
        if (this.projectData.platform === 'twitch') {
            return this.connectToTwitch();
        } else if (this.projectData.platform === 'streamelements') {
            return this.connectToStreamElements();
        } else {
            // For other platforms, skip connection step
            this.showConnectionSuccess('Platform connection not required for ' + this.projectData.platform);
        }
    }

    /**
     * Twitch API Connection
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

            // Create EventSub subscription
            const currentUser = getCurrentUser();
            if (!currentUser) throw new Error('User not authenticated');
            
            const idToken = await currentUser.getIdToken();
            
            // Get correct version for each event type based on Twitch EventSub API
            const getEventVersion = (eventType) => {
                switch (eventType) {
                    case 'channel.follow':
                        return '2'; // Only channel.follow uses version 2
                    case 'channel.subscribe':
                    case 'channel.cheer':
                    case 'channel.raid':
                    case 'channel.channel_points_custom_reward_redemption.add':
                    default:
                        return '1'; // All other events use version 1
                }
            };
            
            const response = await fetch(`${config.api.baseUrl}/api/twitch-eventsub`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: this.projectData.eventType,
                    version: getEventVersion(this.projectData.eventType),
                    condition: {
                        broadcaster_user_id: currentUser.uid.replace('twitch:', '')
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

    /**
     * StreamElements Connection
     */
    async connectToStreamElements() {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionResult = document.getElementById('connectionResult');
        const connectionError = document.getElementById('connectionError');

        try {
            // Show loading state
            if (connectionStatus) {
                connectionStatus.innerHTML = `
                    <div class="status-icon">🔗</div>
                    <p>Setting up StreamElements integration...</p>
                `;
                connectionStatus.style.display = 'block';
            }
            if (connectionResult) connectionResult.style.display = 'none';
            if (connectionError) connectionError.style.display = 'none';

            // For StreamElements, we need the channel ID
            const channelId = prompt("Please enter your StreamElements Channel ID (found in your StreamElements dashboard):");
            
            if (!channelId) {
                throw new Error('Channel ID is required for StreamElements integration');
            }

            const currentUser = getCurrentUser();
            if (!currentUser) throw new Error('User not authenticated');
            
            const idToken = await currentUser.getIdToken();
            const response = await fetch(`${config.api.baseUrl}/api/streamelements-setup`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelId: channelId,
                    eventTypes: [this.projectData.eventType],
                    webhookUrl: `${config.api.baseUrl}/api/streamelements-webhook`
                })
            });

            if (response.ok) {
                const result = await response.json();
                this.projectData.streamElementsConfig = {
                    channelId: channelId,
                    method: result.method,
                    pollInterval: result.pollInterval
                };

                // Show success
                if (connectionStatus) connectionStatus.style.display = 'none';
                if (connectionResult) connectionResult.style.display = 'block';
                
                const subscriptionDetails = document.getElementById('subscriptionDetails');
                if (subscriptionDetails) {
                    subscriptionDetails.innerHTML = `
                        <h4>StreamElements Integration:</h4>
                        <p><strong>Channel ID:</strong> ${channelId}</p>
                        <p><strong>Event Type:</strong> ${this.projectData.eventType}</p>
                        <p><strong>Method:</strong> ${result.method}</p>
                        <p><strong>Status:</strong> Active</p>
                    `;
                }

                // Auto-advance to next step after a short delay
                setTimeout(() => {
                    this.nextStep();
                }, 2000);

            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to set up StreamElements integration');
            }

        } catch (error) {
            console.error('StreamElements connection error:', error);
            
            if (connectionStatus) connectionStatus.style.display = 'none';
            if (connectionError) connectionError.style.display = 'block';
            
            const errorMessage = document.querySelector('.error-message');
            if (errorMessage) errorMessage.textContent = error.message;
        }
    }

    /**
     * Show connection success message (for platforms that don't need connection)
     */
    showConnectionSuccess(message) {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionResult = document.getElementById('connectionResult');
        const connectionError = document.getElementById('connectionError');

        if (connectionStatus) connectionStatus.style.display = 'none';
        if (connectionResult) connectionResult.style.display = 'block';
        if (connectionError) connectionError.style.display = 'none';

        const subscriptionDetails = document.getElementById('subscriptionDetails');
        if (subscriptionDetails) {
            subscriptionDetails.innerHTML = `<h4>${message}</h4>`;
        }

        // Auto-advance to next step after a short delay
        setTimeout(() => {
            this.nextStep();
        }, 1500);
    }

    retryConnection() {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionResult = document.getElementById('connectionResult');
        const connectionError = document.getElementById('connectionError');
        
        if (connectionStatus) connectionStatus.style.display = 'block';
        if (connectionResult) connectionResult.style.display = 'none';
        if (connectionError) connectionError.style.display = 'none';
        
        this.connectToPlatform();
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
     * Get default mask name based on event type
     */
    getDefaultProjectName(eventType) {
        const eventNames = {
            'channel.follow': 'Follow',
            'channel.subscribe': 'Subscribe',
            'channel.cheer': 'Cheer',
            'channel.bits.use': 'Bits Use',
            'channel.raid': 'Raid',
            'channel.channel_points_custom_reward_redemption': 'Channel Points'
        };
        
        const eventName = eventNames[eventType] || eventType.replace('channel.', '').replace('_', ' ');
        return `My ${eventName} Mask`;
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
            alert('Mask URL copied to clipboard!');
        }
    }

    /**
     * Finish Wizard
     */
    async finishWizard() {
        try {
            const user = getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            // Create mask directly in Firestore (stored as project for backend compatibility)
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

            alert('Mask saved successfully!');
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