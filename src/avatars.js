import { getCurrentUser } from './firebase.js';
import { config } from './config.js';

// Lazily imported firestore helpers to reduce initial bundle size
async function getFirestore() {
    const mod = await import('./firebase.js');
    return mod;
}

export async function renderAvatars(container) {
    const containerElement = typeof container === 'string' ? document.querySelector(container) : container;
    if (!containerElement) {
        console.error('Avatar editor container not found:', container);
        return;
    }

    // Ensure a mount point
    let root = document.getElementById('avatarsManager');
    if (!root) {
        root = document.createElement('div');
        root.id = 'avatarsManager';
        containerElement.appendChild(root);
    }

    root.innerHTML = `
        <div class="section-header">
            <h2 class="section-title">Your Avatars</h2>
            <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="newAvatarName" class="form-input" placeholder="New avatar name" style="min-width:220px;">
                <button class="btn btn-primary" id="createAvatarBtn">+ Create Avatar</button>
            </div>
        </div>
        <div class="avatars-grid" id="avatarsGrid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:16px;"></div>
        <div class="avatar-library" style="margin-top:24px;">
            <h3 class="section-title" style="font-size:1.1rem;">Upload Image</h3>
            <input type="file" id="avatarUploadInput" accept="image/*" style="display:none;" />
            <button class="btn btn-primary" id="openUpload">Upload</button>
        </div>
    `;

    // Bind create button
    document.getElementById('createAvatarBtn').onclick = async () => {
        const nameInput = document.getElementById('newAvatarName');
        const displayName = (nameInput?.value || '').trim();
        if (!displayName) {
            alert('Please enter a name for the new avatar');
            return;
        }
        nameInput.value = '';
        const newId = await createAvatar(displayName);
        // Initialize HeyGen group for this avatar
        try {
            const user = getCurrentUser();
            if (user) {
                const idToken = await user.getIdToken();
                await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/init`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupDocId: newId, displayName })
                });
            }
        } catch (e) {
            console.warn('Failed to init HeyGen group (will be created on first upload):', e);
        }
        await loadAvatars();
    };

    // Hook upload button
    const openUploadBtn = document.getElementById('openUpload');
    if (openUploadBtn) {
        openUploadBtn.onclick = () => {
            const input = document.getElementById('avatarUploadInput');
            if (input) input.click();
        };
    }

    await Promise.all([loadAvatars(), loadLibrary()]);

    async function loadAvatars() {
        try {
            const user = getCurrentUser();
            if (!user) {
                renderInfo('Please sign in to manage your avatars.');
                return;
            }
            const { db, collection, getDocs } = await getFirestore();
            const groupsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups');
            const snap = await getDocs(groupsRef);
            const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
            renderAvatarGroups(items);
        } catch (e) {
            console.error('Failed to load avatars:', e);
            if (e && (e.code === 'permission-denied' || e.message?.includes('Missing or insufficient permissions'))) {
                renderError('Missing or insufficient permissions to load avatars. Ensure Firestore rules allow the signed-in user to read their own avatar data.');
            } else {
                renderError('Failed to load avatars. Please try again.');
            }
        }
    }

    async function createAvatar(displayName) {
        const user = getCurrentUser();
        if (!user) return;
        const { db, collection, addDoc, serverTimestamp } = await getFirestore();
        const groupsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups');
        const ref = await addDoc(groupsRef, {
            userId: user.uid,
            displayName,
            // avatar_group_id will be assigned by backend when first used
            createdAt: serverTimestamp ? serverTimestamp() : new Date()
        });
        return ref.id;
    }

    function renderAvatarGroups(groups) {
        const grid = document.getElementById('avatarsGrid');
        if (!groups || groups.length === 0) {
            grid.innerHTML = '<div style="color: rgba(255,255,255,0.6);">No avatars yet. Create one above.</div>';
            return;
        }
        grid.innerHTML = groups.map(g => `
            <div class="avatar-card" data-id="${g.id}" style="border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px; background: rgba(255,255,255,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <input class="form-input" value="${escapeHtml(g.displayName || 'Untitled Avatar')}" data-role="avatar-name" style="flex:1;">
                    <button class="btn btn-secondary" data-role="save-name">Save</button>
                </div>
                <div style="margin-top:12px; display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;" id="assets-${g.id}"></div>
                <div style="margin-top:12px; display:flex; gap:8px;">
                    <button class="btn btn-primary" data-role="upload-to-group">Upload</button>
                </div>
            </div>
        `).join('');

        // Attach events per group
        groups.forEach(g => {
            const card = grid.querySelector(`.avatar-card[data-id="${g.id}"]`);
            if (!card) return;
            const saveBtn = card.querySelector('[data-role="save-name"]');
            const nameInput = card.querySelector('[data-role="avatar-name"]');
            const addBtn = card.querySelector('[data-role="upload-to-group"]');
            saveBtn.onclick = () => saveName(g.id, nameInput.value.trim());
            addBtn.onclick = () => openUploadForGroup(g.id);
            // Load assets
            loadAssets(g.id);
        });
    }

    async function saveName(groupId, displayName) {
        if (!displayName) return;
        const user = getCurrentUser();
        if (!user) return;
        const { db, doc, updateDoc } = await getFirestore();
        await updateDoc(doc(db, 'users', user.uid, 'heygenAvatarGroups', groupId), {
            displayName,
            updatedAt: new Date()
        });
    }

    async function loadAssets(groupId) {
        try {
            const user = getCurrentUser();
            if (!user) return;
            const { db, collection, getDocs } = await getFirestore();
            const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupId, 'assets');
            const snap = await getDocs(assetsRef);
            const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
            const grid = document.getElementById(`assets-${groupId}`);
            if (!grid) return;
            if (!items || items.length === 0) {
                grid.innerHTML = '<div style="grid-column: span 3; color: rgba(255,255,255,0.6);">No assets yet</div>';
                return;
            }
            grid.innerHTML = items.map(a => `
                <div class="asset-thumb" data-id="${a.id}" data-url="${a.url}" style="position:relative; border:1px solid rgba(255,255,255,0.1); border-radius:6px; overflow:hidden;">
                    <img src="${a.url}" alt="asset" style="width:100%; height:100px; object-fit:cover;">
                    <button class="asset-delete-btn" data-asset-id="${a.id}" data-group-id="${groupId}" data-image-url="${escapeHtml(a.url)}" 
                            onclick="deleteAsset('${groupId}', '${a.id}', '${escapeHtml(a.url)}')" 
                            style="position:absolute; top:4px; right:4px; width:24px; height:24px; border-radius:50%; background:#ef4444; color:#fff; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; line-height:1; padding:0; box-shadow:0 2px 4px rgba(0,0,0,0.3);" 
                            title="Delete image">
                        ×
                    </button>
                </div>
            `).join('');
        } catch (e) {
            console.error('Failed to load assets for group', groupId, e);
        }
    }

    function parseMaybeJsonMessage(m) {
        if (typeof m === 'string') {
            try { return JSON.parse(m); } catch { return m; }
        }
        return m;
    }

    function extFromFile(name) {
        const i = name.lastIndexOf('.');
        return i >= 0 ? name.slice(i + 1).toLowerCase() : 'jpg';
    }

    async function openUploadForGroup(groupId) {
        const input = document.getElementById('avatarUploadInput');
        if (!input) return;
        input.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const user = getCurrentUser();
                if (!user) throw new Error('Not authenticated');

                // Upload directly to Firebase Storage
                const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                const storage = getStorage();
                const suffix = extFromFile(file.name);
                const objectPath = `avatars/avatar_${user.uid}_${Date.now()}.${suffix}`;
                const storageRef = ref(storage, objectPath);
                await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
                const imageUrl = await getDownloadURL(storageRef);

                // Save asset locally for immediate UI
                await addAssetToGroup(groupId, imageUrl, file.name);
                await loadAssets(groupId);

                // Ensure HeyGen association and training
                const idToken = await user.getIdToken();
                const resp = await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/add-look`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupDocId: groupId, imageUrl })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    const msg = parseMaybeJsonMessage(err?.message) || err?.error || 'Upload to HeyGen failed';
                    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
                }
                const result = await resp.json().catch(() => ({}));
                if (resp.status === 202) {
                    console.warn('HeyGen training in progress:', result);
                }
            } catch (err) {
                console.error('Avatar upload error:', err);
                alert(`Failed to upload and train avatar: ${err?.message || err}`);
            } finally {
                e.target.value = '';
            }
        };
        input.click();
    }

    async function addAssetToGroup(groupId, url, fileName) {
        const user = getCurrentUser();
        if (!user) return;
        const { db, collection, addDoc, doc, updateDoc } = await getFirestore();
        const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupId, 'assets');
        await addDoc(assetsRef, {
            url,
            fileName: fileName || 'asset',
            userId: user.uid,
            createdAt: new Date()
        });
        // Also set avatarUrl on the group (acts as primary for now)
        await updateDoc(doc(db, 'users', user.uid, 'heygenAvatarGroups', groupId), { avatarUrl: url, updatedAt: new Date() });
    }

    async function loadLibrary() { /* no-op now: upload via button */ }

    function renderInfo(message) {
        const grid = document.getElementById('avatarsGrid');
        if (grid) grid.innerHTML = `<div style="color: rgba(255,255,255,0.6);">${escapeHtml(message)}</div>`;
    }

    function renderError(message) {
        const grid = document.getElementById('avatarsGrid');
        if (grid) grid.innerHTML = `<div style="color:#fca5a5;">${escapeHtml(message)}</div>`;
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[s]);
}

