// campaign.js
const express = require('express');
const admin = require('../../config/firebase'); // Import the initialized Firebase instance
const { verifyToken } = require('../../config/middleware'); // Import your middleware
const { logActivity } = require('../../utils/activityLogger'); // Import the activity logger
const router = express.Router();

// Initialize Firebase Admin SDK (only if not already initialized elsewhere)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

// Helper function to get counts for a campaign
async function getCampaignCounts(campaignId) {
  try {
    // Count AI videos for the campaign
    const aiVideosSnapshot = await db.collection('aiVideos')
      .where('campaignId', '==', campaignId)
      .get();
    const aiVideoCount = aiVideosSnapshot.size;

    // Count survey responses (surveyVideos) for the campaign
    const surveyVideosSnapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .get();
    const responsesCount = surveyVideosSnapshot.size;

    return { aiVideoCount, responsesCount };
  } catch (error) {
    console.error(`Error fetching counts for campaign ${campaignId}:`, error);
    return { aiVideoCount: 0, responsesCount: 0 }; // Return 0s if counts fail
  }
}

// Create a new campaign (account-specific)
router.post('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid; // Get UID from verified token
    console.log(`Received request to create a campaign for user: ${userId}`);
    const campaignData = {
      ...req.body,
      userId, // Associate campaign with the user
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };
    const campaignRef = await db.collection('campaigns').add(campaignData);
    const createdDoc = await campaignRef.get();
    const createdCampaign = { id: createdDoc.id, ...createdDoc.data() };
    console.log(`Campaign created successfully with ID: ${createdDoc.id} for user: ${userId}`);
    await logActivity(userId, 'campaign_created', `Created campaign: ${createdCampaign.name || 'Untitled'}`, { campaignId: createdDoc.id });
    // Add counts to the response (new campaign will have 0 initially)
    const counts = { aiVideoCount: 0, responsesCount: 0 };
    res.status(201).json({ ...createdCampaign, ...counts });
  } catch (error) {
    console.error(`Error creating campaign for user: ${userId}`, error);
    res.status(500).json({ error: 'Failed to create campaign', message: error.message });
  }
});

// Read all campaigns for the authenticated user, sorted by most recent (dateModified descending)
router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`Received request to get all campaigns for user: ${userId}`);
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .orderBy('dateModified', 'desc')
      .get();
    const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
      const campaignData = { id: doc.id, ...doc.data() };
      const counts = await getCampaignCounts(doc.id);
      return { ...campaignData, ...counts };
    }));
    console.log(`Retrieved ${campaigns.length} campaigns for user: ${userId}`);
    res.status(200).json(campaigns);
  } catch (error) {
    console.error(`Error retrieving campaigns for user: ${userId}`, error);
    res.status(500).json({ error: 'Failed to retrieve campaigns', message: error.message });
  }
});

// UPDATED ENDPOINT: Read the most recent campaigns (up to 3) for the authenticated user
router.get('/campaigns/recent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`Received request to get recent campaigns for user: ${userId}`);
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .orderBy('dateModified', 'desc')
      .limit(3)
      .get();
    const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
      const campaignData = { id: doc.id, ...doc.data() };
      const counts = await getCampaignCounts(doc.id);
      return { ...campaignData, ...counts };
    }));
    console.log(`Found ${campaigns.length} recent campaigns for user: ${userId}`);
    res.status(200).json(campaigns);
  } catch (error) {
    console.error(`Error retrieving recent campaigns for user: ${userId}`, error);
    res.status(500).json({ error: 'Failed to retrieve recent campaigns', message: error.message });
  }
});

// Count campaigns for the authenticated user
router.get('/campaigns/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`Received request to count campaigns for user: ${userId}`);
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .get();
    const count = snapshot.size;
    console.log(`Campaign count for user ${userId}: ${count}`);
    res.status(200).json({ count });
  } catch (error) {
    console.error(`Error counting campaigns for user: ${userId}`, error);
    res.status(500).json({ error: 'Failed to count campaigns', message: error.message });
  }
});

// Read a specific campaign by ID (account-specific)
router.get('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.log(`Received request to get campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.log(`Campaign ${campaignId} not found for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.log(`User ${userId} does not own campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    const counts = await getCampaignCounts(campaignId);
    const campaignWithCounts = { id: doc.id, ...campaignData, ...counts };
    console.log(`Successfully retrieved campaign ${campaignId} for user: ${userId}`);
    res.status(200).json(campaignWithCounts);
  } catch (error) {
    console.error(`Error retrieving campaign ${req.params.id} for user: ${req.user.uid}`, error);
    res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

// Update a campaign by ID (account-specific)
router.put('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.log(`Received request to update campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.log(`Campaign ${campaignId} not found for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.log(`User ${userId} does not own campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.update({
      ...req.body,
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    });
    const updatedDoc = await campaignRef.get();
    const updatedCampaign = { id: updatedDoc.id, ...updatedDoc.data() };
    const counts = await getCampaignCounts(campaignId);
    console.log(`Campaign ${campaignId} updated successfully for user: ${userId}`);
    await logActivity(userId, 'campaign_edited', `Edited campaign: ${updatedCampaign.name || 'Untitled'}`, { campaignId: campaignId });
    res.status(200).json({ ...updatedCampaign, ...counts });
  } catch (error) {
    console.error(`Error updating campaign ${req.params.id} for user: ${req.user.uid}`, error);
    res.status(500).json({ error: 'Failed to update campaign', message: error.message });
  }
});

// Delete a campaign by ID (account-specific)
router.delete('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.log(`Received request to delete campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.log(`Campaign ${campaignId} not found for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.log(`User ${userId} does not own campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.delete();
    console.log(`Campaign ${campaignId} deleted successfully for user: ${userId}`);
    await logActivity(userId, 'campaign_deleted', `Deleted campaign: ${campaignData.name || 'Untitled'}`, { campaignId: campaignId });
    res.status(200).json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error(`Error deleting campaign ${req.params.id} for user: ${req.user.uid}`, error);
    res.status(500).json({ error: 'Failed to delete campaign', message: error.message });
  }
});

// Read a specific campaign survey by ID (no authentication, as per original)
router.get('/campaigns/survey/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    console.log(`Received request to get campaign survey ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.log(`Campaign survey ${campaignId} not found`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    const counts = await getCampaignCounts(campaignId);
    console.log(`Successfully retrieved campaign survey ${campaignId}`);
    res.status(200).json({ id: doc.id, ...campaignData, ...counts });
  } catch (error) {
    console.error(`Error retrieving campaign survey ${req.params.id}`, error);
    res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

module.exports = router;