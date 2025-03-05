// stripe.js
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('../firebase'); // Adjust path to your Firebase config
const { verifyToken } = require('../middleware'); // Adjust path to your middleware
const router = express.Router();
const db = admin.firestore();

// Mapping from plan to Stripe Price ID (replace with your actual Price IDs)
const planToPriceId = {
  pro: 'price_1Qz1CmGf0OHXso0nSDHCPPG4',    // Replace with your Pro plan Price ID from Stripe
  premium: 'price_1Qz1FnGf0OHXso0nfdgvQH0r' // Replace with your Premium plan Price ID from Stripe
};

// Credits to grant upon successful subscription
const planCredits = {
  pro: 100,
  premium: 250
};

// POST /stripe/create-checkout-session
// Creates a Stripe Checkout Session for subscribing to Pro or Premium plans
router.post('/create-checkout-session', verifyToken, async (req, res) => {
  const { plan } = req.body;
  const userId = req.user.uid;

  // Validate the requested plan
  if (!plan || !planToPriceId[plan]) {
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
      success_url: 'https://amplify-pink.vercel.app/success?session_id={CHECKOUT_SESSION_ID}', // Replace with your success URL
      cancel_url: 'https://amplify-pink.vercel.app/cancel', // Replace with your cancel URL
      metadata: { userId, plan } // Pass userId and plan to webhook for easy identification
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session', details: error.message });
  }
});

// POST /stripe/verify-payment
// Verifies a payment was successful and updates the user's plan
router.post('/verify-payment', verifyToken, async (req, res) => {
    const { sessionId } = req.body;
    const userId = req.user.uid;
  
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
  
    try {
      // Retrieve the checkout session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);
  
      // Verify the session belongs to this user
      if (session.metadata.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
  
      // Check if the payment was successful
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Payment not completed' });
      }
  
      // Get the plan from the session metadata
      const plan = session.metadata.plan;
  
      // Update the user's plan and credits in Firestore
      const userRef = admin.firestore().collection('users').doc(userId);
      await userRef.update({
        plan,
        credits: planCredits[plan],
        stripeSubscriptionId: session.subscription,
        stripeCustomerId: session.customer,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
  
      // Fetch the updated user profile
      const updatedDoc = await userRef.get();
      const updatedProfile = updatedDoc.data();
  
      // Return the updated profile
      res.json({ success: true, plan, user: updatedProfile });
    } catch (error) {
      console.error('Error verifying payment:', error.message);
      res.status(500).json({ error: 'Failed to verify payment' });
    }
  });

// POST /stripe/webhook
// Handles Stripe webhook events to update user data
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  // Verify webhook signature
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook verification failed', details: err.message });
  }

  // Handle specific Stripe events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const userId = session.metadata.userId;
      const plan = session.metadata.plan;
      const subscriptionId = session.subscription;

      // Update user's plan and credits in Firestore
      const userRef = db.collection('users').doc(userId);
      await userRef.update({
        plan,
        credits: planCredits[plan],
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: session.customer // Store customer ID
      });

      console.log(`User ${userId} subscribed to ${plan}, added ${planCredits[plan]} credits`);
      break;

    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      // Find user by subscription ID
      const userSnapshot = await db.collection('users')
        .where('stripeSubscriptionId', '==', deletedSubscription.id)
        .get();

      if (!userSnapshot.empty) {
        const userDoc = userSnapshot.docs[0];
        await userDoc.ref.update({
          plan: 'standard',
          credits: 5, // Reset to standard plan credits
          stripeSubscriptionId: null
        });
        console.log(`User ${userDoc.id} subscription canceled, downgraded to standard`);
      }
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Acknowledge receipt of the event
  res.json({ received: true });
});

module.exports = router;