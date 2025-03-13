/**
 * Auth API
 *
 * This module handles authentication-related endpoints for user profile management,
 * including updating subscription plans, signing up users, fetching profiles, and account deletion.
 *
 * When a new user signs up, a default namespace is automatically created. We also store that
 * namespace's document ID on the user record as "defaultNamespace" for easy reference.
 *
 * Endpoints:
 *   POST /update-plan        - Update the user's plan to 'basic' and reset credits.
 *   POST /signup             - Create a new user profile and a default namespace.
 *   GET /profile             - Retrieve the authenticated user's profile.
 *   GET /user                - Return user info from the auth token.
 *   GET /data                - Return protected data along with user details.
 *   DELETE /delete-account   - Delete the authenticated user's account.
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
 * Creates a new user profile in Firestore and automatically creates a default namespace.
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
    // Create user profile
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

    // Create a default namespace for the new user.
    const defaultNamespaceData = {
      name: 'default',
      description: `Default namespace for ${firstName} ${lastName}`,
      accountId: uid,
      // The default namespace will only include the creator as a member.
      // The user is assigned an "admin" role here for default operations,
      // but you can enforce logic elsewhere to disallow them from adding members or deleting it.
      members: [{
        email,
        permission: 'admin',
        status: 'active'
      }],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    let defaultNamespaceRef = null;
    try {
      defaultNamespaceRef = await admin.firestore().collection('namespaces').add(defaultNamespaceData);
      console.log(`[INFO] Default namespace created for UID: ${uid}, namespaceId: ${defaultNamespaceRef.id}`);

      // Store the namespace ID on the user record
      await admin.firestore().collection('users').doc(uid).update({
        defaultNamespace: defaultNamespaceRef.id
      });
    } catch (nsError) {
      console.error(`[ERROR] Failed to create default namespace for UID ${uid}:`, nsError.message);
      // Proceed without failing the signup process.
      // The user profile is created but no defaultNamespace is stored.
    }

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