/**
 * Campaign API
 *
 * This module provides endpoints for managing campaigns for authenticated users.
 *
 * Endpoints:
 *   POST   /campaigns                         - Create a new campaign.
 *   GET    /campaigns                         - Retrieve all campaigns for the current namespace.
 *   GET    /campaigns/recent                  - Retrieve up to 3 most recent campaigns in the current namespace.
 *   GET    /campaigns/count                   - Retrieve the total count of campaigns in the current namespace.
 *   GET    /campaigns/:id                     - Retrieve a specific campaign by its ID (with user's permission and creator/updater names attached).
 *   PUT    /campaigns/:id                     - Update a specific campaign (requires "read/write" or "admin" permission).
 *   DELETE /campaigns/:id                     - Delete a specific campaign (requires "admin" permission).
 *   GET    /campaigns/survey/:id              - Retrieve survey data for a campaign (public endpoint).
 *   GET    /campaigns/:id/explainer-upload-url - Generate a signed URL for direct upload of an explainer video.
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
 * Helper function to get the current user's permission for a namespace.
 * Returns the permission string ("read/write", "readonly", or "admin")
 * if the user is an active member, otherwise null.
 *
 * @param {string} namespaceId - The namespace ID.
 * @param {string} userEmail - The user's email.
 * @returns {Promise<string|null>}
 */
async function getUserPermission(namespaceId, userEmail) {
  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return null;
  const nsData = nsDoc.data();
  if (!nsData.members) return null;
  const member = nsData.members.find(m => m.email.toLowerCase() === userEmail.toLowerCase() && m.status === 'active');
  return member ? member.permission : null;
}

/**
 * Helper function to get campaign counts.
 * Returns the count of AI-enhanced survey videos and total survey responses
 * associated with a campaign.
 *
 * @param {string} campaignId - The campaign ID.
 * @returns {Promise<{aiVideoCount: number, responsesCount: number}>}
 */
async function getCampaignCounts(campaignId) {
  try {
    const aiVideoSnapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .where('isVideoEnhanced', '==', true)
      .get();
    const aiVideoCount = aiVideoSnapshot.size;

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
 * Helper function to fetch a user's first and last name given their account ID.
 *
 * @param {string} accountId - The account ID.
 * @returns {Promise<{ firstName: string, lastName: string }|null>}
 */
async function getUserName(accountId) {
  const userDoc = await db.collection('users').doc(accountId).get();
  if (!userDoc.exists) return null;
  const data = userDoc.data();
  return { firstName: data.firstName || '', lastName: data.lastName || '' };
}

/**
 * POST /campaigns
 * Create a new campaign in the given namespace.
 * The current user must have "read/write" or "admin" permission.
 * Stores new fields "createdBy" and "lastUpdatedBy" (set to current user).
 */
router.post('/campaigns', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    console.info(`[INFO] Creating new campaign for user: ${userId}`);

    // Validate namespaceId.
    const { namespaceId } = req.body;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }
    const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    // Instead of checking accountId equality, we require that the user is a member.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to create a campaign' });
    }

    // Process explainer video.
    let explainerVideo = req.body.explainerVideo || '';
    if (explainerVideo.length > 1000000) {
      console.info('[INFO] Explainer video is too large; ignoring.');
      explainerVideo = '';
    }

    // Build campaign data.
    let campaignData = {
      name: req.body.name,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      theme: req.body.theme,
      campaignImage: req.body.campaignImage,
      customColors: req.body.customColors,
      subcategory: req.body.subcategory,
      surveyQuestions: req.body.surveyQuestions ? JSON.parse(req.body.surveyQuestions) : [],
      hasExplainerVideo: req.body.hasExplainerVideo === true || req.body.hasExplainerVideo === 'true',
      explainerVideo,
      namespaceId,
      createdBy: userId,
      lastUpdatedBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const campaignRef = await db.collection('campaigns').add(campaignData);
    const campaignId = campaignRef.id;
    await logActivity(userId, 'campaign_created', `Created campaign: ${campaignData.name || 'Untitled'}`, namespaceId, { campaignId });
    const counts = { aiVideoCount: 0, responsesCount: 0 };
    const createdDoc = await campaignRef.get();
    // Attach the current user's permission.
    const responseData = { id: createdDoc.id, ...createdDoc.data(), userPermission: permission, ...counts };
    console.info(`[INFO] Campaign created with ID: ${createdDoc.id} for user: ${userId}`);
    return res.status(201).json(responseData);
  } catch (error) {
    console.error(`[ERROR] Error creating campaign for user ${req.user.uid}:`, error.message);
    return res.status(500).json({ error: 'Failed to create campaign', message: error.message });
  }
});

