/**
 * User API
 *
 * This module provides endpoints for managing user profiles.
 * 
 * **Security Best Practices:**
 *  - Always use HTTPS so that credentials (email/password) are transmitted securely.
 *  - Avoid logging sensitive information (e.g. passwords).
 *  - We recommend handling sensitive operations (like email verification and reauthentication)
 *    on the client using the Firebase Client SDK (e.g. user.sendEmailVerification(), updateEmail(), updatePassword()).
 *  - If you implement server‑side email verification, you can call the Firebase Identity Toolkit API,
 *    but that requires additional handling (such as obtaining a fresh ID token from the client).
 *
 * Endpoints:
 *   PUT /update
 *     - Update user credentials such as email, password, first name, and last name.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const router = express.Router();

router.put('/update', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  const { firstName, lastName, email, password } = req.body;
  console.info(`[INFO] Updating user credentials for UID: ${uid}`);

  try {
    // Prepare update for Firebase Auth.
    // Note: Even though email and password are transmitted over HTTPS,
    // do not log these sensitive details.
    const authUpdate = {};
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    if (firstName || lastName) {
      authUpdate.displayName = `${firstName || ''} ${lastName || ''}`.trim();
    }
    if (Object.keys(authUpdate).length > 0) {
      await admin.auth().updateUser(uid, authUpdate);
      console.info(`[INFO] Firebase Auth updated for UID: ${uid}`);
    }

    // Prepare update for Firestore.
    const firestoreUpdate = {};
    if (firstName) firestoreUpdate.firstName = firstName;
    if (lastName) firestoreUpdate.lastName = lastName;
    if (email) firestoreUpdate.email = email;
    if (Object.keys(firestoreUpdate).length > 0) {
      await admin.firestore().collection('users').doc(uid).set(firestoreUpdate, { merge: true });
      console.info(`[INFO] Firestore profile updated for UID: ${uid}`);
    }

    // Optional: If email is updated, you might want to trigger a verification email.
    // It is recommended to handle email verification on the client using Firebase's built-in methods:
    //    firebase.auth().currentUser.sendEmailVerification()
    // Or use the Firebase Identity Toolkit API from your server (requires additional security checks).

    return res.status(200).json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('[ERROR] Error updating user:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;