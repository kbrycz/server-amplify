/**
 * User API
 *
 * This module provides endpoints for managing user profiles.
 *
 * Endpoints:
 *   PUT /update
 *     - Update user credentials such as email, password, first name, and last name.
 *
 * Example:
 *   curl -X PUT -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com", "password": "newpassword"}' \
 *        https://yourdomain.com/user/update
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const router = express.Router();

/**
 * PUT /update
 * Update user credentials in Firebase Auth and Firestore.
 */
router.put('/update', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  const { firstName, lastName, email, password } = req.body;
  console.info(`[INFO] Updating user credentials for UID: ${uid}`);
  try {
    // Prepare update for Firebase Auth
    const authUpdate = {};
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    if (firstName || lastName) {
      authUpdate.displayName = `${firstName || ''} ${lastName || ''}`.trim() || undefined;
    }
    if (Object.keys(authUpdate).length > 0) {
      await admin.auth().updateUser(uid, authUpdate);
      console.info(`[INFO] Firebase Auth updated for UID: ${uid}`);
    }

    // Prepare update for Firestore
    const firestoreUpdate = {};
    if (firstName) firestoreUpdate.firstName = firstName;
    if (lastName) firestoreUpdate.lastName = lastName;
    if (email) firestoreUpdate.email = email;
    if (Object.keys(firestoreUpdate).length > 0) {
      await admin.firestore().collection('users').doc(uid).set(firestoreUpdate, { merge: true });
      console.info(`[INFO] Firestore profile updated for UID: ${uid}`);
    }

    return res.status(200).json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('[ERROR] Error updating user:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;