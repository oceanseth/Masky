/**
 * Subscription Helper Utility
 * 
 * This module provides helper functions for checking subscription tiers
 * and enforcing tier-based limits throughout the application.
 */

// Tier definitions and limits
const TIER_LIMITS = {
    free: {
        name: 'Free',
        avatars: 1,
        voices: 1,
        alertTypes: ['basic'],
        customScripts: false,
        analytics: false,
        support: 'community',
        apiAccess: false,
        customBranding: false,
        whiteLabel: false
    },
    standard: {
        name: 'Standard',
        avatars: 5,
        voices: 10,
        alertTypes: ['basic', 'advanced', 'custom'],
        customScripts: true,
        analytics: true,
        support: 'priority',
        apiAccess: false,
        customBranding: false,
        whiteLabel: false
    },
    pro: {
        name: 'Pro',
        avatars: Infinity,
        voices: Infinity,
        alertTypes: ['basic', 'advanced', 'custom', 'premium'],
        customScripts: true,
        analytics: true,
        support: '24/7',
        apiAccess: true,
        customBranding: true,
        whiteLabel: true
    }
};

/**
 * Get tier configuration
 * @param {string} tier - The subscription tier (free, standard, pro)
 * @returns {object} Tier configuration object
 */
function getTierConfig(tier) {
    const normalizedTier = (tier || 'free').toLowerCase();
    return TIER_LIMITS[normalizedTier] || TIER_LIMITS.free;
}

/**
 * Check if a user can perform an action based on their tier
 * @param {string} tier - The user's subscription tier
 * @param {string} feature - The feature to check (e.g., 'customScripts', 'apiAccess')
 * @returns {boolean} True if the feature is available for this tier
 */
function hasFeature(tier, feature) {
    const config = getTierConfig(tier);
    return config[feature] === true || config[feature] === Infinity;
}

/**
 * Check if a user has reached their limit for a resource
 * @param {string} tier - The user's subscription tier
 * @param {string} resourceType - The type of resource (e.g., 'avatars', 'voices')
 * @param {number} currentCount - The current number of resources the user has
 * @returns {object} { allowed: boolean, limit: number, remaining: number }
 */
function checkLimit(tier, resourceType, currentCount) {
    const config = getTierConfig(tier);
    const limit = config[resourceType];
    
    if (limit === Infinity) {
        return {
            allowed: true,
            limit: Infinity,
            remaining: Infinity
        };
    }
    
    const remaining = Math.max(0, limit - currentCount);
    
    return {
        allowed: currentCount < limit,
        limit: limit,
        remaining: remaining
    };
}

/**
 * Get upgrade suggestions for a user who has reached their limit
 * @param {string} currentTier - The user's current subscription tier
 * @param {string} resourceType - The type of resource they need more of
 * @returns {object} Upgrade suggestion with next tier information
 */
function getUpgradeSuggestion(currentTier, resourceType) {
    const tierOrder = ['free', 'standard', 'pro'];
    const currentIndex = tierOrder.indexOf(currentTier.toLowerCase());
    
    if (currentIndex === tierOrder.length - 1) {
        return {
            needsUpgrade: false,
            message: 'You are already on the highest tier!'
        };
    }
    
    const nextTier = tierOrder[currentIndex + 1];
    const nextTierConfig = getTierConfig(nextTier);
    const nextLimit = nextTierConfig[resourceType];
    
    return {
        needsUpgrade: true,
        currentTier: currentTier,
        nextTier: nextTier,
        nextTierName: nextTierConfig.name,
        currentLimit: getTierConfig(currentTier)[resourceType],
        nextLimit: nextLimit,
        message: `Upgrade to ${nextTierConfig.name} to get ${
            nextLimit === Infinity ? 'unlimited' : nextLimit
        } ${resourceType}!`
    };
}

/**
 * Validate tier name
 * @param {string} tier - The tier to validate
 * @returns {boolean} True if valid tier
 */
function isValidTier(tier) {
    return ['free', 'standard', 'pro'].includes((tier || '').toLowerCase());
}

/**
 * Get all tier information for comparison
 * @returns {object} Object containing all tier configurations
 */
function getAllTiers() {
    return {
        free: getTierConfig('free'),
        standard: getTierConfig('standard'),
        pro: getTierConfig('pro')
    };
}

// Export for CommonJS (backend)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TIER_LIMITS,
        getTierConfig,
        hasFeature,
        checkLimit,
        getUpgradeSuggestion,
        isValidTier,
        getAllTiers
    };
}

// Export for ES6 modules (frontend)
if (typeof exports !== 'undefined') {
    exports.TIER_LIMITS = TIER_LIMITS;
    exports.getTierConfig = getTierConfig;
    exports.hasFeature = hasFeature;
    exports.checkLimit = checkLimit;
    exports.getUpgradeSuggestion = getUpgradeSuggestion;
    exports.isValidTier = isValidTier;
    exports.getAllTiers = getAllTiers;
}

/**
 * Backend-specific helper to get user's subscription tier from Firebase
 * This requires firebase-admin to be initialized
 */
async function getUserSubscriptionTier(userId) {
    try {
        // Only works in backend context
        const admin = require('firebase-admin');
        
        // Try to get from custom claims first (faster)
        const userRecord = await admin.auth().getUser(userId);
        const tier = userRecord.customClaims?.subscriptionTier;
        
        if (tier) {
            return tier;
        }
        
        // Fallback to Firestore
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (userDoc.exists) {
            return userDoc.data().subscriptionTier || 'free';
        }
        
        return 'free';
    } catch (error) {
        console.error('Error getting user subscription tier:', error);
        return 'free'; // Default to free on error
    }
}

/**
 * Backend-specific helper to enforce limits in API endpoints
 * Usage example in API:
 * 
 * const canCreate = await enforceLimit(userId, 'avatars', currentAvatarCount);
 * if (!canCreate.allowed) {
 *   return {
 *     statusCode: 403,
 *     body: JSON.stringify({
 *       error: canCreate.message,
 *       upgrade: canCreate.upgrade
 *     })
 *   };
 * }
 */
async function enforceLimit(userId, resourceType, currentCount) {
    try {
        const tier = await getUserSubscriptionTier(userId);
        const limitCheck = checkLimit(tier, resourceType, currentCount);
        
        if (!limitCheck.allowed) {
            const upgrade = getUpgradeSuggestion(tier, resourceType);
            
            return {
                allowed: false,
                tier: tier,
                limit: limitCheck.limit,
                current: currentCount,
                message: `You have reached your ${resourceType} limit (${limitCheck.limit}). ${upgrade.message}`,
                upgrade: upgrade
            };
        }
        
        return {
            allowed: true,
            tier: tier,
            limit: limitCheck.limit,
            current: currentCount,
            remaining: limitCheck.remaining
        };
    } catch (error) {
        console.error('Error enforcing limit:', error);
        // On error, allow but log
        return {
            allowed: true,
            error: error.message
        };
    }
}

// Export backend-specific functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports.getUserSubscriptionTier = getUserSubscriptionTier;
    module.exports.enforceLimit = enforceLimit;
}

