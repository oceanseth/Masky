import { getCurrentUser, onAuthChange } from './firebase.js';
import { showProjectWizard } from './projectWizard.js';
import { config } from './config.js';
import { renderProjectCard, bindProjectCard } from './projectCard.js';
import { getEventTypeLabel } from './eventTypeLabels.js';

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
            <div id="socialHooksSection" style="margin-top: 12px;">
                <button id="socialHooksToggle" type="button" class="btn btn-secondary" style="width: 100%; justify-content: space-between; display: flex; align-items: center; gap: 12px; font-size: 0.9rem; padding: 0.35rem 0.6rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);" aria-expanded="false" aria-controls="socialHooksDetails">
                    <span style="opacity: 0.85; text-transform: uppercase; letter-spacing: 0.02em; font-size: 0.8rem;">Connected Social Hooks</span>
                    <span style="display:flex; align-items:center; gap: 8px;">
                        <span id="socialHooksCount" style="font-weight: 600; color: rgba(255,255,255,0.95);">—</span>
                        <span id="socialHooksToggleIcon" aria-hidden="true">▼</span>
                    </span>
                </button>
                <div id="socialHooksDetails" style="display: none; margin-top: 8px; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 12px; background: rgba(0,0,0,0.35); color: rgba(255,255,255,0.82); font-size: 0.85rem;">
                    <div>Sign in to view your connected social hooks.</div>
                </div>
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
    let lastSocialHooksLoad = 0;
    let socialHooksLoading = false;
    let pendingSocialHooksRefresh = false;
    let pendingSocialHooksOptions = null;
    let socialHooksItems = [];
    let socialHooksExpectedCount = 0;
    let socialHooksVerifying = false;
    let socialHooksVerificationProgress = 0;
    let socialHooksSignedOut = false;
    let socialHooksError = null;

    const newProjectBtn = root.querySelector('#newProjectBtn');
    const copyObsBtn = root.querySelector('#copyObsBtn');
    const socialHooksToggle = root.querySelector('#socialHooksToggle');
    if (newProjectBtn) newProjectBtn.onclick = () => openWizard();
    if (copyObsBtn) copyObsBtn.onclick = copyObsUrl;
    if (socialHooksToggle) {
        socialHooksToggle.onclick = (event) => {
            event.preventDefault();
            toggleSocialHooks();
        };
    }

    // Initialize hooks display
    loadSocialHooks({ showLoading: false });

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
        loadSocialHooks({ showLoading: true });
    } else {
        onAuthChange((u) => {
            if (u) {
                // Fill OBS URL then load
                const obsEl = root.querySelector('#obsUrlText');
                if (obsEl) obsEl.textContent = `${window.location.origin}/twitchevent.html#${u.uid}`;
                console.log('[Projects] auth change -> load projects for', u.uid);
                loadProjects();
                loadSocialHooks({ showLoading: true, forceRefresh: true });
            } else {
                // Reset hooks display when user logs out
                loadSocialHooks({ showLoading: false });
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
                loadSocialHooks({ showLoading: true, forceRefresh: true });
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

    function toggleSocialHooks(forceExpanded = null) {
        const toggleBtn = root.querySelector('#socialHooksToggle');
        const detailsEl = root.querySelector('#socialHooksDetails');
        const icon = root.querySelector('#socialHooksToggleIcon');

        if (!toggleBtn || !detailsEl) {
            return;
        }

        if (toggleBtn.disabled) {
            return;
        }

        const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = typeof forceExpanded === 'boolean' ? forceExpanded : !isExpanded;

        toggleBtn.setAttribute('aria-expanded', String(nextExpanded));
        detailsEl.style.display = nextExpanded ? 'block' : 'none';
        if (icon) icon.textContent = nextExpanded ? '▲' : '▼';

        if (nextExpanded) {
            loadSocialHooks({ showLoading: true, forceRefresh: true });
        }
    }

    async function loadSocialHooks({ showLoading = true, forceRefresh = false, verifyWithProviders = false } = {}) {
        const countEl = root.querySelector('#socialHooksCount');
        const detailsEl = root.querySelector('#socialHooksDetails');
        if (!countEl || !detailsEl) {
            return;
        }

        const user = getCurrentUser();
        if (!user) {
            socialHooksSignedOut = true;
            socialHooksItems = [];
            socialHooksExpectedCount = 0;
            socialHooksVerifying = false;
            socialHooksVerificationProgress = 0;
            socialHooksError = null;
            lastSocialHooksLoad = Date.now();
            socialHooksLoading = false;
            pendingSocialHooksRefresh = false;
            pendingSocialHooksOptions = null;
            updateSocialHooksDisplay();
            return;
        }

        socialHooksSignedOut = false;

        if (socialHooksLoading) {
            if (forceRefresh) {
                pendingSocialHooksRefresh = true;
                pendingSocialHooksOptions = {
                    showLoading: true,
                    forceRefresh: true
                };
            }
            return;
        }

        socialHooksLoading = true;
        pendingSocialHooksRefresh = false;
        pendingSocialHooksOptions = null;
        socialHooksError = null;

        if (showLoading && !verifyWithProviders) {
            countEl.textContent = '…';
            detailsEl.innerHTML = `<div style="display:flex; align-items:center; gap: 8px; color: rgba(255,255,255,0.7);"><span class="loading-spinner" style="font-size: 1.2rem; animation: spin 1s linear infinite;">⏳</span> Loading connected hooks...</div>`;
        }

        try {
            const { db, collection, getDocs, query, orderBy } = await import('./firebase.js');
            const subsRef = collection(db, 'users', user.uid, 'subscriptions');

            let snap;
            try {
                const orderedQuery = query(subsRef, orderBy('updatedAt', 'desc'));
                snap = await getDocs(orderedQuery);
            } catch (orderByError) {
                console.warn('[Projects] subscriptions orderBy failed, using unordered fetch:', orderByError?.message || orderByError);
                snap = await getDocs(subsRef);
            }

            const normalized = dedupeSocialHookItems(snap.docs.map(normalizeSubscriptionDoc));
            normalized.sort((a, b) => {
                const aTime = a.updatedAt ? a.updatedAt.getTime() : 0;
                const bTime = b.updatedAt ? b.updatedAt.getTime() : 0;
                return bTime - aTime;
            });
            socialHooksExpectedCount = normalized.length;
            lastSocialHooksLoad = Date.now();

            if (verifyWithProviders) {
                socialHooksItems = [];
                socialHooksVerifying = true;
                socialHooksVerificationProgress = 0;
                updateSocialHooksDisplay();
                await verifySocialHooksSequential(normalized);
                socialHooksVerificationProgress = socialHooksExpectedCount;
                socialHooksVerifying = false;
                updateSocialHooksDisplay();
            } else {
                socialHooksItems = normalized;
                socialHooksVerificationProgress = normalized.length;
                socialHooksVerifying = false;
                updateSocialHooksDisplay();
            }
        } catch (error) {
            console.error('[Projects] Failed to load connected social hooks:', error);
            socialHooksError = error;
            socialHooksItems = [];
            socialHooksExpectedCount = 0;
            socialHooksVerifying = false;
            socialHooksVerificationProgress = 0;
            updateSocialHooksDisplay();
        } finally {
            socialHooksLoading = false;
            if (pendingSocialHooksRefresh) {
                const queuedOptions = pendingSocialHooksOptions || { showLoading: true, forceRefresh: true };
                pendingSocialHooksRefresh = false;
                pendingSocialHooksOptions = null;
                setTimeout(() => loadSocialHooks(queuedOptions), 0);
            }
        }
    }

    function updateSocialHooksDisplay() {
        const countEl = root.querySelector('#socialHooksCount');
        const detailsEl = root.querySelector('#socialHooksDetails');
        const toggleBtn = root.querySelector('#socialHooksToggle');
        const icon = root.querySelector('#socialHooksToggleIcon');

        if (!countEl || !detailsEl || !toggleBtn) {
            return;
        }

        if (socialHooksSignedOut) {
            toggleBtn.disabled = true;
            toggleBtn.setAttribute('aria-disabled', 'true');
            toggleBtn.setAttribute('aria-expanded', 'false');
            if (icon) icon.textContent = '▼';
            detailsEl.style.display = 'none';
            detailsEl.innerHTML = `<div>Sign in to view your connected social hooks.</div>`;
            countEl.textContent = '—';
            return;
        }

        toggleBtn.disabled = false;
        toggleBtn.removeAttribute('aria-disabled');

        if (socialHooksError) {
            countEl.textContent = '—';
            detailsEl.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="color: rgba(255,255,255,0.75);">Failed to load connected social hooks.</div>
                    <button id="retrySocialHooksBtn" class="btn btn-secondary" style="align-self:flex-start; padding: 0.25rem 0.65rem; font-size: 0.8rem;">Retry</button>
                </div>
            `;
            const retryBtn = root.querySelector('#retrySocialHooksBtn');
            if (retryBtn) {
                retryBtn.onclick = (event) => {
                    event.preventDefault();
                    loadSocialHooks({ showLoading: true, forceRefresh: true });
                };
            }
            return;
        }

        const activeCount = socialHooksItems.filter(item => item.isActive).length;
        if (socialHooksVerifying) {
            const denominator = socialHooksExpectedCount || Math.max(socialHooksItems.length, 1);
            countEl.textContent = `${activeCount}/${denominator}`;
        } else if (socialHooksItems.length > 0) {
            countEl.textContent = `${activeCount}`;
        } else {
            countEl.textContent = socialHooksExpectedCount > 0 ? '0' : '—';
        }

        detailsEl.innerHTML = renderSocialHooksDetails(socialHooksItems, {
            verifying: socialHooksVerifying,
            expected: socialHooksExpectedCount,
            progress: socialHooksVerificationProgress
        });

        const refreshBtn = root.querySelector('#refreshSocialHooksBtn');
        if (refreshBtn) {
            refreshBtn.onclick = (event) => {
                event.preventDefault();
                loadSocialHooks({ showLoading: true, forceRefresh: true });
            };
        }

        const retryBtn = root.querySelector('#retrySocialHooksBtn');
        if (retryBtn) {
            retryBtn.onclick = (event) => {
                event.preventDefault();
                loadSocialHooks({ showLoading: true, forceRefresh: true });
            };
        }
    }

    async function verifySocialHooksSequential(items) {
        if (!Array.isArray(items) || items.length === 0) {
            updateSocialHooksDisplay();
            return;
        }

        const user = getCurrentUser();
        if (!user) {
            return;
        }

        for (const baseItem of items) {
            let token;
            try {
                token = await user.getIdToken();
            } catch (err) {
                console.error('[Projects] Failed to obtain auth token for hook verification:', err);
                token = null;
            }

            const verified = await verifySingleSocialHook(baseItem, token);
            if (verified && verified.subscriptionId) {
                socialHooksItems = dedupeSocialHookItems([...socialHooksItems, verified]);
            } else if (verified) {
                socialHooksItems.push(verified);
            }
            socialHooksVerificationProgress += 1;
            updateSocialHooksDisplay();
        }
    }

    async function verifySingleSocialHook(baseItem, token, attempt = 0) {
        const item = { ...baseItem };
        try {
            if (!token) {
                throw new Error('Missing auth token');
            }

            const response = await fetch(`${config.api.baseUrl}/api/social-hooks/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    subscriptions: [{
                        provider: item.provider,
                        subscriptionId: item.subscriptionId,
                        eventType: item.eventType,
                        docId: item.id
                    }]
                })
            });

            if (response.status === 401 && attempt === 0) {
                const user = getCurrentUser();
                if (user) {
                    const freshToken = await user.getIdToken(true);
                    return verifySingleSocialHook(baseItem, freshToken, attempt + 1);
                }
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Verification request failed (${response.status})`);
            }

            const data = await response.json();
            const result = Array.isArray(data.results) ? data.results[0] : null;

            if (result?.subscription) {
                applyProviderSubscription(item, result.subscription);
                item.verificationState = 'verified';
                item.verificationSource = result.provider || 'provider';
                item.verificationTimestamp = new Date();
                item.providerSubscription = result.subscription;
            } else {
                if (result?.status) {
                    item.statusRaw = result.status;
                    item.statusLower = result.status.toLowerCase();
                    item.isActive = result.status === 'enabled';
                }
                if (result?.error) {
                    item.verificationState = 'error';
                    const friendlyError = result.message
                        ? result.message
                        : typeof result.error === 'string'
                            ? formatLabel(result.error.replace(/[_\-]+/g, ' '))
                            : 'Verification failed';
                    item.verificationError = friendlyError;
                    item.isActive = false;
                } else {
                    item.verificationState = 'verified';
                }
                item.verificationSource = result?.provider || 'provider';
                item.verificationTimestamp = new Date();
            }

            return item;
        } catch (err) {
            console.error('[Projects] verifySingleSocialHook error:', err);
            const errorItem = { ...item };
            errorItem.verificationState = 'error';
            errorItem.verificationError = err.message || 'Verification failed';
            errorItem.verificationTimestamp = new Date();
            errorItem.isActive = false;
            return errorItem;
        }
    }

    function applyProviderSubscription(item, subscription) {
        if (!subscription || typeof subscription !== 'object') {
            return;
        }

        item.subscriptionId = subscription.id || item.subscriptionId;
        item.eventType = subscription.type || item.eventType;
        item.eventLabel = formatEventType(item.eventType, item.provider);

        const status = subscription.status || item.statusRaw || '';
        item.statusRaw = status;
        item.statusLower = status.toLowerCase();
        item.isActive = String(subscription.status || '').toLowerCase() === 'enabled';

        if (subscription.condition) {
            item.condition = subscription.condition;
        }
        if (subscription.transport) {
            item.transport = subscription.transport.method || subscription.transport;
        }

        const expiresAt = extractDate(subscription.expires_at);
        if (expiresAt) {
            item.expiresAt = expiresAt;
        }

        const updatedAt = extractDate(subscription.updated_at) || extractDate(subscription.created_at);
        if (updatedAt) {
            item.updatedAt = updatedAt;
        } else {
            item.updatedAt = new Date();
        }
    }

    function renderSocialHooksDetails(items, { verifying = false, expected = 0, progress = 0 } = {}) {
        const totalExpected = typeof expected === 'number' && expected > 0 ? expected : (Array.isArray(items) ? items.length : 0);
        const activeCount = Array.isArray(items) ? items.filter(item => item.isActive).length : 0;
        const parts = [];

        if (verifying) {
            const message = totalExpected > 0
                ? `Verifying social hooks ${Math.min(progress, totalExpected)} / ${totalExpected}...`
                : 'Verifying social hooks...';
            parts.push(`
                <div style="display:flex; align-items:center; gap:8px; color: rgba(255,255,255,0.7); font-size:0.78rem; margin-bottom:8px;">
                    <span class="loading-spinner" style="font-size: 1rem; animation: spin 1s linear infinite;">⏳</span>
                    <span>${escapeHtml(message)}</span>
                </div>
            `);
        }

        if (!Array.isArray(items) || items.length === 0) {
            const emptyMessage = verifying
                ? 'Awaiting verification responses...'
                : 'No social hooks connected yet.';
            parts.push(`
                <div style="color: rgba(255,255,255,0.75); font-size: 0.85rem;">
                    ${escapeHtml(emptyMessage)}
                </div>
            `);
            if (!verifying) {
                parts.push(`
                    <div style="color: rgba(255,255,255,0.55); font-size: 0.78rem; margin-top: 6px;">
                        Connect Twitch or other platforms to set up event subscriptions for your automations.
                    </div>
                `);
            }
            return parts.join('');
        }

        parts.push(`
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom: 8px;">
                <div style="font-size: 0.78rem; color: rgba(255,255,255,0.65);">
                    Active ${activeCount} of ${totalExpected || items.length} subscriptions${verifying && totalExpected ? ` • Verified ${Math.min(progress, totalExpected)} of ${totalExpected}` : ''}.
                </div>
                <button id="refreshSocialHooksBtn" class="btn btn-secondary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;">↻ Refresh</button>
            </div>
        `);

        const now = Date.now();
        parts.push(items.map((item) => {
            const statusInfo = getStatusDisplay(item);
            const updatedLabel = formatDateTime(item.updatedAt) || 'Unknown';
            const expiresInfo = getExpirationDisplay(item, now);
            const conditionLabel = formatCondition(item.condition);
            const transportLabel = item.transport ? formatLabel(item.transport) : 'Unknown';
            const subscriptionId = item.subscriptionId ? `<div><strong>ID:</strong> ${escapeHtml(item.subscriptionId)}</div>` : '';
            const verificationInfo = formatVerificationInfo(item);
            const errorNote = item.verificationState === 'error'
                ? `<div style="margin-top:6px; color:#ff6b6b;">${escapeHtml(item.verificationError || 'Verification failed')}</div>`
                : '';

            return `
                <div class="social-hook-card" style="border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 12px; margin-top: 8px; background: rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
                        <div style="font-weight: 600; color: rgba(255,255,255,0.9);">${escapeHtml(item.providerLabel)}</div>
                        <span style="${statusInfo.badgeStyle}">${escapeHtml(statusInfo.label)}</span>
                    </div>
                    <div style="margin-top: 6px; font-size: 0.9rem; color: rgba(255,255,255,0.85);">${escapeHtml(item.eventLabel)}</div>
                    <div style="margin-top: 8px; font-size: 0.78rem; color: rgba(255,255,255,0.65); line-height: 1.45;">
                        <div><strong>Status:</strong> ${escapeHtml(statusInfo.longLabel)}${statusInfo.note}</div>
                        <div><strong>Last Updated:</strong> ${escapeHtml(updatedLabel)}</div>
                        <div><strong>Verified:</strong> ${escapeHtml(verificationInfo)}</div>
                        <div><strong>Transport:</strong> ${escapeHtml(transportLabel)}</div>
                        <div><strong>Target:</strong> ${escapeHtml(conditionLabel)}</div>
                        <div><strong>Expires:</strong> ${escapeHtml(expiresInfo.label)}${expiresInfo.note}</div>
                        ${subscriptionId}
                        ${errorNote}
                    </div>
                </div>
            `;
        }).join(''));

        return parts.join('');
    }

    function formatVerificationInfo(item) {
        if (!item) return '—';
        if (item.verificationState === 'error') {
            return `Error - ${item.verificationError || 'Verification failed'}`;
        }
        if (item.verificationState === 'verified') {
            const when = formatDateTime(item.verificationTimestamp) || 'Just now';
            const source = item.verificationSource ? formatLabel(item.verificationSource) : 'Provider';
            return `${source} @ ${when}`;
        }
        if (item.verificationState === 'recorded') {
            return 'Stored record';
        }
        return '—';
    }

    function dedupeSocialHookItems(items) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const bySubscription = new Map();
        const byDoc = new Map();
        const result = [];

        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const subscriptionKey = item.subscriptionId || item.providerSubscription?.id || null;
            const docKey = item.id || `${item.provider || 'unknown'}:${item.eventType || 'unknown'}:${JSON.stringify(item.condition || {})}`;

            if (subscriptionKey) {
                if (bySubscription.has(subscriptionKey)) {
                    continue;
                }
                bySubscription.set(subscriptionKey, true);
            } else if (byDoc.has(docKey)) {
                continue;
            } else {
                byDoc.set(docKey, true);
            }

            result.push(item);
        }

        return result;
    }

    function normalizeSubscriptionDoc(doc) {
        const data = doc.data?.() || doc.data() || {};
        const providerRaw = typeof data.provider === 'string' && data.provider.trim() ? data.provider.trim() : (typeof doc.id === 'string' && doc.id.includes('_') ? doc.id.split('_')[0] : 'unknown');
        const provider = providerRaw.toLowerCase();
        const providerLabel = formatProviderLabel(providerRaw);
        const providerDataKey = `${provider}Subscription`;
        const rawSubscription = data[providerDataKey] || data.subscription || data.details || null;

        let eventType = data.eventType || rawSubscription?.type || doc.id;
        if (typeof eventType === 'string' && eventType.includes('_') && !data.eventType && !rawSubscription?.type) {
            const parts = eventType.split('_');
            if (parts.length > 1) {
                eventType = parts.slice(1).join('_');
            }
        }

        const statusRaw = rawSubscription?.status || data.status || '';
        const statusString = statusRaw ? String(statusRaw) : (data.isActive === false ? 'disabled' : 'enabled');
        const statusLower = statusString.toLowerCase();
        const isActive = data.isActive === false ? false : ['enabled', 'active', 'webhook_callback_verification_pending'].includes(statusLower);

        return {
            id: doc.id,
            provider,
            providerLabel,
            eventType,
            eventLabel: formatEventType(eventType, provider),
            statusRaw: statusString,
            statusLower,
            isActive,
            createdAt: extractDate(data.createdAt) || extractDate(rawSubscription?.created_at),
            updatedAt: extractDate(data.updatedAt) || extractDate(rawSubscription?.updated_at) || extractDate(rawSubscription?.created_at),
            expiresAt: extractDate(data.expiresAt) || extractDate(rawSubscription?.expires_at),
            condition: rawSubscription?.condition || data.condition || null,
            transport: rawSubscription?.transport?.method || data.transport || null,
            subscriptionId: rawSubscription?.id || data.subscriptionId || '',
            verificationState: 'recorded',
            verificationSource: 'firestore',
            verificationTimestamp: extractDate(data.lastVerifiedAt) || extractDate(data.updatedAt) || extractDate(rawSubscription?.updated_at) || null,
            verificationError: data.lastVerificationError || null,
            raw: data
        };
    }

    function extractDate(value) {
        if (!value) return null;
        if (typeof value.toDate === 'function') {
            try {
                const converted = value.toDate();
                return Number.isNaN(converted?.getTime?.()) ? null : converted;
            } catch (err) {
                console.warn('[Projects] Failed to convert Firestore timestamp:', err);
            }
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        if (typeof value === 'string') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    }

    function formatProviderLabel(providerRaw) {
        if (!providerRaw) return 'Unknown Provider';
        const normalized = providerRaw.toString().trim().toLowerCase();
        switch (normalized) {
            case 'twitch':
                return 'Twitch';
            case 'youtube':
                return 'YouTube';
            case 'kick':
                return 'Kick';
            case 'discord':
                return 'Discord';
            default:
                return formatLabel(providerRaw);
        }
    }

    function formatEventType(value, provider) {
        return getEventTypeLabel(value, provider);
    }

    function formatLabel(value) {
        if (value === null || value === undefined) return 'Unknown';
        const str = String(value).replace(/[_\-]+/g, ' ').replace(/\.+/g, ' ');
        return str.split(' ').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
    }

    function getStatusDisplay(item) {
        const statusLower = (item.statusLower || '').toLowerCase();
        const verificationState = (item.verificationState || '').toLowerCase();
        let label = item.statusRaw ? formatLabel(item.statusRaw) : (item.isActive ? 'Enabled' : 'Disabled');
        let longLabel = label;
        let color = item.isActive ? '#2ecc71' : '#ff6b6b';
        const noteParts = [];

        if (statusLower.includes('pending')) {
            color = '#f6c343';
            noteParts.push('<span style="color:#f6c343;">(Pending verification)</span>');
        } else if (statusLower.includes('revoked')) {
            color = '#ff6b6b';
            noteParts.push('<span style="color:#ff6b6b;">(Authorization revoked)</span>');
        } else if (statusLower.includes('disabled') || statusLower.includes('failed')) {
            color = '#ff6b6b';
        } else if (statusLower === 'enabled' || statusLower === 'active') {
            color = '#2ecc71';
        }

        if (verificationState === 'error') {
            label = 'Error';
            longLabel = 'Verification Failed';
            color = '#ff6b6b';
            noteParts.push('<span style="color:#ff6b6b;">(Verification failed)</span>');
        } else if (verificationState === 'verified' && !statusLower.includes('pending')) {
            noteParts.push('<span style="color:#2ecc71;">(Verified)</span>');
        } else if (verificationState === 'recorded') {
            noteParts.push('<span style="color:rgba(255,255,255,0.6);">(Stored record)</span>');
        }

        const background = color === '#2ecc71'
            ? 'rgba(46,204,113,0.18)'
            : color === '#f6c343'
                ? 'rgba(246,195,67,0.18)'
                : 'rgba(255,107,107,0.18)';

        const note = noteParts.length ? ` ${noteParts.join(' ')}` : '';

        return {
            label,
            longLabel,
            note,
            badgeStyle: `display:inline-flex; align-items:center; border-radius:999px; padding: 3px 10px; font-size:0.75rem; font-weight:600; background:${background}; color:${color};`
        };
    }

    function getExpirationDisplay(item, nowMs) {
        const date = item.expiresAt;
        if (!date) return { label: 'Not provided', note: '' };

        const label = formatDateTime(date) || 'Unknown';
        const diff = date.getTime() - nowMs;
        if (!Number.isFinite(diff)) {
            return { label, note: '' };
        }

        if (diff <= 0) {
            return { label, note: ' <span style="color:#ff6b6b;">(Expired)</span>' };
        }

        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (diff < sevenDaysMs) {
            return { label, note: ' <span style="color:#f6c343;">(Expiring soon)</span>' };
        }

        return { label, note: '' };
    }

    function formatCondition(condition) {
        if (!condition || typeof condition !== 'object') {
            return '—';
        }

        const entries = Object.entries(condition).filter(([, value]) => value !== undefined && value !== null && value !== '');
        if (entries.length === 0) {
            return '—';
        }

        return entries.map(([key, value]) => {
            const displayValue = typeof value === 'string' ? value : JSON.stringify(value);
            return `${formatLabel(key)}: ${displayValue}`;
        }).join(', ');
    }

    function formatDateTime(date) {
        if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
            return null;
        }
        try {
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (err) {
            console.warn('[Projects] Failed to format date:', err);
            return date.toISOString();
        }
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return String(value).replace(/[&<>"']/g, (char) => map[char] || char);
    }
}


