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
    const platform = escapeHtml((project.platform || '').charAt(0).toUpperCase() + (project.platform || '').slice(1));
    const eventType = escapeHtml(project.eventType || '');
    const isActive = project.twitchSubscription;
    
    return `
        <div class="project-card" data-id="${project.projectId}" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.3s ease;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom: 12px;">
                <div>
                    <div class="project-name" style="font-weight:600; font-size: 1.1rem; margin-bottom: 4px;">${projectName}</div>
                    <div class="project-platform" style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">${platform}${eventType ? ` - ${eventType}` : ''}</div>
                </div>
                <div class="project-status" style="display:flex; align-items:center; gap:6px;" onclick="event.stopPropagation();">
                    <span class="status-label" style="font-size:0.8rem;">${isActive ? 'Active' : 'Inactive'}</span>
                    <label class="status-toggle">
                        <input type="checkbox" ${isActive ? 'checked' : ''} data-role="status-toggle">
                        <span class="status-slider"></span>
                    </label>
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
export function bindProjectCard(card, project, onEdit, onToggleStatus) {
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
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (video.paused) {
                // Enable audio and play
                video.muted = false;
                video.play();
                overlay.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
                
                // When video ends, show overlay again
                video.onended = () => {
                    overlay.style.opacity = '1';
                    overlay.style.pointerEvents = 'auto';
                    video.currentTime = 0;
                    video.muted = true;
                };
            } else {
                video.pause();
                video.muted = true;
                overlay.style.opacity = '1';
                overlay.style.pointerEvents = 'auto';
            }
        });
    }
    
    // Handle status toggle
    const statusToggle = card.querySelector('[data-role="status-toggle"]');
    const statusLabel = card.querySelector('.status-label');
    const statusToggleWrapper = card.querySelector('.status-toggle');
    
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
            } catch (err) {
                console.error('Failed to toggle status', err);
                // Revert on error
                e.target.checked = !checked;
                if (statusLabel) statusLabel.textContent = !checked ? 'Active' : 'Inactive';
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