async function deleteAsset(groupId, assetId, imageUrl) {
    if (!confirm('Are you sure you want to delete this image from the avatar group?')) {
        return;
    }

    try {
        const user = getCurrentUser();
        if (!user) throw new Error('Not authenticated');

        const idToken = await user.getIdToken();
        const resp = await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/remove-look`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupDocId: groupId, assetId: assetId, imageUrl: imageUrl })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const msg = err?.message || err?.error || 'Failed to delete image';
            throw new Error(msg);
        }

        // Reload assets for this group to update UI
        const { db, collection, getDocs } = await getFirestore();
        const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupId, 'assets');
        const snap = await getDocs(assetsRef);
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
        const grid = document.getElementById(`assets-${groupId}`);
        if (grid) {
            if (!items || items.length === 0) {
                grid.innerHTML = '<div style="grid-column: span 3; color: rgba(255,255,255,0.6);">No assets yet</div>';
            } else {
                grid.innerHTML = items.map(a => `
                    <div class="asset-thumb" data-id="${a.id}" data-url="${a.url}" style="position:relative; border:1px solid rgba(255,255,255,0.1); border-radius:6px; overflow:hidden;">
                        <img src="${a.url}" alt="asset" style="width:100%; height:100px; object-fit:cover;">
                        <button class="asset-delete-btn" data-asset-id="${a.id}" data-group-id="${groupId}" data-image-url="${escapeHtml(a.url)}" 
                                onclick="deleteAsset('${groupId}', '${a.id}', '${escapeHtml(a.url)}')" 
                                style="position:absolute; top:4px; right:4px; width:24px; height:24px; border-radius:50%; background:#ef4444; color:#fff; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; line-height:1; padding:0; box-shadow:0 2px 4px rgba(0,0,0,0.3);" 
                                title="Delete image">
                            ×
                        </button>
                    </div>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Error deleting asset:', err);
        alert(`Failed to delete image: ${err.message || err}`);
    }
}

// Make deleteAsset globally available for onclick handlers
window.deleteAsset = deleteAsset;


