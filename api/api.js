const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    region: 'us-east-1',
    signatureVersion: 'v4',
    endpoint: 'https://s3.us-east-1.amazonaws.com'  // Specify regional endpoint
});
const firebaseInitializer = require('../utils/firebaseInit');
const stripeInitializer = require('../utils/stripeInit');
const twitchInitializer = require('../utils/twitchInit');

// Handle Twitch OAuth login (legacy - for direct access token)
const handleTwitchOAuth = async (event) => {
    try {
        // Parse body - it might be base64 encoded, a string, or an object
        let body;
        if (typeof event.body === 'string') {
            // Check if body is base64 encoded (API Gateway does this)
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }
        console.log('Parsed body:', JSON.stringify(body));
        const { accessToken } = body;

        if (!accessToken) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing accessToken in request body' })
            };
        }

        // Verify Twitch token and get user info using twitchInitializer
        const twitchUser = await twitchInitializer.verifyToken(accessToken);
        const uid = `twitch:${twitchUser.id}`;

        // Initialize Firebase Admin
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');

        // Create or update user in Firebase
        let userRecord;
        try {
            userRecord = await admin.auth().getUser(uid);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create new user
                userRecord = await admin.auth().createUser({
                    uid: uid,
                    displayName: twitchUser.display_name,
                    photoURL: twitchUser.profile_image_url,
                    email: twitchUser.email
                });
            } else {
                throw error;
            }
        }

        // Create custom token for Firebase authentication
        const customToken = await admin.auth().createCustomToken(uid, {
            provider: 'twitch',
            twitchId: twitchUser.id,
            displayName: twitchUser.display_name,
            profileImage: twitchUser.profile_image_url
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                firebaseToken: customToken,
                user: {
                    uid: uid,
                    displayName: twitchUser.display_name,
                    photoURL: twitchUser.profile_image_url,
                    email: twitchUser.email,
                    twitchId: twitchUser.id
                }
            })
        };

    } catch (error) {
        console.error('Twitch OAuth error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};

exports.handler = async (event, context) => {
    console.log('Event received:', JSON.stringify({ 
        path: event.path, 
        httpMethod: event.httpMethod,
        body: event.body,
        headers: event.headers 
    }));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Route handling
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;

    // Handle Twitch OAuth callback (authorization code exchange)
    if (path.includes('/twitch_oauth_callback') && method === 'POST') {
        const response = await twitchInitializer.handleOAuthCallback(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Handle Twitch OAuth (legacy - direct access token)
    if (path.includes('/twitch_oauth') && method === 'POST') {
        const response = await handleTwitchOAuth(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Subscription status endpoint
    if (path.includes('/subscription/status') && method === 'GET') {
        console.log('Subscription status request received');
        const response = await getSubscriptionStatus(event);
        return {
            statusCode: response.statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
                'Content-Type': 'application/json'
            },
            body: response.body
        };
    }

    // Create checkout session
    if (path.includes('/subscription/create-checkout') && method === 'POST') {
        const response = await createCheckoutSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Cancel subscription
    if (path.includes('/subscription/cancel') && method === 'POST') {
        const response = await cancelSubscription(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Create customer portal session
    if (path.includes('/subscription/portal') && method === 'POST') {
        const response = await createPortalSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Stripe webhook
    if (path.includes('/stripe/webhook') && method === 'POST') {
        const response = await handleStripeWebhook(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Default response for unmatched routes
    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Route not found' })
    };
}

/**
 * Get subscription status for a user
 */
async function getSubscriptionStatus(event) {
    try {
        console.log('Getting subscription status, headers:', JSON.stringify(event.headers));
        
        // Verify Firebase token - API Gateway normalizes headers to lowercase
        const authHeader = event.headers.Authorization || event.headers.authorization;
        
        if (!authHeader) {
            console.error('No authorization header found');
            return {
                statusCode: 401,
                body: JSON.stringify({ 
                    error: 'Unauthorized - No token provided',
                    debug: 'No Authorization header found in request'
                })
            };
        }
        
        if (!authHeader.startsWith('Bearer ')) {
            console.error('Invalid authorization header format:', authHeader.substring(0, 20));
            return {
                statusCode: 401,
                body: JSON.stringify({ 
                    error: 'Unauthorized - Invalid token format',
                    debug: 'Authorization header must start with "Bearer "'
                })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        // Verify the token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Get user's custom claims (where we store subscription info)
        const userRecord = await admin.auth().getUser(userId);
        const customClaims = userRecord.customClaims || {};

        // If no subscription data in custom claims, check Firestore
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        const subscription = {
            tier: customClaims.subscriptionTier || userData.subscriptionTier || 'free',
            status: customClaims.subscriptionStatus || userData.subscriptionStatus || 'active',
            stripeCustomerId: customClaims.stripeCustomerId || userData.stripeCustomerId,
            stripeSubscriptionId: customClaims.stripeSubscriptionId || userData.stripeSubscriptionId,
            currentPeriodEnd: customClaims.currentPeriodEnd || userData.currentPeriodEnd,
            cancelAtPeriodEnd: customClaims.cancelAtPeriodEnd || userData.cancelAtPeriodEnd || false
        };

        return {
            statusCode: 200,
            body: JSON.stringify({ subscription })
        };

    } catch (error) {
        console.error('Error getting subscription status:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to get subscription status',
                message: error.message 
            })
        };
    }
}

/**
 * Create Stripe checkout session
 */
async function createCheckoutSession(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        const userEmail = decodedToken.email;

        // Parse request body
        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }

        const { tier, priceId, successUrl, cancelUrl } = body;

        if (!tier || !['standard', 'pro'].includes(tier)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid tier specified' })
            };
        }

        if (!priceId || !priceId.startsWith('price_')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid price ID provided' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Get or create Stripe customer
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        let stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: userEmail,
                metadata: {
                    firebaseUID: userId
                }
            });
            stripeCustomerId = customer.id;

            // Save customer ID to Firestore
            await db.collection('users').doc(userId).set({
                stripeCustomerId: stripeCustomerId
            }, { merge: true });
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                }
            ],
            mode: 'subscription',
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                firebaseUID: userId,
                tier: tier
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create checkout session',
                message: error.message 
            })
        };
    }
}

/**
 * Cancel subscription
 */
async function cancelSubscription(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Get user's subscription ID
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const stripeSubscriptionId = userDoc.data()?.stripeSubscriptionId;

        if (!stripeSubscriptionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No active subscription found' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Cancel subscription at period end
        const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        // Update Firestore
        await db.collection('users').doc(userId).update({
            cancelAtPeriodEnd: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update custom claims
        await admin.auth().setCustomUserClaims(userId, {
            ...decodedToken,
            cancelAtPeriodEnd: true
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Subscription canceled successfully',
                subscription: {
                    id: subscription.id,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    currentPeriodEnd: subscription.current_period_end
                }
            })
        };

    } catch (error) {
        console.error('Error canceling subscription:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to cancel subscription',
                message: error.message 
            })
        };
    }
}

