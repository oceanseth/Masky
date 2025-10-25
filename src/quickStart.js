// Quick Start Guide Component for New Users
class QuickStartGuide {
  constructor() {
    this.steps = [
      {
        id: 'connect',
        title: 'Connect Your Accounts',
        description: 'Link Twitch to access your VODs or prepare to upload your content.',
        action: 'Connect Now',
        target: '#twitchCard',
        completed: false
      },
      {
        id: 'upload',
        title: 'Upload Content',
        description: 'Add videos, audio files, or images to create your AI models.',
        action: 'Upload Files',
        target: '#vodsSection',
        completed: false
      },
      {
        id: 'voice',
        title: 'Clone Voice',
        description: 'Build your voice model from audio samples for realistic speech.',
        action: 'Clone Voice',
        target: '#voiceCloner',
        completed: false
      }
    ];
    
    this.isVisible = false;
    this.completedSteps = this.loadProgress();
    this.init();
  }

  init() {
    // Don't auto-show on init - let main.js control when to show
    // This makes it less intrusive for new users
  }

  loadProgress() {
    const saved = localStorage.getItem('quickstart_progress');
    return saved ? JSON.parse(saved) : [];
  }

  saveProgress() {
    localStorage.setItem('quickstart_progress', JSON.stringify(this.completedSteps));
  }

  markStepCompleted(stepId) {
    if (!this.completedSteps.includes(stepId)) {
      this.completedSteps.push(stepId);
      this.saveProgress();
      this.updateUI();
    }
  }

  show() {
    if (this.isVisible) return;
    
    this.isVisible = true;
    this.render();
    this.updateUI();
  }

  hide() {
    const guide = document.getElementById('quickStartGuide');
    if (guide) {
      guide.remove();
    }
    this.isVisible = false;
  }

  dismiss() {
    localStorage.setItem('quickstart_dismissed', 'true');
    this.hide();
  }

  render() {
    // Find insertion point (after dashboard header)
    const dashboardContainer = document.querySelector('.dashboard-container');
    const socialLinking = document.getElementById('socialLinking');
    
    if (!dashboardContainer || !socialLinking) return;

    const guide = document.createElement('div');
    guide.id = 'quickStartGuide';
    guide.className = 'quick-start-guide';
    guide.innerHTML = this.getHTML();

    // Insert before social linking section
    dashboardContainer.insertBefore(guide, socialLinking);

    // Add event listeners
    this.attachEventListeners();
  }

  getHTML() {
    const completedCount = this.completedSteps.length;
    const totalSteps = this.steps.length;
    const progressPercent = (completedCount / totalSteps) * 100;

    return `
      <div class="quick-start-header">
        <div class="quick-start-title">
          <span class="icon">🚀</span>
          Quick Start Guide
        </div>
        <button class="dismiss-guide" onclick="quickStartGuide.dismiss()" title="Dismiss guide">
          ✕
        </button>
      </div>

      <div class="quick-start-steps">
        ${this.steps.map((step, index) => this.renderStep(step, index + 1)).join('')}
      </div>

      <div class="progress-indicator">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progressPercent}%"></div>
        </div>
        <span class="progress-text">${completedCount}/${totalSteps} completed</span>
      </div>

      ${completedCount === totalSteps ? this.renderCompletionCTA() : ''}
    `;
  }

  renderStep(step, number) {
    const isCompleted = this.completedSteps.includes(step.id);
    const completedClass = isCompleted ? ' completed' : '';

    return `
      <div class="quick-start-step${completedClass}" data-step="${step.id}">
        <div class="step-number">${number}</div>
        <div class="step-title">${step.title}</div>
        <div class="step-description">${step.description}</div>
        ${!isCompleted ? `
          <a href="#" class="step-action" onclick="quickStartGuide.executeStep('${step.id}')" data-step-action="${step.id}">
            ${step.action}
          </a>
        ` : ''}
      </div>
    `;
  }

