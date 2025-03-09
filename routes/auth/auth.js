/**
 * Auth API
 *
 * This module handles authentication-related endpoints for user profile management,
 * including updating subscription plans, signing up users, fetching profiles, and account deletion.
 *
 * Endpoints:
 *
 * POST /update-plan
 *   - Updates the user's plan to 'basic' and resets credits to 5.
 *   - Example:
 *     curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *          -d '{"plan": "basic"}' https://yourdomain.com/auth/update-plan
 *
 * POST /signup
 *   - Creates a new user profile in Firestore.
 *   - Requires "firstName" and "lastName" in the request body.
 *   - Example:
 *     curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *          -d '{"firstName": "John", "lastName": "Doe"}' https://yourdomain.com/auth/signup
 *
 * GET /profile
 *   - Retrieves the authenticated user's profile from Firestore.
 *   - Example:
 *     curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/auth/profile
 *
 * GET /user
 *   - Returns the user information stored in the authentication token.
 *   - Example:
 *     curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/auth/user
 *
 * GET /data
 *   - Returns protected data along with user details.
 *   - Example:
 *     curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/auth/data
 *
 * DELETE /delete-account
 *   - Deletes the authenticated user's account from Firebase Auth and Firestore.
 *   - Example:
 *     curl -X DELETE -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/auth/delete-account
 */

const express = require('express');
const admin = require('../../config/firebase'); // Firebase Admin instance
const { verifyToken } = require('../../config/middleware'); // Token verification middleware
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

const planToPriceId = {
  pro: 'price_1Qz1CmGf0OHXso0nSDHCPPG4',
  premium: 'price_1Qz1FnGf0OHXso0nfdgvQH0r'
};

/**
 * POST /update-plan
 * Updates the user's plan to 'basic' and resets credits.
 */
router.post('/update-plan', verifyToken, async (req, res) => {
  const { plan } = req.body;
  const userId = req.user.uid;
  console.log(`[INFO] Update plan request for user: ${userId}, plan: ${plan}`);

  if (plan !== 'basic') {
    console.warn(`[WARN] Invalid plan update attempt by user ${userId}: ${plan}`);
    return res.status(400).json({ error: 'This endpoint only supports updating to the basic plan' });
  }

  try {
    const userRef = admin.firestore().collection('users').doc(userId);
    await userRef.update({
      plan: 'basic',
      credits: 5
    });
    console.log(`[INFO] Successfully updated plan for user: ${userId} to basic`);
    return res.json({ success: true, plan: 'basic' });
  } catch (error) {
    console.error(`[ERROR] Error updating plan for user ${userId}:`, error.message);
    return res.status(500).json({ error: 'Failed to update plan' });
  }
});

/**
 * POST /signup
 * Creates a new user profile in Firestore.
 */
router.post('/signup', verifyToken, async (req, res) => {
  console.log(`[INFO] Signup request received with body:`, req.body);
  const { firstName, lastName } = req.body;
  const uid = req.user.uid;
  const email = req.user.email;

  if (!firstName || !lastName || !firstName.trim() || !lastName.trim()) {
    console.warn(`[WARN] Signup failed for UID ${uid}: Missing first name or last name`);
    return res.status(400).send('First name and last name are required');
  }

  try {
    await admin.firestore().collection('users').doc(uid).set({
      email,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      preferences: {},
      campaigns: [],
      plan: 'basic',
      credits: 5
    });

    console.log(`[INFO] User profile created for UID: ${uid}`);
    return res.status(201).json({
      message: 'Profile created successfully',
      uid,
      email
    });
  } catch (error) {
    console.error(`[ERROR] Error creating profile for UID ${uid}:`, error);
    return res.status(500).send(`Failed to create profile: ${error.message}`);
  }
});

/**
 * GET /profile
 * Retrieves the authenticated user's profile from Firestore.
 */
router.get('/profile', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  console.log(`[INFO] Fetching profile for UID: ${uid}`);
  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      console.warn(`[WARN] Profile not found for UID: ${uid}`);
      return res.status(404).send('Profile not found');
    }
    console.log(`[INFO] Profile retrieved for UID: ${uid}`);
    return res.status(200).json(userDoc.data());
  } catch (error) {
    console.error(`[ERROR] Error fetching profile for UID ${uid}:`, error);
    return res.status(500).send(`Failed to fetch profile: ${error.message}`);
  }
});

/**
 * GET /user
 * Returns the user information from the authentication token.
 */
router.get('/user', verifyToken, (req, res) => {
  console.log(`[INFO] Returning auth token user data for UID: ${req.user.uid}`);
  return res.json({ user: req.user });
});

/**
 * GET /data
 * Returns protected data along with user details.
 */
router.get('/data', verifyToken, (req, res) => {
  console.log(`[INFO] Returning protected data for UID: ${req.user.uid}`);
  return res.json({ message: 'This is protected data', user: req.user });
});

/**
 * DELETE /delete-account
 * Deletes the authenticated user's account from Firebase Auth and Firestore.
 */
router.delete('/delete-account', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  console.log(`[INFO] Delete account request received for UID: ${uid}`);
  try {
    await admin.auth().deleteUser(uid);
    await admin.firestore().collection('users').doc(uid).delete();
    console.log(`[INFO] Successfully deleted account for UID: ${uid}`);
    return res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting account for UID ${uid}:`, error.message);
    return res.status(500).json({ error: `Error deleting account: ${error.message}` });
  }
});

module.exports = router;