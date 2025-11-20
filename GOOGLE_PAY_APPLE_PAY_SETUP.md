# Google Pay and Apple Pay Setup Guide

This guide explains how to enable Google Pay and Apple Pay with Stripe Payment Element.

## Overview

The Stripe Payment Element automatically displays Google Pay and Apple Pay buttons when:
- Enabled in your Stripe Dashboard
- Your domain is verified (Apple Pay)
- Your site is served over HTTPS
- The user's browser/device supports these payment methods

## Step 1: Stripe Dashboard Configuration

### Enable Apple Pay

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Settings** → **Payment methods**
2. Find **Apple Pay** and click **Activate**
3. Accept the Apple Pay Terms of Service
4. Register your domain:
   - Click **Add domain**
   - Enter your domain (e.g., `masky.ai`)
   - Download the domain verification file
   - Upload it to your domain at: `https://yourdomain.com/.well-known/apple-developer-merchantid-domain-association`
   - Click **Verify domain**

### Enable Google Pay

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Settings** → **Payment methods**
2. Find **Google Pay** and ensure it's **Enabled**
3. No domain verification required for Google Pay

## Step 2: Domain Verification File Setup

### For Production (masky.ai)

You need to host the Apple Pay domain verification file at:
```
https://masky.ai/.well-known/apple-developer-merchantid-domain-association
```

**Option A: Host on S3/CloudFront**
1. Download the file from Stripe Dashboard
2. Upload to S3 bucket at path: `.well-known/apple-developer-merchantid-domain-association`
3. Ensure CloudFront serves it with correct content-type: `text/plain`

**Option B: Host in your web server**
1. Download the file from Stripe Dashboard
2. Place it in your `public/.well-known/` directory
3. Ensure your web server serves it correctly

### For Local Development

Apple Pay won't work on localhost (requires HTTPS and domain verification).
Google Pay can work on localhost with HTTPS.

## Step 3: Code Updates

The Payment Element automatically detects and shows Apple Pay/Google Pay buttons when:
- Payment methods are enabled in Stripe Dashboard
- Domain is verified (Apple Pay)
- Site uses HTTPS
- Browser/device supports the payment method

No code changes are required - the Payment Element handles this automatically!

## Step 4: Testing

### Test Mode

1. Use Stripe test mode
2. For Apple Pay testing:
   - Use Safari on macOS or iOS
   - Add a test card in Wallet app
   - Use test card: `4242 4242 4242 4242`
3. For Google Pay testing:
   - Use Chrome on desktop or Android
   - Add a test card in Google Pay
   - Use test card: `4242 4242 4242 4242`

### Production Testing

1. Ensure domain verification file is accessible
2. Test on actual devices:
   - **Apple Pay**: Safari on macOS/iOS with real Apple Pay setup
   - **Google Pay**: Chrome on desktop/Android with real Google Pay setup

## Troubleshooting

### Apple Pay not showing:
- ✅ Check domain verification file is accessible
- ✅ Ensure HTTPS is enabled
- ✅ Verify Apple Pay is enabled in Stripe Dashboard
- ✅ Test on Safari (macOS/iOS) - not Chrome
- ✅ Check browser console for errors

### Google Pay not showing:
- ✅ Ensure Google Pay is enabled in Stripe Dashboard
- ✅ Test on Chrome (desktop/Android)
- ✅ Ensure HTTPS is enabled
- ✅ Check browser console for errors

### Both not showing:
- ✅ Verify Payment Element is properly initialized
- ✅ Check Stripe publishable key is correct
- ✅ Ensure Payment Intent is created successfully
- ✅ Check browser console for Stripe errors

## Additional Notes

- **Payment Element automatically handles**: Button display, payment method selection, and payment processing
- **No additional code needed**: The Payment Element detects available payment methods and shows them automatically
- **Mobile-first**: Apple Pay and Google Pay work best on mobile devices
- **Desktop support**: Google Pay works on Chrome desktop; Apple Pay requires macOS Safari

## Resources

- [Stripe Apple Pay Docs](https://stripe.com/docs/apple-pay)
- [Stripe Google Pay Docs](https://stripe.com/docs/google-pay)
- [Payment Element Docs](https://stripe.com/docs/payments/payment-element)

