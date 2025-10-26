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
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  onSnapshot
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

// Auth providers
const googleProvider = new GoogleAuthProvider();

/**
 * Sign in with Twitch using custom OAuth flow
 */
export async function signInWithTwitch() {
  try {
    // Generate state for CSRF protection
    const state = generateRandomState();
    sessionStorage.setItem('twitch_oauth_state', state);
    
    // Build authorization URL
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.append('client_id', config.twitch.clientId);
    authUrl.searchParams.append('redirect_uri', config.twitch.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', config.twitch.scopes.join(' '));
    authUrl.searchParams.append('state', state);
    
    // Redirect to Twitch for authorization
    window.location.href = authUrl.toString();
  } catch (error) {
    console.error('Twitch sign in error:', error);
    throw error;
  }
}

/**
 * Handle OAuth callback from Twitch
 * This should be called on the callback page
 */
export async function handleTwitchCallback() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    
    // Check for errors
    if (error) {
      throw new Error(`Twitch OAuth error: ${error}`);
    }
    
    if (!code) {
      throw new Error('No authorization code received');
    }
    
    // Verify state to prevent CSRF
    const savedState = sessionStorage.getItem('twitch_oauth_state');
    if (!savedState || savedState !== state) {
      throw new Error('Invalid state parameter - possible CSRF attack');
    }
    
    // Clear the saved state
    sessionStorage.removeItem('twitch_oauth_state');
    
    // Exchange code for Firebase token via our backend
    const response = await fetch(`${config.api.baseUrl}/api/twitch_oauth_callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        code,
        redirectUri: config.twitch.redirectUri 
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

export { auth, db };
export { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  onSnapshot
};

