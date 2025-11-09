import { getCurrentUser, onAuthChange } from './firebase.js';
import { showProjectWizard } from './projectWizard.js';
import { config } from './config.js';
import { renderProjectCard, bindProjectCard } from './projectCard.js';

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
        <div class="projects-header" id="projectsHeader" style="margin: 12px 0 20px 0;">
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
        <div id="projectWizardContainer" style="display:none;"></div>
    `;

    // Wiring
    const newProjectBtn = root.querySelector('#newProjectBtn');
    const copyObsBtn = root.querySelector('#copyObsBtn');
    if (newProjectBtn) newProjectBtn.onclick = () => openWizard();
    if (copyObsBtn) copyObsBtn.onclick = copyObsUrl;

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
                </div>`;
            return;
        }

        console.log('[Projects] rendering cards...');
        grid.innerHTML = projects.map(p => renderProjectCard(p)).join('');

        // Bind each card
        projects.forEach(p => {
            const card = grid.querySelector(`.project-card[data-id="${p.projectId}"]`);
            if (card) {
                bindProjectCard(card, p, openWizard, toggleProjectStatus, handleDeleteProject);
            }
        });
    }

    async function toggleProjectStatus(projectId, isActive) {
        const { db, doc, updateDoc } = await import('./firebase.js');
        await updateDoc(doc(db, 'projects', projectId), {
            twitchSubscription: isActive,
            updatedAt: new Date()
        });
    }

    async function handleDeleteProject(project, triggerButton) {
        const projectName = project.projectName ? `"${project.projectName}"` : 'this project';
        const confirmed = window.confirm(`Are you sure you want to permanently delete ${projectName}? This action cannot be undone.`);
        if (!confirmed) return;

        const originalText = triggerButton?.innerHTML;
        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.innerHTML = 'Deleting...';
        }

        try {
            const { db, doc, deleteDoc } = await import('./firebase.js');
            await deleteDoc(doc(db, 'projects', project.projectId));
            await loadProjects();
        } catch (err) {
            console.error('[Projects] Failed to delete project:', err);
            alert('Failed to delete project. Please try again.');
            if (triggerButton) {
                triggerButton.disabled = false;
                triggerButton.innerHTML = originalText || 'Delete';
            }
        }
    }

    function openWizard(project = null) {
        const container = root.querySelector('#projectWizardContainer');
        const projectsHeader = root.querySelector('#projectsHeader');
        const projectsGrid = root.querySelector('#projectsGrid');
        
        if (!container) return;
        
        // Hide projects list and header
        if (projectsHeader) projectsHeader.style.display = 'none';
        if (projectsGrid) projectsGrid.style.display = 'none';
        
        // Show and clear wizard container
        container.style.display = 'block';
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
    }

    function closeWizard() {
        const container = root.querySelector('#projectWizardContainer');
        const projectsHeader = root.querySelector('#projectsHeader');
        const projectsGrid = root.querySelector('#projectsGrid');
        
        // Hide wizard
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        
        // Show projects list and header
        if (projectsHeader) projectsHeader.style.display = 'block';
        if (projectsGrid) projectsGrid.style.display = 'grid';
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
}


