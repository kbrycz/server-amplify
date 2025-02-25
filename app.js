const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  // Note: For local testing, set the GOOGLE_APPLICATION_CREDENTIALS environment variable
  // to the path of your service account key JSON file. On Google App Engine, this uses
  // the default credentials automatically.
});

// Middleware
app.use(cors()); // Allows cross-origin requests from your Next.js app
app.use(express.json()); // Parses incoming JSON requests

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
app.get('/api/user', verifyToken, (req, res) => {
  res.json({ user: req.user }); // Returns user data from the verified token
});

// Example protected route
app.get('/api/data', verifyToken, (req, res) => {
  res.json({ message: 'This is protected data', user: req.user });
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});