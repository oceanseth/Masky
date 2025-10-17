import './styles/main.css';
import './styles/navigation.css';
import './styles/landing.css';
import './styles/dashboard.css';
import './styles/modal.css';
import './styles/icons.css';

import { 
  signInWithTwitch, 
  signInWithGoogle, 
  signInWithEmail, 
  createAccountWithEmail,
  signOut,
  onAuthChange 
} from './firebase';

// State management
const state = {
  isLoggedIn: false,
  user: null,
  connections: {
    twitch: false,
    heygen: false,
    hume: false
  },
  alerts: []
};

// Modal functions
window.showLogin = function() {
  document.getElementById('authModal').classList.add('active');
  switchToLogin();
};

window.showSignup = function() {
  document.getElementById('authModal').classList.add('active');
  switchToSignup();
};

window.closeModal = function() {
  document.getElementById('authModal').classList.remove('active');
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

// Auth functions with Firebase
window.loginWithTwitch = async function() {
  try {
    const user = await signInWithTwitch();
    console.log('Logged in with Twitch:', user);
    closeModal();
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

function showDashboard() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  if (state.user) {
    document.getElementById('username').textContent = state.user.displayName || state.user.email?.split('@')[0] || 'Creator';
  }
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
  } else {
    state.isLoggedIn = false;
    state.user = null;
    showLanding();
  }
});

// Connection functions
window.connectTwitch = async function() {
  if (state.connections.twitch) {
    // Handle disconnect
    if (confirm('Are you sure you want to disconnect your Twitch account?')) {
      state.connections.twitch = false;
      const card = document.getElementById('twitchCard');
      card.classList.remove('connected');
      card.querySelector('.social-status').textContent = 'Not Connected';
      const btn = card.querySelector('.btn');
      btn.textContent = 'Connect Twitch';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      checkAllConnections();
    }
  } else {
    // Use Firebase Twitch login
    try {
      await loginWithTwitch();
      markTwitchConnected();
    } catch (error) {
      alert('Failed to connect Twitch: ' + error.message);
    }
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
    const hasTwitch = user.providerData.some(provider => 
      provider.providerId === 'oidc.twitch'
    );
    if (hasTwitch) {
      markTwitchConnected();
    }
  }
}

window.connectHeygen = function() {
  if (state.connections.heygen) {
    // Handle disconnect
    if (confirm('Are you sure you want to disconnect your HeyGen account?')) {
      localStorage.removeItem('heygen_token');
      state.connections.heygen = false;
      const card = document.getElementById('heygenCard');
      card.classList.remove('connected');
      card.querySelector('.social-status').textContent = 'Not Connected';
      const btn = card.querySelector('.btn');
      btn.textContent = 'Connect HeyGen';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    }
  } else {
    alert('HeyGen integration coming soon!');
  }
};

window.connectHume = function() {
  if (state.connections.hume) {
    // Handle disconnect
    if (confirm('Are you sure you want to disconnect your Hume AI account?')) {
      localStorage.removeItem('hume_token');
      state.connections.hume = false;
      const card = document.getElementById('humeCard');
      card.classList.remove('connected');
      card.querySelector('.social-status').textContent = 'Not Connected';
      const btn = card.querySelector('.btn');
      btn.textContent = 'Connect Hume';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    }
  } else {
    alert('Hume AI integration coming soon!');
  }
};

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
    avatar: 'HeyGen Avatar',
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
        <div class="empty-state-icon">✨</div>
        <p>No alerts yet. Create your first alert to get started!</p>
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

