import { getCurrentUser } from './firebase.js';
import { config } from './config.js';

function sanitizeStorageUid(uid = '') {
    return String(uid).replace(/[/:.]/g, '_');
}

function userStorageBasePath(uid = '') {
    return `userData/${sanitizeStorageUid(uid)}`;
}

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
        <input type="file" id="avatarUploadInput" accept="image/*" style="display:none;" />
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

    await loadAvatars();

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
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px;">
                    <h3 style="margin:0; flex:1; font-size:1.1rem; color:rgba(255,255,255,0.9);">${escapeHtml(g.displayName || 'Untitled Avatar')}</h3>
                    <button class="btn btn-danger" data-role="delete-group" style="background:#ef4444; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.9rem;">Delete Group</button>
                </div>
                <div style="margin-top:12px; display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;" id="assets-${g.id}"></div>
                <div style="margin-top:12px; display:flex; gap:8px;">
                    <button class="btn btn-primary" data-role="upload-to-group">Upload</button>
                </div>
                <div style="margin-top:12px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                        <label for="personality-prompt-${g.id}" style="color:rgba(255,255,255,0.9); font-size:0.9rem; font-weight:500; margin:0;">Personality Prompt</label>
                        <div style="position:relative; display:inline-block;">
                            <button type="button" class="tooltip-trigger" data-tooltip-id="tooltip-${g.id}" style="width:18px; height:18px; border-radius:50%; border:1px solid rgba(255,255,255,0.3); background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.7); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; padding:0; line-height:1; transition:all 0.2s;" onmouseenter="showTooltip('tooltip-${g.id}')" onmouseleave="hideTooltip('tooltip-${g.id}')" ontouchstart="toggleTooltip('tooltip-${g.id}')" onclick="toggleTooltip('tooltip-${g.id}')">?</button>
                            <div id="tooltip-${g.id}" class="tooltip-content" style="position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.95); color:rgba(255,255,255,0.9); padding:12px; border-radius:6px; font-size:0.85rem; line-height:1.5; width:280px; max-width:90vw; z-index:1000; display:none; box-shadow:0 4px 12px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); pointer-events:none;">
                                <div style="position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:6px solid rgba(0,0,0,0.95);"></div>
                                This prompt will control the way ai will respond when generating text to respond to viewer comments, if it should simply read them or read then and reply to them, in various ways throughout the site. You can configure the kind of response/reaction in other places, but this prompt determines the personality and type of text that will be generated.
                            </div>
                        </div>
                    </div>
                    <textarea id="personality-prompt-${g.id}" class="form-input" data-group-id="${g.id}" onchange="handlePersonalityPromptChange('${g.id}')" oninput="handlePersonalityPromptChange('${g.id}')" placeholder="You are Triumph the Insult Comic Dog.

You are a cigar-chomping, foul-mouthed, wisecracking hand puppet voiced by Robert Smigel. Your entire personality revolves around roasting, mocking, and insulting whoever you're talking to. You deliver insults with playful cruelty, exaggerated bravado, and over-the-top sarcasm. You often build a joke with a setup, twist it with a mean-spirited punchline, and then cap it off with your signature phrase: &quot;for me to poop on!&quot;

Your Style &amp; Rules

Speak like Triumph: gruff voice, showman energy, smug and sleazy charm.

Every response should include at least one roast or cutting insult.

You may improvise absurd comparisons, exaggerated metaphors, and mocking observations.

You should frequently—but not necessarily always—end a joke or a full message with &quot;for me to poop on!&quot;

You can be crude, but stay within allowed boundaries (no slurs or real-world harm).

Your comedic tone is mean-but-funny, never genuinely hateful.

You are self-aware, breaking the fourth wall and mocking the format of the conversation itself.

You may reference being a puppet, your cigar, your cheap production value, or your creator Robert Smigel.

Famous Lines You May Reference

&quot;You got a great show… for me to poop on!&quot;

&quot;That's like poop telling vomit it stinks!&quot;

&quot;I think Eminem should relax a little. I mean, my mom's a bitch too, but I don't sing songs about it.&quot;

Q: question → A: &quot;Oh, no, I'm sorry, the answer is: who gives a shit?&quot;

Behavioral Examples

If someone makes a statement, mock its seriousness or stupidity.

If someone asks a question, answer with a roast before the real answer.

When complimented, respond with a smug insult.

When challenged, double down with absurd bravado.

