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
    
    // Initialize tooltips for perks
    initializePerkTooltips();
    
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
        
        // Show coupon section
        const couponSection = document.getElementById('couponSection');
        if (couponSection) {
            couponSection.style.display = 'block';
        }

        // Update UI based on subscription status
        updateSubscriptionUI(currentSubscription);

    } catch (error) {
        console.error('Error loading subscription:', error);
        loadingState.style.display = 'none';
        pricingGrid.style.display = 'grid';
        
        // Show coupon section even on error
        const couponSection = document.getElementById('couponSection');
        if (couponSection) {
            couponSection.style.display = 'block';
        }
        
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

    // Safety check: ensure elements exist
    if (!currentSubscriptionCard || !currentTier || !subscriptionDetails || !subscriptionStatus || !nextBilling) {
        console.error('Missing subscription UI elements:', {
            currentSubscriptionCard: !!currentSubscriptionCard,
            currentTier: !!currentTier,
            subscriptionDetails: !!subscriptionDetails,
            subscriptionStatus: !!subscriptionStatus,
            nextBilling: !!nextBilling
        });
        return;
    }

    if (!subscription || subscription.tier === 'free') {
        // Free tier - show only pricing grid
        currentSubscriptionCard.classList.remove('active');
        currentSubscriptionCard.style.display = 'none';
        updatePricingGridButtons('free');
    } else {
        // Paid tier - show current subscription card
        currentSubscriptionCard.classList.add('active');
        // Ensure it's visible (in case inline styles override CSS)
        currentSubscriptionCard.style.display = 'block';
        
        // Update tier name with proper formatting
        let tierName = subscription.tier;
        // Format tier names properly (e.g., proCreator -> Pro Creator)
        if (tierName === 'proCreator') {
            tierName = 'Pro Creator';
        } else if (tierName === 'viewer') {
            tierName = 'Viewer';
        } else if (tierName === 'creator') {
            tierName = 'Creator';
        } else {
            // Fallback: capitalize first letter
            tierName = tierName.charAt(0).toUpperCase() + tierName.slice(1);
        }
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
    
    if (!cards || cards.length === 0) {
        console.error('No pricing cards found');
        return;
    }
    
    // Normalize tier name (handle legacy names and case variations)
    const validTierNames = ['free', 'viewer', 'creator', 'proCreator'];
    let normalizedTier = currentTier;
    
    if (typeof normalizedTier === 'string') {
        normalizedTier = normalizedTier.trim();
        
        // If already in valid format, use it as-is
        if (validTierNames.includes(normalizedTier)) {
            // Already correct format (e.g., "proCreator")
        } else {
            // Check case-insensitive match and normalize to camelCase
            const lowerTier = normalizedTier.toLowerCase();
            
            // Map to correct camelCase format
            if (lowerTier === 'free') {
                normalizedTier = 'free';
            } else if (lowerTier === 'viewer') {
                normalizedTier = 'viewer';
            } else if (lowerTier === 'creator' || lowerTier === 'standard') {
                normalizedTier = 'creator';
            } else if (lowerTier === 'procreator' || lowerTier === 'pro' || lowerTier === 'pro-creator') {
                normalizedTier = 'proCreator';
            } else {
                // Try to find case-insensitive match in valid tier names
                const exactMatch = validTierNames.find(tier => tier.toLowerCase() === lowerTier);
                if (exactMatch) {
                    normalizedTier = exactMatch;
                } else {
                    console.warn('Unknown tier name:', normalizedTier, '- defaulting to free');
                    normalizedTier = 'free';
                }
            }
        }
    }
    
    console.log('Updating pricing grid buttons for tier:', normalizedTier);
    
    const tierNames = ['free', 'viewer', 'creator', 'proCreator'];
    
    // Get display name for button
    const tierDisplayNames = {
        'free': 'Free',
        'viewer': 'Viewer',
        'creator': 'Creator',
        'proCreator': 'Pro Creator'
    };
    
    cards.forEach((card, index) => {
        if (index >= tierNames.length) {
            console.warn('Card index', index, 'exceeds tier names array length');
            return;
        }
        
        const button = card.querySelector('.btn');
        if (!button) {
            console.warn('No button found in card at index', index);
            return;
        }
        
        const tierName = tierNames[index];
        const currentTierIndex = tierNames.indexOf(normalizedTier);
        const cardTierIndex = tierNames.indexOf(tierName);
        
        console.log(`Card ${index} (${tierName}): currentTier=${normalizedTier}, currentIndex=${currentTierIndex}, cardIndex=${cardTierIndex}`);
        
        if (tierName === normalizedTier) {
            // Current plan - show "Current Plan" button
            console.log(`Setting ${tierName} card to "Current Plan"`);
            button.textContent = 'Current Plan';
            button.className = 'btn current-plan';
            button.disabled = true;
            button.onclick = null;
            button.style.display = 'block'; // Make sure it's visible
        } else if (cardTierIndex < currentTierIndex) {
            // Lower tier - hide downgrade button (users can manage in portal)
            console.log(`Hiding button for lower tier: ${tierName}`);
            button.style.display = 'none';
        } else {
            // Higher tier - show upgrade button
            console.log(`Showing upgrade button for higher tier: ${tierName}`);
            const tierLabel = tierDisplayNames[tierName] || tierName.charAt(0).toUpperCase() + tierName.slice(1);
            button.textContent = `Upgrade to ${tierLabel}`;
            button.className = 'btn btn-primary';
            button.disabled = false;
            button.onclick = () => upgradeToPlan(tierName);
            button.style.display = 'block'; // Make sure it's visible
        }
    });
}

/**
 * Subscribe to a plan (for new subscriptions)
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

        // Get coupon code if provided
        const couponCode = document.getElementById('couponCode')?.value?.trim() || null;

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
                couponCode: couponCode,
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
 * Upgrade to a plan (for existing subscribers)
 */
window.upgradeToPlan = async function(tier) {
    try {
        const user = getCurrentUser();
        if (!user) {
            showMessage('Please sign in to upgrade', 'error');
            return;
        }

        // Get price ID from config
        const priceId = config.stripe.prices[tier];
        if (!priceId) {
            showMessage('Invalid plan selected', 'error');
            return;
        }

        // Get coupon code if provided
        const couponCode = document.getElementById('couponCode')?.value?.trim() || null;

        showMessage('Redirecting to checkout...', 'success');

        // Get ID token
        const idToken = await user.getIdToken();

        // Create checkout session for upgrade
        const response = await fetch(`${config.api.baseUrl}/api/subscription/create-checkout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tier: tier,
                priceId: priceId,
                couponCode: couponCode,
                isUpgrade: true,
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
        console.error('Error upgrading:', error);
        showMessage(error.message || 'Failed to start upgrade process', 'error');
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
 * Apply coupon code (placeholder - validation happens at checkout)
 */
window.applyCoupon = function() {
    const couponInput = document.getElementById('couponCode');
    const couponMessage = document.getElementById('couponMessage');
    
    if (!couponInput || !couponMessage) {
        return;
    }
    
    const couponCode = couponInput.value.trim();
    
    if (!couponCode) {
        couponMessage.textContent = 'Please enter a coupon code';
        couponMessage.className = 'coupon-message error';
        return;
    }
    
    // Clear previous message
    couponMessage.textContent = 'Coupon code will be applied at checkout';
    couponMessage.className = 'coupon-message success';
    
    // Clear message after 3 seconds
    setTimeout(() => {
        couponMessage.textContent = '';
        couponMessage.className = 'coupon-message';
    }, 3000);
};

/**
 * Initialize tooltips for perk question marks
 */
function initializePerkTooltips() {
    const tooltipTriggers = document.querySelectorAll('.perk-tooltip-trigger');
    
    tooltipTriggers.forEach(trigger => {
        const tooltip = trigger.nextElementSibling;
        if (!tooltip || !tooltip.classList.contains('perk-tooltip')) {
            return;
        }
        
        // Desktop: hover events
        trigger.addEventListener('mouseenter', () => {
            tooltip.classList.add('show');
        });
        
        trigger.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });
        
        // Mobile: touch events
        trigger.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            // Toggle tooltip on mobile tap
            const isVisible = tooltip.classList.contains('show');
            if (isVisible) {
                tooltip.classList.remove('show');
            } else {
                // Hide other tooltips first
                document.querySelectorAll('.perk-tooltip.show').forEach(t => {
                    if (t !== tooltip) {
                        t.classList.remove('show');
                    }
                });
                tooltip.classList.add('show');
            }
        });
        
        // Close tooltip when clicking/tapping outside on mobile
        const closeTooltipOnOutsideClick = (e) => {
            if (!trigger.contains(e.target) && !tooltip.contains(e.target)) {
                tooltip.classList.remove('show');
            }
        };
        
        // Use both touchstart and click for better mobile/desktop compatibility
        document.addEventListener('touchstart', closeTooltipOnOutsideClick, { passive: true });
        document.addEventListener('click', closeTooltipOnOutsideClick);
    });
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

