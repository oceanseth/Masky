# Membership System - Quick Start Checklist

Use this checklist to quickly set up your Stripe subscription system. For detailed instructions, see [MEMBERSHIP_SETUP.md](./MEMBERSHIP_SETUP.md).

## ✅ Pre-Launch Checklist

### 1. Stripe Setup (15 minutes)

- [ ] **Create Stripe Account** (or use existing)
  - Go to https://stripe.com
  - Complete account setup

- [ ] **Create Standard Product**
  - Dashboard → Products → Add Product
  - Name: "Masky Standard"
  - Price: $20.00/month recurring
  - Save and **copy Price ID** (starts with `price_`)

- [ ] **Create Pro Product**
  - Dashboard → Products → Add Product
  - Name: "Masky Pro"  
  - Price: $50.00/month recurring
  - Save and **copy Price ID** (starts with `price_`)

- [ ] **Enable Customer Portal**
  - Settings → Billing → Customer portal
  - Enable portal
  - Allow: subscriptions, payments, invoices
  - Save configuration

- [ ] **Create Webhook**
  - Developers → Webhooks → Add endpoint
  - URL: `https://YOUR-API-DOMAIN/api/stripe/webhook`
  - Events: 
    - ✅ checkout.session.completed
    - ✅ customer.subscription.updated
    - ✅ customer.subscription.deleted
    - ✅ invoice.payment_failed
  - Save and **copy Webhook Secret** (starts with `whsec_`)

### 2. AWS Configuration (10 minutes)

- [ ] **Store Stripe Secret Key in SSM**
  ```bash
  aws ssm put-parameter \
    --name "/voicecert/prod/STRIPE_SECRET_KEY" \
    --value "sk_live_YOUR_KEY" \
    --type "SecureString" \
    --overwrite
  ```

- [ ] **Store Webhook Secret in SSM**
  ```bash
  aws ssm put-parameter \
    --name "/voicecert/prod/STRIPE_WEBHOOK_SECRET" \
    --value "whsec_YOUR_SECRET" \
    --type "SecureString" \
    --overwrite
  ```

### 3. Firebase Setup (5 minutes)

- [ ] **Enable Firestore**
  - Firebase Console → Firestore Database
  - Create database (Production mode)
  - Choose location
  - Enable

- [ ] **Update Security Rules** (optional)
  ```javascript
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /users/{userId} {
        allow read: if request.auth != null && request.auth.uid == userId;
        allow write: if false;
      }
    }
  }
  ```

### 4. Environment Variables (2 minutes)

- [ ] **Update serverless.yml** (or set environment variables)
  ```yaml
  environment:
    STRIPE_STANDARD_PRICE_ID: 'price_YOUR_STANDARD_ID'
    STRIPE_PRO_PRICE_ID: 'price_YOUR_PRO_ID'
  ```

  OR

  ```bash
  export STRIPE_STANDARD_PRICE_ID=price_YOUR_STANDARD_ID
  export STRIPE_PRO_PRICE_ID=price_YOUR_PRO_ID
  ```

### 5. Deployment (5 minutes)

- [ ] **Build Frontend**
  ```bash
  npm run build
  ```

- [ ] **Deploy Backend**
  ```bash
  serverless deploy --stage prod
  ```
  **Copy the API endpoint URL from the output**

- [ ] **Update Stripe Webhook URL**
  - Stripe Dashboard → Webhooks
  - Edit webhook endpoint
  - Update URL to your API endpoint
  - Example: `https://abcd1234.execute-api.us-east-1.amazonaws.com/prod/api/stripe/webhook`

- [ ] **Deploy Frontend**
  - Upload `dist/` folder to your hosting service
  - Or run your hosting provider's deploy command

### 6. Testing (10 minutes)

- [ ] **Test with Stripe Test Mode**
  - Switch to test mode in Stripe Dashboard
  - Use test Price IDs
  - Use test Webhook Secret

- [ ] **Test Subscription Flow**
  - [ ] Sign up as new user
  - [ ] Navigate to /membership.html
  - [ ] Click "Upgrade to Standard"
  - [ ] Complete checkout with test card: `4242 4242 4242 4242`
  - [ ] Verify membership badge updates
  - [ ] Check Firestore for subscription data

- [ ] **Test Cancellation**
  - [ ] Click "Cancel Subscription"
  - [ ] Verify status shows "Canceling"
  - [ ] Verify access remains

- [ ] **Test Customer Portal**
  - [ ] Click "Manage Billing"
  - [ ] Verify redirect to Stripe portal
  - [ ] Test updating payment method

- [ ] **Test Webhooks**
  - Check CloudWatch logs for webhook processing
  - Verify Firestore updates
  - Verify custom claims updates

### 7. Go Live! (2 minutes)

- [ ] **Switch to Live Mode**
  - Use live Stripe keys (sk_live_...)
  - Use live Price IDs
  - Use live Webhook Secret
  - Update SSM parameters with live values

- [ ] **Update Webhook to Production URL**
  - Stripe Dashboard → Webhooks
  - Update endpoint URL to production

- [ ] **Final Verification**
  - Test with real card (small amount)
  - Verify all webhooks working
  - Test cancellation flow
  - Monitor CloudWatch logs

---

## 🚀 You're Live!

Your membership system is now ready. Users can:
- ✅ View pricing and features at `/membership.html`
- ✅ Upgrade to Standard or Pro
- ✅ Manage their subscription via Stripe Customer Portal
- ✅ Cancel anytime (keeps access until period end)

## 📊 Monitor Your Business

- **Stripe Dashboard**: Monitor subscriptions, revenue, and customers
- **CloudWatch Logs**: Track API requests and webhook processing
- **Firebase Console**: View user subscription data

## 🎯 Quick Links

- Full Setup Guide: [MEMBERSHIP_SETUP.md](./MEMBERSHIP_SETUP.md)
- Usage Examples: [SUBSCRIPTION_USAGE_EXAMPLES.md](./SUBSCRIPTION_USAGE_EXAMPLES.md)
- Implementation Details: [MEMBERSHIP_README.md](./MEMBERSHIP_README.md)

## 🆘 Troubleshooting

**Webhook not working?**
- Check URL is correct in Stripe Dashboard
- Verify webhook secret in SSM is correct
- Check CloudWatch logs for errors

**Subscription not updating?**
- Force token refresh: `user.getIdToken(true)`
- Check Firestore user document
- Verify webhook processed successfully

**Can't create checkout?**
- Verify Price IDs are correct
- Check Stripe secret key is valid
- Review CloudWatch logs

---

## Test Cards (Test Mode Only)

| Card Number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Decline |
| 4000 0000 0000 9995 | Insufficient funds |

Use any future expiry date (12/34) and any 3-digit CVC (123).

---

**Estimated Total Setup Time**: ~45 minutes  
**Ready to go live?** Yes! Just follow the checklist above.