Constantly remind the audience that you are a cigar-smoking puppet dog who is morally and emotionally bankrupt—comedically." style="width:100%; min-height:200px; padding:12px; border:1px solid rgba(255,255,255,0.1); border-radius:6px; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.9); font-family:inherit; font-size:0.9rem; resize:vertical;"></textarea>
                </div>
            </div>
        `).join('');

        // Attach events per group
        groups.forEach(g => {
            const card = grid.querySelector(`.avatar-card[data-id="${g.id}"]`);
            if (!card) return;
            const deleteBtn = card.querySelector('[data-role="delete-group"]');
            const addBtn = card.querySelector('[data-role="upload-to-group"]');
            const textarea = card.querySelector(`#personality-prompt-${g.id}`);
            deleteBtn.onclick = () => deleteGroup(g.id, g.displayName || 'Untitled Avatar');
            addBtn.onclick = () => openUploadForGroup(g.id);
            // Set textarea value if it exists
            if (textarea && g.personalityPrompt) {
                textarea.value = g.personalityPrompt;
            }
            // Load assets directly from Firestore to avoid unnecessary sync round-trips
            loadAssets(g.id);
        });
    }

    async function deleteGroup(groupId, displayName) {
        if (!confirm(`Are you sure you want to delete the "${displayName}" avatar?`)) {
            return;
        }
        
        try {
            const user = getCurrentUser();
            if (!user) throw new Error('Not authenticated');
            
            const idToken = await user.getIdToken();
            const resp = await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/delete`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupDocId: groupId })
            });
            
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                const msg = err?.message || err?.error || 'Failed to delete avatar group';
                throw new Error(msg);
            }
            
            // Reload avatars to reflect the deletion
            await loadAvatars();
        } catch (err) {
            console.error('Failed to delete avatar group:', err);
            alert(`Failed to delete avatar group: ${err.message || err}`);
        }
    }

    async function syncAndLoadAssets(groupId) {
        try {
            const user = getCurrentUser();
            if (!user) return;
            const idToken = await user.getIdToken();
            // Sync with HeyGen first
            try {
                await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/sync`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupDocId: groupId })
                });
            } catch (syncErr) {
                console.warn('Sync failed (non-critical):', syncErr);
            }
            // Then load assets
            await loadAssets(groupId);
        } catch (err) {
            console.error('Sync and load failed:', err);
            await loadAssets(groupId); // Fallback to just loading
        }
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

    /**
     * Convert image file to JPEG format using canvas API
     * Handles WebP, PNG, and other formats
     */
    async function convertImageToJpeg(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Create canvas and draw image
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    // Convert to JPEG blob
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error('Failed to convert image to JPEG'));
                            return;
                        }
                        // Create a new File object with JPEG extension
                        const jpegFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(jpegFile);
                    }, 'image/jpeg', 0.9); // 90% quality
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
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

                // Convert image to JPEG if needed (especially for WebP)
                let fileToUpload = file;
                const fileType = file.type.toLowerCase();
                const fileName = file.name.toLowerCase();
                
                // Convert WebP or other unsupported formats to JPEG
                if (fileType.includes('webp') || fileName.endsWith('.webp') ||
                    (!fileType.includes('jpeg') && !fileType.includes('jpg') && !fileType.includes('png'))) {
                    console.log('Converting image to JPEG format...');
                    try {
                        fileToUpload = await convertImageToJpeg(file);
                        console.log('Image converted to JPEG successfully');
                    } catch (convertErr) {
                        console.error('Failed to convert image:', convertErr);
                        throw new Error(`Failed to convert image: ${convertErr.message}. Please upload a JPEG or PNG image.`);
                    }
                }

                // Get image dimensions before uploading
                const imageDimensions = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        resolve({ width: img.width, height: img.height });
                    };
                    img.onerror = () => {
                        reject(new Error('Failed to load image for dimension check'));
                    };
                    img.src = URL.createObjectURL(fileToUpload);
                });
                console.log('Image dimensions:', imageDimensions);

                // Upload directly to Firebase Storage
                const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                const storage = getStorage();
                const suffix = extFromFile(fileToUpload.name);
                const objectPath = `${userStorageBasePath(user.uid)}/avatars/avatar_${Date.now()}.${suffix}`;
                const storageRef = ref(storage, objectPath);
                await uploadBytes(storageRef, fileToUpload, { 
                    contentType: fileToUpload.type || 'image/jpeg' 
                });
                const imageUrl = await getDownloadURL(storageRef);

                // Save asset to Firestore and get the asset ID
                const { db, collection, addDoc, doc, updateDoc, serverTimestamp } = await getFirestore();
                const assetsRef = collection(db, 'users', user.uid, 'heygenAvatarGroups', groupId, 'assets');
                const assetDocRef = await addDoc(assetsRef, {
                    url: imageUrl,
                    fileName: fileToUpload.name,
                    userId: user.uid,
                    width: imageDimensions.width,
                    height: imageDimensions.height,
                    createdAt: serverTimestamp ? serverTimestamp() : new Date()
                });
                const assetId = assetDocRef.id;
                
                // Also set avatarUrl on the group (acts as primary for now)
                await updateDoc(doc(db, 'users', user.uid, 'heygenAvatarGroups', groupId), { 
                    avatarUrl: imageUrl, 
                    updatedAt: new Date() 
                });

                // IMPORTANT: Call add-look FIRST to create HeyGen group and add the image
                // This must happen before sync, otherwise sync might delete the asset
                const idToken = await user.getIdToken();
                console.log('Calling add-look endpoint with assetId:', assetId);
                const resp = await fetch(`${config.api.baseUrl}/api/heygen/avatar-group/add-look`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupDocId: groupId, assetId })
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
                console.log('Successfully added look to HeyGen, now refreshing UI');
                
                // Refresh UI after HeyGen operations complete
                await loadAssets(groupId);
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

        // Sync and reload assets for this group to update UI
        // Note: syncAndLoadAssets is defined in the same module, so we can call it directly
        // But since deleteAsset is a global function, we need to trigger a reload
        // The best approach is to reload the page or trigger a custom event
        window.dispatchEvent(new CustomEvent('avatar-assets-changed', { detail: { groupId } }));
        
        // Also try to sync and reload directly if we can access the function
        // For now, just reload the assets manually
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

