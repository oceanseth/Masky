import './styles/main.css';
import './styles/navigation.css';
import './styles/landing.css';
import './styles/dashboard.css';
import './styles/modal.css';
import './styles/icons.css';
import './styles/vods.css';
import './styles/voiceCloner.css';
import './styles/quickstart.css';

// Import i18n
import i18next from './i18n.js';
import { updateContent, changeLanguage, t } from './localeHelper.js';

import { 
  signInWithTwitch, 
  signInWithGoogle, 
  signInWithEmail, 
  createAccountWithEmail,
  signOut,
  onAuthChange,
  handleTwitchCallback,
  getCurrentUser
} from './firebase';

import { config } from './config';
import { fetchTwitchVods, renderVods, showAndLoadVods } from './vods.js';
import { onboardingManager } from './onboarding.js';
import { quickStartGuide } from './quickStart.js';
import { welcomeNotification } from './welcomeNotification.js';

// Make onboarding manager globally available
window.onboardingManager = onboardingManager;

// State management
window.state = {
  isLoggedIn: false,
  user: null,
  connections: {
    twitch: false
  },
  alerts: [],
  twitchAuth: null
};

// Modal functions
window.showLogin = function() {
  document.getElementById('authModal').classList.add('active');
  document.body.classList.add('modal-open');
  switchToLogin();
};

window.showSignup = function() {
  document.getElementById('authModal').classList.add('active');
  document.body.classList.add('modal-open');
  switchToSignup();
};

window.closeModal = function() {
  document.getElementById('authModal').classList.remove('active');
  document.body.classList.remove('modal-open');
};

function switchToLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('signupForm').style.display = 'none';
}

function switchToSignup() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'block';
}

window.switchToLogin = switchToLogin;
window.switchToSignup = switchToSignup;

window.scrollToFeatures = function() {
  document.getElementById('features').scrollIntoView({ behavior: 'smooth' });
};

// Make i18n functions available globally
window.changeLanguage = changeLanguage;
window.t = t;

// Auth functions with Firebase
window.loginWithTwitch = async function() {
  try {
    const result = await signInWithTwitch();
    console.log('Logged in with Twitch:', result);
    closeModal();
    
    // If we have Twitch authentication data, show and load VODs
    if (result && result.accessToken && result.userId) {
      state.connections.twitch = true;
      const card = document.getElementById('twitchCard');
      if (card) {
        card.classList.add('connected');
        card.querySelector('.social-status').textContent = 'Connected ✓';
        const btn = card.querySelector('.btn');
        if (btn) {
          btn.textContent = 'Disconnect';
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
        }
      }
      
      await showAndLoadVods(result.accessToken, result.userId);
    }
  } catch (error) {
    alert('Failed to sign in with Twitch: ' + error.message);
  }
};

window.loginWithGoogle = async function() {
  try {
    const user = await signInWithGoogle();
    console.log('Logged in with Google:', user);
    closeModal();
  } catch (error) {
    alert('Failed to sign in with Google: ' + error.message);
  }
};

window.login = async function() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  if (!email || !password) {
    alert('Please enter email and password');
    return;
  }

  try {
    const user = await signInWithEmail(email, password);
    console.log('Logged in with email:', user);
    closeModal();
  } catch (error) {
    alert('Failed to sign in: ' + error.message);
  }
};

window.signup = async function() {
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  
  if (!email || !password) {
    alert('Please enter email and password');
    return;
  }

  if (password.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }

  try {
    const user = await createAccountWithEmail(email, password);
    console.log('Account created:', user);
    closeModal();
  } catch (error) {
    alert('Failed to create account: ' + error.message);
  }
};

window.logout = async function() {
  try {
    await signOut();
    state.isLoggedIn = false;
    state.user = null;
    showLanding();
  } catch (error) {
    alert('Failed to sign out: ' + error.message);
  }
};

// Alias for signOut to match navigation button
window.signOut = window.logout;

