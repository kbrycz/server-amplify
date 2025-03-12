/**
 * Draft Campaign API
 *
 * This module provides endpoints for managing draft campaigns for authenticated users.
 *
 * Endpoints:
 *   POST   /drafts
 *     - Create a new draft campaign.
 *   GET    /drafts
 *     - Retrieve all draft campaigns for the authenticated user.
 *   GET    /drafts/count
 *     - Count the draft campaigns for the authenticated user.
 *   GET    /drafts/:id
 *     - Retrieve a specific draft campaign by ID (account-specific).
 *   PUT    /drafts/:id
 *     - Update a specific draft campaign (account-specific).
 *   DELETE /drafts/:id
 *     - Delete a specific draft campaign (account-specific).
 *
 * @example
 *   // Create a draft campaign:
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{ "name": "Draft Campaign", "title": "Draft Title", "description": "Some description", "category": "government", "theme": "aurora", "campaignImage": "data:image/png;base64,...", "customColors": "", "subcategory": "success_stories", "surveyQuestions": "[\"Question1\", \"Question2\"]", "hasExplainerVideo": false }' \
 *        https://yourdomain.com/campaign/drafts
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();

// Ensure Firebase is initialized (if not already done)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

/**
 * POST /drafts
 * Create a new draft campaign associated with the authenticated user.
 * Allowed fields:
 *   - name, title, description, category, theme, campaignImage (base64 string),
 *     customColors, subcategory, surveyQuestions (as a JSON string), hasExplainerVideo.
 * Any field related to explainer video file upload is ignored.
 */
router.post('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Creating new draft campaign for user: ${userId}`);

    // Build draftData using only allowed fields.
    const draftData = {
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
      // Explicitly ignore any explainerVideo field (no file upload allowed for drafts)
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const draftRef = await db.collection('draftCampaigns').add(draftData);
    console.info(`[INFO] Draft campaign created with ID: ${draftRef.id} for user: ${userId}`);
    return res.status(201).json({ id: draftRef.id, ...draftData });
  } catch (error) {
    console.error(`[ERROR] Error creating draft campaign for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to create draft campaign', message: error.message });
  }
});

/**
 * GET /drafts
 * Retrieve all draft campaigns for the authenticated user, sorted by last modified date (descending).
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/drafts
 */
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Fetching draft campaigns for user: ${userId}`);
    const snapshot = await db.collection('draftCampaigns')
      .where('userId', '==', userId)
      .orderBy('dateModified', 'desc')
      .get();
    const drafts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.info(`[INFO] Found ${drafts.length} draft campaigns for user: ${userId}`);
    return res.status(200).json(drafts);
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve draft campaigns', message: error.message });
  }
});

/**
 * GET /drafts/count
 * Count the number of draft campaigns for the authenticated user.
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/drafts/count
 */
router.get('/drafts/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Counting draft campaigns for user: ${userId}`);
    const snapshot = await db.collection('draftCampaigns')
      .where('userId', '==', userId)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] User ${userId} has ${count} draft campaigns`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error(`[ERROR] Error counting draft campaigns for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to count draft campaigns', message: error.message });
  }
});

/**
 * GET /drafts/:id
 * Retrieve a specific draft campaign by ID. Only the owner can access it.
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/drafts/abc123
 */
router.get('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Fetching draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to access draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    return res.status(200).json({ id: doc.id, ...draftData });
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve draft campaign', message: error.message });
  }
});

/**
 * PUT /drafts/:id
 * Update a specific draft campaign. Only the owner can update it.
 * Allowed fields for update are the same as for creation:
 *   - name, title, description, category, theme, campaignImage, customColors, subcategory, surveyQuestions, hasExplainerVideo.
 * Any fields related to explainer video file upload are ignored.
 *
 * @example
 *   curl -X PUT -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{ "name": "Updated Draft Campaign", "title": "Updated Title", ... }' https://yourdomain.com/campaign/drafts/abc123
 */
router.put('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Updating draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to update draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    // Only update allowed fields. Ignore any explainerVideo field.
    const allowedFields = {
      name: req.body.name,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      theme: req.body.theme,
      campaignImage: req.body.campaignImage,
      customColors: req.body.customColors,
      subcategory: req.body.subcategory,
      surveyQuestions: req.body.surveyQuestions ? JSON.parse(req.body.surveyQuestions) : undefined,
      hasExplainerVideo: req.body.hasExplainerVideo
    };

    // Remove undefined values.
    Object.keys(allowedFields).forEach(key => {
      if (allowedFields[key] === undefined) delete allowedFields[key];
    });

    allowedFields.dateModified = admin.firestore.FieldValue.serverTimestamp();

    await draftRef.update(allowedFields);
    console.info(`[INFO] Draft campaign ${req.params.id} updated successfully for user: ${userId}`);
    return res.status(200).json({ id: req.params.id, ...allowedFields });
  } catch (error) {
    console.error(`[ERROR] Error updating draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to update draft campaign', message: error.message });
  }
});

/**
 * DELETE /drafts/:id
 * Delete a specific draft campaign. Only the owner can delete it.
 *
 * @example
 *   curl -X DELETE -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/campaign/drafts/abc123
 */
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.info(`[INFO] Deleting draft campaign with ID: ${req.params.id} for user: ${userId}`);
    const draftRef = db.collection('draftCampaigns').doc(req.params.id);
    const doc = await draftRef.get();
    if (!doc.exists) {
      console.warn(`[WARN] Draft campaign not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Draft campaign not found' });
    }
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to delete draft campaign ${req.params.id}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this draft campaign' });
    }
    await draftRef.delete();
    console.info(`[INFO] Draft campaign ${req.params.id} deleted successfully for user: ${userId}`);
    return res.status(200).json({ message: 'Draft campaign deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting draft campaign ${req.params.id} for user ${req.user.uid}:`, error);
    return res.status(500).json({ error: 'Failed to delete draft campaign', message: error.message });
  }
});

module.exports = router;