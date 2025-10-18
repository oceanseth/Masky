# Membership System Setup Guide

This guide will help you set up the Stripe subscription system for Masky.

## Overview

The membership system includes three tiers:
- **Free**: 1 avatar, 1 voice (default for all users)
- **Standard**: $20/month - 5 avatars, 10 voices, custom scripts, priority support
- **Pro**: $50/month - Unlimited avatars & voices, API access, custom branding

## Prerequisites

1. Stripe account (https://stripe.com)
2. AWS account with SSM Parameter Store access
3. Serverless Framework installed
4. Firebase project with Firestore enabled

## Step 1: Create Stripe Products and Prices

### 1.1 Log into Stripe Dashboard
Go to https://dashboard.stripe.com

### 1.2 Create Standard Plan Product
1. Navigate to **Products** → **Add Product**
2. Fill in the details:
   - **Name**: Masky Standard
   - **Description**: For serious content creators
   - **Pricing**: Recurring → $20.00 USD/month
   - **Billing period**: Monthly
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_`) - you'll need this

### 1.3 Create Pro Plan Product
1. Navigate to **Products** → **Add Product**
2. Fill in the details:
   - **Name**: Masky Pro
   - **Description**: Maximum creative freedom
   - **Pricing**: Recurring → $50.00 USD/month
   - **Billing period**: Monthly
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_`) - you'll need this

## Step 2: Configure Stripe Webhooks

### 2.1 Create Webhook Endpoint
1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Enter your endpoint URL: `https://your-api-domain.com/api/stripe/webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. **Copy the Webhook Signing Secret** (starts with `whsec_`)

### 2.2 Configure Stripe Customer Portal
1. Go to **Settings** → **Billing** → **Customer portal**
2. Enable the customer portal
3. Configure allowed actions:
   - ✅ Update subscription (allow upgrades/downgrades)
   - ✅ Cancel subscription
   - ✅ Update payment method
   - ✅ View invoice history
4. Set your business information and branding
5. Save settings

## Step 3: Store Stripe Secrets in AWS SSM

The system already uses AWS SSM Parameter Store for secure secret management. You need to add the following parameters:

### 3.1 Store Stripe Secret Key
```bash
# For production
aws ssm put-parameter \
  --name "/voicecert/prod/STRIPE_SECRET_KEY" \
  --value "sk_live_..." \
  --type "SecureString" \
  --overwrite

# For development/staging
aws ssm put-parameter \
  --name "/voicecert/dev/STRIPE_SECRET_KEY" \
  --value "sk_test_..." \
  --type "SecureString" \
  --overwrite
```

### 3.2 Store Stripe Webhook Secret
```bash
# For production
aws ssm put-parameter \
  --name "/voicecert/prod/STRIPE_WEBHOOK_SECRET" \
  --value "whsec_..." \
  --type "SecureString" \
  --overwrite

# For development/staging
aws ssm put-parameter \
  --name "/voicecert/dev/STRIPE_WEBHOOK_SECRET" \
  --value "whsec_..." \
  --type "SecureString" \
  --overwrite
```

## Step 4: Configure Environment Variables

### 4.1 Create .env file (for local development)
```env
STRIPE_STANDARD_PRICE_ID=price_1234567890abcdef
STRIPE_PRO_PRICE_ID=price_0987654321fedcba
```

### 4.2 Set Environment Variables in Deployment
For production deployment, set these in your CI/CD or deployment environment:
```bash
export STRIPE_STANDARD_PRICE_ID=price_1234567890abcdef
export STRIPE_PRO_PRICE_ID=price_0987654321fedcba
```

Or update `serverless.yml` directly:
```yaml
environment:
  STRIPE_STANDARD_PRICE_ID: 'price_1234567890abcdef'
  STRIPE_PRO_PRICE_ID: 'price_0987654321fedcba'
