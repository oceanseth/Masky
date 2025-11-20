import { getCurrentUser, onAuthChange } from './firebase.js';
import { db, collection, doc, getDoc, setDoc, query, where, getDocs } from './firebase.js';
import { config as appConfig } from './config.js';
import { renderRedemptionCard, renderRedemptionQueue } from './customRedemptionCard.js';

/**
 * Render user page configuration UI
 */
export async function renderUserPageConfig(container) {
    const containerElement = typeof container === 'string' ? document.querySelector(container) : container;
    if (!containerElement) {
        console.error('User page config container not found:', container);
        return;
    }

    // Create or reuse mount
    let root = document.getElementById('userPageConfig');
    if (!root) {
        root = document.createElement('div');
        root.id = 'userPageConfig';
        containerElement.appendChild(root);
    }

    root.innerHTML = `
        <div class="user-page-config" style="margin: 20px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <button id="closeUserPageConfig" class="btn btn-secondary" style="padding: 0.5rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3);">← Back</button>
                    <h3 class="section-title" style="margin: 0;">User Page Configuration</h3>
                </div>
                <button class="btn btn-secondary" id="saveUserPageConfig" style="padding: 0.5rem 1rem;">Save Settings</button>
            </div>
            
            <div class="config-section" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;">
                <h4 style="color: #c084fc; margin-bottom: 1rem; font-size: 1.1rem;">Donations</h4>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" id="enableDonations" style="width: 18px; height: 18px; cursor: pointer;">
                        <span>Enable user donations</span>
                    </label>
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Donation Thank You Message</label>
                    <textarea id="donationThankYouMessage" placeholder="Thank you @username for donating $amount, enjoy your masky credits, looking forward to seeing your redemptions" style="width: 100%; min-height: 80px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff; font-family: inherit; resize: vertical;"></textarea>
                    <small style="color: rgba(255,255,255,0.6); display: block; margin-top: 0.25rem;">Use @username for the donor's name and $amount for the donation amount. Leave empty to disable chat messages.</small>
                </div>
            </div>

            <div class="config-section" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
                    <div>
                        <h4 style="color: #c084fc; margin-bottom: 0.5rem; font-size: 1.1rem;">Redemptions</h4>
                        <p style="color: rgba(255,255,255,0.7); font-size: 0.9rem; margin-bottom: 1.5rem;">As users donate, they get points to use on redemptions.</p>
                        
                        <div id="redemptionsList" style="margin-bottom: 1rem;">
                            <!-- Redemption cards will be rendered here -->
                        </div>
                        
                        <button id="addNewRedemptionBtn" class="btn btn-secondary" style="padding: 0.5rem 1rem; background: rgba(192,132,252,0.2); border: 1px solid rgba(192,132,252,0.5); color: #c084fc;">Add New Redemption</button>
                    </div>
                    
                    <div id="redemptionQueueContainer" style="border-left: 1px solid rgba(192,132,252,0.3); padding-left: 2rem;">
                        <!-- Redemption queue will be rendered here -->
                    </div>
                </div>
            </div>

            <div class="config-section" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;">
                <h4 style="color: #c084fc; margin-bottom: 1rem; font-size: 1.1rem;">Tribe (Subscriber Community)</h4>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Tribe Name</label>
                    <input type="text" id="tribeName" placeholder="{streamer name} subscribers" style="width: 100%; max-width: 400px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
                    <small style="color: rgba(255,255,255,0.6); display: block; margin-top: 0.25rem;">Use {streamer} to insert your display name</small>
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Tribe Join Cost (USD)</label>
                    <input type="number" id="tribeJoinCost" min="0" step="0.01" value="10" style="width: 150px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">
                        <span>Bits to Points Amount</span>
                        <span style="position: relative; display: inline-block;">
                            <span style="color: rgba(255,255,255,0.6); cursor: help;">❓</span>
                            <span class="bits-to-points-tooltip" style="visibility: hidden; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.9); color: #fff; padding: 0.5rem; border-radius: 6px; white-space: normal; font-size: 0.875rem; margin-bottom: 0.5rem; z-index: 1000; width: 250px;">When a user redeems bits of this amount, they will get masky credits to use on your page equal to bits/100. Set to 0 to disable.</span>
                        </span>
                    </label>
                    <input type="number" id="bitsToPointsAmount" min="0" step="1" value="100" style="width: 150px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Monthly Videos for Tribe Members</label>
                    <input type="number" id="monthlyTribeVideos" min="0" step="1" value="5" style="width: 150px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" id="subscribersJoinTribeFree" style="width: 18px; height: 18px; cursor: pointer;">
                        <span>Subscribers get to join tribe for free</span>
                    </label>
                </div>
            </div>
        </div>
    `;

    // Load existing config
    await loadUserPageConfig();

    // Wire up tooltip for bits to points amount
    const bitsTooltipTrigger = root.querySelector('.bits-to-points-tooltip');
    if (bitsTooltipTrigger) {
        const trigger = bitsTooltipTrigger.previousElementSibling;
        trigger.addEventListener('mouseenter', () => {
            bitsTooltipTrigger.style.visibility = 'visible';
        });
        trigger.addEventListener('mouseleave', () => {
            bitsTooltipTrigger.style.visibility = 'hidden';
        });
        // Also handle touch events for mobile
        trigger.addEventListener('touchstart', (e) => {
            e.preventDefault();
            bitsTooltipTrigger.style.visibility = bitsTooltipTrigger.style.visibility === 'visible' ? 'hidden' : 'visible';
        });
    }

    // Wire up save button
    const saveBtn = root.querySelector('#saveUserPageConfig');
    if (saveBtn) {
        saveBtn.onclick = saveUserPageConfig;
    }
    
    // Wire up close button
    const closeBtn = root.querySelector('#closeUserPageConfig');
    if (closeBtn) {
        closeBtn.onclick = () => {
            // Check if we're on user.html page
            if (typeof window.showUserContent === 'function') {
                window.showUserContent();
            } else {
                // Fallback: try to hide config and show user content directly
                const configContainer = document.getElementById('userPageConfigContainer');
                const userContent = document.getElementById('userContent');
                if (configContainer) configContainer.style.display = 'none';
                if (userContent) userContent.style.display = 'block';
            }
        };
    }
    
    // Wire up add new redemption button
    const addRedemptionBtn = root.querySelector('#addNewRedemptionBtn');
    if (addRedemptionBtn) {
        addRedemptionBtn.onclick = () => addNewRedemption();
    }
    
    // Load redemption queue
    const user = getCurrentUser();
    if (user) {
        const queueContainer = root.querySelector('#redemptionQueueContainer');
        if (queueContainer) {
            await renderRedemptionQueue(queueContainer, user.uid);
        }
    }
}

