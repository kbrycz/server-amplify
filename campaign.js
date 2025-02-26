const express = require('express');
const admin = require('./firebase'); // Import the initialized Firebase instance
const { verifyToken } = require('./middleware'); // Import your middleware
const router = express.Router();

// Initialize Firebase Admin SDK (only if not already initialized elsewhere)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

// Create a new campaign (account-specific)
router.post('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid; // Get UID from verified token
    const campaignData = {
      ...req.body,
      userId, // Associate campaign with the user
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };
    const campaignRef = await db.collection('campaigns').add(campaignData);
    res.status(201).json({ id: campaignRef.id, ...campaignData });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign', message: error.message });
  }
});

// Read all campaigns for the authenticated user
router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .get();
    const campaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(campaigns);
  } catch (error) {
    console.error('Error retrieving campaigns:', error);
    res.status(500).json({ error: 'Failed to retrieve campaigns', message: error.message });
  }
});

// Read a specific campaign by ID (account-specific)
router.get('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignRef = db.collection('campaigns').doc(req.params.id);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    res.status(200).json({ id: doc.id, ...campaignData });
  } catch (error) {
    console.error('Error retrieving campaign:', error);
    res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

// Update a campaign by ID (account-specific)
router.put('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignRef = db.collection('campaigns').doc(req.params.id);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.update({
      ...req.body,
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ id: req.params.id, ...req.body });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Failed to update campaign', message: error.message });
  }
});

// Delete a campaign by ID (account-specific)
router.delete('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignRef = db.collection('campaigns').doc(req.params.id);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.delete();
    res.status(200).json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign', message: error.message });
  }
});

// Read a specific campaign by ID (account-specific)
router.get('/campaigns/survey/:id', async (req, res) => {
    try {
      const campaignRef = db.collection('campaigns').doc(req.params.id);
      const doc = await campaignRef.get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      const campaignData = doc.data();
      res.status(200).json({ id: doc.id, ...campaignData });
    } catch (error) {
      console.error('Error retrieving campaign:', error);
      res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
    }
  });

module.exports = router;