```

## Step 5: Enable Firestore

The membership system uses Firestore to store subscription data.

### 5.1 Enable Firestore in Firebase Console
1. Go to Firebase Console: https://console.firebase.google.com
2. Select your project
3. Navigate to **Firestore Database**
4. Click **Create database**
5. Choose **Production mode** or **Test mode** (recommended for development)
6. Select your preferred location
7. Click **Enable**

### 5.2 Configure Firestore Security Rules
Add these rules to allow authenticated users to read their own subscription data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      // Users can read their own data
      allow read: if request.auth != null && request.auth.uid == userId;
      
      // Only backend can write subscription data
      allow write: if false;
    }
  }
}
```

## Step 6: Deploy the Application

### 6.1 Build Frontend
```bash
npm run build
```

### 6.2 Deploy Backend
```bash
serverless deploy --stage prod
```

### 6.3 Note Your API Endpoint
After deployment, Serverless will output your API Gateway endpoint. Update your `src/config.js` if needed:
```javascript
api: {
  baseUrl: 'https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod'
}
```

### 6.4 Deploy Frontend
Upload the contents of the `dist` folder to your hosting service (S3, Cloudflare Pages, Vercel, etc.)

## Step 7: Update Stripe Webhook URL

Once deployed, update your Stripe webhook endpoint URL:
1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click on your webhook endpoint
3. Update the URL to your production API endpoint
4. Example: `https://api.masky.net/api/stripe/webhook`

## Testing

### Test with Stripe Test Mode

1. Use Stripe test cards: https://stripe.com/docs/testing
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`

2. Test the subscription flow:
   - Sign up as a new user
   - Navigate to membership page
   - Click "Upgrade to Standard"
   - Use test card `4242 4242 4242 4242`
   - Any future expiry date (e.g., 12/34)
   - Any 3-digit CVC

3. Verify subscription status:
   - Check membership badge in navigation
   - Check Firestore for user document
   - Check Stripe Dashboard for customer and subscription

4. Test cancellation:
   - Go to membership page
   - Click "Cancel Subscription"
   - Verify status shows "Canceling"
   - Verify access remains until period end

5. Test customer portal:
   - Click "Manage Billing"
   - Verify redirect to Stripe portal
   - Test updating payment method
   - Test changing subscription tier

### Webhook Testing

Use Stripe CLI to test webhooks locally:

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Login to Stripe
stripe login

# Forward webhooks to local endpoint
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

## API Endpoints

The following API endpoints are available:

### GET /api/subscription/status
Get current user's subscription status
- **Auth**: Firebase ID Token (Bearer)
- **Response**: 
```json
{
  "subscription": {
    "tier": "standard",
    "status": "active",
    "stripeCustomerId": "cus_...",
    "stripeSubscriptionId": "sub_...",
    "currentPeriodEnd": 1234567890,
    "cancelAtPeriodEnd": false
  }
}
```

### POST /api/subscription/create-checkout
Create Stripe checkout session
- **Auth**: Firebase ID Token (Bearer)
- **Body**:
```json
{
  "tier": "standard",
  "successUrl": "https://masky.net/membership.html?success=true",
  "cancelUrl": "https://masky.net/membership.html?canceled=true"
}
```
- **Response**:
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### POST /api/subscription/cancel
Cancel user's subscription (at period end)
- **Auth**: Firebase ID Token (Bearer)
- **Response**:
```json
{
  "message": "Subscription canceled successfully",
  "subscription": {
    "id": "sub_...",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": 1234567890
  }
}
```

### POST /api/subscription/portal
Create Stripe customer portal session
- **Auth**: Firebase ID Token (Bearer)
- **Body**:
```json
{
  "returnUrl": "https://masky.net/membership.html"
}
```
- **Response**:
```json
{
  "url": "https://billing.stripe.com/..."
}
```

### POST /api/stripe/webhook
Stripe webhook endpoint (called by Stripe)
- **Auth**: Stripe signature verification
- **Handles**: 
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

## Implementing Tier-Based Features

To enforce tier limits in your application, check the user's subscription tier:

### Frontend
```javascript
import { getCurrentUser } from './firebase';