/**
 * Create customer portal session
 */
async function createPortalSession(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Parse request body
        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }

        const { returnUrl } = body;

        // Get user's Stripe customer ID
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No Stripe customer found' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Create portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl || event.headers.origin || 'https://masky.net'
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating portal session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create portal session',
                message: error.message 
            })
        };
    }
}

/**
 * Handle Stripe webhooks
 */
async function handleStripeWebhook(event) {
    try {
        // Initialize Stripe
        const { stripe, webhookSecret } = await stripeInitializer.initialize();

        // Get the signature from headers
        const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
        
        if (!signature) {
            console.error('No Stripe signature found in headers');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No signature provided' })
            };
        }

        // Get raw body
        let rawBody = event.body;
        if (event.isBase64Encoded) {
            rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
        }

        // Verify webhook signature
        let stripeEvent;
        try {
            stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid signature' })
            };
        }

        console.log('Webhook event type:', stripeEvent.type);

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Handle different event types
        switch (stripeEvent.type) {
            case 'checkout.session.completed': {
                const session = stripeEvent.data.object;
                const userId = session.metadata.firebaseUID;
                const tier = session.metadata.tier;
                const customerId = session.customer;
                const subscriptionId = session.subscription;

                // Update user data
                await db.collection('users').doc(userId).set({
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    subscriptionTier: tier,
                    subscriptionStatus: 'active',
                    cancelAtPeriodEnd: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // Update custom claims
                await admin.auth().setCustomUserClaims(userId, {
                    subscriptionTier: tier,
                    subscriptionStatus: 'active',
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    cancelAtPeriodEnd: false
                });

                console.log('Subscription created for user:', userId);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = stripeEvent.data.object;
                const customerId = subscription.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Determine tier from subscription items
                    // Note: You can also add metadata to products in Stripe Dashboard
                    const priceId = subscription.items.data[0].price.id;
                    const productId = subscription.items.data[0].price.product;
                    
                    // Try to get tier from subscription metadata first, then fallback to product lookup
                    let tier = subscription.metadata?.tier || 'free';
                    
                    // If no metadata, try to determine from product
                    if (!subscription.metadata?.tier) {
                        // You can add logic here to map product IDs to tiers if needed
                        // For now, we'll keep the tier from the original subscription creation
                        const existingData = userDoc.data();
                        tier = existingData.subscriptionTier || 'free';
                    }

                    const updateData = {
                        subscriptionStatus: subscription.status,
                        subscriptionTier: tier,
                        currentPeriodEnd: subscription.current_period_end,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };

                    await db.collection('users').doc(userId).update(updateData);

                    // Update custom claims
                    await admin.auth().setCustomUserClaims(userId, {
                        subscriptionTier: tier,
                        subscriptionStatus: subscription.status,
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: subscription.id,
                        currentPeriodEnd: subscription.current_period_end,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end
                    });

                    console.log('Subscription updated for user:', userId);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = stripeEvent.data.object;
                const customerId = subscription.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Downgrade to free tier
                    await db.collection('users').doc(userId).update({
                        subscriptionStatus: 'canceled',
                        subscriptionTier: 'free',
                        stripeSubscriptionId: null,
                        cancelAtPeriodEnd: false,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Update custom claims
                    await admin.auth().setCustomUserClaims(userId, {
                        subscriptionTier: 'free',
                        subscriptionStatus: 'canceled',
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: null,
                        cancelAtPeriodEnd: false
                    });

                    console.log('Subscription canceled for user:', userId);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = stripeEvent.data.object;
                const customerId = invoice.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Mark payment as failed
                    await db.collection('users').doc(userId).update({
                        subscriptionStatus: 'past_due',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    console.log('Payment failed for user:', userId);
                }
                break;
            }

            default:
                console.log('Unhandled event type:', stripeEvent.type);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ received: true })
        };

    } catch (error) {
        console.error('Error handling webhook:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Webhook handler failed',
                message: error.message 
            })
        };
    }
}