import {
  auth,
  onAuthChange,
  signOut as firebaseSignOut,
  db,
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot
} from './firebase.js';
import { signInWithCustomToken } from 'firebase/auth';
import { config } from './config.js';

const elements = {
  currentAdminName: document.getElementById('currentAdminName'),
  currentAdminId: document.getElementById('currentAdminId'),
  currentAdminContainer: document.getElementById('currentAdminContainer'),
  adminBadge: document.getElementById('adminBadge'),
  adminHeader: document.getElementById('adminHeader'),
  statusCard: document.getElementById('statusCard'),
  statusMessage: document.getElementById('statusMessage'),
  statusText: document.getElementById('statusText'),
  loginButton: document.getElementById('loginButton'),
  signedOutActions: document.getElementById('signedOutActions'),
  userListCard: document.getElementById('userListCard'),
  userList: document.getElementById('userList'),
  userRowTemplate: document.getElementById('userRowTemplate'),
  userCount: document.getElementById('userCount'),
  searchInput: document.getElementById('searchInput'),
  signOutButton: document.getElementById('signOutButton')
};

const state = {
  user: null,
  isAdmin: false,
  tokens: [],
  unsubscribeTokens: null,
  searchTerm: ''
};

function hideSignedOutView() {
  if (elements.signedOutActions) {
    elements.signedOutActions.classList.add('hidden');
  }
  if (elements.adminHeader) {
    elements.adminHeader.classList.remove('hidden');
  }
  if (elements.currentAdminContainer) {
    elements.currentAdminContainer.classList.toggle('hidden', !state.user);
  }
  if (elements.signOutButton) {
    elements.signOutButton.classList.toggle('hidden', !state.user);
  }
}

function showSignedOutView() {
  if (elements.statusCard) {
    elements.statusCard.classList.add('hidden');
  }
  if (elements.userListCard) {
    elements.userListCard.classList.add('hidden');
  }
  if (elements.signedOutActions) {
    elements.signedOutActions.classList.remove('hidden');
  }
  if (elements.adminHeader) {
    elements.adminHeader.classList.add('hidden');
  }
  if (elements.currentAdminContainer) {
    elements.currentAdminContainer.classList.add('hidden');
  }
  if (elements.signOutButton) {
    elements.signOutButton.classList.add('hidden');
  }
}

function setStatus(message, { type = 'info' } = {}) {
  hideSignedOutView();
  if (elements.statusCard) {
    elements.statusCard.classList.remove('hidden');
  }
  if (elements.statusText) {
    elements.statusText.textContent = message;
  }

  if (elements.statusMessage) {
    elements.statusMessage.classList.remove('status-info', 'status-success', 'status-danger');
    elements.statusMessage.classList.add(`status-${type}`);
  }
}

function setAdminDisplay(user, isAdmin) {
  const displayName = user?.displayName || user?.email || user?.uid || '—';
  if (elements.currentAdminName) {
    elements.currentAdminName.textContent = displayName;
  }
  if (elements.currentAdminId) {
    elements.currentAdminId.textContent = user?.uid ? `(${user.uid})` : '';
  }
  if (elements.currentAdminContainer) {
    elements.currentAdminContainer.classList.toggle('hidden', !user);
  }
  if (elements.adminBadge) {
    elements.adminBadge.classList.toggle('hidden', !isAdmin);
  }
}

