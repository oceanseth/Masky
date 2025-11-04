import { getCurrentUser, onAuthChange } from './firebase.js';
import { showProjectWizard } from './projectWizard.js';
import { config } from './config.js';

export function renderProjectsManager(container) {
    const containerElement = typeof container === 'string' ? document.querySelector(container) : container;
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

    root.innerHTML = `
        <div class="projects-header" style="margin: 12px 0 20px 0;">
            <h2 class="section-title">Your Projects</h2>
            <div style="display:flex; align-items:center; gap:8px; color: rgba(255,255,255,0.75);">
                <small id="obsUrlText"></small>
                <button class="btn btn-secondary" id="copyObsBtn" title="Copy URL" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">📋</button>
                <button class="btn btn-primary" id="newProjectBtn">+ New Project</button>
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
    document.getElementById('newProjectBtn').onclick = () => openWizard();
    document.getElementById('copyObsBtn').onclick = copyObsUrl;
    document.getElementById('closeWizardBtn').onclick = closeWizard;

    // Show OBS URL
    const user = getCurrentUser();
    const obsEl = document.getElementById('obsUrlText');
    if (user && obsEl) obsEl.textContent = `${window.location.origin}/twitchevent.html#${user.uid}`;

    const userAtRender = getCurrentUser();
    if (userAtRender) {
        loadProjects();
    } else {
        onAuthChange((u) => {
            if (u) {
                // Fill OBS URL then load
                const obsEl = document.getElementById('obsUrlText');
                if (obsEl) obsEl.textContent = `${window.location.origin}/twitchevent.html#${u.uid}`;
                loadProjects();
            }
        });
    }

    async function loadProjects() {
        try {
            const user = getCurrentUser();
            if (!user) return;
            const { db, collection, query, where, orderBy, getDocs } = await import('./firebase.js');
            const projectsRef = collection(db, 'projects');
            const q = query(projectsRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            const items = snap.docs.map(doc => ({ projectId: doc.id, ...doc.data() }));
            renderProjects(items);
        } catch (e) {
            console.error('Failed to load projects:', e);
            showError('Failed to load projects');
        }
    }

    function renderProjects(projects) {
        const grid = document.getElementById('projectsGrid');
        if (!projects || projects.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="text-align:center; color: rgba(255,255,255,0.6); padding: 2rem; border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px;">
                    <div style="font-size: 2rem;">📁</div>
                    <div>No projects yet</div>
                    <button class="btn btn-primary" id="emptyCreateBtn" style="margin-top: 10px;">Create Your First Project</button>
                </div>`;
            const btn = document.getElementById('emptyCreateBtn');
            if (btn) btn.onclick = () => openWizard();
            return;
        }

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
        const card = document.querySelector(`.project-card[data-id="${project.projectId}"]`);
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


