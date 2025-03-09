/**
 * Stripe API
 *
 * This module provides endpoints for handling Stripe payments and subscription management.
 *
 * Endpoints:
 * 
 * POST /stripe/create-checkout-session
 *   - Creates a Stripe Checkout Session for subscribing to Pro or Premium plans.
 *   - Example:
 *     curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *          -d '{"plan": "pro"}' https://yourdomain.com/stripe/create-checkout-session
 *
 * POST /stripe/verify-payment
 *   - Verifies a payment was completed and updates the user's plan and credits in Firestore.
 *   - Example:
 *     curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *          -d '{"sessionId": "cs_test_ABC123"}' https://yourdomain.com/stripe/verify-payment
 *
 * POST /stripe/webhook
 *   - Handles Stripe webhook events to update user data based on subscription events.
 *
 * POST /stripe/downgrade
 *   - Downgrades the user's subscription plan.
 *   - Example:
 *     curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *          -d '{"targetPlan": "basic"}' https://yourdomain.com/stripe/downgrade
 */

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('../../config/firebase'); // Firebase Admin instance
const { verifyToken } = require('../../config/middleware');
const router = express.Router();
const db = admin.firestore();

// Mapping from plan to Stripe Price ID (update with your actual Price IDs)
const planToPriceId = {
  pro: 'price_1Qz1CmGf0OHXso0nSDHCPPG4',
  premium: 'price_1Qz1FnGf0OHXso0nfdgvQH0r'
};

// Credits to grant upon successful subscription
const planCredits = {
  pro: 100,
  premium: 250
};

/**
 * POST /stripe/create-checkout-session
 * Creates a Stripe Checkout Session for subscribing to Pro or Premium plans.
 */
router.post('/create-checkout-session', verifyToken, async (req, res) => {
  const { plan } = req.body;
  const userId = req.user.uid;
  console.info(`[INFO] Creating checkout session for user: ${userId}, plan: ${plan}`);

  if (!plan || !planToPriceId[plan]) {
    console.warn(`[WARN] Invalid plan provided: ${plan}`);
    return res.status(400).json({ error: 'Invalid plan. Must be "pro" or "premium"' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: planToPriceId[plan],
        quantity: 1
      }],
      success_url: 'https://amplify-pink.vercel.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://amplify-pink.vercel.app/cancel',
      metadata: { userId, plan }
    });
    console.info(`[INFO] Checkout session created with ID: ${session.id}`);
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('[ERROR] Error creating checkout session:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session', details: error.message });
  }
});

/**
 * POST /stripe/verify-payment
 * Verifies a payment was successful and updates the user's plan in Firestore.
 */
router.post('/verify-payment', verifyToken, async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.uid;
  console.info(`[INFO] Verifying payment for session: ${sessionId}, user: ${userId}`);

  if (!sessionId) {
    console.warn('[WARN] Session ID is missing');
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata.userId !== userId) {
      console.warn(`[WARN] User mismatch for session: ${sessionId}`);
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (session.payment_status !== 'paid') {
      console.warn(`[WARN] Payment not completed for session: ${sessionId}`);
      return res.status(400).json({ error: 'Payment not completed' });
    }
    const plan = session.metadata.plan;
    const userRef = admin.firestore().collection('users').doc(userId);
    await userRef.update({
      plan,
      credits: planCredits[plan],
      stripeSubscriptionId: session.subscription,
      stripeCustomerId: session.customer,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const updatedProfile = (await userRef.get()).data();
    console.info(`[INFO] Payment verified and profile updated for user: ${userId}`);
    res.json({ success: true, plan, user: updatedProfile });
  } catch (error) {
    console.error('[ERROR] Error verifying payment:', error.message);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

/**
 * POST /stripe/webhook
 * Handles Stripe webhook events to update user data.
 * Use express.raw to capture the request body for signature verification.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.info(`[INFO] Received Stripe webhook event: ${event.type}`);
  } catch (err) {
    console.error('[ERROR] Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook verification failed', details: err.message });
  }

  // Handle specific events
  switch (event.type) {
    case 'checkout.session.completed':
      {
        const session = event.data.object;
        const userId = session.metadata.userId;
        const plan = session.metadata.plan;
        const subscriptionId = session.subscription;
        const userRef = db.collection('users').doc(userId);
        await userRef.update({
          plan,
          credits: planCredits[plan],
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: session.customer
        });
        console.info(`[INFO] User ${userId} subscribed to ${plan}; added ${planCredits[plan]} credits`);
      }
      break;
    case 'customer.subscription.deleted':
      {
        const deletedSubscription = event.data.object;
        const userSnapshot = await db.collection('users')
          .where('stripeSubscriptionId', '==', deletedSubscription.id)
          .get();
        if (!userSnapshot.empty) {
          const userDoc = userSnapshot.docs[0];
          await userDoc.ref.update({
            plan: 'standard',
            credits: 5,
            stripeSubscriptionId: null
          });
          console.info(`[INFO] User ${userDoc.id} subscription canceled and downgraded to standard`);
        }
      }
      break;
    default:
      console.info(`[INFO] Unhandled event type: ${event.type}`);
  }
  res.json({ received: true });
});

/**
 * POST /stripe/downgrade
 * Downgrades a user's subscription.
 * Expects a targetPlan in the request body. The target plan must be lower than the current plan.
 *
 * Example:
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"targetPlan": "basic"}' https://yourdomain.com/stripe/downgrade
 */
router.post('/downgrade', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { targetPlan } = req.body;
  console.info(`[INFO] Downgrade request for user: ${userId}, targetPlan: ${targetPlan}`);

  // Define plan rankings and credits
  const planRank = { basic: 1, pro: 2, premium: 3 };
  const planCredits = { basic: 5, pro: 100, premium: 250 };

  if (!targetPlan || !planRank[targetPlan]) {
    console.warn('[WARN] Invalid target plan specified');
    return res.status(400).json({ error: 'Invalid target plan specified' });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.warn(`[WARN] User not found for userId: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    const currentPlan = userData.plan || 'basic';
    const currentRank = planRank[currentPlan];
    const targetRank = planRank[targetPlan];
    if (currentRank <= targetRank) {
      console.warn(`[WARN] Invalid downgrade: current plan ${currentPlan} is not higher than target plan ${targetPlan}`);
      return res.status(400).json({ error: 'Downgrade target must be lower than current plan' });
    }
    const subscriptionId = userData.stripeSubscriptionId;
    if (!subscriptionId) {
      console.warn('[WARN] No active subscription found for downgrade');
      return res.status(400).json({ error: 'No active subscription found for downgrade' });
    }
    await stripe.subscriptions.cancel(subscriptionId);
    await userRef.update({
      plan: targetPlan,
      credits: planCredits[targetPlan],
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.info(`[INFO] User ${userId} downgraded to ${targetPlan}`);
    return res.json({ success: true, plan: targetPlan, message: `Subscription downgraded to ${targetPlan} plan successfully` });
  } catch (error) {
    console.error('[ERROR] Error downgrading subscription:', error.message);
    return res.status(500).json({ error: 'Failed to downgrade subscription', details: error.message });
  }
});

module.exports = router;