// Store redemptions in memory
let currentRedemptions = [];

/**
 * Load user page configuration from Firestore
 */
async function loadUserPageConfig() {
    try {
        const user = getCurrentUser();
        if (!user) return;

        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();
            const config = userData.userPageConfig || {};

            // Set form values
            document.getElementById('enableDonations').checked = config.enableDonations !== false;
            document.getElementById('donationThankYouMessage').value = config.donationThankYouMessage || '';
            
            // Set tribe name - if empty, use default with placeholder
            const defaultTribeName = `{streamer} subscribers`;
            document.getElementById('tribeName').value = config.tribeName || defaultTribeName;
            document.getElementById('tribeName').placeholder = defaultTribeName;
            
            document.getElementById('tribeJoinCost').value = config.tribeJoinCost || 10;
            document.getElementById('bitsToPointsAmount').value = config.bitsToPointsAmount || 100;
            document.getElementById('monthlyTribeVideos').value = config.monthlyTribeVideos || 5;
            document.getElementById('subscribersJoinTribeFree').checked = config.subscribersJoinTribeFree === true;
            
            // Load redemptions
            const redemptions = config.redemptions || [];
            
            // Ensure Custom Video redemption exists (hardcoded, always present)
            const customVideoRedemption = {
                id: 'custom-video',
                name: 'Custom Video',
                description: 'Create a custom video that will play on stream',
                creditCost: config.customVideoPrice || 5,
                allowCustomUserString: true,
                showInQueue: true // Always true for custom video
            };
            
            // Check if custom video redemption already exists in redemptions
            const existingCustomVideo = redemptions.find(r => r.id === 'custom-video');
            if (existingCustomVideo) {
                // Merge with existing, but keep it as custom-video
                Object.assign(existingCustomVideo, customVideoRedemption);
            } else {
                // Add custom video redemption at the beginning
                redemptions.unshift(customVideoRedemption);
            }
            
            currentRedemptions = redemptions;
            
            // Render redemption cards
            renderRedemptions();
        } else {
            // Initialize with default Custom Video redemption
            const customVideoRedemption = {
                id: 'custom-video',
                name: 'Custom Video',
                description: 'Create a custom video that will play on stream',
                creditCost: 5,
                allowCustomUserString: true,
                showInQueue: true // Always true for custom video
            };
            currentRedemptions = [customVideoRedemption];
            renderRedemptions();
        }
    } catch (error) {
        console.error('Error loading user page config:', error);
    }
}

