# Subscription System Usage Examples

This document provides practical examples of how to use the subscription system in your application.

## Table of Contents
1. [Frontend Examples](#frontend-examples)
2. [Backend Examples](#backend-examples)
3. [Common Patterns](#common-patterns)

## Frontend Examples

### 1. Check User's Subscription Tier

```javascript
// src/your-component.js
import { getCurrentUser } from './firebase';
import { config } from './config';

async function getUserSubscriptionInfo() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return { tier: 'free' };
    }

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
      return data.subscription;
    }

    return { tier: 'free' };
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return { tier: 'free' };
  }
}
```

### 2. Show Upgrade Prompt When Limit Reached

```javascript
// src/avatar-creator.js
import { getCurrentUser } from './firebase';
import { config } from './config';

async function createNewAvatar(avatarData) {
  try {
    const user = getCurrentUser();
    const idToken = await user.getIdToken();

    const response = await fetch(`${config.api.baseUrl}/api/avatars/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(avatarData)
    });

    if (response.status === 403) {
      // Limit reached
      const error = await response.json();
      
      // Show upgrade modal
      showUpgradeModal({
        title: 'Avatar Limit Reached',
        message: error.message,
        currentTier: error.upgrade.currentTier,
        nextTier: error.upgrade.nextTier,
        onUpgrade: () => {
          window.location.href = '/membership.html';
        }
      });
      
      return null;
    }

    if (!response.ok) {
      throw new Error('Failed to create avatar');
    }

    const data = await response.json();
    return data.avatar;

  } catch (error) {
    console.error('Error creating avatar:', error);
    throw error;
  }
}

function showUpgradeModal({ title, message, currentTier, nextTier, onUpgrade }) {
  // Your modal implementation
  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${title}</h2>
      <p>${message}</p>
      <div class="modal-actions">
        <button onclick="this.closest('.upgrade-modal').remove()">Cancel</button>
        <button class="btn-primary" onclick="window.location.href='/membership.html'">
          Upgrade to ${nextTier}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
```

### 3. Conditionally Show Features Based on Tier

```javascript
// src/main.js
async function initializeDashboard() {
  const subscription = await getUserSubscriptionInfo();
  const tier = subscription.tier || 'free';

  // Show/hide features based on tier
  const customScriptsFeature = document.getElementById('customScripts');
  const apiAccessFeature = document.getElementById('apiAccess');
  const advancedAnalytics = document.getElementById('advancedAnalytics');

  if (tier === 'free') {
    // Hide premium features
    customScriptsFeature.style.display = 'none';
    apiAccessFeature.style.display = 'none';
    advancedAnalytics.style.display = 'none';
    
    // Show upgrade prompts
    showFeatureLockedBadges();
  } else if (tier === 'standard') {
    // Show standard features
    customScriptsFeature.style.display = 'block';
    advancedAnalytics.style.display = 'block';
    
    // Hide pro-only features
    apiAccessFeature.style.display = 'none';
  } else if (tier === 'pro') {
    // Show all features
    customScriptsFeature.style.display = 'block';
    apiAccessFeature.style.display = 'block';
    advancedAnalytics.style.display = 'block';
  }

  // Update avatar/voice limits display
  updateLimitsDisplay(tier);
}

function updateLimitsDisplay(tier) {
  const limits = {
    free: { avatars: 1, voices: 1 },
    standard: { avatars: 5, voices: 10 },
    pro: { avatars: '∞', voices: '∞' }
  };

  const tierLimits = limits[tier] || limits.free;
  
  document.getElementById('avatarLimit').textContent = 
    `${currentAvatarCount}/${tierLimits.avatars} avatars`;
  document.getElementById('voiceLimit').textContent = 
    `${currentVoiceCount}/${tierLimits.voices} voices`;
}
```

### 4. Real-time Subscription Status Updates

```javascript
// src/subscription-monitor.js
import { onAuthChange } from './firebase';

// Listen for auth state changes (which include custom claims)
let subscriptionChangeCallback = null;

export function onSubscriptionChange(callback) {
  subscriptionChangeCallback = callback;
  
  return onAuthChange(async (user) => {
    if (user) {
      // Force token refresh to get latest claims
      const idTokenResult = await user.getIdTokenResult(true);
      const tier = idTokenResult.claims.subscriptionTier || 'free';
      
      if (subscriptionChangeCallback) {
        subscriptionChangeCallback({
          tier: tier,
          status: idTokenResult.claims.subscriptionStatus || 'active',
          cancelAtPeriodEnd: idTokenResult.claims.cancelAtPeriodEnd || false
        });
      }
    }
  });
}

// Usage in your app
onSubscriptionChange((subscription) => {
  console.log('Subscription changed:', subscription);
  updateUIBasedOnTier(subscription.tier);
});
```

## Backend Examples

### 1. Enforce Avatar Creation Limit

```javascript
// api/avatars.js
const { enforceLimit } = require('../utils/subscriptionHelper');
const admin = require('firebase-admin');

async function createAvatar(event) {
  try {
    // Authenticate user
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Parse request body
    const body = JSON.parse(event.body);

    // Check current avatar count
    const db = admin.firestore();
    const avatarsSnapshot = await db.collection('avatars')
      .where('userId', '==', userId)
      .get();
    
    const currentCount = avatarsSnapshot.size;

    // Enforce limit
    const limitCheck = await enforceLimit(userId, 'avatars', currentCount);
    
    if (!limitCheck.allowed) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Avatar limit reached',
          message: limitCheck.message,
          upgrade: limitCheck.upgrade
        })
      };
    }

    // Create avatar
    const avatarRef = await db.collection('avatars').add({
      userId: userId,
      name: body.name,
      config: body.config,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Avatar created successfully',
        avatar: {
          id: avatarRef.id,
          ...body
        },
        remaining: limitCheck.remaining
      })
    };

  } catch (error) {
    console.error('Error creating avatar:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to create avatar',
        message: error.message
      })
    };
  }
}

