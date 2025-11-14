// Welcome Notification System for Masky
class WelcomeNotification {
  constructor() {
    this.notifications = [];
    this.container = null;
    this.init();
  }

  init() {
    this.createContainer();
  }

  createContainer() {
    if (this.container) return;
    
    this.container = document.createElement('div');
    this.container.id = 'welcomeNotifications';
    this.container.className = 'welcome-notifications-container';
    document.body.appendChild(this.container);
    
    // Add styles
    this.addStyles();
  }

  addStyles() {
    if (document.querySelector('#welcome-notification-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'welcome-notification-styles';
    style.textContent = `
      .welcome-notifications-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        pointer-events: none;
        max-width: 400px;
      }

      .welcome-notification {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(101, 163, 255, 0.3);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        pointer-events: auto;
        transform: translateX(100%);
        transition: all 0.4s cubic-bezier(0.23, 1, 0.320, 1);
        opacity: 0;
      }

      .welcome-notification.show {
        transform: translateX(0);
        opacity: 1;
      }

      .welcome-notification.hide {
        transform: translateX(100%);
        opacity: 0;
      }

      .notification-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
      }

      .notification-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        color: #fff;
        font-size: 1rem;
      }

      .notification-icon {
        font-size: 1.2rem;
      }

      .notification-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        padding: 0.25rem;
        border-radius: 4px;
        transition: all 0.2s ease;
        font-size: 1.1rem;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .notification-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }

      .notification-message {
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.9rem;
        line-height: 1.4;
        margin-bottom: 1rem;
      }

      .notification-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .notification-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-block;
        text-align: center;
        font-weight: 500;
      }

      .notification-btn.primary {
        background: linear-gradient(45deg, #65a3ff, #8b5cf6);
        color: white;
      }

      .notification-btn.primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(101, 163, 255, 0.3);
      }

      .notification-btn.secondary {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .notification-btn.secondary:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .notification-progress {
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 1rem;
      }

      .notification-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #65a3ff, #8b5cf6);
        transition: width 0.1s linear;
      }

      @media (max-width: 768px) {
        .welcome-notifications-container {
          left: 20px;
          right: 20px;
          max-width: none;
        }
        
        .welcome-notification {
          padding: 1.25rem;
        }
        
        .notification-actions {
          flex-direction: column;
        }
        
        .notification-btn {
          text-align: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  show(options = {}) {
    const {
      title = 'Welcome to Masky! 👋',
      message = 'Ready to create amazing AI avatars and voice clones from your content?',
      icon = '🎭',
      actions = [
        { text: 'Take Tour', type: 'primary', action: () => this.startTour() },
        { text: 'Explore', type: 'secondary', action: () => this.dismiss() }
      ],
      duration = 12000,
      showProgress = true
    } = options;

    const id = `notification-${Date.now()}`;
    const notification = this.createNotification({
      id, title, message, icon, actions, duration, showProgress
    });

    this.container.appendChild(notification);
    this.notifications.push({ id, element: notification, duration });

    // Show with animation
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);

    // Auto-hide after duration
    if (duration > 0) {
      this.scheduleHide(id, duration);
    }

    return id;
  }

  createNotification({ id, title, message, icon, actions, duration, showProgress }) {
    const notification = document.createElement('div');
    notification.className = 'welcome-notification';
    notification.setAttribute('data-id', id);

    notification.innerHTML = `
      <div class="notification-header">
        <div class="notification-title">
          <span class="notification-icon">${icon}</span>
          ${title}
        </div>
        <button class="notification-close" onclick="welcomeNotification.hide('${id}')">
          ×
        </button>
      </div>
      <div class="notification-message">${message}</div>
      <div class="notification-actions">
        ${actions.map((action, index) => `
          <button class="notification-btn ${action.type}" onclick="welcomeNotification.executeAction('${id}', ${index})">
            ${action.text}
          </button>
        `).join('')}
      </div>
      ${showProgress && duration > 0 ? `
        <div class="notification-progress">
          <div class="notification-progress-fill" id="progress-${id}"></div>
        </div>
      ` : ''}
    `;

    // Store actions for later execution
    notification._actions = actions;

    return notification;
  }

  scheduleHide(id, duration) {
    const progressBar = document.getElementById(`progress-${id}`);
    
    if (progressBar) {
      // Animate progress bar
      progressBar.style.width = '100%';
      progressBar.style.transition = `width ${duration}ms linear`;
      
      setTimeout(() => {
        progressBar.style.width = '0%';
      }, 100);
    }

    setTimeout(() => {
      this.hide(id);
    }, duration);
  }

  hide(id) {
    const notification = this.container.querySelector(`[data-id="${id}"]`);
    if (notification) {
      notification.classList.add('hide');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications = this.notifications.filter(n => n.id !== id);
      }, 400);
    }
  }

  executeAction(notificationId, actionIndex) {
    const notification = this.container.querySelector(`[data-id="${notificationId}"]`);
    if (notification && notification._actions && notification._actions[actionIndex]) {
      const action = notification._actions[actionIndex];
      if (typeof action.action === 'function') {
        action.action();
      }
      // Hide notification after action
      this.hide(notificationId);
    }
  }

  startTour() {
    if (window.onboardingManager) {
      window.onboardingManager.startOnboarding();
    }
  }

  dismiss() {
    // Just close the notification, user can explore on their own
  }

  showWelcomeForNewUser(user) {
    // Check if this is a very new user
    if (user && user.metadata && user.metadata.creationTime) {
      const signupTime = new Date(user.metadata.creationTime);
      const now = new Date();
      const minutesAgo = (now - signupTime) / (1000 * 60);
      
      // Show for users who signed up in the last 2 hours
      if (minutesAgo < 120) {
        setTimeout(() => {
          this.show({
            title: 'Welcome to Masky! 🎉',
            message: 'Transform your videos and audio into AI avatars and voice clones. Want a quick tour of what you can do?',
            icon: '✨',
            duration: 15000,
            actions: [
              { text: '📚 Show Me Around', type: 'primary', action: () => this.startTour() },
              { text: '🚀 I\'ll Explore', type: 'secondary', action: () => this.dismiss() }
            ]
          });
        }, 1500);
      }
    }
  }

  // Show different notifications based on user actions
  showContextualTip(context) {
    const tips = {
      'connected-twitch': {
        title: 'Great! Twitch Connected 🟣',
        message: 'Now your VODs will load automatically. Click on any VOD to extract avatars and voice samples!',
        icon: '✅',
        actions: [{ text: 'Got it!', type: 'primary', action: () => this.dismiss() }],
        duration: 8000
      },
      'uploaded-content': {
        title: 'Content Uploaded! 📁',
        message: 'Your content is ready for processing. You can now create AI avatars and clone voices from your uploads.',
        icon: '🎯',
        actions: [{ text: 'Start Creating', type: 'primary', action: () => this.showCreationOptions() }],
        duration: 10000
      },
      'first-avatar': {
        title: 'Avatar Created! 🎭',
        message: 'Awesome! Your AI avatar is ready. You can now use it in videos, stream alerts, and more.',
        icon: '🎉',
        actions: [{ text: 'See Options', type: 'primary', action: () => this.showAvatarOptions() }],
        duration: 12000
      }
    };

    const tip = tips[context];
    if (tip) {
      this.show(tip);
    }
  }

  showCreationOptions() {
    // Navigate to or highlight creation tools
    const voiceSection = document.querySelector('#voiceCloner') || document.querySelector('.voice-section');
    if (voiceSection) {
      voiceSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  showAvatarOptions() {
    // Show avatar usage options
    this.show({
      title: 'Your Avatar is Ready! 🎭',
      message: 'You can now use your AI avatar for stream alerts, video content, or social media posts.',
      icon: '🚀',
      actions: [
        { text: 'Create Alert', type: 'primary', action: () => this.createAlert() },
        { text: 'Browse Features', type: 'secondary', action: () => this.browseFeatures() }
      ],
      duration: 0 // Don't auto-hide
    });
  }

  createAlert() {
    // Navigate to alert creation
    window.createNewAlert?.();
  }

  browseFeatures() {
    // Show features or navigate to membership
    if (typeof window.showMembership === 'function') {
      window.showMembership();
    } else {
      // Fallback: navigate to home if showMembership not available
      window.location.href = '/';
    }
  }

  // Clear all notifications
  clearAll() {
    this.notifications.forEach(notification => {
      this.hide(notification.id);
    });
  }
}

// Initialize the welcome notification system
const welcomeNotification = new WelcomeNotification();
window.welcomeNotification = welcomeNotification;

export { WelcomeNotification, welcomeNotification };