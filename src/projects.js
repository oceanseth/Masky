import { getCurrentUser, onAuthChange } from './firebase.js';
import { showProjectWizard } from './projectWizard.js';
import { config } from './config.js';

export function renderProjectsManager(container) {
    const containerElement = typeof container === 'string' ? document.querySelector(container) : container;
    console.log('[Projects] renderProjectsManager container:', container, 'resolved?', !!containerElement);
    if (!containerElement) {
        console.error('Projects container not found:', container);
        return;
    }

    // Create or reuse mount
    let root = document.getElementById('projectsManager');
    if (!root) {
        root = document.createElement('div');
        root.id = 'projectsManager';
        containerElement.appendChild(root);
    }

    console.log('[Projects] Rendering projects manager UI');
    root.innerHTML = `
        <div class="projects-header" style="margin: 12px 0 20px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                <h2 class="section-title" style="margin: 0;">Your Projects</h2>
                <button class="btn btn-primary" id="newProjectBtn">+ New Project</button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; color: rgba(255,255,255,0.75);">
                <span style="opacity:0.85;">OBS Overlay Url:</span>
                <small id="obsUrlText" title="OBS Overlay Url"></small>
                <button class="btn btn-secondary" id="copyObsBtn" title="Copy URL" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">📋</button>
            </div>
        </div>
        <div class="projects-grid" id="projectsGrid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px;">
            <div class="loading-state" style="grid-column: 1 / -1; text-align:center; color: rgba(255,255,255,0.7);">
                <div class="loading-spinner" style="font-size: 2rem; animation: spin 1s linear infinite;">⏳</div>
                <p>Loading your projects...</p>
            </div>
        </div>
        <div class="modal" id="projectWizardModal" style="display:none;">
            <div class="modal-content">
                <button class="modal-close" id="closeWizardBtn">×</button>
                <div id="projectWizardContainer"></div>
            </div>
        </div>
    `;

    // Wiring
    const newProjectBtn = root.querySelector('#newProjectBtn');
    const copyObsBtn = root.querySelector('#copyObsBtn');
    const closeWizardBtn = root.querySelector('#closeWizardBtn');
    if (newProjectBtn) newProjectBtn.onclick = () => openWizard();
    if (copyObsBtn) copyObsBtn.onclick = copyObsUrl;
    if (closeWizardBtn) closeWizardBtn.onclick = closeWizard;

    // Show OBS URL
    const user = getCurrentUser();
    const obsEl = root.querySelector('#obsUrlText');
    console.log('[Projects] current user at render:', user?.uid);
    if (user && obsEl) {
        const url = `${window.location.origin}/twitchevent.html#${user.uid}`;
        obsEl.textContent = url;
        console.log('[Projects] OBS URL set to:', url);
    }

    const userAtRender = getCurrentUser();
    if (userAtRender) {
        console.log('[Projects] user present, loading projects');
        loadProjects();
    } else {
        onAuthChange((u) => {
            if (u) {
                // Fill OBS URL then load
                const obsEl = root.querySelector('#obsUrlText');
                if (obsEl) obsEl.textContent = `${window.location.origin}/twitchevent.html#${u.uid}`;
                console.log('[Projects] auth change -> load projects for', u.uid);
                loadProjects();
            }
        });
    }

    async function loadProjects() {
        const grid = root.querySelector('#projectsGrid');
        if (!grid) {
            console.warn('[Projects] projectsGrid not found');
            return;
        }
        console.log('[Projects] loadProjects() start');
        
        try {
            const user = getCurrentUser();
            console.log('[Projects] user in load:', user?.uid);
            if (!user) {
                grid.innerHTML = `
                    <div class="empty-state" style="text-align:center; color: rgba(255,255,255,0.6); padding: 2rem;">
                        <div>Please log in to view your projects</div>
                    </div>`;
                return;
            }
            
            console.log('[Projects] importing firebase.js...');
            const { db, collection, query, where, orderBy, getDocs } = await import('./firebase.js');
            const projectsRef = collection(db, 'projects');
            
            // Try with orderBy first, fallback to without if index is missing
            let snap;
            try {
                const q = query(projectsRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
                console.log('[Projects] querying with orderBy(createdAt)');
                snap = await getDocs(q);
                console.log('[Projects] query complete (ordered). docs:', snap?.docs?.length);
            } catch (orderByError) {
                // If orderBy fails (likely missing index), try without it
                console.warn('[Projects] orderBy failed, falling back:', orderByError?.message || orderByError);
                const q = query(projectsRef, where('userId', '==', user.uid));
                console.log('[Projects] querying without orderBy');
                snap = await getDocs(q);
                console.log('[Projects] query complete (fallback). docs:', snap?.docs?.length);
                // Sort manually in memory
                const items = snap.docs.map(doc => ({ projectId: doc.id, ...doc.data() }));
                items.sort((a, b) => {
                    const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
                    const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
                    return bTime - aTime; // Descending
                });
                console.log('[Projects] rendering (fallback) items:', items.length);
                renderProjects(items);
                return;
            }
            
            const items = snap.docs.map(doc => ({ projectId: doc.id, ...doc.data() }));
            console.log('[Projects] rendering items:', items.length);
            renderProjects(items);
        } catch (e) {
            console.error('[Projects] Failed to load projects:', e);
            // Show error message and clear loading state
            grid.innerHTML = `
                <div class="empty-state" style="text-align:center; color: rgba(255,107,107,0.8); padding: 2rem; border: 1px solid rgba(255,107,107,0.3); border-radius: 8px;">
                    <div style="font-size: 2rem;">⚠️</div>
                    <div style="margin-top: 8px;">Failed to load projects</div>
                    <div style="font-size: 0.9rem; color: rgba(255,255,255,0.6); margin-top: 4px;">${e.message || 'Please try refreshing the page'}</div>
                    <button class="btn btn-secondary" id="retryLoadBtn" style="margin-top: 12px;">Retry</button>
                </div>`;
            const retryBtn = document.getElementById('retryLoadBtn');
            if (retryBtn) {
                retryBtn.onclick = () => loadProjects();
            }
        }
    }

    function renderProjects(projects) {
        console.log('[Projects] renderProjects count:', Array.isArray(projects) ? projects.length : 'invalid');
        const grid = root.querySelector('#projectsGrid');
        if (!projects || projects.length === 0) {
            console.log('[Projects] rendering empty state');
            grid.innerHTML = `
                <div class="empty-state" style="text-align:center; color: rgba(255,255,255,0.6); padding: 2rem; border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px;">
                    <div style="font-size: 2rem;">📁</div>
                    <div>No projects yet</div>
                    <button class="btn btn-primary" id="emptyCreateBtn" style="margin-top: 10px;">Create Your First Project</button>
                </div>`;
            const btn = root.querySelector('#emptyCreateBtn');
            if (btn) btn.onclick = () => openWizard();
            return;
        }

        console.log('[Projects] rendering cards...');
        grid.innerHTML = projects.map(p => `
            <div class="project-card" data-id="${p.projectId}" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div>
                        <div class="project-name" style="font-weight:600;">${escapeHtml(p.projectName || 'Untitled Project')}</div>
                        <div class="project-platform" style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">${escapeHtml((p.platform || '').charAt(0).toUpperCase() + (p.platform || '').slice(1))} - ${escapeHtml(p.eventType || '')}</div>
                    </div>
                    <div class="project-status" style="display:flex; align-items:center; gap:6px;">
                        <span class="status-label" style="font-size:0.8rem;">${p.twitchSubscription ? 'Active' : 'Inactive'}</span>
                        <label class="status-toggle" style="position:relative; display:inline-block; width:50px; height:24px;">
                            <input type="checkbox" ${p.twitchSubscription ? 'checked' : ''} data-role="status-toggle" style="display:none;">
                            <span class="status-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${p.twitchSubscription ? '#10b981' : '#ef4444'};transition:0.3s;border-radius:24px;border:1px solid rgba(255,255,255,0.2);"></span>
                        </label>
                    </div>
                </div>

                <div class="project-video-preview" style="margin-top:12px;">
                    ${p.videoUrl ? `
                        <div class="video-thumbnail-container" style="position:relative; aspect-ratio:16/9; background:#1a1a1a; border-radius:12px; overflow:hidden;">
                            <video src="${p.videoUrl}" muted preload="metadata" style="width:100%; height:100%; object-fit:cover;"></video>
                            <div class="video-overlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center; background: rgba(0,0,0,0.35);">▶️</div>
                        </div>
                    ` : `
                        <div class="video-placeholder" style="aspect-ratio:16/9; border: 2px dashed rgba(255,255,255,0.2); border-radius:12px; display:flex; align-items:center; justify-content:center; color: rgba(255,255,255,0.6);">No video created yet</div>
                    `}
                </div>

                <div class="project-actions" style="display:flex; gap:8px; margin-top:12px;">
                    <button class="btn btn-secondary" data-role="edit">Edit</button>
                    <button class="btn btn-secondary" data-role="view">View</button>
                    <button class="btn btn-secondary" data-role="copy-url">Copy URL</button>
                </div>
            </div>
        `).join('');

        // bind each card
        projects.forEach(p => bindCard(p));
    }

    function bindCard(project) {
        const card = root.querySelector(`.project-card[data-id="${project.projectId}"]`);
        if (!card) return;
        const statusToggle = card.querySelector('[data-role="status-toggle"]');
        const statusLabel = card.querySelector('.status-label');
        const editBtn = card.querySelector('[data-role="edit"]');
        const viewBtn = card.querySelector('[data-role="view"]');
        const copyBtn = card.querySelector('[data-role="copy-url"]');

        if (statusToggle) {
            statusToggle.onchange = async (e) => {
                try {
                    const checked = e.target.checked;
                    const { db, doc, updateDoc } = await import('./firebase.js');
                    await updateDoc(doc(db, 'projects', project.projectId), {
                        twitchSubscription: checked,
                        updatedAt: new Date()
                    });
                    if (statusLabel) statusLabel.textContent = checked ? 'Active' : 'Inactive';
                } catch (err) {
                    console.error('Failed to toggle status', err);
                    e.target.checked = !e.target.checked;
                }
            };
        }

        if (editBtn) editBtn.onclick = () => openWizard(project);
        if (viewBtn) viewBtn.onclick = () => openProject(project);
        if (copyBtn) copyBtn.onclick = () => copyProjectUrl(project);
    }

    function openWizard(project = null) {
        const modal = document.getElementById('projectWizardModal');
        const container = document.getElementById('projectWizardContainer');
        if (!modal || !container) return;
        container.innerHTML = '';
        showProjectWizard({
            containerId: 'projectWizardContainer',
            mode: project ? 'edit' : 'create',
            projectData: project,
            onComplete: () => {
                closeWizard();
                loadProjects();
            },
            onCancel: () => closeWizard()
        });
        modal.style.display = 'block';
    }

    function closeWizard() {
        const modal = document.getElementById('projectWizardModal');
        if (modal) modal.style.display = 'none';
    }

    function openProject(project) {
        const user = getCurrentUser();
        if (user && user.uid) {
            window.open(`/twitchevent.html#${user.uid}`, '_blank');
        } else {
            alert('Please log in to view your project');
        }
    }

    function copyObsUrl() {
        const user = getCurrentUser();
        if (user && user.uid) {
            const url = `${window.location.origin}/twitchevent.html#${user.uid}`;
            navigator.clipboard.writeText(url).then(() => alert('OBS Browser Source URL copied!'));
        } else {
            alert('Please log in to copy your OBS Browser Source URL');
        }
    }

    function copyProjectUrl(project) {
        const user = getCurrentUser();
        if (user && user.uid) {
            const url = `${window.location.origin}/twitchevent.html#${user.uid}`;
            navigator.clipboard.writeText(url).then(() => alert('Project URL copied!'));
        } else {
            alert('Please log in to copy your project URL');
        }
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
}