// Tooltip functions
function showTooltip(tooltipId) {
    const tooltip = document.getElementById(tooltipId);
    if (tooltip) {
        tooltip.style.display = 'block';
    }
}

function hideTooltip(tooltipId) {
    const tooltip = document.getElementById(tooltipId);
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

function toggleTooltip(tooltipId) {
    const tooltip = document.getElementById(tooltipId);
    if (tooltip) {
        const isVisible = tooltip.style.display === 'block';
        tooltip.style.display = isVisible ? 'none' : 'block';
    }
}

// Make tooltip functions globally available
window.showTooltip = showTooltip;
window.hideTooltip = hideTooltip;
window.toggleTooltip = toggleTooltip;

// Close tooltips when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.tooltip-trigger') && !e.target.closest('.tooltip-content')) {
        document.querySelectorAll('.tooltip-content').forEach(tooltip => {
            tooltip.style.display = 'none';
        });
    }
});

// Debounce timers for personality prompt saves
const personalityPromptTimers = new Map();

// Handle personality prompt changes with debounce
async function handlePersonalityPromptChange(groupId) {
    const textarea = document.getElementById(`personality-prompt-${groupId}`);
    if (!textarea) return;

    // Clear existing timer for this group
    if (personalityPromptTimers.has(groupId)) {
        clearTimeout(personalityPromptTimers.get(groupId));
    }

    // Set new timer to save after 2 seconds of inactivity
    const timer = setTimeout(async () => {
        await savePersonalityPrompt(groupId, textarea.value);
        personalityPromptTimers.delete(groupId);
    }, 2000);

    personalityPromptTimers.set(groupId, timer);
}

// Save personality prompt directly to Firestore
async function savePersonalityPrompt(groupId, promptText) {
    try {
        const user = getCurrentUser();
        if (!user) {
            console.warn('Cannot save personality prompt: user not authenticated');
            return;
        }

        const { db, doc, updateDoc } = await getFirestore();
        await updateDoc(doc(db, 'users', user.uid, 'heygenAvatarGroups', groupId), {
            personalityPrompt: promptText,
            updatedAt: new Date()
        });

        console.log('Personality prompt saved successfully for group:', groupId);
    } catch (err) {
        console.error('Failed to save personality prompt:', err);
        // Optionally show a user-friendly error message
        // alert(`Failed to save personality prompt: ${err.message || err}`);
    }
}

// Make functions globally available
window.handlePersonalityPromptChange = handlePersonalityPromptChange;


