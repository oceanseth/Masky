import { db, doc, setDoc, getDoc } from './firebase.js';
import { getCurrentUser } from './firebase.js';

/**
 * Render a redemption card component
 * @param {HTMLElement} container - Container element to render the card into
 * @param {Object} redemption - Redemption data object
 * @param {Function} onUpdate - Callback when redemption is updated
 * @param {Function} onDelete - Callback when redemption is deleted (null if not deletable)
 */
export function renderRedemptionCard(container, redemption, onUpdate, onDelete) {
    const card = document.createElement('div');
    card.className = 'redemption-card';
    card.dataset.redemptionId = redemption.id;
    card.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;';
    
    const isCustomVideo = redemption.id === 'custom-video';
    
    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
            <h5 style="color: #c084fc; margin: 0; font-size: 1.1rem;">${redemption.name || 'Unnamed Redemption'}</h5>
            ${onDelete ? `<button class="delete-redemption-btn" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #ef4444; padding: 0.25rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Delete</button>` : ''}
        </div>
        
        <div class="config-item" style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Redemption Name</label>
            <input type="text" class="redemption-name" value="${redemption.name || ''}" placeholder="Enter redemption name" ${isCustomVideo ? 'readonly' : ''} style="width: 100%; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
        </div>
        
        <div class="config-item" style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Description</label>
            <textarea class="redemption-description" placeholder="Enter redemption description" ${isCustomVideo ? 'readonly' : ''} rows="2" style="width: 100%; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff; resize: vertical;">${redemption.description || ''}</textarea>
        </div>
        
        <div class="config-item" style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; color: rgba(255,255,255,0.8);">Credit Cost</label>
            <input type="number" class="redemption-credit-cost" min="1" step="0.01" value="${redemption.creditCost || 5}" ${isCustomVideo ? '' : ''} style="width: 150px; padding: 0.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(192,132,252,0.3); border-radius: 6px; color: #fff;">
        </div>
        
        <div class="config-item" style="margin-bottom: 1rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" class="redemption-allow-custom-string" ${redemption.allowCustomUserString ? 'checked' : ''} ${isCustomVideo ? '' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                <span>Allow custom user string</span>
                <span style="position: relative; display: inline-block; margin-left: 0.25rem;">
                    <span style="color: rgba(255,255,255,0.6); cursor: help;">❓</span>
                    <span class="tooltip-text" style="visibility: hidden; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.9); color: #fff; padding: 0.5rem; border-radius: 6px; white-space: nowrap; font-size: 0.875rem; margin-bottom: 0.5rem; z-index: 1000; width: 200px; white-space: normal;">Whether or not the user gets to add a string of text to save when redeeming it</span>
                </span>
            </label>
        </div>
        
        <div class="config-item" style="margin-bottom: 1rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: ${isCustomVideo ? 'default' : 'pointer'};">
                <input type="checkbox" class="redemption-show-in-queue" ${redemption.showInQueue !== false ? 'checked' : ''} ${isCustomVideo ? 'disabled' : ''} style="width: 18px; height: 18px; cursor: ${isCustomVideo ? 'default' : 'pointer'};">
                <span>Show in queue${isCustomVideo ? ' (always enabled for Custom Video)' : ''}</span>
            </label>
        </div>
        
        
    `;
    
    // Add tooltip hover functionality
    const tooltipTrigger = card.querySelector('.tooltip-text');
    if (tooltipTrigger) {
        const trigger = tooltipTrigger.previousElementSibling;
        trigger.addEventListener('mouseenter', () => {
            tooltipTrigger.style.visibility = 'visible';
        });
        trigger.addEventListener('mouseleave', () => {
            tooltipTrigger.style.visibility = 'hidden';
        });
    }
    
    // Wire up delete button
    if (onDelete) {
        const deleteBtn = card.querySelector('.delete-redemption-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                if (confirm(`Are you sure you want to delete "${redemption.name}"?`)) {
                    onDelete(redemption.id);
                }
            };
        }
    }
    
    // Wire up input change handlers
    const inputs = card.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            const updatedRedemption = {
                ...redemption,
                name: card.querySelector('.redemption-name')?.value || redemption.name,
                description: card.querySelector('.redemption-description')?.value || redemption.description,
                creditCost: parseFloat(card.querySelector('.redemption-credit-cost')?.value) || redemption.creditCost,
                allowCustomUserString: card.querySelector('.redemption-allow-custom-string')?.checked || false,
                showInQueue: isCustomVideo ? true : (card.querySelector('.redemption-show-in-queue')?.checked !== false), // Always true for custom video
            };
            
            
            
            if (onUpdate) {
                onUpdate(updatedRedemption);
            }
        });
    });
    
    container.appendChild(card);
    return card;
}

/**
 * Render redemption queue (list of pending redemptions)
 * @param {HTMLElement} container - Container element to render the queue into
 * @param {string} userId - User ID of the streamer
 */
export async function renderRedemptionQueue(container, userId) {
    try {
        // Get pending redemptions from Firestore
        const { db, collection, query, where, getDocs, doc, updateDoc } = await import('./firebase.js');
        const redemptionsRef = collection(db, 'redemptions');
        const q = query(
            redemptionsRef,
            where('userId', '==', userId),
            where('dismissed', '==', false)
        );
        
        const snapshot = await getDocs(q);
        const redemptions = [];
        
        snapshot.forEach(doc => {
            redemptions.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // Sort by createdAt (oldest first)
        redemptions.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return aTime - bTime;
        });
        
        // Get viewer display names (fallback to stored viewerName)
        const redemptionsWithNames = await Promise.all(redemptions.map(async (redemption) => {
            let displayName = redemption.viewerName || 'Anonymous';
            let twitchUsername = redemption.viewerTwitchUsername || null;
            
            // Try to fetch current user data if viewerId exists
            if (redemption.viewerId) {
                try {
                    const { doc, getDoc } = await import('./firebase.js');
                    const viewerDoc = await getDoc(doc(db, 'users', redemption.viewerId));
                    if (viewerDoc.exists()) {
                        const viewerData = viewerDoc.data();
                        displayName = viewerData.displayName || displayName;
                        twitchUsername = viewerData.twitchUsername || twitchUsername;
                    }
                } catch (error) {
                    console.warn('Could not fetch viewer data:', error);
                }
            }
            
            return {
                ...redemption,
                displayName,
                twitchUsername
            };
        }));
        
        container.innerHTML = `
            <h4 style="color: #c084fc; margin-bottom: 1rem; font-size: 1.1rem;">Redemption Queue</h4>
            <div class="redemption-queue-list" style="max-height: 500px; overflow-y: auto;">
                ${redemptionsWithNames.length === 0 ? `
                    <div style="text-align: center; padding: 2rem; color: rgba(255,255,255,0.6);">
                        No pending redemptions
                    </div>
                ` : redemptionsWithNames.map(redemption => `
                    <div class="redemption-queue-item" data-redemption-id="${redemption.id}" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(192,132,252,0.3); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                            <div style="flex: 1;">
                                <div style="font-weight: 600; color: #c084fc; margin-bottom: 0.25rem;">${redemption.redemptionName || 'Unknown Redemption'}</div>
                                <div style="color: rgba(255,255,255,0.8); font-size: 0.9rem;">
                                    ${redemption.displayName || 'Anonymous'}${redemption.twitchUsername ? ` (@${redemption.twitchUsername})` : ''}
                                </div>
                                ${redemption.customString ? `<div style="color: rgba(255,255,255,0.7); font-size: 0.85rem; margin-top: 0.5rem; font-style: italic;">"${redemption.customString}"</div>` : ''}
                            </div>
                            <div style="display: flex; gap: 0.5rem; margin-left: 1rem;">
                                ${redemption.redemptionId === 'custom-video' && redemption.videoId ? `<button class="approve-redemption-btn" data-user-id="${userId}" data-viewer-id="${redemption.viewerId || ''}" data-video-id="${redemption.videoId}" data-viewer-name="${redemption.displayName || 'Anonymous'}" style="background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.5); color: #10b981; padding: 0.25rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Approve</button>` : ''}
                                ${redemption.redemptionId === 'custom-video' && redemption.videoId ? `<button class="preview-redemption-btn" data-video-id="${redemption.videoId}" style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #3b82f6; padding: 0.25rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Preview</button>` : ''}
                                <button class="refund-redemption-btn" data-redemption-id="${redemption.id}" style="background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.5); color: #22c55e; padding: 0.25rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Refund</button>
                                <button class="dismiss-redemption-btn" data-redemption-id="${redemption.id}" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #ef4444; padding: 0.25rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Dismiss</button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        // Wire up dismiss buttons
        container.querySelectorAll('.dismiss-redemption-btn').forEach(btn => {
            btn.onclick = async () => {
                const redemptionId = btn.dataset.redemptionId;
                if (!confirm('Are you sure you want to dismiss this redemption? This will hide it from the queue but the points will remain spent.')) {
                    return;
                }
                
                try {
                    const redemptionRef = doc(db, 'redemptions', redemptionId);
                    await updateDoc(redemptionRef, {
                        dismissed: true,
                        dismissedAt: new Date()
                    });
                    
                    // Remove from UI
                    const queueItem = container.querySelector(`[data-redemption-id="${redemptionId}"]`);
                    if (queueItem) {
                        queueItem.remove();
                    }
                    
                    // If queue is empty, show empty state
                    const queueList = container.querySelector('.redemption-queue-list');
                    if (queueList && queueList.querySelectorAll('.redemption-queue-item').length === 0) {
                        queueList.innerHTML = `
                            <div style="text-align: center; padding: 2rem; color: rgba(255,255,255,0.6);">
                                No pending redemptions
                            </div>
                        `;
                    }
                } catch (error) {
                    console.error('Error dismissing redemption:', error);
                    alert('Failed to dismiss redemption. Please try again.');
                }
            };
        });
        
        // Wire up refund buttons
        container.querySelectorAll('.refund-redemption-btn').forEach(btn => {
            btn.onclick = async () => {
                const redemptionId = btn.dataset.redemptionId;
                if (!confirm('Are you sure you want to refund this redemption? The points will be returned to the user and the redemption will be removed.')) {
                    return;
                }
                
                try {
                    const { getCurrentUser } = await import('./firebase.js');
                    const user = getCurrentUser();
                    if (!user) {
                        alert('Please sign in to refund redemptions');
                        return;
                    }
                    
                    const idToken = await user.getIdToken();
                    const { config } = await import('./config.js');
                    
                    const response = await fetch(`${config.api.baseUrl}/api/redemptions/refund`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            redemptionId: redemptionId
                        })
                    });
                    
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to refund redemption');
                    }
                    
                    // Remove from UI
                    const queueItem = container.querySelector(`[data-redemption-id="${redemptionId}"]`);
                    if (queueItem) {
                        queueItem.remove();
                    }
                    
                    // If queue is empty, show empty state
                    const queueList = container.querySelector('.redemption-queue-list');
                    if (queueList && queueList.querySelectorAll('.redemption-queue-item').length === 0) {
                        queueList.innerHTML = `
                            <div style="text-align: center; padding: 2rem; color: rgba(255,255,255,0.6);">
                                No pending redemptions
                            </div>
                        `;
                    }
                } catch (error) {
                    console.error('Error refunding redemption:', error);
                    alert('Failed to refund redemption: ' + error.message);
                }
            };
        });

        // Wire up preview buttons
        container.querySelectorAll('.preview-redemption-btn').forEach(btn => {
            btn.onclick = async () => {
                const videoId = btn.dataset.videoId;
                if (!videoId) return;
                try {
                    const { db, doc, getDoc } = await import('./firebase.js');
                    const videoDoc = await getDoc(doc(db, 'customVideos', videoId));
                    if (!videoDoc.exists()) {
                        alert('Video not found');
                        return;
                    }
                    const videoData = videoDoc.data();
                    const safeUrl = sanitizeVideoUrl(videoData?.videoUrl);
                    if (!safeUrl) {
                        alert('The stored video URL appears invalid or unsafe.');
                        return;
                    }
                    const w = window.open('', 'preview', 'width=640,height=420');
                    if (!w) {
                        alert('Popup blocked. Please allow popups for preview.');
                        return;
                    }
                    w.document.write(`<!DOCTYPE html><html><head><title>Preview</title><style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;} video{max-width:100%;max-height:100%;}</style></head><body><video src="${safeUrl}" autoplay muted playsinline></video></body></html>`);
                    w.document.close();
                } catch (e) {
                    console.error('Preview failed:', e);
                    alert('Failed to preview video.');
                }
            };
        });

        // Wire up approve buttons - publishes event to overlay
        container.querySelectorAll('.approve-redemption-btn').forEach(btn => {
            btn.onclick = async () => {
                const videoId = btn.dataset.videoId;
                const streamerId = btn.dataset.userId;
                const viewerId = btn.dataset.viewerId || null;
                const viewerName = btn.dataset.viewerName || 'Anonymous';
                if (!videoId || !streamerId) {
                    alert('Missing data to approve this custom video');
                    return;
                }
                try {
                    const { db, doc, collection, addDoc, getDoc } = await import('./firebase.js');
                    // Fetch video to get URL and optional message
                    const videoDoc = await getDoc(doc(db, 'customVideos', videoId));
                    if (!videoDoc.exists()) {
                        alert('Video not found');
                        return;
                    }
                    const vd = videoDoc.data();
                    const safeUrl = sanitizeVideoUrl(vd?.videoUrl);
                    if (!safeUrl) {
                        alert('The stored video URL appears invalid or unsafe.');
                        return;
                    }
                    const alertsRef = collection(db, 'users', streamerId, 'events', 'custom-video', 'alerts');
                    await addDoc(alertsRef, {
                        type: 'custom-video',
                        videoId: videoId,
                        videoUrl: safeUrl,
                        message: vd?.message || null,
                        viewerName: viewerName,
                        viewerId: viewerId,
                        timestamp: new Date()
                    });
                    // Optional: give quick UI feedback
                    alert('Approved! The video will play on the overlay.');
                } catch (e) {
                    console.error('Error approving custom video:', e);
                    alert('Failed to approve the video: ' + (e?.message || 'Unknown error'));
                }
            };
        });
        
    } catch (error) {
        console.error('Error loading redemption queue:', error);
        container.innerHTML = `
            <h4 style="color: #c084fc; margin-bottom: 1rem; font-size: 1.1rem;">Redemption Queue</h4>
            <div style="text-align: center; padding: 2rem; color: rgba(255,0,0,0.6);">
                Error loading redemption queue
            </div>
        `;
    }
}

function sanitizeVideoUrl(raw) {
    try {
        const trimmed = String(raw).trim();
        const url = new URL(trimmed);
        const protocol = url.protocol.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') {
            return null;
        }
        return trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
    } catch {
        return null;
    }
}