module.exports = { createAvatar };
```

### 2. Check Feature Access

```javascript
// api/custom-scripts.js
const { getUserSubscriptionTier, hasFeature } = require('../utils/subscriptionHelper');
const admin = require('firebase-admin');

async function saveCustomScript(event) {
  try {
    // Authenticate user
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Check if user has access to custom scripts
    const tier = await getUserSubscriptionTier(userId);
    
    if (!hasFeature(tier, 'customScripts')) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Feature not available',
          message: 'Custom scripts are only available on Standard and Pro plans',
          currentTier: tier,
          requiredTier: 'standard'
        })
      };
    }

    // Parse and save custom script
    const body = JSON.parse(event.body);
    const db = admin.firestore();
    
    await db.collection('customScripts').add({
      userId: userId,
      script: body.script,
      alertType: body.alertType,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Custom script saved successfully'
      })
    };

  } catch (error) {
    console.error('Error saving custom script:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to save custom script',
        message: error.message
      })
    };
  }
}

module.exports = { saveCustomScript };
```

### 3. Middleware for Tier Verification

```javascript
// api/middleware/tierCheck.js
const { getUserSubscriptionTier, hasFeature } = require('../../utils/subscriptionHelper');
const admin = require('firebase-admin');

/**
 * Middleware to check if user has required tier
 * Usage: const userTier = await requireTier(event, 'standard');
 */
async function requireTier(event, requiredTier) {
  // Authenticate user
  const authHeader = event.headers.Authorization || event.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const idToken = authHeader.split('Bearer ')[1];
  const decodedToken = await admin.auth().verifyIdToken(idToken);
  const userId = decodedToken.uid;

  // Get user's tier
  const userTier = await getUserSubscriptionTier(userId);
  
  // Check if tier meets requirement
  const tierHierarchy = { free: 0, standard: 1, pro: 2 };
  
  if (tierHierarchy[userTier] < tierHierarchy[requiredTier]) {
    const error = new Error('Insufficient subscription tier');
    error.statusCode = 403;
    error.data = {
      currentTier: userTier,
      requiredTier: requiredTier,
      message: `This feature requires ${requiredTier} or higher plan`
    };
    throw error;
  }

  return { userId, tier: userTier, decodedToken };
}

/**
 * Middleware to check if user has specific feature
 * Usage: const userInfo = await requireFeature(event, 'apiAccess');
 */
async function requireFeature(event, featureName) {
  const authHeader = event.headers.Authorization || event.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const idToken = authHeader.split('Bearer ')[1];
  const decodedToken = await admin.auth().verifyIdToken(idToken);
  const userId = decodedToken.uid;

  const userTier = await getUserSubscriptionTier(userId);
  
  if (!hasFeature(userTier, featureName)) {
    const error = new Error('Feature not available');
    error.statusCode = 403;
    error.data = {
      currentTier: userTier,
      feature: featureName,
      message: `Feature '${featureName}' is not available in your current plan`
    };
    throw error;
  }

  return { userId, tier: userTier, decodedToken };
}