/**
 * Render all redemption cards
 */
function renderRedemptions() {
    const container = document.getElementById('redemptionsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    currentRedemptions.forEach((redemption, index) => {
        const isCustomVideo = redemption.id === 'custom-video';
        const onDelete = isCustomVideo ? null : (id) => deleteRedemption(id);
        const onUpdate = (updatedRedemption) => updateRedemption(updatedRedemption);
        
        renderRedemptionCard(container, redemption, onUpdate, onDelete);
        
        // Add separator between redemptions (except after the last one)
        if (index < currentRedemptions.length - 1) {
            const separator = document.createElement('div');
            separator.style.cssText = 'height: 1px; background: rgba(192,132,252,0.3); margin: 1rem 0;';
            container.appendChild(separator);
        }
    });
}

/**
 * Add a new redemption
 */
function addNewRedemption() {
    const newRedemption = {
        id: `redemption-${Date.now()}`,
        name: 'New Redemption',
        description: '',
        creditCost: 5,
        allowCustomUserString: false,
        showInQueue: true
    };
    
    currentRedemptions.push(newRedemption);
    renderRedemptions();
}

/**
 * Update a redemption
 */
function updateRedemption(updatedRedemption) {
    const index = currentRedemptions.findIndex(r => r.id === updatedRedemption.id);
    if (index !== -1) {
        currentRedemptions[index] = updatedRedemption;
    }
}

/**
 * Delete a redemption
 */
function deleteRedemption(redemptionId) {
    currentRedemptions = currentRedemptions.filter(r => r.id !== redemptionId);
    renderRedemptions();
}

/**
 * Save user page configuration to Firestore
 */