// Mobile menu functions
window.toggleMobileMenu = function() {
  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu) {
    mobileMenu.classList.toggle('show');
  }
};

window.closeMobileMenu = function() {
  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu) {
    mobileMenu.classList.remove('show');
  }
};

// Membership function
window.showMembership = function() {
  // Navigate to membership page
  window.location.href = '/membership.html';
};

// Close mobile menu when clicking outside
document.addEventListener('click', function(event) {
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  
  if (mobileMenu && mobileMenuBtn && 
      !mobileMenu.contains(event.target) && 
      !mobileMenuBtn.contains(event.target)) {
    mobileMenu.classList.remove('show');
  }
});

function showDashboard() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  if (state.user) {
    const username = state.user.displayName || state.user.email?.split('@')[0] || 'Creator';
    // Update the username span in the dashboard title
    const usernameElement = document.getElementById('username');
    if (usernameElement) {
      usernameElement.textContent = username;
    }
  }
  // Update content after showing dashboard to ensure translations are applied
  updateContent();
}

function showLanding() {
  document.getElementById('landing').style.display = 'flex';
  document.getElementById('dashboard').classList.remove('active');
}

// Listen for auth state changes
onAuthChange((user) => {
    if (user) {
        state.isLoggedIn = true;
        state.user = user;
        showDashboard();
        
        // Check if Twitch connection exists
        checkTwitchConnection();
        
        // Show VODs section (will display connection message if needed)
        const vodsSection = document.getElementById('vodsSection');
        if (vodsSection) {
            vodsSection.style.display = 'block';
            vodsSection.classList.add('active');
        }
        
        // Load and display membership status
        loadMembershipStatus();
        
        // Show welcome popup for brand new users
        onboardingManager.showWelcomePopup(user);
        
        // Show friendly welcome notification 
        welcomeNotification.showWelcomeForNewUser(user);
        
        // Check if new user needs full onboarding (but don't force it)
        onboardingManager.checkAndShowOnboarding(user);
        
        // Show quick start guide for users who completed onboarding or existing users (but less prominently)
        setTimeout(() => {
            if (!onboardingManager.shouldShowOnboarding(user)) {
                // Only show quick start if user has been around for more than an hour
                if (user && user.metadata && user.metadata.creationTime) {
                    const signupTime = new Date(user.metadata.creationTime);
                    const now = new Date();
                    const hoursAgo = (now - signupTime) / (1000 * 60 * 60);
                    
                    if (hoursAgo > 1) {
                        quickStartGuide.show();
                    }
                } else {
                    quickStartGuide.show();
                }
            }
        }, 3000);
        
        // Update navigation buttons for logged in state
        const navSignIn = document.getElementById('navSignIn');
        const navSignUp = document.getElementById('navSignUp');
        const navHelp = document.getElementById('navHelp');
        const navSignOut = document.getElementById('navSignOut');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const mobileHelp = document.getElementById('mobileHelp');
        const mobileSignOut = document.getElementById('mobileSignOut');
        const mobileMembership = document.getElementById('mobileMembership');
        const mobileSignInBtn = document.getElementById('mobileSignInBtn');
        const mobileSignUpBtn = document.getElementById('mobileSignUpBtn');
        
        if (navSignIn) navSignIn.style.display = 'none';
        if (navSignUp) navSignUp.style.display = 'none';
        if (navHelp) navHelp.style.display = 'none';
        if (navSignOut) navSignOut.style.display = 'none';
        
        // Show mobile menu and logged-in mobile buttons
        if (mobileMenuBtn) mobileMenuBtn.style.display = 'flex';
        if (mobileHelp) mobileHelp.style.display = 'flex';
        if (mobileSignOut) mobileSignOut.style.display = 'flex';
        if (mobileMembership) mobileMembership.style.display = 'flex';
        
        // Hide logged-out mobile buttons
        if (mobileSignInBtn) mobileSignInBtn.style.display = 'none';
        if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'none';
  } else {
    state.isLoggedIn = false;
    state.user = null;
    showLanding();
    
    // Hide membership link when logged out
    const membershipLink = document.getElementById('membershipLink');
    if (membershipLink) {
      membershipLink.style.display = 'none';
    }

    // Update navigation buttons for logged out state
    const navSignIn = document.getElementById('navSignIn');
    const navSignUp = document.getElementById('navSignUp');
    const navHelp = document.getElementById('navHelp');
    const navSignOut = document.getElementById('navSignOut');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileHelp = document.getElementById('mobileHelp');
    const mobileSignOut = document.getElementById('mobileSignOut');
    const mobileMembership = document.getElementById('mobileMembership');
    const mobileSignInBtn = document.getElementById('mobileSignInBtn');
    const mobileSignUpBtn = document.getElementById('mobileSignUpBtn');
    
    if (navSignIn) navSignIn.style.display = 'none';
    if (navSignUp) navSignUp.style.display = 'none';
    if (navHelp) navHelp.style.display = 'none';
    if (navSignOut) navSignOut.style.display = 'none';
    
    // Always show mobile menu button
    if (mobileMenuBtn) mobileMenuBtn.style.display = 'flex';
    
    // Show logged-out mobile buttons
    if (mobileSignInBtn) mobileSignInBtn.style.display = 'flex';
    if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'flex';
    
    // Hide logged-in mobile buttons
    if (mobileHelp) mobileHelp.style.display = 'none';
    if (mobileSignOut) mobileSignOut.style.display = 'none';
    if (mobileMembership) mobileMembership.style.display = 'none';
    closeMobileMenu();
  }
});

