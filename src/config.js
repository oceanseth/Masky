// Configuration for OAuth providers, API endpoints, and Stripe products

export const config = {
  // Twitch OAuth Configuration
  twitch: {
    clientId: 'sgb17aslo6gesnetuqfnf6qql6jrae',
    redirectUri: window.location.origin + '/',
    scopes: ['user:read:email', 'channel:manage:videos', 'user:read:broadcast', 'moderator:read:followers']
  },
  
  // API Configuration  
  api: {
    // Use direct API Gateway to bypass CloudFront (which is still deploying updated config)
    baseUrl: 'https://masky.net'
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

