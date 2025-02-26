const express = require('express');
const admin = require('./firebase'); // Import the initialized Firebase instance
const { verifyToken } = require('./middleware');

const router = express.Router();

// Update user credentials
router.put('/update', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  const { firstName, lastName, email, password } = req.body;

  try {
    // Update Firebase Auth
    const authUpdate = {};
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    if (firstName || lastName) {
      authUpdate.displayName = `${firstName || ''} ${lastName || ''}`.trim() || undefined;
    }
    if (Object.keys(authUpdate).length > 0) {
      await admin.auth().updateUser(uid, authUpdate);
    }

    // Update Firestore
    const firestoreUpdate = {};
    if (firstName) firestoreUpdate.firstName = firstName;
    if (lastName) firestoreUpdate.lastName = lastName;
    if (email) firestoreUpdate.email = email;
    if (Object.keys(firestoreUpdate).length > 0) {
      await admin.firestore().collection('users').doc(uid).set(firestoreUpdate, { merge: true });
    }

    res.status(200).json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Removed duplicate /profile route to avoid confusion
// Profile fetching should be handled by /auth/profile

module.exports = router;