async function checkUserTier() {
  const user = getCurrentUser();
  const idToken = await user.getIdToken(true); // Force refresh to get latest claims
  const decodedToken = await user.getIdTokenResult();
  
  const tier = decodedToken.claims.subscriptionTier || 'free';
  
  switch(tier) {
    case 'free':
      return { avatars: 1, voices: 1 };
    case 'standard':
      return { avatars: 5, voices: 10 };
    case 'pro':
      return { avatars: Infinity, voices: Infinity };
  }
}
```

### Backend
```javascript
const admin = require('firebase-admin');

async function getUserTier(userId) {
  const userRecord = await admin.auth().getUser(userId);
  const tier = userRecord.customClaims?.subscriptionTier || 'free';
  return tier;
}

// In your API endpoints
async function createAvatar(userId, avatarData) {
  const tier = await getUserTier(userId);
  const db = admin.firestore();
  
  // Count existing avatars
  const avatarsSnapshot = await db.collection('avatars')
    .where('userId', '==', userId)
    .get();
  
  const avatarCount = avatarsSnapshot.size;
  
  // Check limits
  const limits = {
    free: 1,
    standard: 5,
    pro: Infinity
  };
  
  if (avatarCount >= limits[tier]) {
    throw new Error('Avatar limit reached for your tier');
  }
  
  // Create avatar...
}
```

## Monitoring

### Stripe Dashboard
- Monitor subscription metrics
- Track MRR (Monthly Recurring Revenue)
- View customer lifecycle
- Analyze churn rate

### CloudWatch Logs
- Monitor Lambda function logs
- Set up alarms for errors
- Track webhook processing

### Firebase Console
- Monitor Firestore usage
- Check user authentication
- Review custom claims

## Troubleshooting

### Issue: Webhook not receiving events
**Solution**: 
1. Check webhook URL is correct in Stripe Dashboard
2. Ensure API Gateway allows POST requests
3. Verify webhook signature in logs
4. Test with Stripe CLI: `stripe listen --forward-to YOUR_URL`

### Issue: Subscription status not updating
**Solution**:
1. Check Firestore security rules allow backend writes
2. Verify Firebase Admin SDK is initialized
3. Check CloudWatch logs for errors
4. Ensure webhook secret is correct

### Issue: User can't access subscription features
**Solution**:
1. Force token refresh on frontend: `user.getIdToken(true)`
2. Check custom claims are set correctly
3. Verify subscription is active in Stripe Dashboard
4. Check Firestore user document

### Issue: Checkout session creation fails
**Solution**:
1. Verify Stripe price IDs are correct
2. Check Stripe secret key is valid
3. Ensure customer email is valid
4. Review CloudWatch logs for detailed error

## Security Considerations

1. **Never expose Stripe secret keys** in frontend code
2. **Always verify webhook signatures** to prevent spoofing
3. **Use HTTPS** for all API endpoints
4. **Validate user authentication** before processing subscriptions
5. **Store sensitive data** in AWS SSM Parameter Store
6. **Set appropriate Firestore security rules**
7. **Monitor for suspicious activity** in Stripe Dashboard

## Next Steps

1. **Customize the UI** in `membership.html` to match your brand
2. **Add email notifications** for subscription events
3. **Implement usage tracking** for avatars and voices
4. **Add promotional codes** via Stripe Dashboard
5. **Set up analytics** to track conversion rates
6. **Create marketing materials** for paid tiers
7. **Implement free trial** period if desired

## Support

For Stripe-related questions:
- Documentation: https://stripe.com/docs
- Support: https://support.stripe.com

For Firebase questions:
- Documentation: https://firebase.google.com/docs
- Support: https://firebase.google.com/support

For AWS questions:
- Documentation: https://docs.aws.amazon.com
- Support: https://aws.amazon.com/support

---

**Created**: October 2025  
**Last Updated**: October 2025  
**Version**: 1.0.0

