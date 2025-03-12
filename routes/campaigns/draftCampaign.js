/**
 * Draft Campaign API
 *
 * This module provides endpoints for managing draft campaigns for authenticated users.
 *
 * Endpoints:
 *   POST   /drafts
 *     - Create a new draft campaign.
 *   GET    /drafts
 *     - Retrieve all draft campaigns for the authenticated user in a given namespace.
 *   GET    /drafts/count
 *     - Count the draft campaigns for the authenticated user in a given namespace.
 *   GET    /drafts/:id
 *     - Retrieve a specific draft campaign by ID (account-specific).
 *   PUT    /drafts/:id
 *     - Update a specific draft campaign (account-specific). (Note: namespaceId cannot be updated.)
 *   DELETE /drafts/:id
 *     - Delete a specific draft campaign (account-specific).
 *
 * @example
 *   // Create a draft campaign:
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{ "namespaceId": "NAMESPACE_DOC_ID", "name": "Draft Campaign", "title": "Draft Title", "description": "Some description", "category": "government", "theme": "aurora", "campaignImage": "data:image/png;base64,...", "customColors": "", "subcategory": "success_stories", "surveyQuestions": "[\"Question1\", \"Question2\"]", "hasExplainerVideo": false }' \
 *        https://yourdomain.com/campaign/drafts
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const { logActivity } = require('../../utils/activityLogger');

const router = express.Router();

// Ensure Firebase is initialized (if not already done)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

/**
 * Helper function to get the user's permission for a namespace.
 * Returns the permission string ("read/write", "readonly", or "admin") if the user is an active member;
 * otherwise returns null.
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
 * POST /drafts
 * Create a new draft campaign associated with the authenticated user.
 * Allowed fields:
 *   - namespaceId, name, title, description, category, theme, campaignImage (base64 string),
 *     customColors, subcategory, surveyQuestions (as a JSON string), hasExplainerVideo.
 * Any field related to explainer video file upload is ignored.
 */
router.post('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    console.info(`[INFO] Creating new draft campaign for user: ${userId}`);

    // Validate that namespaceId is provided.
    const { namespaceId } = req.body;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }
    // Verify the namespace exists and belongs to the user.
    const namespaceDoc = await db.collection('namespaces').doc(namespaceId).get();
    if (!namespaceDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    const nsData = namespaceDoc.data();
    if (nsData.accountId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to use this namespace' });
    }
    // Check user's permission: require "read/write" or "admin" for creating a draft.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to create a draft campaign' });
    }

    // Build draft campaign data.
    const draftData = {
      namespaceId, // Associate with this namespace.
      name: req.body.name,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      theme: req.body.theme,
      campaignImage: req.body.campaignImage, // Expected as base64 string.
      customColors: req.body.customColors,
      subcategory: req.body.subcategory,
      surveyQuestions: req.body.surveyQuestions ? JSON.parse(req.body.surveyQuestions) : [],
      hasExplainerVideo: req.body.hasExplainerVideo === true || req.body.hasExplainerVideo === 'true',
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const draftRef = await db.collection('draftCampaigns').add(draftData);
    await logActivity(userId, 'draft_campaign_created', `Created draft campaign: ${draftData.name}`, namespaceId, { draftCampaignId: draftRef.id });
    console.info(`[INFO] Draft campaign created with ID: ${draftRef.id} for user: ${userId}`);
    return res.status(201).json({ id: draftRef.id, ...draftData, userPermission: permission });
  } catch (error) {
    console.error(`[ERROR] Error creating draft campaign for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to create draft campaign', message: error.message });
  }
});

/**
 * GET /drafts
 * Retrieve all draft campaigns for the authenticated user in a given namespace,
 * sorted by last modified date (descending).
 * Expects a query parameter: namespaceId.
 * Each returned draft includes the user's permission.
 */
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    // Verify the namespace.
    const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    const nsData = nsDoc.data();
    if (nsData.accountId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to access this namespace' });
    }
    const permission = await getUserPermission(namespaceId, userEmail);
    const snapshot = await db.collection('draftCampaigns')
      .where('userId', '==', userId)
      .where('namespaceId', '==', namespaceId)
      .orderBy('dateModified', 'desc')
      .get();
    const drafts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), userPermission: permission }));
    console.info(`[INFO] Found ${drafts.length} draft campaigns for user: ${userId} in namespace: ${namespaceId}`);
    return res.status(200).json(drafts);
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve draft campaigns', message: error.message });
  }
});

/**
 * GET /drafts/count
 * Count the number of draft campaigns for the authenticated user in a given namespace.
 * Expects a query parameter: namespaceId.
 */
router.get('/drafts/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    const snapshot = await db.collection('draftCampaigns')
      .where('userId', '==', userId)
      .where('namespaceId', '==', namespaceId)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] User ${userId} has ${count} draft campaigns in namespace: ${namespaceId}`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error(`[ERROR] Error counting draft campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to count draft campaigns', message: error.message });
  }
});

/**
 * GET /drafts/:id
 * Retrieve a specific draft campaign by ID.
 * Expects a query parameter: namespaceId.
 * Only the owner can access it.
 * Returns the draft along with the user's permission.
 */
router.get('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Fetching draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId || draftData.namespaceId !== namespaceId) {
      console.warn(`[WARN] User ${userId} is not authorized to access draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    const permission = await getUserPermission(namespaceId, userEmail);
    return res.status(200).json({ id: doc.id, ...draftData, userPermission: permission });
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve draft campaign', message: error.message });
  }
});

