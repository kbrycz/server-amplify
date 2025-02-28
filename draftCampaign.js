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

// Create a new draft campaign (account-specific)
router.post('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid; // Get UID from verified token
    const draftData = {
      ...req.body,
      userId, // Associate draft with the user
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };
    console.log('Creating new draft campaign for user:', userId);
    const draftRef = await db.collection('draftCampaigns').add(draftData);
    console.log('Draft created with ID:', draftRef.id);
    res.status(201).json({ id: draftRef.id, ...draftData });
  } catch (error) {
    console.error('Error creating draft campaign:', error);
    res.status(500).json({ error: 'Failed to create draft campaign', message: error.message });
  }
});

// Read all draft campaigns for the authenticated user
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Fetching draft campaigns for user:', userId);
    const snapshot = await db.collection('draftCampaigns')
      .where('userId', '==', userId)
      .get();
    const drafts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`Found ${drafts.length} draft campaigns for user:`, userId);
    res.status(200).json(drafts);
  } catch (error) {
    console.error('Error retrieving draft campaigns:', error);
    res.status(500).json({ error: 'Failed to retrieve draft campaigns', message: error.message });
  }
});

// Read a specific draft campaign by ID (account-specific)
router.get('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    console.log('Fetching draft campaign with ID:', req.params.id, 'for user:', userId);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.log('Draft campaign not found for ID:', req.params.id);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.log('Forbidden: User does not own this draft campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    res.status(200).json({ id: doc.id, ...draftData });
  } catch (error) {
    console.error('Error retrieving draft campaign:', error);
    res.status(500).json({ error: 'Failed to retrieve draft campaign', message: error.message });
  }
});

// Update a draft campaign by ID (account-specific)
router.put('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    console.log('Updating draft campaign with ID:', req.params.id, 'for user:', userId);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.log('Draft campaign not found for ID:', req.params.id);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.log('Forbidden: User does not own this draft campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    await draftRef.update({
      ...req.body,
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Draft campaign updated successfully:', req.params.id);
    res.status(200).json({ id: req.params.id, ...req.body });
  } catch (error) {
    console.error('Error updating draft campaign:', error);
    res.status(500).json({ error: 'Failed to update draft campaign', message: error.message });
  }
});

// Delete a draft campaign by ID (account-specific)
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    console.log('Deleting draft campaign with ID:', req.params.id, 'for user:', userId);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.log('Draft campaign not found for ID:', req.params.id);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.log('Forbidden: User does not own this draft campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    await draftRef.delete();
    console.log('Draft campaign deleted successfully:', req.params.id);
    res.status(200).json({ message: 'Draft campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting draft campaign:', error);
    res.status(500).json({ error: 'Failed to delete draft campaign', message: error.message });
  }
});

module.exports = router;