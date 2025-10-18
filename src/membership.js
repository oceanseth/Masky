import { auth, getCurrentUser, signOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { config } from './config';

let currentSubscription = null;
let stripePromise = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth state
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadSubscriptionStatus();
        } else {
            // Redirect to home if not logged in
            window.location.href = '/';
        }
    });
});

/**
 * Load user's current subscription status
 */
async function loadSubscriptionStatus() {
    const loadingState = document.getElementById('loadingState');
    const currentSubscriptionCard = document.getElementById('currentSubscription');
    const pricingGrid = document.getElementById('pricingGrid');
    
    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        // Get ID token
        const idToken = await user.getIdToken();
        
        // Fetch subscription status from backend
        const response = await fetch(`${config.api.baseUrl}/api/subscription/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load subscription status');
        }

        const data = await response.json();
        currentSubscription = data.subscription;

        // Hide loading
        loadingState.style.display = 'none';
        pricingGrid.style.display = 'grid';

        // Update UI based on subscription status
        updateSubscriptionUI(currentSubscription);

    } catch (error) {
        console.error('Error loading subscription:', error);
        loadingState.style.display = 'none';
        pricingGrid.style.display = 'grid';
        showMessage('Failed to load subscription status. Please try again.', 'error');
    }
}

/**
 * Update UI based on current subscription
 */
function updateSubscriptionUI(subscription) {
    const currentSubscriptionCard = document.getElementById('currentSubscription');
    const currentTier = document.getElementById('currentTier');
    const subscriptionDetails = document.getElementById('subscriptionDetails');
    const subscriptionStatus = document.getElementById('subscriptionStatus');
    const nextBilling = document.getElementById('nextBilling');

    if (!subscription || subscription.tier === 'free') {
        // Free tier - show only pricing grid
        currentSubscriptionCard.style.display = 'none';
        updatePricingGridButtons('free');
    } else {
        // Paid tier - show current subscription card
        currentSubscriptionCard.classList.add('active');
        
        // Update tier name
        const tierName = subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);
        currentTier.textContent = `${tierName} Plan`;

        // Update status
        if (subscription.status === 'active') {
            subscriptionStatus.textContent = 'Active';
            subscriptionStatus.className = 'subscription-status status-active';
        } else if (subscription.cancelAtPeriodEnd) {
            subscriptionStatus.textContent = 'Canceling';
            subscriptionStatus.className = 'subscription-status status-canceled';
        }

        // Update billing date
        if (subscription.currentPeriodEnd) {
            const date = new Date(subscription.currentPeriodEnd * 1000);
            nextBilling.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            if (subscription.cancelAtPeriodEnd) {
                subscriptionDetails.innerHTML = `Access ends: <span id="nextBilling">${nextBilling.textContent}</span>`;
            } else {
                subscriptionDetails.innerHTML = `Next billing date: <span id="nextBilling">${nextBilling.textContent}</span>`;
            }
        }

        updatePricingGridButtons(subscription.tier);
    }
}

/**
 * Update buttons in pricing grid based on current tier
 */
function updatePricingGridButtons(currentTier) {
    const cards = document.querySelectorAll('.pricing-card');
    
    cards.forEach((card, index) => {
        const button = card.querySelector('.btn');
        const tierNames = ['free', 'standard', 'pro'];
        const tierName = tierNames[index];

        if (tierName === currentTier) {
            button.textContent = 'Current Plan';
            button.className = 'btn current-plan';
            button.disabled = true;
            button.onclick = null;
        } else if (tierNames.indexOf(tierName) < tierNames.indexOf(currentTier)) {
            // Lower tier - allow downgrade
            button.textContent = 'Downgrade';
            button.className = 'btn btn-secondary';
            button.disabled = false;
            button.onclick = () => openCustomerPortal();
        } else {
            // Higher tier - allow upgrade
            const tierLabel = tierName.charAt(0).toUpperCase() + tierName.slice(1);
            button.textContent = `Upgrade to ${tierLabel}`;
            button.className = 'btn btn-primary';
            button.disabled = false;
        }
    });
}

/**
 * Subscribe to a plan
 */
window.subscribeToPlan = async function(tier) {
    try {
        const user = getCurrentUser();
        if (!user) {
            showMessage('Please sign in to subscribe', 'error');
            return;
        }

        // Get price ID from config
        const priceId = config.stripe.prices[tier];
        if (!priceId) {
            showMessage('Invalid plan selected', 'error');
            return;
        }

        showMessage('Redirecting to checkout...', 'success');

        // Get ID token
        const idToken = await user.getIdToken();

        // Create checkout session
        const response = await fetch(`${config.api.baseUrl}/api/subscription/create-checkout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tier: tier,
                priceId: priceId,
                successUrl: `${window.location.origin}/membership.html?success=true`,
                cancelUrl: `${window.location.origin}/membership.html?canceled=true`
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create checkout session');
        }

        const data = await response.json();

        // Redirect to Stripe Checkout
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error('No checkout URL received');
        }

    } catch (error) {
        console.error('Error subscribing:', error);
        showMessage(error.message || 'Failed to start subscription process', 'error');
    }
};

/**
 * Cancel subscription
 */
window.cancelSubscription = async function() {
    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.')) {
        return;
    }

    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        // Get ID token
        const idToken = await user.getIdToken();

        // Cancel subscription
        const response = await fetch(`${config.api.baseUrl}/api/subscription/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to cancel subscription');
        }

        showMessage('Subscription canceled successfully. You will retain access until the end of your billing period.', 'success');
        
        // Reload subscription status
        await loadSubscriptionStatus();

    } catch (error) {
        console.error('Error canceling subscription:', error);
        showMessage(error.message || 'Failed to cancel subscription', 'error');
    }
};

/**
 * Open Stripe Customer Portal
 */
window.openCustomerPortal = async function() {
    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        showMessage('Redirecting to billing portal...', 'success');

        // Get ID token
        const idToken = await user.getIdToken();

        // Create portal session
        const response = await fetch(`${config.api.baseUrl}/api/subscription/portal`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                returnUrl: `${window.location.origin}/membership.html`
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to open billing portal');
        }

        const data = await response.json();

        // Redirect to portal
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error('No portal URL received');
        }

    } catch (error) {
        console.error('Error opening portal:', error);
        showMessage(error.message || 'Failed to open billing portal', 'error');
    }
};

/**
 * Handle sign out
 */
window.handleSignOut = async function() {
    try {
        await signOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Error signing out:', error);
    }
};

/**
 * Show message to user
 */
function showMessage(message, type) {
    const messageArea = document.getElementById('messageArea');
    messageArea.textContent = message;
    messageArea.className = `message ${type} show`;
    
    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            messageArea.classList.remove('show');
        }, 5000);
    }
}

// Check for URL parameters (success/cancel from Stripe)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('success') === 'true') {
    showMessage('Subscription successful! Welcome to your new plan.', 'success');
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
} else if (urlParams.get('canceled') === 'true') {
    showMessage('Subscription was canceled. You can try again anytime.', 'error');
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
}

