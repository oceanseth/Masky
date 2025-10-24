# Fix Stripe Webhook Endpoint Issue

## Problem
Stripe is failing to send webhooks to `https://masky.net/api/stripe/webhook` because:
1. CloudFront might not be properly configured for webhook POST requests
2. The webhook endpoint should use the direct API Gateway URL

## Solution

### Option 1: Update Webhook URL in Stripe Dashboard (Recommended)

1. **Go to Stripe Dashboard:**
   - Login to [Stripe Dashboard](https://dashboard.stripe.com/)
   - Go to **Developers** → **Webhooks**

2. **Find your existing webhook:**
   - Look for the webhook pointing to `https://masky.net/api/stripe/webhook`
   - Click on it to edit

3. **Update the endpoint URL:**
   - Change from: `https://masky.net/api/stripe/webhook`
   - Change to: `https://b4feblbni7.execute-api.us-east-1.amazonaws.com/production/api/stripe/webhook`

4. **Save the changes**

### Option 2: Use PowerShell Script

If you have your Stripe API key and webhook ID, you can run:

```powershell
.\update-stripe-webhook.ps1 -StripeApiKey "sk_live_..." -WebhookId "whsec_..."
```

### Option 3: Create New Webhook

If you can't find the existing webhook or want to start fresh:

1. **Create new webhook in Stripe Dashboard:**
   - Go to **Developers** → **Webhooks**
   - Click **"Add endpoint"**
   - URL: `https://b4feblbni7.execute-api.us-east-1.amazonaws.com/production/api/stripe/webhook`

2. **Select events to listen for:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

3. **Get the webhook secret:**
   - After creating, click on the webhook
   - Copy the **"Signing secret"** (starts with `whsec_`)
   - Update the AWS SSM parameter `/masky/production/stripe_webhook_secret`

## Verify the Fix

After updating the webhook endpoint:

1. **Test a subscription:**
   - Try upgrading to Standard or Pro plan
   - Check the Lambda logs to see if webhook events are received

2. **Check Lambda logs:**
   ```bash
   aws logs tail /aws/lambda/masky-production-api --since 5m --format short
   ```

3. **Look for webhook events:**
   - You should see `"Webhook event type: checkout.session.completed"` in the logs

## Current Status

✅ **Subscription status API** - Working (Authorization header fixed)
✅ **Checkout session creation** - Working  
❌ **Webhook processing** - Needs endpoint update

The webhook endpoint update will fix the Stripe notification issue and ensure subscription status updates work properly.
