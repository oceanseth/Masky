// Configuration for OAuth providers, API endpoints, and Stripe products

export const config = {
  // Twitch OAuth Configuration
  twitch: {
    clientId: 'sgb17aslo6gesnetuqfnf6qql6jrae',
    botUserId: '1386063343', // maskyai chatbot account user ID
    redirectUri: window.location.origin + window.location.pathname,
    scopes: [
      'user:read:email',
      'channel:manage:videos',
      'user:read:broadcast',
      'moderator:read:followers',
      'user:read:chat',
      'chat:read',
      'chat:edit',
      'channel:bot',
      // Added to support EventSub types
      'channel:read:subscriptions',
      'bits:read',
      'channel:read:redemptions'
    ]
  },
  
  // API Configuration  
  api: {
    // Dynamically determine API URL based on environment
    // In local development (localhost), use serverless-offline
    // In production, use production API
    get baseUrl() {
      const hostname = window.location.hostname;
      
      // Local development
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3001';
      }
      
      // Production
      return 'https://masky.ai';
    }
  },
  stripe: {
    // Stripe Price IDs (not Product IDs)
    // Get these from Stripe Dashboard -> Products -> Click on product -> Copy the Price ID (starts with price_)
    prices: {
      standard: 'price_1SJV5lJwtIxwToTZ1YxaxW78', // Update with your actual Standard plan price ID
      pro: 'price_1SJV61JwtIxwToTZmIKUYjEu'      // Update with your actual Pro plan price ID
    },
    // Product IDs (for reference)
    products: {
      standard: 'prod_TG18RbF6BIdNpR',
      pro: 'prod_TG186SL60qrvxa'
    }
  },
};