/**
 * GET /campaigns
 * Retrieve all campaigns for the current namespace.
 * All users in the namespace see the same campaigns.
 * Expects a query parameter: namespaceId.
 * Returns each campaign along with the current user's permission.
 */
router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    // Verify the namespace exists.
    const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    // Get current user's permission.
    const permission = await getUserPermission(namespaceId, userEmail);
    // Query all campaigns in this namespace.
    const snapshot = await db.collection('campaigns')
      .where('namespaceId', '==', namespaceId)
      .orderBy('dateModified', 'desc')
      .get();
    const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
      const campaignData = { id: doc.id, ...doc.data() };
      const counts = await getCampaignCounts(doc.id);
      return { ...campaignData, userPermission: permission, ...counts };
    }));
    console.info(`[INFO] Retrieved ${campaigns.length} campaigns in namespace: ${namespaceId}`);
    return res.status(200).json(campaigns);
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaigns:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/recent
 * Retrieve up to 3 most recent campaigns in the current namespace.
 * Expects a query parameter: namespaceId.
 */
router.get('/campaigns/recent', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    const permission = await getUserPermission(namespaceId, userEmail);
    const snapshot = await db.collection('campaigns')
      .where('namespaceId', '==', namespaceId)
      .orderBy('dateModified', 'desc')
      .limit(3)
      .get();
    const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
      const campaignData = { id: doc.id, ...doc.data() };
      const counts = await getCampaignCounts(doc.id);
      return { ...campaignData, userPermission: permission, ...counts };
    }));
    console.info(`[INFO] Found ${campaigns.length} recent campaigns in namespace: ${namespaceId}`);
    return res.status(200).json(campaigns);
  } catch (error) {
    console.error(`[ERROR] Error retrieving recent campaigns:`, error);
    return res.status(500).json({ error: 'Failed to retrieve recent campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/count
 * Count the total number of campaigns in the current namespace.
 * Expects a query parameter: namespaceId.
 */
router.get('/campaigns/count', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    const snapshot = await db.collection('campaigns')
      .where('namespaceId', '==', namespaceId)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] There are ${count} campaigns in namespace: ${namespaceId}`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error(`[ERROR] Error counting campaigns:`, error);
    return res.status(500).json({ error: 'Failed to count campaigns', message: error.message });
  }
});

/**
 * GET /campaigns/:id
 * Retrieve a specific campaign by its ID.
 * Expects a query parameter: namespaceId.
 * Additionally, fetch the "created by" and "last updated by" names.
 * Returns the campaign along with the current user's permission.
 */
router.get('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const campaignId = req.params.id;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Retrieving campaign ${campaignId} in namespace: ${namespaceId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Campaign ${campaignId} not found`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.namespaceId !== namespaceId) {
      return res.status(403).json({ error: 'Forbidden: Campaign does not belong to this namespace' });
    }
    // Get current user's permission.
    const permission = await getUserPermission(namespaceId, userEmail);
    const counts = await getCampaignCounts(campaignId);
    
    // Fetch creator and last updater names.
    const createdByInfo = await getUserName(campaignData.createdBy);
    const lastUpdatedByInfo = await getUserName(campaignData.lastUpdatedBy);
    
    const responseData = {
      id: doc.id,
      ...campaignData,
      userPermission: permission,
      aiVideoCount: counts.aiVideoCount,
      responsesCount: counts.responsesCount,
      createdByName: createdByInfo ? `${createdByInfo.firstName} ${createdByInfo.lastName}` : 'Unknown',
      lastUpdatedByName: lastUpdatedByInfo ? `${lastUpdatedByInfo.firstName} ${lastUpdatedByInfo.lastName}` : 'Unknown'
    };
    console.info(`[INFO] Successfully retrieved campaign ${campaignId}`);
    return res.status(200).json(responseData);
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaign ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

/**
 * PUT /campaigns/:id
 * Update a specific campaign.
 * Only users with "read/write" or "admin" permission in the namespace may update.
 * The namespaceId cannot be updated.
 * Expects a query parameter: namespaceId.
 * Updates the "lastUpdatedBy" field.
 */
router.put('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const campaignId = req.params.id;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Updating campaign ${campaignId} in namespace: ${namespaceId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.namespaceId !== namespaceId) {
      return res.status(403).json({ error: 'Forbidden: Campaign does not belong to this namespace' });
    }
    // Check permission for update.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to update campaign' });
    }
    // Prevent updating the namespaceId.
    const { namespaceId: ignore, ...updateFields } = req.body;
    updateFields.lastUpdatedBy = userId;
    updateFields.dateModified = admin.firestore.FieldValue.serverTimestamp();
    await campaignRef.update(updateFields);
    await logActivity(userId, 'campaign_edited', `Edited campaign: ${updateFields.name || campaignData.name || 'Untitled'}`, namespaceId, { campaignId });
    const updatedDoc = await campaignRef.get();
    const counts = await getCampaignCounts(campaignId);
    console.info(`[INFO] Campaign ${campaignId} updated successfully`);
    return res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data(), userPermission: permission, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error updating campaign ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to update campaign', message: error.message });
  }
});

