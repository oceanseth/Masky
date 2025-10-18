// Configuration for OAuth providers and API endpoints

// Determine API base URL based on environment
const getApiBaseUrl = () => {
  // Use API Gateway directly to bypass CloudFront (which strips Authorization header)
  // CloudFront needs to be configured to forward Authorization header
  return 'https://b4feblbni7.execute-api.us-east-1.amazonaws.com/production';
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

