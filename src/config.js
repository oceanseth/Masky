// Configuration for OAuth providers, API endpoints, and Stripe products

export const config = {
  // Firebase configuration
  firebase: {
    apiKey: "AIzaSyBxDknJ0YcbfGXcrj9aoqyW5UMQm4OhcdI",
    authDomain: "maskydotnet.firebaseapp.com",
    databaseURL: "https://maskydotnet-default-rtdb.firebaseio.com",
    projectId: "maskydotnet",
    storageBucket: "maskydotnet.firebasestorage.app",
    messagingSenderId: "253806012115",
    appId: "1:253806012115:web:634bb43405ca639401d626"
  },

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
      const { hostname } = window.location;
      
      // Local development
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3001';
      }
      
      // Production
      return 'https://masky.ai';
    }
  },
  stripe: {
    currency: 'USD',
    // Stripe Publishable Key - safe to expose, used by frontend
    publishableKey: 'pk_live_51S3l76JwtIxwToTZyoyd2Po8iXksp8U1r2Mqc7nfgsexWOIwN1DO33liWh1gVITYqZ4tJVXvsnjFO3DhHGgf91w400YPLk4PPm',
    // Display prices for plans (in USD)
    displayPrices: {
      viewer: 10,
      creator: 50,
      proCreator: 500
    },
    // Stripe Price IDs (not Product IDs)
    // Get these from Stripe Dashboard -> Products -> Click on product -> Copy the Price ID (starts with price_)
    prices: {
      viewer: 'price_1STApoJwtIxwToTZBmaMkfIm', // Viewer tier price ID
      creator: 'price_1SQyPfJwtIxwToTZ7hgQGdRF', // Creator plan price ID (formerly Standard)
      proCreator: 'price_1SQyR0JwtIxwToTZCbDhQUu7'      // Pro Creator plan price ID (formerly Pro)
    },
    // Product IDs (for reference)
    products: {
      viewer: 'prod_TQ0ru1Mi4f0D3x',
      creator: 'prod_TG18RbF6BIdNpR',
      proCreator: 'prod_TG186SL60qrvxa'
    }
  },
};

