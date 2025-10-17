import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  OAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';

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

// Auth providers
const googleProvider = new GoogleAuthProvider();
const twitchProvider = new OAuthProvider('oidc.twitch');

// Configure Twitch provider
twitchProvider.addScope('user:read:email');
twitchProvider.addScope('channel:read:subscriptions');

/**
 * Sign in with Twitch
 */
export async function signInWithTwitch() {
  try {
    const result = await signInWithPopup(auth, twitchProvider);
    const credential = OAuthProvider.credentialFromResult(result);
    const accessToken = credential.accessToken;
    
    // Send token to our API for backend processing
    await fetch('/api/twitch_oauth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accessToken })
    });
    
    return result.user;
  } catch (error) {
    console.error('Twitch sign in error:', error);
    throw error;
  }
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

export { auth };

