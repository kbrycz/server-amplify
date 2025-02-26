const admin = require('firebase-admin');

// Check if any Firebase apps are already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // Adjust this based on your setup
    projectId: 'amplify-dev-6b1c7' // Added for consistency with your project
  });
}

module.exports = admin;