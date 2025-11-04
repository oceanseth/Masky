import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { config } from './config';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxDknJ0YcbfGXcrj9aoqyW5UMQm4OhcdI",
  authDomain: "maskydotnet.firebaseapp.com",
  databaseURL: "https://maskydotnet-default-rtdb.firebaseio.com",
  projectId: "maskydotnet",
  storageBucket: "maskydotnet.firebasestorage.app",
  messagingSenderId: "253806012115",
  appId: "1:253806012115:web:634bb43405ca639401d626"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Auth providers
const googleProvider = new GoogleAuthProvider();

/**
 * Sign in with Twitch using popup OAuth flow
 */
export async function signInWithTwitch(extraScopes = []) {
  try {
    // Generate state for CSRF protection
    const state = generateRandomState();
    sessionStorage.setItem('twitch_oauth_state', state);
    
    // Use the API endpoint as redirect URI for popup
    const redirectUri = `${config.api.baseUrl}/api/twitch_oauth`;
    
    // Build authorization URL
    const mergedScopes = Array.from(new Set([...(config.twitch.scopes || []), ...(extraScopes || [])]));
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.append('client_id', config.twitch.clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code'); // Use code response type for server-side flow
    authUrl.searchParams.append('scope', mergedScopes.join(' '));
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('popup', 'true'); // Indicate this is a popup request
    
    // Open popup window for Twitch authorization
    const popup = window.open(
      authUrl.toString(),
      'twitch_oauth',
      'width=500,height=600,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
    );
    
    if (!popup) {
      throw new Error('Popup blocked. Please allow popups for this site.');
    }
    
    // Wait for popup to close or receive message
    return new Promise((resolve, reject) => {
      let messageReceived = false;
      
      const checkClosed = setInterval(() => {
        if (popup.closed && !messageReceived) {
          console.log('Popup was closed before receiving message');
          clearInterval(checkClosed);
          reject(new Error('OAuth popup was closed by user'));
        } else if (popup.closed && messageReceived) {
          console.log('Popup was closed after receiving message - this is expected');
        }
      }, 1000);
      
      // Listen for message from popup
      const messageHandler = (event) => {
        console.log('Message received from popup:', {
          origin: event.origin,
          expectedOrigin: window.location.origin,
          data: event.data,
          type: event.data?.type
        });
        
        // Accept messages from masky.ai domain or localhost (for development)
        const allowedOrigins = ['https://masky.ai', 'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];
        if (!allowedOrigins.includes(event.origin)) {
          console.log('Ignoring message from non-whitelisted origin:', event.origin);
          return;
        }
        
        if (!event.data || typeof event.data !== 'object' || !event.data.type) {
          console.log('Ignoring invalid message:', event.data);
          return;
        }
        
        if (event.data.type === 'TWITCH_OAUTH_SUCCESS') {
          console.log('Processing OAuth success message...');
          messageReceived = true;
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          
          // Sign into Firebase with the custom token so onAuthChange triggers and dashboard shows
          const payload = event.data.user || {};
          const token = payload.firebaseToken;
          if (!token) {
            console.error('Missing firebaseToken in OAuth success payload');
            reject(new Error('Missing firebase token from OAuth response'));
            return;
          }
          
          signInWithCustomToken(auth, token)
            .then((userCredential) => {
              console.log('Signed into Firebase with custom token');
              // Let popup close itself; resolve with user info
              resolve({ ...payload, firebaseUser: userCredential.user });
            })
            .catch((e) => {
              console.error('Failed to sign into Firebase with custom token:', e);
              reject(new Error('Failed to complete sign-in'));
            });
        } else if (event.data.type === 'TWITCH_OAUTH_ERROR') {
          console.log('Processing OAuth error message...');
          messageReceived = true;
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          
          // Don't close popup here, let it close itself
          console.log('OAuth error:', event.data.error);
          reject(new Error(event.data.error));
        } else {
          console.log('Unknown message type from popup:', event.data.type);
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!messageReceived) {
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          popup.close();
          reject(new Error('OAuth timeout'));
        }
      }, 300000);
    });
  } catch (error) {
    console.error('Twitch sign in error:', error);
    throw error;
  }
}

/**
 * Handle OAuth callback from Twitch (legacy flow)
 * This should be called on the callback page
 */
export async function handleTwitchCallback() {
  try {
    // For legacy flow, the access token comes in the URL fragment, not query params
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = urlParams.get('access_token');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    
    // Check for errors
    if (error) {
      throw new Error(`Twitch OAuth error: ${error}`);
    }
    
    if (!accessToken) {
      throw new Error('No access token received');
    }
    
    // Verify state to prevent CSRF
    const savedState = sessionStorage.getItem('twitch_oauth_state');
    if (!savedState || savedState !== state) {
      throw new Error('Invalid state parameter - possible CSRF attack');
    }
    
    // Clear the saved state
    sessionStorage.removeItem('twitch_oauth_state');
    
    // Send access token to our backend for Firebase token exchange
    const response = await fetch(`${config.api.baseUrl}/api/twitch_oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        accessToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to authenticate with Twitch');
    }
    
    const data = await response.json();
    
    // Sign in to Firebase with custom token
    const userCredential = await signInWithCustomToken(auth, data.firebaseToken);
    
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    return userCredential.user;
  } catch (error) {
    console.error('Twitch callback error:', error);
    throw error;
  }
}

/**
 * Generate random state for OAuth
 */
function generateRandomState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google sign in error:', error);
    throw error;
  }
}

/**
 * Sign in with email and password
 */
export async function signInWithEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Email sign in error:', error);
    throw error;
  }
}

/**
 * Create account with email and password
 */
export async function createAccountWithEmail(email, password) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Email sign up error:', error);
    throw error;
  }
}

/**
 * Sign out
 */
export async function signOut() {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
}

/**
 * Listen for auth state changes
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return auth.currentUser;
}

export { auth, db, storage };
export { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  deleteDoc
};

