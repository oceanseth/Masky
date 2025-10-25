// New User Onboarding System for Masky
class OnboardingManager {
  constructor() {
    this.currentStep = 0;
    this.totalSteps = 6;
    this.onboardingData = {
      isFirstTime: false,
      completedSteps: [],
      skipped: false
    };
    this.overlayElement = null;
    this.init();
  }

  init() {
    this.createOnboardingStyles();
    this.loadOnboardingState();
  }

  createOnboardingStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .onboarding-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .onboarding-overlay.active {
        opacity: 1;
      }

      .onboarding-modal {
        background: linear-gradient(135deg, #1a0f2e 0%, #2d1b3d 100%);
        border: 1px solid rgba(219, 112, 147, 0.3);
        border-radius: 20px;
        padding: 2rem;
        max-width: min(600px, 90vw);
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        box-shadow: 0 20px 40px rgba(139, 69, 139, 0.3);
        animation: slideUp 0.4s ease-out;
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
        box-sizing: border-box;
        margin: 0 auto;
        left: 0;
        right: 0;
      }

      @keyframes slideUp {
        from {
          transform: translateY(50px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .onboarding-header {
        text-align: center;
        margin-bottom: 1.5rem;
      }

      .onboarding-title {
        font-family: 'Orbitron', monospace;
        font-size: 1.6rem;
        color: #ffffff;
        margin: 0 0 0.5rem 0;
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
      }

      .onboarding-subtitle {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.95rem;
        margin: 0;
      }

      .onboarding-content {
        margin-bottom: 1.5rem;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }

      .onboarding-step {
        display: none;
        animation: fadeIn 0.3s ease;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }

      .onboarding-step.active {
        display: block;
      }

      /* Ensure all text content wraps properly */
      .onboarding-modal p, 
      .onboarding-modal li, 
      .onboarding-modal span, 
      .onboarding-modal div {
        word-wrap: break-word;
        overflow-wrap: break-word;
        max-width: 100%;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .step-icon {
        width: 60px;
        height: 60px;
        margin: 0 auto 1rem;
        background: linear-gradient(45deg, #db7093, #da70d6);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
      }

      .step-description {
        color: #fff;
        font-size: 1rem;
        line-height: 1.4;
        text-align: center;
        margin-bottom: 1rem;
      }

      .step-details {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 1rem;
        margin: 1rem 0;
        border-left: 3px solid #db7093;
      }

      .step-details h4 {
        color: #db7093;
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
      }

      .step-details ul {
        margin: 0.5rem 0;
        padding-left: 1.25rem;
        color: rgba(255, 255, 255, 0.8);
      }

      .step-details li {
        margin: 0.25rem 0;
        font-size: 0.9rem;
        line-height: 1.3;
      }

      .permission-box {
        background: rgba(255, 182, 193, 0.1);
        border: 1px solid rgba(255, 182, 193, 0.3);
        border-radius: 6px;
        padding: 1rem;
        margin: 1rem 0;
        text-align: center;
      }

      .permission-box .warning-icon {
        font-size: 1.2rem;
        color: #ffb6c1;
        margin-bottom: 0.5rem;
      }

      .permission-box p {
        font-size: 0.85rem;
        line-height: 1.3;
        margin: 0;
      }

      .onboarding-navigation {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .step-indicator {
        display: flex;
        gap: 6px;
      }

      .step-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transition: all 0.2s ease;
      }

      .step-dot.active {
        background: #db7093;
        transform: scale(1.2);
      }

      .onboarding-btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-block;
        text-align: center;
      }

      .btn-primary {
        background: linear-gradient(45deg, #db7093, #da70d6);
        color: white;
      }

      .btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(219, 112, 147, 0.4);
      }

      .btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .close-btn {
        position: absolute;
        top: 15px;
        right: 15px;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        font-size: 1.5rem;
        cursor: pointer;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
      }

      .close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }

      .feature-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin: 1rem 0;
      }

      .feature-card {
        background: linear-gradient(135deg, rgba(219, 112, 147, 0.1) 0%, rgba(218, 112, 214, 0.1) 100%);
        border: 1px solid rgba(219, 112, 147, 0.2);
        border-radius: 8px;
        padding: 1rem;
        text-align: center;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      .feature-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, #db7093, #da70d6);
      }

      .feature-card:hover {
        transform: translateY(-2px);
        border-color: rgba(219, 112, 147, 0.4);
        background: linear-gradient(135deg, rgba(219, 112, 147, 0.15) 0%, rgba(218, 112, 214, 0.15) 100%);
      }

      .feature-card .icon {
        font-size: 1.8rem;
        margin-bottom: 0.5rem;
        background: linear-gradient(45deg, #db7093, #da70d6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .feature-card h4 {
        color: white;
        margin: 0 0 0.5rem 0;
        font-weight: 600;
        font-size: 0.95rem;
      }

      .feature-card p {
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.8rem;
        margin: 0;
        line-height: 1.3;
      }

      .highlight-element {
        position: relative;
        z-index: 10001;
        box-shadow: 0 0 20px rgba(101, 163, 255, 0.6);
        border-radius: 8px;
      }

      .pulse-highlight {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0% { box-shadow: 0 0 20px rgba(101, 163, 255, 0.6); }
        50% { box-shadow: 0 0 30px rgba(101, 163, 255, 0.8); }
        100% { box-shadow: 0 0 20px rgba(101, 163, 255, 0.6); }
      }

      .onboarding-overlay .target-highlight {
        position: absolute;
        border: 3px solid #65a3ff;
        border-radius: 8px;
        background: rgba(101, 163, 255, 0.1);
        pointer-events: none;
        animation: highlight-pulse 2s infinite;
      }

      @keyframes highlight-pulse {
        0%, 100% { 
          border-color: #db7093;
          box-shadow: 0 0 20px rgba(219, 112, 147, 0.5);
        }
        50% { 
          border-color: #da70d6;
          box-shadow: 0 0 30px rgba(218, 112, 214, 0.7);
        }
      }

      /* Welcome Popup Styles */
      .welcome-popup {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 15000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .welcome-popup.active {
        opacity: 1;
      }

      .welcome-popup-content {
        background: linear-gradient(135deg, #1a0f2e 0%, #2d1b3d 100%);
        border: 1px solid rgba(219, 112, 147, 0.3);
        border-radius: 20px;
        padding: 3rem;
        text-align: center;
        max-width: 500px;
        width: 90%;
        animation: welcomeBounce 0.5s ease-out;
      }

      @keyframes welcomeBounce {
        0% { transform: scale(0.8) translateY(50px); opacity: 0; }
        60% { transform: scale(1.05) translateY(-10px); }
        100% { transform: scale(1) translateY(0); opacity: 1; }
      }

      .welcome-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
        animation: welcomeIconSpin 2s ease-in-out infinite;
      }

      @keyframes welcomeIconSpin {
        0%, 100% { transform: rotate(0deg) scale(1); }
        25% { transform: rotate(-5deg) scale(1.1); }
        75% { transform: rotate(5deg) scale(1.1); }
      }

      .welcome-popup h2 {
        color: #fff;
        font-size: 2rem;
        margin-bottom: 1rem;
        background: linear-gradient(45deg, #db7093, #da70d6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .welcome-popup p {
        color: rgba(255, 255, 255, 0.8);
        font-size: 1.1rem;
        margin-bottom: 2rem;
        line-height: 1.5;
      }

      .welcome-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
        flex-wrap: wrap;
      }

      .welcome-actions .btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-block;
      }

      /* Mobile and Responsive Styles */
      @media (max-width: 768px) {
        .onboarding-overlay {
          padding: 0.5rem;
          box-sizing: border-box;
          align-items: flex-start;
          padding-top: 2rem;
        }

        .onboarding-modal {
          padding: 1.5rem;
          width: 95vw;
          max-width: 95vw;
          max-height: calc(100vh - 4rem);
          border-radius: 15px;
          margin: 0;
          box-sizing: border-box;
          position: relative;
          left: 0;
          right: 0;
          transform: none;
        }

        .onboarding-title {
          font-size: 1.3rem;
          line-height: 1.3;
          word-break: break-word;
        }

        .onboarding-subtitle {
          font-size: 0.85rem;
          line-height: 1.4;
          word-wrap: break-word;
        }

        .feature-grid {
          grid-template-columns: 1fr;
          gap: 0.75rem;
        }

        .feature-card {
          padding: 0.75rem;
          word-wrap: break-word;
        }

        .feature-card .icon {
          font-size: 1.5rem;
        }

        .feature-card h4 {
          font-size: 0.9rem;
          line-height: 1.3;
          word-break: break-word;
        }

        .feature-card p {
          font-size: 0.75rem;
          line-height: 1.4;
          word-wrap: break-word;
        }

        .onboarding-navigation {
          flex-direction: column;
          gap: 1rem;
          text-align: center;
        }

        .onboarding-btn {
          padding: 0.6rem 1.2rem;
          font-size: 0.85rem;
          min-width: 120px;
          white-space: nowrap;
        }

        .welcome-popup-content {
          padding: 2rem;
          width: 95%;
          max-width: 95vw;
          box-sizing: border-box;
        }

        .welcome-icon {
          font-size: 3rem;
        }

        .close-btn {
          top: 10px;
          right: 10px;
          font-size: 1.3rem;
          width: 28px;
          height: 28px;
        }
      }

      @media (max-width: 480px) {
        .onboarding-overlay {
          padding: 0.25rem;
          box-sizing: border-box;
          align-items: flex-start;
          padding-top: 1rem;
        }

        .onboarding-modal {
          padding: 1rem;
          width: 96vw;
          max-width: 96vw;
          max-height: calc(100vh - 2rem);
          border-radius: 12px;
          margin: 0;
          box-sizing: border-box;
          position: relative;
          left: 0;
          right: 0;
          transform: none;
        }

        .onboarding-title {
          font-size: 1.1rem;
          line-height: 1.2;
          word-break: break-word;
          hyphens: auto;
        }

        .onboarding-subtitle {
          font-size: 0.8rem;
          line-height: 1.3;
          word-wrap: break-word;
        }

        .feature-card {
          padding: 0.5rem;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .feature-card .icon {
          font-size: 1.3rem;
        }

        .feature-card h4 {
          font-size: 0.85rem;
          line-height: 1.2;
          word-break: break-word;
          margin-bottom: 0.3rem;
        }

        .feature-card p {
          font-size: 0.7rem;
          line-height: 1.3;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .onboarding-btn {
          padding: 0.5rem 1rem;
          font-size: 0.8rem;
          min-width: 100px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .welcome-popup-content {
          padding: 1.5rem;
          width: 98%;
          max-width: 98vw;
        }

        .welcome-icon {
          font-size: 2.5rem;
        }

        .step-indicator {
          gap: 4px;
        }

        .step-dot {
          width: 6px;
          height: 6px;
        }

        /* Ensure all text elements wrap properly */
        * {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        h1, h2, h3, h4, h5, h6 {
          hyphens: auto;
        }
      }

      /* Extra small screens */
      @media (max-width: 375px) {
        .onboarding-overlay {
          padding: 0.125rem;
          box-sizing: border-box;
          align-items: flex-start;
          padding-top: 0.5rem;
        }

        .onboarding-modal {
          padding: 0.75rem;
          width: 98vw;
          max-width: 98vw;
          max-height: calc(100vh - 1rem);
          border-radius: 8px;
          margin: 0;
          box-sizing: border-box;
          position: relative;
          left: 0;
          right: 0;
          transform: none;
        }

        .onboarding-title {
          font-size: 1rem;
          line-height: 1.2;
        }

        .onboarding-subtitle {
          font-size: 0.75rem;
          line-height: 1.3;
        }

        .onboarding-btn {
          padding: 0.4rem 0.8rem;
          font-size: 0.75rem;
          min-width: 80px;
        }
      }

      /* Prevent any horizontal overflow */
      .onboarding-overlay,
      .onboarding-modal,
      .onboarding-modal * {
        max-width: 100%;
        box-sizing: border-box;
      }

      /* Force wrap for any long content */
      .onboarding-modal pre,
      .onboarding-modal code {
        white-space: pre-wrap;
        word-break: break-all;
        overflow-wrap: break-word;
      }
      }

      /* Landscape mobile orientation */
      @media (max-height: 600px) and (max-width: 900px) {
        .onboarding-overlay {
          align-items: flex-start;
          padding: 0.5rem;
          padding-top: 0.5rem;
        }

        .onboarding-modal {
          max-height: calc(100vh - 1rem);
          padding: 1rem;
          width: 95vw;
          max-width: 95vw;
          margin: 0;
          position: relative;
          left: 0;
          right: 0;
          transform: none;
        }

        .onboarding-header {
          margin-bottom: 1rem;
        }

        .onboarding-content {
          margin-bottom: 1rem;
        }

        .feature-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
        }

        .feature-card {
          padding: 0.5rem;
        }

        .onboarding-navigation {
          margin-top: 1rem;
          padding-top: 0.5rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  loadOnboardingState() {
    const stored = localStorage.getItem('masky_onboarding');
    if (stored) {
      this.onboardingData = JSON.parse(stored);
    }
  }

  saveOnboardingState() {
    localStorage.setItem('masky_onboarding', JSON.stringify(this.onboardingData));
  }

  shouldShowOnboarding(user) {
    // Always show for users who haven't completed onboarding
    if (!this.onboardingData.completedSteps.length && !this.onboardingData.skipped) {
      return true;
    }
    
    // Check if user signed up recently (within 7 days) and hasn't seen onboarding
    if (user && user.metadata && user.metadata.creationTime) {
      const signupTime = new Date(user.metadata.creationTime);
      const now = new Date();
      const hoursAgo = (now - signupTime) / (1000 * 60 * 60);
      
      return hoursAgo < 168 && !this.onboardingData.skipped; // 7 days = 168 hours
    }
    
    return false;
  }

  startOnboarding() {
    this.currentStep = 0;
    this.createOnboardingOverlay();
    this.showStep(0);
  }

  createOnboardingOverlay() {
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'onboarding-overlay';
    this.overlayElement.innerHTML = this.getOnboardingHTML();
    document.body.appendChild(this.overlayElement);
    
    // Fade in
    setTimeout(() => {
      this.overlayElement.classList.add('active');
    }, 100);

    // Add event listeners
    this.addEventListeners();
  }

  getOnboardingHTML() {
    return `
      <div class="onboarding-modal">
        <button class="close-btn" onclick="onboardingManager.skipOnboarding()">&times;</button>
        
        <div class="onboarding-header">
          <h2 class="onboarding-title" id="onboardingTitle">Welcome to Masky! 🎭</h2>
          <p class="onboarding-subtitle" id="onboardingSubtitle">Let's get you started with AI-powered content creation</p>
        </div>

        <div class="onboarding-content">
          ${this.getStepsHTML()}
        </div>

        <div class="onboarding-navigation">
          <button class="onboarding-btn btn-secondary" onclick="onboardingManager.previousStep()" id="prevBtn" style="visibility: hidden;">
            Previous
          </button>

          <div class="step-indicator">
            ${Array.from({length: this.totalSteps}, (_, i) => 
              `<div class="step-dot ${i === 0 ? 'active' : ''}" data-step="${i}"></div>`
            ).join('')}
          </div>

          <button class="onboarding-btn btn-primary" onclick="onboardingManager.nextStep()" id="nextBtn">
            Next
          </button>
        </div>
      </div>
    `;
  }

  getStepsHTML() {
    return `
      <!-- Step 1: Welcome & Overview -->
      <div class="onboarding-step active" data-step="0">
        <div class="step-icon">🎭</div>
        <div class="step-description">
          <h3>Transform Your Content with AI</h3>
          <p>Masky helps you create AI avatars and voice clones from your existing content, perfect for streamers, content creators, and businesses.</p>
        </div>
        
        <div class="feature-grid">
          <div class="feature-card">
            <div class="icon">🎥</div>
            <h4>Video Processing</h4>
            <p>Extract avatars from your VODs and videos</p>
          </div>
          <div class="feature-card">
            <div class="icon">🎤</div>
            <h4>Voice Cloning</h4>
            <p>Create realistic voice models from audio</p>
          </div>
          <div class="feature-card">
            <div class="icon">🤖</div>
            <h4>AI Integration</h4>
            <p>Connect with HeyGen and other AI platforms</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Account & Permissions -->
      <div class="onboarding-step" data-step="1">
        <div class="step-icon">🔐</div>
        <div class="step-description">
          <h3>Your Account & Permissions</h3>
          <p>To create personalized avatars and voices, Masky needs access to your content sources.</p>
        </div>
        
        <div class="step-details">
          <h4>What We'll Need Access To:</h4>
          <ul>
            <li><strong>Twitch VODs</strong> - Your past streams for avatar extraction</li>
            <li><strong>Upload Permissions</strong> - Your videos, audio files, and images</li>
            <li><strong>Microphone</strong> - For real-time voice samples (optional)</li>
            <li><strong>Camera</strong> - For live avatar creation (optional)</li>
          </ul>
        </div>

        <div class="permission-box">
          <div class="warning-icon">⚠️</div>
          <p><strong>Privacy First:</strong> Your content is processed securely and only used to create your personal AI models. We never share or sell your data.</p>
        </div>
      </div>

      <!-- Step 3: Connect Twitch -->
      <div class="onboarding-step" data-step="2">
        <div class="step-icon">🟣</div>
        <div class="step-description">
          <h3>Connect Your Twitch Account</h3>
          <p>Link your Twitch account to access your VODs and create avatars from your streaming content.</p>
        </div>
        
        <div class="step-details">
          <h4>How Twitch Integration Works:</h4>
          <ul>
            <li>We'll fetch your recent VODs (videos on demand)</li>
            <li>Extract video segments for avatar creation</li>
            <li>Analyze audio for voice pattern recognition</li>
            <li>Create personalized AI models from your content</li>
          </ul>
        </div>

        <div class="step-details">
          <h4>What You Can Do:</h4>
          <ul>
            <li>🎭 Create avatars from your streaming footage</li>
            <li>🎤 Generate voice clones from VOD audio</li>
            <li>🔄 Auto-sync new VODs for continuous improvement</li>
            <li>📊 Analytics on your content engagement</li>
          </ul>
        </div>
      </div>

      <!-- Step 4: Upload Content -->
      <div class="onboarding-step" data-step="3">
        <div class="step-icon">📁</div>
        <div class="step-description">
          <h3>Upload Your Content</h3>
          <p>Don't have Twitch? No problem! Upload your own videos, audio files, and images to create AI models.</p>
        </div>
        
        <div class="step-details">
          <h4>Supported File Types:</h4>
          <ul>
            <li><strong>Video:</strong> MP4, MOV, AVI, WebM (for avatar creation)</li>
            <li><strong>Audio:</strong> MP3, WAV, M4A (for voice cloning)</li>
            <li><strong>Images:</strong> JPG, PNG (for static avatars)</li>
          </ul>
        </div>

        <div class="step-details">
          <h4>Best Practices for Quality:</h4>
          <ul>
            <li>Use well-lit, clear videos with your face visible</li>
            <li>Provide 2-5 minutes of clear speech for voice cloning</li>
            <li>High-resolution images work best for avatars</li>
            <li>Multiple samples improve AI model accuracy</li>
          </ul>
        </div>
      </div>

      <!-- Step 5: AI Processing -->
      <div class="onboarding-step" data-step="4">
        <div class="step-icon">⚡</div>
        <div class="step-description">
          <h3>AI Processing Magic</h3>
          <p>Our AI analyzes your content to create personalized avatars and voice models.</p>
        </div>
        
        <div class="step-details">
          <h4>Avatar Creation Process:</h4>
          <ul>
            <li>🔍 Facial recognition and tracking</li>
            <li>🎨 3D model generation from your features</li>
            <li>🎭 Expression and movement mapping</li>
            <li>✨ Real-time animation capabilities</li>
          </ul>
        </div>

        <div class="step-details">
          <h4>Voice Cloning Process:</h4>
          <ul>
            <li>🎵 Audio pattern analysis and learning</li>
            <li>🗣️ Speech synthesis model training</li>
            <li>🎯 Accent and tone preservation</li>
            <li>⚡ Real-time speech generation</li>
          </ul>
        </div>

        <div class="permission-box">
          <div class="warning-icon">⏱️</div>
          <p><strong>Processing Time:</strong> Avatar creation takes 5-15 minutes, voice cloning takes 10-30 minutes depending on content quality and length.</p>
        </div>
      </div>

      <!-- Step 6: Start Creating -->
      <div class="onboarding-step" data-step="5">
        <div class="step-icon">🚀</div>
        <div class="step-description">
          <h3>Ready to Create Amazing Content!</h3>
          <p>You're all set! Let's start creating your first AI avatar and voice clone.</p>
        </div>
        
        <div class="feature-grid">
          <div class="feature-card">
            <div class="icon">🎬</div>
            <h4>Video Content</h4>
            <p>Create videos with your AI avatar narrating with your cloned voice</p>
          </div>
          <div class="feature-card">
            <div class="icon">📺</div>
            <h4>Stream Alerts</h4>
            <p>Personalized alerts using your avatar for follows, subs, and donations</p>
          </div>
          <div class="feature-card">
            <div class="icon">🎙️</div>
            <h4>Voice Content</h4>
            <p>Generate speech in your voice for podcasts, announcements, and more</p>
          </div>
        </div>

        <div class="step-details">
          <h4>Your Next Steps:</h4>
          <ul>
            <li>1. Connect your Twitch account or upload content</li>
            <li>2. Wait for AI processing to complete</li>
            <li>3. Test your avatar and voice models</li>
            <li>4. Start creating amazing content!</li>
          </ul>
        </div>
      </div>
    `;
  }

  addEventListeners() {
    // Click outside to close (optional)
    this.overlayElement.addEventListener('click', (e) => {
      if (e.target === this.overlayElement) {
        this.skipOnboarding();
      }
    });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlayElement) {
        this.skipOnboarding();
      }
    });
  }

  showStep(stepIndex) {
    const steps = this.overlayElement.querySelectorAll('.onboarding-step');
    const dots = this.overlayElement.querySelectorAll('.step-dot');
    const prevBtn = this.overlayElement.querySelector('#prevBtn');
    const nextBtn = this.overlayElement.querySelector('#nextBtn');
    const title = this.overlayElement.querySelector('#onboardingTitle');
    const subtitle = this.overlayElement.querySelector('#onboardingSubtitle');

    // Hide all steps
    steps.forEach(step => step.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));

    // Show current step
    if (steps[stepIndex]) {
      steps[stepIndex].classList.add('active');
      dots[stepIndex].classList.add('active');
    }

    // Update header based on step
    if (stepIndex === 0) {
      title.textContent = 'Welcome to Masky! 🎭';
      subtitle.textContent = "Let's get you started with AI-powered content creation";
    } else {
      title.textContent = `Step ${stepIndex + 1} of ${this.totalSteps}`;
      subtitle.textContent = 'AI-powered content creation made simple';
    }

    // Update navigation
    prevBtn.style.visibility = stepIndex > 0 ? 'visible' : 'hidden';
    
    if (stepIndex === this.totalSteps - 1) {
      nextBtn.textContent = 'Get Started!';
      nextBtn.className = 'onboarding-btn btn-primary';
    } else {
      nextBtn.textContent = 'Next';
      nextBtn.className = 'onboarding-btn btn-primary';
    }

    this.currentStep = stepIndex;
  }

  nextStep() {
    if (this.currentStep < this.totalSteps - 1) {
      this.showStep(this.currentStep + 1);
    } else {
      this.completeOnboarding();
    }
  }

  previousStep() {
    if (this.currentStep > 0) {
      this.showStep(this.currentStep - 1);
    }
  }

  completeOnboarding() {
    this.onboardingData.completedSteps = Array.from({length: this.totalSteps}, (_, i) => i);
    this.onboardingData.isFirstTime = false;
    this.saveOnboardingState();
    this.closeOnboarding();
    
    // Show success message
    this.showCompletionMessage();
  }

  skipOnboarding() {
    if (confirm('Are you sure you want to skip the tutorial? You can always restart it from the help menu.')) {
      this.onboardingData.skipped = true;
      this.saveOnboardingState();
      this.closeOnboarding();
    }
  }

  closeOnboarding() {
    if (this.overlayElement) {
      this.overlayElement.classList.remove('active');
      setTimeout(() => {
        if (this.overlayElement && this.overlayElement.parentNode) {
          this.overlayElement.parentNode.removeChild(this.overlayElement);
        }
        this.overlayElement = null;
      }, 300);
    }
  }

  showCompletionMessage() {
    // Create a temporary success message
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(45deg, #10b981, #065f46);
      color: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);
      z-index: 10000;
      font-family: 'Inter', sans-serif;
      max-width: 300px;
      animation: slideInRight 0.3s ease-out;
    `;
    
    successDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <span style="font-size: 1.5rem;">✅</span>
        <strong>Welcome to Masky!</strong>
      </div>
      <p style="margin: 0; font-size: 0.9rem; opacity: 0.9;">
        You're all set up! Start by connecting Twitch or uploading your content to create your first AI avatar.
      </p>
    `;

    document.body.appendChild(successDiv);

    // Add animation style
    if (!document.querySelector('#completion-animation-style')) {
      const style = document.createElement('style');
      style.id = 'completion-animation-style';
      style.textContent = `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    // Remove after 5 seconds
    setTimeout(() => {
      if (successDiv && successDiv.parentNode) {
        successDiv.style.animation = 'slideInRight 0.3s ease-out reverse';
        setTimeout(() => {
          if (successDiv.parentNode) {
            successDiv.parentNode.removeChild(successDiv);
          }
        }, 300);
      }
    }, 5000);
  }

  // Public method to restart onboarding
  restartOnboarding() {
    this.onboardingData = {
      isFirstTime: false,
      completedSteps: [],
      skipped: false
    };
    this.saveOnboardingState();
    this.startOnboarding();
  }

  // Public method to check if user should see onboarding
  checkAndShowOnboarding(user) {
    if (this.shouldShowOnboarding(user)) {
      // Small delay to let the main app load, then show immediately
      setTimeout(() => {
        this.startOnboarding();
      }, 500);
    }
  }

  // Show welcome popup for any new user (even if they've seen onboarding)
  showWelcomePopup(user) {
    // Check if this is a very new user (signed up in last 30 minutes)
    if (user && user.metadata && user.metadata.creationTime) {
      const signupTime = new Date(user.metadata.creationTime);
      const now = new Date();
      const minutesAgo = (now - signupTime) / (1000 * 60);
      
      if (minutesAgo < 30) {
        // Show a simplified welcome popup first
        setTimeout(() => {
          this.showSimpleWelcome();
        }, 800);
        return;
      }
    }
  }

  showSimpleWelcome() {
    const welcomePopup = document.createElement('div');
    welcomePopup.className = 'welcome-popup';
    welcomePopup.innerHTML = `
      <div class="welcome-popup-content">
        <div class="welcome-icon">🎉</div>
        <h2>Welcome to Masky!</h2>
        <p>Ready to create amazing AI avatars and voice clones?</p>
        <div class="welcome-actions">
          <button class="btn btn-primary" onclick="this.parentElement.parentElement.parentElement.remove(); onboardingManager.startOnboarding();">Show Me Around</button>
          <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove();">I'll Explore</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(welcomePopup);
    
    // Auto-fade in
    setTimeout(() => welcomePopup.classList.add('active'), 100);
    
    // Auto-remove after 10 seconds if no action
    setTimeout(() => {
      if (welcomePopup.parentNode) {
        welcomePopup.classList.remove('active');
        setTimeout(() => welcomePopup.remove(), 300);
      }
    }, 10000);
  }
}

// Initialize the onboarding manager
const onboardingManager = new OnboardingManager();

// Export for use in main.js
window.onboardingManager = onboardingManager;

export { OnboardingManager, onboardingManager };