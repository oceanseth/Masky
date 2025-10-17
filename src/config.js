// Configuration for OAuth providers and API endpoints
// In production, these should be environment variables

export const config = {
  // Twitch OAuth Configuration
  // Get your Twitch Client ID from: https://dev.twitch.tv/console/apps
  twitch: {
    clientId: import.meta.env.VITE_TWITCH_CLIENT_ID || 'YOUR_TWITCH_CLIENT_ID',
    redirectUri: window.location.origin + '/auth/callback',
    scopes: ['user:read:email', 'channel:read:subscriptions']
  },
  
  // API Configuration
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || window.location.origin
  }
};

