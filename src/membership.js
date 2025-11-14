import { auth, getCurrentUser, signOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { config } from './config';

let currentSubscription = null;
let stripePromise = null;
let membershipInitialized = false;

/**
 * Initialize membership page functionality
 * This function should be called when the membership section is displayed
 */
export async function initializeMembership() {
    // Only initialize once
    if (membershipInitialized) {
        return;
    }

    updateDisplayedPrices();
    
    // Check auth state
    const user = getCurrentUser();
    if (user) {
        await loadSubscriptionStatus();
    } else {
        // If not logged in, show login message or redirect
        const messageArea = document.getElementById('messageArea');
        if (messageArea) {
            showMessage('Please sign in to view membership plans', 'error');
        }
    }
    
    membershipInitialized = true;
}

/**
 * Reset membership state (useful when navigating away)
 */
export function resetMembership() {
    membershipInitialized = false;
}

function updateDisplayedPrices() {
    const { stripe } = config;
    const displayPrices = stripe?.displayPrices ?? {};
    const currencyCode = stripe?.currency ?? 'USD';

    const currencyFormatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const amountFormatter = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const currencySymbol =
        currencyFormatter
            .formatToParts(0)
            .find(part => part.type === 'currency')
            ?.value ?? '$';

    document.querySelectorAll('.tier-price .currency').forEach((element) => {
        element.textContent = currencySymbol;
    });

    const applyAmount = (elementId, amount) => {
        const element = document.getElementById(elementId);
        if (!element) {
            return;
        }

        const numericAmount = Number(amount);
        if (Number.isFinite(numericAmount)) {
            element.textContent = amountFormatter.format(numericAmount);
        } else {
            element.textContent = '--';
        }
    };

    applyAmount('viewerMonthlyPrice', displayPrices.viewer);
    applyAmount('creatorMonthlyPrice', displayPrices.creator);
    applyAmount('proCreatorMonthlyPrice', displayPrices.proCreator);
}

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
        console.log('API Response:', JSON.stringify(data, null, 2));
        currentSubscription = data.subscription;
        console.log('Current subscription object:', JSON.stringify(currentSubscription, null, 2));

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
        console.log('Updating billing date - currentPeriodEnd:', subscription.currentPeriodEnd);
        console.log('Type of currentPeriodEnd:', typeof subscription.currentPeriodEnd);
        
        if (subscription.currentPeriodEnd) {
            console.log('Converting timestamp:', subscription.currentPeriodEnd, 'to date');
            const date = new Date(subscription.currentPeriodEnd * 1000);
            console.log('Converted date:', date);
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
        } else {
            console.log('No currentPeriodEnd found in subscription object');
        }

        updatePricingGridButtons(subscription.tier);
    }
}

/**
 * Update buttons in pricing grid based on current tier
 */
function updatePricingGridButtons(currentTier) {
    const cards = document.querySelectorAll('.pricing-card');
    
    // Handle legacy tier names
    let normalizedTier = currentTier.toLowerCase();
    if (normalizedTier === 'standard') {
        normalizedTier = 'creator';
    }
    if (normalizedTier === 'pro') {
        normalizedTier = 'proCreator';
    }
    
    cards.forEach((card, index) => {
        const button = card.querySelector('.btn');
        const tierNames = ['free', 'viewer', 'creator', 'proCreator'];
        const tierName = tierNames[index];
        
        // Get display name for button
        const tierDisplayNames = {
            'free': 'Free',
            'viewer': 'Viewer',
            'creator': 'Creator',
            'proCreator': 'Pro Creator'
        };

        if (tierName === normalizedTier) {
            button.textContent = 'Current Plan';
            button.className = 'btn current-plan';
            button.disabled = true;
            button.onclick = null;
        } else if (tierNames.indexOf(tierName) < tierNames.indexOf(normalizedTier)) {
            // Lower tier - hide downgrade button (users can manage in portal)
            button.style.display = 'none';
        } else {
            // Higher tier - use customer portal for upgrades
            const tierLabel = tierDisplayNames[tierName] || tierName.charAt(0).toUpperCase() + tierName.slice(1);
            button.textContent = `Upgrade to ${tierLabel}`;
            button.className = 'btn btn-primary';
            button.disabled = false;
            button.onclick = () => openCustomerPortal();
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
                successUrl: `${window.location.origin}/?membership=success`,
                cancelUrl: `${window.location.origin}/?membership=canceled`
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
 * Open Stripe Customer Portal
 */
window.openCustomerPortal = async function() {
    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        showMessage('Redirecting to billing portal where you can upgrade, downgrade, or manage your subscription...', 'success');

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
                returnUrl: `${window.location.origin}/?membership=true`
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
export function showMessage(message, type) {
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

/**
 * Check for URL parameters (success/cancel from Stripe)
 * This should be called when membership is displayed
 */
export function checkMembershipUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('membership') === 'success') {
        showMessage('Subscription successful! Welcome to your new plan.', 'success');
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('membership') === 'canceled') {
        showMessage('Subscription was canceled. You can try again anytime.', 'error');
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