module.exports = {
  requireTier,
  requireFeature
};
```

### 4. Using the Middleware

```javascript
// api/api-keys.js
const { requireFeature } = require('./middleware/tierCheck');
const admin = require('firebase-admin');

async function generateApiKey(event) {
  try {
    // Check if user has API access (Pro only)
    const { userId, tier } = await requireFeature(event, 'apiAccess');

    // Generate API key
    const crypto = require('crypto');
    const apiKey = 'mk_' + crypto.randomBytes(32).toString('hex');

    // Save to Firestore
    const db = admin.firestore();
    await db.collection('apiKeys').add({
      userId: userId,
      key: apiKey,
      tier: tier,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsed: null,
      requestCount: 0
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'API key generated successfully',
        apiKey: apiKey
      })
    };

  } catch (error) {
    console.error('Error generating API key:', error);
    
    if (error.statusCode) {
      return {
        statusCode: error.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: error.message,
          ...error.data
        })
      };
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to generate API key',
        message: error.message
      })
    };
  }
}

module.exports = { generateApiKey };
```

## Common Patterns

### 1. Progressive Disclosure

Show features but lock them behind upgrade prompts:

```javascript
// Show feature with lock icon
function renderFeature(feature, tier) {
  const isLocked = !hasFeatureAccess(feature, tier);
  
  return `
    <div class="feature ${isLocked ? 'locked' : ''}">
      <div class="feature-header">
        <h3>${feature.name}</h3>
        ${isLocked ? '<span class="lock-icon">🔒</span>' : ''}
      </div>
      <p>${feature.description}</p>
      ${isLocked ? `
        <button class="upgrade-btn" onclick="window.location.href='/membership.html'">
          Upgrade to unlock
        </button>
      ` : `
        <button class="use-btn" onclick="useFeature('${feature.id}')">
          Use feature
        </button>
      `}
    </div>
  `;
}
```

### 2. Soft Limits with Grace Period

Allow users to exceed limits but show warnings:

```javascript
async function createWithSoftLimit(userId, resourceType, currentCount) {
  const limitCheck = await enforceLimit(userId, resourceType, currentCount);
  
  if (!limitCheck.allowed) {
    const gracePeriod = 3; // Allow 3 extra
    
    if (currentCount < limitCheck.limit + gracePeriod) {
      // Allow but warn
      return {
        allowed: true,
        warning: true,
        message: `You've exceeded your ${resourceType} limit. Please upgrade to avoid restrictions.`
      };
    } else {
      // Hard block
      return {
        allowed: false,
        message: limitCheck.message
      };
    }
  }
  
  return { allowed: true };
}
```

### 3. Trial Period Implementation

Give new users temporary access to premium features:

```javascript
async function checkTrialStatus(userId) {
  const db = admin.firestore();
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  // Check if user is in trial period (7 days)
  const createdAt = userData.createdAt?.toDate();
  const now = new Date();
  const daysSinceSignup = (now - createdAt) / (1000 * 60 * 60 * 24);
  
  if (daysSinceSignup <= 7 && !userData.subscriptionTier) {
    return {
      inTrial: true,
      daysRemaining: Math.ceil(7 - daysSinceSignup),
      effectiveTier: 'standard' // Give standard features during trial
    };
  }
  
  return {
    inTrial: false,
    effectiveTier: userData.subscriptionTier || 'free'
  };
}
```

## Best Practices

1. **Always check on backend**: Never trust frontend tier checks alone
2. **Cache tier information**: Store tier in user session to reduce API calls
3. **Show upgrade paths**: Make it easy for users to upgrade when they hit limits
4. **Graceful degradation**: Handle tier check failures gracefully
5. **Clear messaging**: Tell users exactly what they need to do to unlock features
6. **Track conversions**: Monitor which limit-reached events lead to upgrades
7. **Test thoroughly**: Test all tier transitions and edge cases

## Testing Checklist

- [ ] Free user can create 1 avatar
- [ ] Free user blocked from creating 2nd avatar
- [ ] Standard user can create 5 avatars
- [ ] Pro user can create unlimited avatars
- [ ] Feature checks work correctly for each tier
- [ ] Upgrade prompts appear at correct times
- [ ] Downgrade from Standard to Free enforces new limits
- [ ] Cancel-at-period-end maintains access until end date
- [ ] Webhook updates tier immediately
- [ ] Frontend and backend tier checks match

---

For more information, see:
- [MEMBERSHIP_SETUP.md](./MEMBERSHIP_SETUP.md) - Setup instructions
- [utils/subscriptionHelper.js](./utils/subscriptionHelper.js) - Helper utilities