function unsubscribeFromTokens() {
  if (typeof state.unsubscribeTokens === 'function') {
    state.unsubscribeTokens();
  }
  state.unsubscribeTokens = null;
  state.tokens = [];
  renderUserList();
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(date) {
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const absDiff = Math.abs(diff);

  const units = [
    { unit: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
    { unit: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
    { unit: 'day', ms: 1000 * 60 * 60 * 24 },
    { unit: 'hour', ms: 1000 * 60 * 60 },
    { unit: 'minute', ms: 1000 * 60 },
    { unit: 'second', ms: 1000 }
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const { unit, ms } of units) {
    if (absDiff >= ms || unit === 'second') {
      const value = Math.round(diff / ms);
      return formatter.format(value, unit);
    }
  }

  return '';
}

function formatTimestamp(value) {
  const date = timestampToDate(value);
  if (!date) return null;

  const absolute = date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const relative = formatRelativeTime(date);
  return relative ? `${absolute} • ${relative}` : absolute;
}

function computeInitials(entry) {
  const source = entry.displayName || entry.twitchId || entry.uid || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  const [first, second] = parts;
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  return `${first[0]}${second[0]}`.toUpperCase();
}

function renderUserList() {
  if (!elements.userList) return;

  elements.userList.innerHTML = '';

  const term = state.searchTerm.trim().toLowerCase();
  const entries = state.tokens
    .map(doc => ({
      ...doc,
      uid: doc.uid || doc.id || doc.__id,
      id: doc.id || doc.uid
    }))
    .filter(entry => {
      if (!term) return true;
      const haystack = [
        entry.displayName,
        entry.email,
        entry.twitchId,
        entry.uid,
        entry?.provider,
        entry?.scopes?.join(' ')
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    })
    .sort((a, b) => {
      const nameA = (a.displayName || a.uid || '').toLowerCase();
      const nameB = (b.displayName || b.uid || '').toLowerCase();
      if (nameA === nameB) {
        const updatedA = timestampToDate(a.updatedAt)?.getTime() || 0;
        const updatedB = timestampToDate(b.updatedAt)?.getTime() || 0;
        return updatedB - updatedA;
      }
      return nameA.localeCompare(nameB);
    });

  const totalCount = state.tokens.length;
  if (elements.userCount) {
    const summary = term
      ? `Users: ${entries.length} (filtered from ${totalCount})`
      : `Users: ${totalCount}`;
    elements.userCount.textContent = summary;
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = term
      ? 'No users match your search.'
      : 'No user sessions have been recorded yet.';
    elements.userList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const fragment = elements.userRowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.user-row');
    const avatarPlaceholder = row.querySelector('.user-avatar');
    const nameEl = row.querySelector('.user-name');
    const metaEl = row.querySelector('.user-meta');
    const scopeEl = row.querySelector('.user-scopes');
    const button = row.querySelector('.become-btn');

    const displayName = entry.displayName || `User ${entry.uid}`;
    nameEl.textContent = displayName;

    if (entry.photoURL) {
      const img = document.createElement('img');
      img.className = 'user-avatar';
      img.src = entry.photoURL;
      img.alt = `${displayName} avatar`;
      avatarPlaceholder.replaceWith(img);
    } else {
      avatarPlaceholder.textContent = computeInitials(entry);
    }

    const metaParts = [];
    if (entry.uid) metaParts.push(`UID: ${entry.uid}`);
    if (entry.twitchId) metaParts.push(`Twitch: ${entry.twitchId}`);
    if (entry.email) metaParts.push(entry.email);
    if (entry.updatedAt) {
      const formatted = formatTimestamp(entry.updatedAt);
      if (formatted) metaParts.push(`Updated ${formatted}`);
    }
    if (entry.lastLoginAt) {
      const formatted = formatTimestamp(entry.lastLoginAt);
      if (formatted) metaParts.push(`Last login ${formatted}`);
    }
    if (entry.lastImpersonatedAt) {
      const formatted = formatTimestamp(entry.lastImpersonatedAt);
      if (formatted) metaParts.push(`Impersonated ${formatted}`);
    }
    metaEl.textContent = metaParts.join(' • ');

    scopeEl.innerHTML = '';
    const scopes = Array.isArray(entry.scopes) ? entry.scopes : [];
    if (scopes.length > 0) {
      scopes.forEach(scope => {
        const chip = document.createElement('span');
        chip.textContent = scope;
        scopeEl.appendChild(chip);
      });
    } else {
      scopeEl.textContent = 'No scopes recorded';
    }

    button.addEventListener('click', () => becomeUser(entry, button));
    row.dataset.uid = entry.uid;

    elements.userList.appendChild(fragment);
  }
}

async function subscribeToUserTokens() {
  if (!state.isAdmin) return;

  if (state.unsubscribeTokens) {
    state.unsubscribeTokens();
    state.unsubscribeTokens = null;
  }

  const tokensRef = collection(db, 'system', 'adminData', 'userTokens');
  const tokensQuery = query(tokensRef, orderBy('updatedAt', 'desc'));

  state.unsubscribeTokens = onSnapshot(tokensQuery, snapshot => {
    state.tokens = snapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    renderUserList();
    setStatus(`Loaded ${state.tokens.length} user sessions`, { type: 'success' });
  }, error => {
    console.error('Failed to load user tokens:', error);
    setStatus(`Failed to load user sessions: ${error.message}`, { type: 'danger' });
  });
}

async function verifyAdmin(user) {
  try {
    if (!user) {
      state.isAdmin = false;
      showSignedOutView();
      unsubscribeFromTokens();
      return;
    }

    setStatus('Verifying admin permissions…', { type: 'info' });

    const adminDoc = await getDoc(doc(db, 'system', 'adminData'));
    if (!adminDoc.exists()) {
      state.isAdmin = false;
      setStatus('Admin configuration document not found. Contact engineering.', { type: 'danger' });
      elements.userListCard?.classList.add('hidden');
      hideSignedOutView();
      return;
    }

    const adminUsers = adminDoc.data()?.adminUsers;
    state.isAdmin = Array.isArray(adminUsers) ? adminUsers.includes(user.uid) : false;
    setAdminDisplay(user, state.isAdmin);

    if (!state.isAdmin) {
      setStatus('You are signed in, but not authorized for admin access.', { type: 'danger' });
      elements.userListCard?.classList.add('hidden');
      unsubscribeFromTokens();
      hideSignedOutView();
      return;
    }

    setStatus('Admin access granted.', { type: 'success' });
    elements.userListCard?.classList.remove('hidden');
    await subscribeToUserTokens();
  } catch (error) {
    console.error('Failed to verify admin access:', error);
    if (error?.code === 'permission-denied') {
      state.isAdmin = false;
      setStatus('You are signed in, but not authorized for admin access.', { type: 'danger' });
      elements.userListCard?.classList.add('hidden');
      unsubscribeFromTokens();
      return;
    }
    state.isAdmin = false;
    setStatus(`Failed to verify admin access: ${error.message}`, { type: 'danger' });
    elements.userListCard?.classList.add('hidden');
    unsubscribeFromTokens();
  }
}

async function becomeUser(entry, button) {
  if (!state.user) {
    alert('You must be signed in as an admin to impersonate a user.');
    showSignedOutView();
    return;
  }

  const originalLabel = button?.querySelector('span')?.textContent;
  if (button) {
    button.disabled = true;
    const labelSpan = button.querySelector('span');
    if (labelSpan) {
      labelSpan.textContent = 'Switching…';
    }
  }

  try {
    const idToken = await state.user.getIdToken();
    const response = await fetch(`${config.api.baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetUid: entry.uid
      })
    });

    if (!response.ok) {
      let errorMessage = 'Failed to impersonate user.';
      try {
        const errorPayload = await response.json();
        errorMessage = errorPayload.error || errorPayload.message || errorMessage;
      } catch {
        // ignore parse error
      }
      throw new Error(errorMessage);
    }

    const payload = await response.json();
    setStatus(`Impersonating ${entry.displayName || entry.uid}…`, { type: 'info' });

    // Optional breadcrumb for returning later
    try {
      sessionStorage.setItem('masky:adminImpersonation', JSON.stringify({
        adminUid: state.user.uid,
        adminDisplayName: state.user.displayName || state.user.email || state.user.uid,
        targetUid: entry.uid,
        targetDisplayName: entry.displayName || entry.uid,
        switchedAt: new Date().toISOString()
      }));
    } catch (storageError) {
      console.warn('Failed to persist impersonation metadata:', storageError);
    }

    await signInWithCustomToken(auth, payload.firebaseToken);
    window.location.href = '/';
  } catch (error) {
    console.error('Impersonation failed:', error);
    setStatus(`Failed to impersonate ${entry.displayName || entry.uid}: ${error.message}`, { type: 'danger' });
  } finally {
    if (button) {
      button.disabled = false;
      const labelSpan = button.querySelector('span');
      if (labelSpan && originalLabel) {
        labelSpan.textContent = originalLabel;
      }
    }
  }
}

if (elements.searchInput) {
  elements.searchInput.addEventListener('input', event => {
    state.searchTerm = event.target.value || '';
    renderUserList();
  });
}

onAuthChange(async user => {
  state.user = user;
  unsubscribeFromTokens();

  if (!user) {
    setAdminDisplay(null, false);
    elements.userListCard?.classList.add('hidden');
    showSignedOutView();
    return;
  }

  setAdminDisplay(user, false);
  hideSignedOutView();
  await verifyAdmin(user);
});

window.handleSignOut = async function handleSignOut() {
  try {
    await firebaseSignOut();
    unsubscribeFromTokens();
    showSignedOutView();
  } catch (error) {
    console.error('Failed to sign out:', error);
    setStatus(`Failed to sign out: ${error.message}`, { type: 'danger' });
  }
};

