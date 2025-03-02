const express = require('express');
const admin = require('../firebase'); // Import the initialized Firebase instance
const { verifyToken } = require('../middleware');

const router = express.Router();

// Create user profile after signup
router.post('/signup', verifyToken, async (req, res) => {
  console.log('Received signup request with body:', req.body);
  const { firstName, lastName } = req.body;
  const uid = req.user.uid;
  const email = req.user.email;

  console.log('Creating profile for UID:', uid); // Debug UID
  if (!firstName || !lastName || !firstName.trim() || !lastName.trim()) {
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
      credits: 10  // New field with initial 10 credits
    });
    console.log('Firestore profile created successfully for UID:', uid);
    res.status(201).json({
      message: 'Profile created successfully',
      uid,
      email
    });
  } catch (error) {
    console.error('Error creating Firestore profile:', error);
    res.status(500).send(`Failed to create profile: ${error.message}`);
  }
});

// Fetch user profile
router.get('/profile', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  console.log('Fetching profile for UID:', uid); // Debug UID
  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    console.log('Document exists:', userDoc.exists); // Debug document existence
    if (!userDoc.exists) {
      return res.status(404).send('Profile not found');
    }
    res.status(200).json(userDoc.data());
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).send(`Failed to fetch profile: ${error.message}`);
  }
});

// Existing routes
router.get('/user', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

router.get('/data', verifyToken, (req, res) => {
  res.json({ message: 'This is protected data', user: req.user });
});

router.delete('/delete-account', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    await admin.auth().deleteUser(uid);
    await admin.firestore().collection('users').doc(uid).delete();
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: `Error deleting account: ${error.message}` });
  }
});

module.exports = router;