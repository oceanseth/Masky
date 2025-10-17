// Configuration for OAuth providers and API endpoints

export const config = {
  // Twitch OAuth Configuration
  twitch: {
    clientId: 'sgb17aslo6gesnetuqfnf6qql6jrae',
    redirectUri: window.location.origin + '/',
    scopes: ['user:read:email', 'channel:read:subscriptions']
  },
  
  // API Configuration
  api: {
    baseUrl: window.location.origin
  }
};

