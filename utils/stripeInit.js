const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });

class StripeInitializer {
  constructor() {
    this.ssm = new AWS.SSM();
    this.stripe = null;
    this.webhookSecret = null;
  }

  async initialize() {
    try {
      // Return existing instance if already initialized
      if (this.stripe) return { stripe: this.stripe, webhookSecret: this.webhookSecret };

      console.log('Initializing Stripe from SSM...');
      
      const stage = process.env.STAGE || 'production';
      console.log(`Loading Stripe secrets from SSM for stage: ${stage}`);
      
      // Load both secret key and webhook secret in parallel
      const [secretKeyResult, webhookSecretResult] = await Promise.all([
        this.ssm.getParameter({
          Name: `/voicecert/prod/STRIPE_SECRET_KEY`,
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
      
      const stripeSecretKey = secretKeyResult.Parameter.Value;
      this.webhookSecret = webhookSecretResult.Parameter.Value;
      
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
}

module.exports = new StripeInitializer();

