import { getEventTypeLabel } from './eventTypeLabels.js';

/**
 * Shared project card rendering utility
 * Provides consistent project card UI across dashboard and projects page
 */

/**
 * Renders a project card HTML
 * @param {Object} project - Project data
 * @returns {string} HTML string for the project card
 */
export function renderProjectCard(project) {
    const escapeHtml = (str) => String(str || '').replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
    
    const projectName = escapeHtml(project.projectName || 'Untitled Project');
    const platformRaw = project.platform || project.provider || '';
    const platformLabel = escapeHtml(platformRaw ? platformRaw.charAt(0).toUpperCase() + platformRaw.slice(1) : 'Unknown');
    const eventLabelRaw = project.eventType ? getEventTypeLabel(project.eventType, platformRaw) : '';
    const eventLabel = eventLabelRaw ? ` - ${escapeHtml(eventLabelRaw)}` : '';
    const isActive = project.twitchSubscription;
    
    return `
        <div class="project-card" data-id="${project.projectId}" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.3s ease;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom: 12px;">
                <div>
                    <div class="project-name" style="font-weight:600; font-size: 1.1rem; margin-bottom: 4px;">${projectName}</div>
                    <div class="project-platform" style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">${platformLabel}${eventLabel}</div>
                </div>
                <div class="project-status" style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;" onclick="event.stopPropagation();">
                    <div class="project-status-toggle" style="display:flex; align-items:center; gap:6px;">
                        <span class="status-label" style="font-size:0.8rem;">${isActive ? 'Active' : 'Inactive'}</span>
                        <label class="status-toggle">
                            <input type="checkbox" ${isActive ? 'checked' : ''} data-role="status-toggle">
                            <span class="status-slider"></span>
                        </label>
                    </div>
                    <button class="btn btn-danger project-delete-btn" data-role="delete-project" style="display:${isActive ? 'none' : 'flex'}; align-items:center; justify-content:center; gap:6px; padding: 0.35rem 0.75rem; font-size:0.8rem; border-radius:6px;">
                        <span aria-hidden="true">🗑️</span>
                        <span>Delete</span>
                    </button>
                </div>
            </div>

            <div class="project-video-preview">
                ${project.videoUrl ? `
                    <div class="video-thumbnail-container" style="position:relative; aspect-ratio:16/9; background:#1a1a1a; border-radius:12px; overflow:hidden;">
                        <video src="${project.videoUrl}" muted preload="metadata" data-role="project-video" style="width:100%; height:100%; object-fit:cover;"></video>
                        <div class="video-overlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center; background: rgba(0,0,0,0.4); transition: background 0.3s ease;">
                            <button class="video-play-btn" data-role="play-video" onclick="event.stopPropagation();" style="background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s ease; font-size: 1.5rem;">
                                ▶️
                            </button>
                        </div>
                    </div>
                ` : `
                    <div class="video-placeholder" style="aspect-ratio:16/9; border: 2px dashed rgba(255,255,255,0.2); border-radius:12px; display:flex; align-items:center; justify-content:center; color: rgba(255,255,255,0.6);">
                        <div style="text-align: center;">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎬</div>
                            <div>No video created yet</div>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;
}

/**
 * Binds event handlers to a project card
 * @param {HTMLElement} card - The card element
 * @param {Object} project - Project data
 * @param {Function} onEdit - Callback when card is clicked to edit
 * @param {Function} onToggleStatus - Callback when status is toggled
 */
