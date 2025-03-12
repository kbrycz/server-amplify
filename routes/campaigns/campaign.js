/**
 * Campaign API
 *
 * This module provides endpoints for managing campaigns for authenticated users.
 *
 * Endpoints:
 *   POST   /campaigns
 *     - Create a new campaign (expects JSON payload).
 *   GET    /campaigns
 *     - Retrieve all campaigns for the authenticated user.
 *   GET    /campaigns/recent
 *     - Retrieve up to 3 most recent campaigns.
 *   GET    /campaigns/count
 *     - Retrieve the total count of campaigns for the authenticated user.
 *   GET    /campaigns/:id
 *     - Retrieve a specific campaign by its ID (account-specific).
 *   PUT    /campaigns/:id
 *     - Update a specific campaign (account-specific).
 *   DELETE /campaigns/:id
 *     - Delete a specific campaign (account-specific).
 *   GET    /campaigns/survey/:id
 *     - Retrieve survey data for a campaign (public endpoint).
 *   GET    /campaigns/:id/explainer-upload-url
 *     - Generate a signed URL for direct upload of an explainer video.
 *
 * @example
 *   // Create a campaign (step 1):
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"name": "Campaign Name", "title": "Campaign Title", "description": "Description", "category": "government", "theme": "aurora", "campaignImage": "data:image/png;base64,...", "customColors": "", "subcategory": "success_stories", "surveyQuestions": "[\"Q1\",\"Q2\"]", "hasExplainerVideo": true }' \
 *        https://yourdomain.com/campaign/campaigns
 *
 *   // Get a signed URL for the explainer video upload (step 2):
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/campaigns/<campaignId>/explainer-upload-url
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const { logActivity } = require('../../utils/activityLogger');

const router = express.Router();

// Ensure Firebase is initialized.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

/**
 * Helper function to get campaign counts.
 * Returns the count of AI videos (survey videos with isVideoEnhanced true)
 * and survey responses associated with a campaign.
 *
 * @param {string} campaignId - The campaign ID.
 * @returns {Promise<{aiVideoCount: number, responsesCount: number}>}
 */
async function getCampaignCounts(campaignId) {
  try {
    // Count AI videos using surveyVideos where isVideoEnhanced is true.
    const aiVideoSnapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .where('isVideoEnhanced', '==', true)
      .get();
    const aiVideoCount = aiVideoSnapshot.size;

    // Count all survey videos for responses count.
    const surveyVideosSnapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .get();
    const responsesCount = surveyVideosSnapshot.size;

    return { aiVideoCount, responsesCount };
  } catch (error) {
    console.error(`[ERROR] Failed to get counts for campaign ${campaignId}:`, error);
    return { aiVideoCount: 0, responsesCount: 0 };
  }
}

/**
 * POST /campaigns
 * Create a new campaign associated with the authenticated user.
 *
 * Expects a JSON payload with fields:
 *   - name, title, description, category, theme, campaignImage (base64 string),
 *     customColors, subcategory, surveyQuestions (as a JSON string), hasExplainerVideo,
 *     and optionally an explainerVideo field (for small videos, if applicable).
 *
 * If the provided explainerVideo string is very large (over ~1MB), it is ignored so that
 * the client must use the separate signed URL endpoint to upload the video.
 *
 * @example
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"name": "Campaign Name", "title": "Campaign Title", "description": "Description", "category": "government", "theme": "aurora", "campaignImage": "data:image/png;base64,...", "customColors": "", "subcategory": "success_stories", "surveyQuestions": "[\"Q1\",\"Q2\"]", "hasExplainerVideo": true }' \
 *        https://yourdomain.com/campaign/campaigns
 */
router.post('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Creating new campaign for user: ${userId}`);

    // Retrieve the explainerVideo field from the payload.
    let explainerVideo = req.body.explainerVideo || '';
    // If the explainerVideo string is larger than ~1MB, ignore it.
    if (explainerVideo.length > 1000000) {
      console.info('[INFO] Explainer video is too large to include in the payload; ignoring.');
      explainerVideo = '';
    }

    // Build campaignData from the request body.
    let campaignData = {
      name: req.body.name,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      theme: req.body.theme,
      campaignImage: req.body.campaignImage, // base64 image string
      customColors: req.body.customColors,
      subcategory: req.body.subcategory,
      surveyQuestions: req.body.surveyQuestions ? JSON.parse(req.body.surveyQuestions) : [],
      hasExplainerVideo: req.body.hasExplainerVideo === true || req.body.hasExplainerVideo === 'true',
      explainerVideo, // Either a small data URL or empty string
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const campaignRef = await db.collection('campaigns').add(campaignData);
    const campaignId = campaignRef.id;
    await logActivity(userId, 'campaign_created', `Created campaign: ${campaignData.name || 'Untitled'}`, { campaignId });
    const counts = { aiVideoCount: 0, responsesCount: 0 };
    const createdDoc = await campaignRef.get();
    const createdCampaign = { id: createdDoc.id, ...createdDoc.data() };
    console.info(`[INFO] Campaign created with ID: ${createdDoc.id} for user: ${userId}`);
    return res.status(201).json({ ...createdCampaign, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error creating campaign for user ${req.user.uid}:`, error.message);
    return res.status(500).json({ error: 'Failed to create campaign', message: error.message });
  }
});

/**
 * GET /campaigns
 * Retrieve all campaigns for the authenticated user, sorted by last modified date (descending).
 */
router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Retrieving all campaigns for user: ${userId}`);
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .orderBy('dateModified', 'desc')
      .get();
    const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
      const campaignData = { id: doc.id, ...doc.data() };
      const counts = await getCampaignCounts(doc.id);
      return { ...campaignData, ...counts };
    }));
    console.info(`[INFO] Retrieved ${campaigns.length} campaigns for user: ${userId}`);
    return res.status(200).json(campaigns);
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/recent
 * Retrieve up to 3 most recent campaigns for the authenticated user.
 */
