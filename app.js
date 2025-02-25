const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const authRoutes = require('./auth'); // Import auth routes

const app = express();

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  // For local testing: Set GOOGLE_APPLICATION_CREDENTIALS env variable
  // For App Engine: Uses default credentials automatically
});

// Middleware
app.use(cors()); // Allows cross-origin requests
app.use(express.json()); // Parses JSON requests

// Mount authentication routes
app.use('/auth', authRoutes); // All auth-related endpoints live under /auth

// Example non-auth route
app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});