  renderCompletionCTA() {
    return `
      <div class="quick-start-cta">
        <h4>🎉 Great job! You're ready to create amazing content!</h4>
        <p>You've completed the setup. Now you can start using your AI avatars and voice clones.</p>
        <div class="cta-buttons">
          <a href="#" class="step-action primary" onclick="quickStartGuide.openFullTutorial()">
            📚 View Full Tutorial
          </a>
          <a href="/membership.html" class="step-action">
            ⭐ Upgrade Plan
          </a>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Monitor for step completion automatically
    this.monitorStepCompletion();
  }

  monitorStepCompletion() {
    // Monitor Twitch connection
    const twitchCard = document.getElementById('twitchCard');
    if (twitchCard) {
      const observer = new MutationObserver(() => {
        if (twitchCard.classList.contains('connected')) {
          this.markStepCompleted('connect');
        }
      });
      observer.observe(twitchCard, { attributes: true, attributeFilter: ['class'] });
    }

    // Monitor VODs loading
    const vodsContainer = document.getElementById('vodsContainer');
    if (vodsContainer) {
      const observer = new MutationObserver(() => {
        if (vodsContainer.children.length > 0) {
          this.markStepCompleted('upload');
        }
      });
      observer.observe(vodsContainer, { childList: true });
    }

    // Monitor voice cloning activity
    if (window.voiceCloner) {
      const originalCloneVoice = window.voiceCloner.cloneVoice?.bind(window.voiceCloner);
      if (originalCloneVoice) {
        window.voiceCloner.cloneVoice = (...args) => {
          this.markStepCompleted('voice');
          return originalCloneVoice(...args);
        };
      }
    }
  }

  executeStep(stepId) {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) return;

    switch (stepId) {
      case 'connect':
        // Scroll to and highlight Twitch card
        this.highlightElement('#twitchCard');
        document.getElementById('twitchCard')?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        break;

      case 'upload':
        // Scroll to VODs section
        document.getElementById('vodsSection')?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
        this.highlightElement('#vodsSection');
        break;

      case 'voice':
        // Open voice cloner if available
        if (window.voiceCloner && typeof window.voiceCloner.show === 'function') {
          window.voiceCloner.show();
        } else {
          // Scroll to voice cloning section
          const voiceSection = document.querySelector('[data-section="voice"]') || 
                              document.querySelector('.voice-cloner') ||
                              document.getElementById('voiceCloner');
          if (voiceSection) {
            voiceSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.highlightElement(voiceSection);
          }
        }
        break;
    }
  }

  highlightElement(selector) {
    // Remove any existing highlights
    document.querySelectorAll('.quick-start-highlight').forEach(el => {
      el.classList.remove('quick-start-highlight');
    });

    // Add highlight to target element
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (element) {
      element.classList.add('quick-start-highlight');
      
      // Remove highlight after 3 seconds
      setTimeout(() => {
        element.classList.remove('quick-start-highlight');
      }, 3000);
    }
  }

  updateUI() {
    if (!this.isVisible) return;

    const guide = document.getElementById('quickStartGuide');
    if (guide) {
      guide.innerHTML = this.getHTML();
      this.attachEventListeners();
    }
  }

  openFullTutorial() {
    // Launch the full onboarding tutorial
    if (window.onboardingManager) {
      this.dismiss(); // Hide quick start first
      window.onboardingManager.restartOnboarding();
    }
  }

  // Public method to manually show the guide
  static show() {
    if (!window.quickStartGuide) {
      window.quickStartGuide = new QuickStartGuide();
    } else {
      window.quickStartGuide.show();
    }
  }

  // Public method to reset progress
  reset() {
    this.completedSteps = [];
    localStorage.removeItem('quickstart_progress');
    localStorage.removeItem('quickstart_dismissed');
    this.updateUI();
  }
}

// Add highlight styles
const highlightStyle = document.createElement('style');
highlightStyle.textContent = `
  .quick-start-highlight {
    position: relative;
    z-index: 1000;
    animation: quickStartPulse 2s ease-in-out infinite;
  }

  @keyframes quickStartPulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(101, 163, 255, 0.7);
    }
    50% {
      box-shadow: 0 0 0 20px rgba(101, 163, 255, 0);
    }
  }

  .quick-start-highlight::before {
    content: '';
    position: absolute;
    top: -4px;
    left: -4px;
    right: -4px;
    bottom: -4px;
    background: linear-gradient(45deg, #65a3ff, #8b5cf6, #65a3ff);
    background-size: 200% 200%;
    border-radius: inherit;
    z-index: -1;
    animation: quickStartGradient 2s ease infinite;
  }

  @keyframes quickStartGradient {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
`;
document.head.appendChild(highlightStyle);

// Initialize when DOM is ready
const quickStartGuide = new QuickStartGuide();
window.quickStartGuide = quickStartGuide;

export { QuickStartGuide, quickStartGuide };