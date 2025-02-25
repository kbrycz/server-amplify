const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    return res.status(401).send('Unauthorized: No token provided');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).send('Unauthorized: Invalid token');
  }
};

// Protected route to get user data
router.get('/user', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// Protected route for sample data
router.get('/data', verifyToken, (req, res) => {
  res.json({ message: 'This is protected data', user: req.user });
});

// Sign-up endpoint (POST /auth/signup)
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Missing email or password');
  }
  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false // Set to true if you verify elsewhere
    });
    res.status(201).json({
      message: 'User created successfully',
      uid: userRecord.uid,
      email: userRecord.email
    });
  } catch (error) {
    res.status(400).send(`Error creating user: ${error.message}`);
  }
});

module.exports = router;