// Load and display membership status in navigation
async function loadMembershipStatus() {
  try {
    const user = getCurrentUser();
    if (!user) return;

    const idToken = await user.getIdToken();
    
    const response = await fetch(`${config.api.baseUrl}/api/subscription/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const subscription = data.subscription;
      
      // Update membership badge in navigation
      const membershipLink = document.getElementById('membershipLink');
      const membershipBadge = document.getElementById('membershipBadge');
      
      if (membershipLink && membershipBadge) {
        membershipLink.style.display = 'inline-block';
        
        if (subscription && subscription.tier) {
          const tierName = subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);
          membershipBadge.textContent = tierName;
        } else {
          membershipBadge.textContent = 'Free';
        }
      }
    }
  } catch (error) {
    console.error('Error loading membership status:', error);
    // Still show the membership link even if status fetch fails
    const membershipLink = document.getElementById('membershipLink');
    if (membershipLink) {
      membershipLink.style.display = 'inline-block';
    }
  }
}

// Connection functions
window.connectTwitch = async function() {
  try {
    const result = await signInWithTwitch();
    console.log('Connected with Twitch:', result);
    
    // If we have Twitch authentication data, show and load VODs
    if (result && result.accessToken && result.userId) {
      state.connections.twitch = true;
      const card = document.getElementById('twitchCard');
      if (card) {
        card.classList.add('connected');
        card.querySelector('.social-status').textContent = 'Connected ✓';
        const btn = card.querySelector('.btn');
        if (btn) {
          btn.textContent = 'Disconnect';
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
        }
      }
      
      await showAndLoadVods(result.accessToken, result.userId);
      
      // Show success notification
      welcomeNotification.showContextualTip('connected-twitch');
    }
  } catch (error) {
    console.error('Failed to connect Twitch:', error);
    alert('Failed to connect Twitch: ' + error.message);
  }
};

function markTwitchConnected() {
  state.connections.twitch = true;
  const card = document.getElementById('twitchCard');
  card.classList.add('connected');
  card.querySelector('.social-status').textContent = 'Connected ✓';
  const btn = card.querySelector('.btn');
  btn.textContent = 'Disconnect';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-secondary');
  checkAllConnections();
}

async function checkTwitchConnection() {
  // Check if user has Twitch provider linked
  const user = state.user;
  if (user && user.providerData) {
    // Check if the user's initial login was through Twitch
    const initialProvider = user.providerData[0];
    const isInitialTwitch = initialProvider && 
      (initialProvider.providerId === 'oidc.twitch' || initialProvider.providerId === 'twitch.tv');

    // Check if Twitch is connected (either as initial or secondary provider)
    const hasTwitch = user.providerData.some(provider => 
      provider.providerId === 'oidc.twitch' || provider.providerId === 'twitch.tv'
    );

    if (hasTwitch) {
      markTwitchConnected();
    }

    // Hide the entire social linking section if user initially logged in with Twitch
    if (isInitialTwitch) {
      // Hide the entire social linking section since user logged in via Twitch
      const socialLinking = document.getElementById('socialLinking');
      if (socialLinking) {
        socialLinking.style.display = 'none';
      }
    }
  }
}

function checkAllConnections() {
  if (state.connections.twitch) {
    document.getElementById('alertsSection').style.display = 'block';
  } else {
    document.getElementById('alertsSection').style.display = 'none';
  }
}

// Alert functions
window.createNewAlert = function() {
  const alert = {
    id: Date.now(),
    type: 'New Subscriber',
    url: `https://masky.io/alert/${Date.now()}`,
    avatar: 'AI Avatar',
    script: 'Thank you for subscribing!'
  };
  
  state.alerts.push(alert);
  renderAlerts();
};

function renderAlerts() {
  const grid = document.getElementById('alertsGrid');
  
  if (state.alerts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${t('dashboard.emptyStateIcon')}</div>
        <p>${t('dashboard.emptyStateText')}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.alerts.map(alert => `
    <div class="alert-card">
      <div class="alert-header">
        <div class="alert-type">${alert.type}</div>
        <div class="alert-actions">
          <button class="icon-btn" title="Edit">✏️</button>
          <button class="icon-btn" title="Copy URL" onclick="copyUrl('${alert.url}')">🔗</button>
          <button class="icon-btn" onclick="deleteAlert(${alert.id})" title="Delete">🗑️</button>
        </div>
      </div>
      <div style="color: rgba(255,255,255,0.6); font-size: 1rem; margin-bottom: 0.8rem;">
        <strong>Avatar:</strong> ${alert.avatar}
      </div>
      <div style="color: rgba(255,255,255,0.5); font-size: 0.95rem; font-style: italic; margin-bottom: 0.5rem;">
        "${alert.script}"
      </div>
      <div class="alert-url">${alert.url}</div>
    </div>
  `).join('');
}

window.deleteAlert = function(id) {
  state.alerts = state.alerts.filter(a => a.id !== id);
  renderAlerts();
};

window.copyUrl = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    alert('URL copied to clipboard!');
  });
};

// Close modal on outside click
document.getElementById('authModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeModal();
  }
});

// Initialize
renderAlerts();


// Check if this is an OAuth callback
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('code') && urlParams.has('state')) {
  // This is a Twitch OAuth callback
  handleTwitchCallback().then(() => {
    // Callback handled successfully, user will be signed in via onAuthChange
    console.log('Successfully authenticated with Twitch');
  }).catch((error) => {
    console.error('Failed to handle Twitch callback:', error);
    alert('Failed to sign in with Twitch: ' + error.message);
    // Redirect to home on error
    window.location.href = '/';
  });
}

// Initialize Voice Cloner when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Import and initialize voice cloner
  import('./voiceCloner.js').then(module => {
    if (window.InstantVoiceCloner) {
      window.voiceCloner = new window.InstantVoiceCloner().init();
      console.log('Voice cloner initialized');
      
      // Load any saved voice
      setTimeout(() => {
        window.voiceCloner.loadSavedVoice();
      }, 1000);
    }
  }).catch(error => {
    console.log('Voice cloner not available:', error);
  });
});

