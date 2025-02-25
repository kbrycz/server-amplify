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
    req.user = decodedToken; // Attach decoded user data to the request
    next();
  } catch (error) {
    return res.status(401).send('Unauthorized: Invalid token');
  }
};

// Protected route to get user data
router.get('/user', verifyToken, (req, res) => {
  res.json({ user: req.user }); // Returns user data from the verified token
});

// Example protected route
router.get('/data', verifyToken, (req, res) => {
  res.json({ message: 'This is protected data', user: req.user });
});

module.exports = router;