async function saveUserPageConfig() {
    try {
        const user = getCurrentUser();
        if (!user) {
            alert('Please sign in to save settings');
            return;
        }

        const saveBtn = document.getElementById('saveUserPageConfig');
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

            const tribeNameInput = document.getElementById('tribeName').value.trim();
            const defaultTribeName = `{streamer} subscribers`;
            
            // Extract Custom Video redemption settings for backward compatibility
            const customVideoRedemption = currentRedemptions.find(r => r.id === 'custom-video');
            const customVideoPrice = customVideoRedemption?.creditCost || 5;
            
            // Ensure showInQueue is always true for custom video
            const redemptionsToSave = currentRedemptions.map(r => {
                if (r.id === 'custom-video') {
                    return { ...r, showInQueue: true };
                }
                return r;
            });
            
            const bitsToPointsAmount = parseInt(document.getElementById('bitsToPointsAmount').value) || 100;
            
            const config = {
                enableDonations: document.getElementById('enableDonations').checked,
                donationThankYouMessage: document.getElementById('donationThankYouMessage').value.trim(),
                customVideoPrice: customVideoPrice, // Keep for backward compatibility
                redemptions: redemptionsToSave, // Store all redemptions (with showInQueue forced to true for custom video)
                tribeName: tribeNameInput || defaultTribeName,
                tribeJoinCost: parseFloat(document.getElementById('tribeJoinCost').value) || 10,
                bitsToPointsAmount: bitsToPointsAmount,
                monthlyTribeVideos: parseInt(document.getElementById('monthlyTribeVideos').value) || 5,
                subscribersJoinTribeFree: document.getElementById('subscribersJoinTribeFree').checked,
                updatedAt: new Date()
            };

        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
            userPageConfig: config
        }, { merge: true });

        // If bitsToPointsAmount > 0, ensure EventSub subscription for channel.cheer exists
        if (bitsToPointsAmount > 0) {
            try {
                const idToken = await user.getIdToken();
                const twitchId = user.uid.replace('twitch:', '');
                
                const response = await fetch(`${appConfig.api.baseUrl}/api/twitch-eventsub`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'channel.cheer',
                        version: '1',
                        condition: {
                            broadcaster_user_id: twitchId
                        }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('Failed to create bits EventSub subscription:', errorData);
                    
                    // Show user-friendly error message
                    if (errorData.code === 'TWITCH_SCOPES_MISSING') {
                        const errorMsg = document.createElement('div');
                        errorMsg.innerHTML = `
                            <div style="position: fixed; top: 20px; right: 20px; background: #ef4444; color: white; padding: 1rem; border-radius: 8px; z-index: 10000; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                                <strong>Twitch Permission Required</strong><br>
                                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">
                                    To enable bits-to-credits conversion, you need to grant the <code>bits:read</code> permission. 
                                    Please reconnect your Twitch account to grant this permission.
                                </p>
                                <button onclick="window.location.reload()" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: white; color: #ef4444; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                                    Reconnect Twitch
                                </button>
                            </div>
                        `;
                        document.body.appendChild(errorMsg);
                        setTimeout(() => errorMsg.remove(), 10000);
                    } else {
                        // Generic error message
                        const errorMsg = document.createElement('div');
                        errorMsg.textContent = `Warning: Could not create Twitch EventSub subscription. Bits-to-credits may not work. Error: ${errorData.error || 'Unknown error'}`;
                        errorMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #f59e0b; color: white; padding: 1rem; border-radius: 8px; z-index: 10000; max-width: 400px;';
                        document.body.appendChild(errorMsg);
                        setTimeout(() => errorMsg.remove(), 5000);
                    }
                } else {
                    // Success - EventSub created
                    const successData = await response.json().catch(() => ({}));
                    if (successData.subscription) {
                        console.log('✅ Bits EventSub subscription created:', successData.subscription.id);
                    }
                }
            } catch (error) {
                console.error('Error creating bits EventSub subscription:', error);
                // Don't fail the save, just log the error
            }
        }

        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.textContent = 'Settings saved successfully!';
        successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 1rem; border-radius: 8px; z-index: 10000;';
        document.body.appendChild(successMsg);
        setTimeout(() => successMsg.remove(), 3000);

    } catch (error) {
        console.error('Error saving user page config:', error);
        alert('Failed to save settings. Please try again.');
        const saveBtn = document.getElementById('saveUserPageConfig');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Settings';
        }
    }
}

/**
 * Get user page configuration
 */
export async function getUserPageConfig(userId) {
    try {
        const userDocRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
                const defaultConfig = {
                enableDonations: true,
                donationThankYouMessage: '',
                customVideoPrice: 5,
                redemptions: [{
                    id: 'custom-video',
                    name: 'Custom Video',
                    description: 'Create a custom video that will play on stream',
                    creditCost: 5,
                    allowCustomUserString: true,
                        showInQueue: true // Always true for custom video
                }],
                tribeName: '',
                tribeJoinCost: 10,
                bitsToPointsAmount: 100,
                monthlyTribeVideos: 5,
                subscribersJoinTribeFree: false
            };
            
            return userData.userPageConfig || defaultConfig;
        }
        return null;
    } catch (error) {
        console.error('Error getting user page config:', error);
        return null;
    }
}

/**
 * Get user's Twitch username for URL
 */
export async function getUserTwitchUsername(userId) {
    try {
        const userDocRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            return userData.twitchUsername || null;
        }
        return null;
    } catch (error) {
        console.error('Error getting Twitch username:', error);
        return null;
    }
}