export function bindProjectCard(card, project, onEdit, onToggleStatus, onDelete) {
    if (!card) return;
    
    // Click card to edit (except for interactive elements)
    card.addEventListener('click', (e) => {
        // Don't trigger if clicking on interactive elements
        if (e.target.closest('[data-role="status-toggle"]') || 
            e.target.closest('.status-toggle') ||
            e.target.closest('[data-role="play-video"]')) {
            return;
        }
        onEdit(project);
    });
    
    // Handle video play button
    const playBtn = card.querySelector('[data-role="play-video"]');
    const video = card.querySelector('[data-role="project-video"]');
    const overlay = card.querySelector('.video-overlay');
    
    if (playBtn && video) {
        let isRefreshingUrl = false;
        
        // Function to fetch fresh video URL from API
        async function refreshVideoUrl() {
            if (isRefreshingUrl || !project.projectId) return null;
            
            isRefreshingUrl = true;
            try {
                const { config } = await import('./config.js');
                const trimmedBase = (config?.api?.baseUrl || '').replace(/\/$/, '');
                const endpoint = trimmedBase ? `${trimmedBase}/api/projects/${project.projectId}/video-url` : `/api/projects/${project.projectId}/video-url`;
                
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Cache-Control': 'no-store'
                    },
                    cache: 'no-store'
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch fresh URL: ${response.status}`);
                }
                
                const data = await response.json();
                return data.videoUrl || null;
            } catch (error) {
                console.error('[ProjectCard] Failed to refresh video URL:', error);
                return null;
            } finally {
                isRefreshingUrl = false;
            }
        }
        
        // Handle video loading errors (e.g., 403 Forbidden)
        video.addEventListener('error', async (e) => {
            const error = video.error;
            const errorCode = error?.code;
            
            console.error('[ProjectCard] Video load error:', {
                projectId: project.projectId,
                videoUrl: video.src,
                error: error,
                errorCode: errorCode
            });
            
            // Check if it's a network/forbidden error (403, 404, etc.)
            // MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED = 4
            // MediaError.MEDIA_ERR_NETWORK = 2
            if (errorCode === 2 || errorCode === 4 || errorCode === undefined) {
                // Try to fetch a fresh URL
                const freshUrl = await refreshVideoUrl();
                
                if (freshUrl && freshUrl !== video.src) {
                    console.log('[ProjectCard] Retrying with fresh URL:', freshUrl);
                    video.src = freshUrl;
                    video.load(); // Reload the video with new URL
                    return; // Don't show error yet, let it try to load
                }
            }
            
            // Show error state in overlay if refresh failed or not applicable
            if (overlay) {
                overlay.innerHTML = `
                    <div style="text-align: center; color: rgba(255,255,255,0.9); padding: 1rem;">
                        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">⚠️</div>
                        <div style="font-size: 0.85rem;">Video unavailable</div>
                        <div style="font-size: 0.75rem; color: rgba(255,255,255,0.6); margin-top: 0.25rem;">URL may have expired</div>
                    </div>`;
                overlay.style.background = 'rgba(0,0,0,0.7)';
                overlay.style.pointerEvents = 'none';
            }
        });
        
        playBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (video.paused) {
                // Before playing, check if video has an error and refresh URL if needed
                if (video.error) {
                    const freshUrl = await refreshVideoUrl();
                    if (freshUrl && freshUrl !== video.src) {
                        video.src = freshUrl;
                        video.load();
                        // Wait a bit for the video to load before playing
                        await new Promise((resolve) => {
                            const timeout = setTimeout(resolve, 500);
                            video.addEventListener('loadeddata', () => {
                                clearTimeout(timeout);
                                resolve();
                            }, { once: true });
                            video.addEventListener('error', () => {
                                clearTimeout(timeout);
                                resolve();
                            }, { once: true });
                        });
                    }
                }
                
                // Enable audio and play
                video.muted = false;
                video.play().catch(err => {
                    console.error('[ProjectCard] Video play error:', err);
                    // If play fails, try refreshing URL once more
                    refreshVideoUrl().then(freshUrl => {
                        if (freshUrl && freshUrl !== video.src) {
                            video.src = freshUrl;
                            video.load();
                            video.play().catch(() => {
                                // If still fails, show error
                                if (overlay) {
                                    overlay.style.opacity = '1';
                                    overlay.style.pointerEvents = 'auto';
                                }
                            });
                        } else {
                            // Show error
                            if (overlay) {
                                overlay.style.opacity = '1';
                                overlay.style.pointerEvents = 'auto';
                            }
                        }
                    });
                });
                if (overlay) {
                    overlay.style.opacity = '0';
                    overlay.style.pointerEvents = 'none';
                }
                
                // When video ends, show overlay again
                video.onended = () => {
                    if (overlay) {
                        overlay.style.opacity = '1';
                        overlay.style.pointerEvents = 'auto';
                    }
                    video.currentTime = 0;
                    video.muted = true;
                };
            } else {
                video.pause();
                video.muted = true;
                if (overlay) {
                    overlay.style.opacity = '1';
                    overlay.style.pointerEvents = 'auto';
                }
            }
        });
    }
    
    // Handle status toggle
    const statusToggle = card.querySelector('[data-role="status-toggle"]');
    const statusLabel = card.querySelector('.status-label');
    const statusToggleWrapper = card.querySelector('.status-toggle');
    const deleteButton = card.querySelector('[data-role="delete-project"]');

    if (deleteButton) {
        if (typeof onDelete === 'function') {
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                onDelete(project, deleteButton);
            });
            deleteButton.style.display = project.twitchSubscription ? 'none' : 'flex';
        } else {
            deleteButton.remove();
        }
    }
    
    if (statusToggle && onToggleStatus) {
        statusToggle.addEventListener('change', async (e) => {
            const checked = e.target.checked;
            try {
                // Add loading state
                if (statusToggleWrapper) statusToggleWrapper.classList.add('updating');
                statusToggle.disabled = true;
                
                await onToggleStatus(project.projectId, checked);
                
                // Update label
                if (statusLabel) statusLabel.textContent = checked ? 'Active' : 'Inactive';
                if (deleteButton && typeof onDelete === 'function') {
                    deleteButton.style.display = checked ? 'none' : 'flex';
                }
            } catch (err) {
                console.error('Failed to toggle status', err);
                // Revert on error
                e.target.checked = !checked;
                if (statusLabel) statusLabel.textContent = !checked ? 'Active' : 'Inactive';
                if (deleteButton && typeof onDelete === 'function') {
                    deleteButton.style.display = !checked ? 'none' : 'flex';
                }
            } finally {
                // Remove loading state
                if (statusToggleWrapper) statusToggleWrapper.classList.remove('updating');
                statusToggle.disabled = false;
            }
        });
    }
    
    // Add hover effects
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-4px)';
        card.style.boxShadow = '0 8px 24px rgba(192, 132, 252, 0.2)';
    });
    
    card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = 'none';
    });
}

