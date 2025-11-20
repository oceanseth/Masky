const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });

// Note: Local environment is loaded in api/api.js handler
// No need to load again here

class StripeInitializer {
  constructor() {
    this.ssm = new AWS.SSM();
    this.stripe = null;
    this.webhookSecret = null;
    // Publishable key - safe to expose, hardcoded for production
    // For local development, can be overridden via STRIPE_PUBLISHABLE_KEY env var
    this.publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S3l76JwtIxwToTZyoyd2Po8iXksp8U1r2Mqc7nfgsexWOIwN1DO33liWh1gVITYqZ4tJVXvsnjFO3DhHGgf91w400YPLk4PPm';
  }

  async initialize() {
    try {
      // Return existing instance if already initialized
      if (this.stripe) return { stripe: this.stripe, webhookSecret: this.webhookSecret };

      let stripeSecretKey, webhookSecret;

      // Check if running locally
      if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
        console.log('🔧 Running in local mode - loading Stripe from environment');
        
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
          throw new Error('STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not found in .env.local. Please copy env.local.example to .env.local and fill in your credentials.');
        }

        stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      } else {
        // Production mode - load from SSM
        console.log('☁️  Initializing Stripe from SSM...');
        
        const stage = process.env.STAGE || 'production';
        console.log(`Loading Stripe secrets from SSM for stage: ${stage}`);
        
        // Load both secret key and webhook secret in parallel
        const [secretKeyResult, webhookSecretResult] = await Promise.all([
          this.ssm.getParameter({
            Name: `/masky/${stage}/stripe_secret_key`,
            WithDecryption: true
          }).promise(),
          this.ssm.getParameter({
            Name: `/masky/${stage}/stripe_webhook_secret`,
            WithDecryption: true
          }).promise()
        ]);
        
        if (!secretKeyResult?.Parameter?.Value) {
          throw new Error('Stripe secret key not found in SSM');
        }
        
        if (!webhookSecretResult?.Parameter?.Value) {
          throw new Error('Stripe webhook secret not found in SSM');
        }
        
        stripeSecretKey = secretKeyResult.Parameter.Value;
        webhookSecret = webhookSecretResult.Parameter.Value;
      }
      
      this.webhookSecret = webhookSecret;
      
      console.log('Stripe secrets loaded from SSM successfully (key length:', stripeSecretKey.length, ', webhook length:', this.webhookSecret.length, ')');
      
      this.stripe = require('stripe')(stripeSecretKey);
      console.log('Stripe initialized successfully');
      
      return { stripe: this.stripe, webhookSecret: this.webhookSecret };
    } catch (error) {
      console.error('Failed to initialize Stripe from SSM:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      throw new Error(`Stripe initialization failed: ${error.message}`);
    }
  }

  /**
   * Get Stripe publishable key
   * Safe to expose - this is meant to be public
   */
  getPublishableKey() {
    return this.publishableKey;
  }
}

module.exports = new StripeInitializer();