/**
 * PUT /drafts/:id
 * Update a specific draft campaign.
 * Only the owner with "read/write" or "admin" permission can update.
 * Allowed fields: name, title, description, category, theme, campaignImage, customColors, subcategory, surveyQuestions, hasExplainerVideo.
 * Note: namespaceId cannot be updated.
 * Expects a query parameter: namespaceId.
 */
router.put('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Updating draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId || draftData.namespaceId !== namespaceId) {
      console.warn(`[WARN] User ${userId} is not authorized to update draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    // Check permission for update.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to update draft campaign' });
    }
    // Prevent updating the namespaceId.
    const { namespaceId: ignore, ...allowedFields } = req.body;
    allowedFields.dateModified = admin.firestore.FieldValue.serverTimestamp();

    await draftRef.update(allowedFields);
    await logActivity(userId, 'draft_campaign_updated', `Updated draft campaign: ${allowedFields.name || draftData.name}`, draftData.namespaceId, { draftCampaignId: req.params.id });
    console.info(`[INFO] Draft campaign ${req.params.id} updated successfully for user: ${userId}`);
    return res.status(200).json({ id: req.params.id, ...allowedFields, userPermission: permission });
  } catch (error) {
    console.error(`[ERROR] Error updating draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to update draft campaign', message: error.message });
  }
});

/**
 * DELETE /drafts/:id
 * Delete a specific draft campaign.
 * Only the owner with "admin" permission can delete.
 * Expects a query parameter: namespaceId.
 */
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    console.info(`[INFO] Deleting draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId || draftData.namespaceId !== namespaceId) {
      console.warn(`[WARN] User ${userId} is not authorized to delete draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    // Check that the user has admin permission.
    const permission = await getUserPermission(namespaceId, userEmail);
    if (permission !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions to delete draft campaign. Admin access required.' });
    }
    
    await draftRef.delete();
    await logActivity(userId, 'draft_campaign_deleted', `Deleted draft campaign: ${draftData.name}`, draftData.namespaceId, { draftCampaignId: req.params.id });
    console.info(`[INFO] Draft campaign ${req.params.id} deleted successfully for user: ${userId}`);
    return res.status(200).json({ message: 'Draft campaign deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to delete draft campaign', message: error.message });
  }
});

module.exports = router;