/**
 * DELETE /campaigns/:id
 * Delete a specific campaign.
 * Only users with "admin" permission in the namespace may delete.
 * Expects a query parameter: namespaceId.
 */
router.delete('/campaigns/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const campaignId = req.params.id;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Deleting campaign ${campaignId} in namespace: ${namespaceId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.namespaceId !== namespaceId) {
      return res.status(403).json({ error: 'Forbidden: Campaign does not belong to this namespace' });
    }
    // Check that the user has admin permission.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (permission !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions to delete campaign. Admin access required.' });
    }
    await campaignRef.delete();
    await logActivity(userId, 'campaign_deleted', `Deleted campaign: ${campaignData.name || 'Untitled'}`, namespaceId, { campaignId });
    console.info(`[INFO] Campaign ${campaignId} deleted successfully`);
    return res.status(200).json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting campaign ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to delete campaign', message: error.message });
  }
});

/**
 * GET /campaigns/survey/:id
 * Retrieve survey information for a specific campaign.
 * Expects a query parameter: namespaceId.
 * This endpoint does not require authentication.
 */
router.get('/campaigns/survey/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Retrieving survey data for campaign ${campaignId} in namespace: ${namespaceId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.namespaceId !== namespaceId) {
      return res.status(403).json({ error: 'Forbidden: Campaign does not belong to this namespace' });
    }
    const counts = await getCampaignCounts(campaignId);
    console.info(`[INFO] Successfully retrieved survey data for campaign ${campaignId}`);
    return res.status(200).json({ id: doc.id, ...campaignData, ...counts });
  } catch (error) {
    console.error(`[ERROR] Error retrieving campaign survey ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve campaign', message: error.message });
  }
});

/**
 * GET /campaigns/:id/explainer-upload-url
 * Generate a signed URL for uploading an explainer video directly to Cloud Storage.
 * Expects a query parameter: namespaceId.
 */
router.get('/campaigns/:id/explainer-upload-url', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const campaignId = req.params.id;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Generating explainer upload URL for campaign ${campaignId} in namespace: ${namespaceId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = doc.data();
    if (campaignData.namespaceId !== namespaceId) {
      return res.status(403).json({ error: 'Forbidden: Campaign does not belong to this namespace' });
    }
    if (campaignData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    const bucket = admin.storage().bucket();
    const fileName = `campaigns/${campaignId}/explainerVideo.mp4`;
    const file = bucket.file(fileName);
    const [uploadUrl] = await file.getSignedUrl({
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'video/mp4'
    });
    console.info(`[INFO] Successfully generated explainer upload URL for campaign ${campaignId}`);
    return res.status(200).json({ uploadUrl, filePath: fileName });
  } catch (error) {
    console.error(`[ERROR] Error generating explainer upload URL for campaign ${req.params.id}:`, error.message);
    return res.status(500).json({ error: 'Failed to generate upload URL', message: error.message });
  }
});

module.exports = router;