router.get('/campaigns/recent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Retrieving recent campaigns for user: ${userId}`);
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
    console.info(`[INFO] Found ${campaigns.length} recent campaigns for user: ${userId}`);
    return res.status(200).json(campaigns);
  } catch (error) {
    console.error(`[ERROR] Error retrieving recent campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve recent campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/count
 * Count the total number of campaigns for the authenticated user.
 */
router.get('/campaigns/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Counting campaigns for user: ${userId}`);
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] User ${userId} has ${count} campaigns`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error(`[ERROR] Error counting campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to count campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/:id
 * Retrieve a specific campaign by its ID. Only the owner can access this campaign.
 */
router.get('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.info(`[INFO] Retrieving campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Campaign ${campaignId} not found for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to access campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    const counts = await getCampaignCounts(campaignId);
    console.info(`[INFO] Successfully retrieved campaign ${campaignId} for user: ${userId}`);
    return res.status(200).json({ id: doc.id, ...campaignData, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

/**
 * PUT /campaigns/:id
 * Update a specific campaign. Only the owner can update their campaign.
 */
router.put('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.info(`[INFO] Updating campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Campaign ${campaignId} not found for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to update campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.update({
      ...req.body,
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    });
    const updatedDoc = await campaignRef.get();
    const updatedCampaign = { id: updatedDoc.id, ...updatedDoc.data() };
    const counts = await getCampaignCounts(campaignId);
    console.info(`[INFO] Campaign ${campaignId} updated successfully for user: ${userId}`);
    await logActivity(userId, 'campaign_edited', `Edited campaign: ${updatedCampaign.name || 'Untitled'}`, { campaignId });
    return res.status(200).json({ ...updatedCampaign, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error updating campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to update campaign', message: error.message });
  }
});

/**
 * DELETE /campaigns/:id
 * Delete a specific campaign. Only the owner can delete their campaign.
 */
router.delete('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.info(`[INFO] Deleting campaign ${campaignId} for user: ${userId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Campaign ${campaignId} not found for deletion for user: ${userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to delete campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await campaignRef.delete();
    console.info(`[INFO] Campaign ${campaignId} deleted successfully for user: ${userId}`);
    await logActivity(userId, 'campaign_deleted', `Deleted campaign: ${campaignData.name || 'Untitled'}`, { campaignId });
    return res.status(200).json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to delete campaign', message: error.message });
  }
});

/**
 * GET /campaigns/survey/:id
 * Retrieve survey information for a specific campaign.
 * This endpoint does not require authentication.
 */
router.get('/campaigns/survey/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    console.info(`[INFO] Retrieving survey data for campaign: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Campaign survey ${campaignId} not found`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    const counts = await getCampaignCounts(campaignId);
    console.info(`[INFO] Successfully retrieved survey data for campaign: ${campaignId}`);
    return res.status(200).json({ id: doc.id, ...campaignData, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaign survey ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

/**
 * GET /campaigns/:id/explainer-upload-url
 * Generate a signed URL for uploading an explainer video directly to Cloud Storage.
 * This allows the client to bypass the request size limit by uploading the file directly.
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/campaigns/<campaignId>/explainer-upload-url
 */
router.get('/campaigns/:id/explainer-upload-url', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    console.info(`[INFO] Generating explainer upload URL for campaign ${campaignId} and user ${userId}`);
    
    // Add additional logging for debugging
    console.info(`[DEBUG] Fetching campaign document for ID: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign ${campaignId} not found`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const campaignData = campaignDoc.data();
    console.info(`[DEBUG] Retrieved campaign data:`, campaignData);
    
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to access campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    
    console.info('[DEBUG] Retrieving Storage bucket');
    const bucket = admin.storage().bucket();
    const fileName = `campaigns/${campaignId}/explainerVideo.mp4`;
    console.info(`[DEBUG] File path for explainer video: ${fileName}`);
    const file = bucket.file(fileName);
    
    console.info('[DEBUG] Generating signed URL with write permissions with options:', {
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'video/mp4'
    });
    
    const [uploadUrl] = await file.getSignedUrl({
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // Expires in 15 minutes
      contentType: 'video/mp4'
    });
    
    console.info(`[INFO] Successfully generated explainer upload URL for campaign ${campaignId}: ${uploadUrl}`);
    return res.status(200).json({ uploadUrl, filePath: fileName });
  } catch (error) {
    console.error(`[ERROR] Error generating explainer upload URL for campaign ${req.params.id}:`, error.message);
    return res.status(500).json({ error: 'Failed to generate upload URL', message: error.message });
  }
});

module.exports = router;