import { getCurrentUser, onAuthChange } from './firebase.js';
import { db, collection, doc, getDoc, setDoc, query, where, getDocs } from './firebase.js';
import { config } from './config.js';

/**
 * Render user page configuration UI
 */
export function renderUserPageConfig(container) {
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
                <h3 class="section-title" style="margin: 0;">User Page Configuration</h3>
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
            </div>

            <div class="config-section" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;">
                <h4 style="color: #c084fc; margin-bottom: 1rem; font-size: 1.1rem;">Custom Videos</h4>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Custom Video Price (USD)</label>
                    <input type="number" id="customVideoPrice" min="1" step="0.01" value="5" style="width: 150px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
                </div>
                <div class="config-item" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" id="allowAvatarDisplay" style="width: 18px; height: 18px; cursor: pointer;">
                        <span>Allow Avatar Display (users can select from your avatars)</span>
                    </label>
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
    loadUserPageConfig();

    // Wire up save button
    const saveBtn = root.querySelector('#saveUserPageConfig');
    if (saveBtn) {
        saveBtn.onclick = saveUserPageConfig;
    }
}

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
            document.getElementById('customVideoPrice').value = config.customVideoPrice || 5;
            document.getElementById('allowAvatarDisplay').checked = config.allowAvatarDisplay === true;
            
            // Set tribe name - if empty, use default with placeholder
            const defaultTribeName = `{streamer} subscribers`;
            document.getElementById('tribeName').value = config.tribeName || defaultTribeName;
            document.getElementById('tribeName').placeholder = defaultTribeName;
            
            document.getElementById('tribeJoinCost').value = config.tribeJoinCost || 10;
            document.getElementById('monthlyTribeVideos').value = config.monthlyTribeVideos || 5;
            document.getElementById('subscribersJoinTribeFree').checked = config.subscribersJoinTribeFree === true;
        }
    } catch (error) {
        console.error('Error loading user page config:', error);
    }
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
            
            const config = {
                enableDonations: document.getElementById('enableDonations').checked,
                customVideoPrice: parseFloat(document.getElementById('customVideoPrice').value) || 5,
                allowAvatarDisplay: document.getElementById('allowAvatarDisplay').checked,
                tribeName: tribeNameInput || defaultTribeName,
                tribeJoinCost: parseFloat(document.getElementById('tribeJoinCost').value) || 10,
                monthlyTribeVideos: parseInt(document.getElementById('monthlyTribeVideos').value) || 5,
                subscribersJoinTribeFree: document.getElementById('subscribersJoinTribeFree').checked,
                updatedAt: new Date()
            };

        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
            userPageConfig: config
        }, { merge: true });

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
            return userData.userPageConfig || {
                enableDonations: true,
                customVideoPrice: 5,
                allowAvatarDisplay: false,
                tribeName: '',
                tribeJoinCost: 10,
                monthlyTribeVideos: 5,
                subscribersJoinTribeFree: false
            };
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

