// Configuration for OAuth providers and API endpoints

// Determine API base URL based on environment
const getApiBaseUrl = () => {
  // If running on localhost, use the deployed API URL
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'https://masky.net';
  }
  // In production, use the same origin
  return window.location.origin;
};

export const config = {
  // Twitch OAuth Configuration
  twitch: {
    clientId: 'sgb17aslo6gesnetuqfnf6qql6jrae',
    redirectUri: window.location.origin + '/',
    scopes: ['user:read:email', 'channel:read:subscriptions']
  },
  
  // API Configuration
  api: {
    baseUrl: getApiBaseUrl()
  }
};

