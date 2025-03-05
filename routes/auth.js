const express = require('express');
const admin = require('../firebase');
const { verifyToken } = require('../middleware');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

const planToPriceId = {
  pro: 'price_1Qz1CmGf0OHXso0nSDHCPPG4',
  premium: 'price_1Qz1FnGf0OHXso0nfdgvQH0r'
};

router.post('/update-plan', verifyToken, async (req, res) => {
  const { plan } = req.body;
  const userId = req.user.uid;

  if (plan !== 'basic') {
    return res.status(400).json({ error: 'This endpoint only supports updating to the basic plan' });
  }

  try {
    const userRef = admin.firestore().collection('users').doc(userId);
    await userRef.update({
      plan: 'basic',
      credits: 5
    });
    res.json({ success: true, plan: 'basic' });
  } catch (error) {
    console.error('Error updating plan:', error.message);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

router.post('/signup', verifyToken, async (req, res) => {
  console.log('Received signup request with body:', req.body);
  const { firstName, lastName } = req.body;
  const uid = req.user.uid;
  const email = req.user.email;

  console.log('Creating profile for UID:', uid);
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
      plan: 'basic',
      credits: 5
    });

    console.log('Firestore profile created successfully for UID:', uid);
    res.status(201).json({
      message: 'Profile created successfully',
      uid,
      email
    });
  } catch (error) {
    console.error('Error creating profile:', error);
    res.status(500).send(`Failed to create profile: ${error.message}`);
  }
});

router.get('/profile', verifyToken, async (req, res) => {
  const uid = req.user.uid;
  console.log('Fetching profile for UID:', uid);
  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).send('Profile not found');
    }
    res.status(200).json(userDoc.data());
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).send(`Failed to fetch profile: ${error.message}`);
  }
});

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