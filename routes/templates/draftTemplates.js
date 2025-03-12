/**
 * Draft Templates API
 *
 * This module provides endpoints for managing draft templates for authenticated users.
 *
 * Each draft template document includes the following fields:
 *   - userId
 *   - namespaceId
 *   - name
 *   - captionType
 *   - captionPosition
 *   - outtroBackgroundColors
 *   - outtroFontColor
 *   - image
 *   - outroText
 *   - outroTheme
 *   - showOutro
 *   - theme
 *   - createdAt
 *   - dateModified
 *
 * Endpoints:
 *   POST   /drafts         - Create a new draft template.
 *   GET    /drafts         - Retrieve all draft templates for the authenticated user in a given namespace.
 *   GET    /drafts/count   - Count the draft templates for the authenticated user in a given namespace.
 *   GET    /drafts/:id     - Retrieve a specific draft template by ID (account-specific).
 *   PUT    /drafts/:id     - Update a specific draft template (account-specific).
 *   DELETE /drafts/:id     - Delete a specific draft template (account-specific).
 *
 * All endpoints are protected by token verification.
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
 * POST /drafts
 * Create a new draft template associated with the authenticated user.
 * Requires a valid namespaceId in the request body.
 */
router.post('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const {
      namespaceId,
      name,
      captionType,
      captionPosition,
      outtroBackgroundColors,
      outtroFontColor,
      image,
      outroText,
      outroTheme,
      showOutro,
      theme
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }
    
    // Verify the namespace exists and belongs to the user.
    const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    const nsData = nsDoc.data();
    if (nsData.accountId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to use this namespace' });
    }
    
    const draftData = {
      userId,
      namespaceId,
      name,
      captionType: captionType || '',
      captionPosition: captionPosition || '',
      outtroBackgroundColors: outtroBackgroundColors || '',
      outtroFontColor: outtroFontColor || '',
      image: image || '',
      outroText: outroText || '',
      outroTheme: outroTheme || '',
      showOutro: showOutro !== undefined ? showOutro : false,
      theme: theme || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const draftRef = await db.collection('draftTemplates').add(draftData);
    
    // Log activity that a draft template was created.
    await logActivity(userId, 'draft_template_created', `Created draft template: ${name}`, namespaceId, { draftTemplateId: draftRef.id });
    
    res.status(201).json({ id: draftRef.id, ...draftData });
  } catch (error) {
    console.error(`[ERROR] Error creating draft template for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to create draft template', message: error.message });
  }
});

/**
 * GET /drafts
 * Retrieve all draft templates for the authenticated user in a given namespace,
 * sorted by last modified date (descending).
 * Expects a query parameter: namespaceId.
 */
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    const snapshot = await db.collection('draftTemplates')
      .where('userId', '==', userId)
      .where('namespaceId', '==', namespaceId)
      .orderBy('dateModified', 'desc')
      .get();
    const drafts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(drafts);
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft templates for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to retrieve draft templates', message: error.message });
  }
});

/**
 * GET /drafts/count
 * Count the number of draft templates for the authenticated user in a given namespace.
 * Expects a query parameter: namespaceId.
 */
router.get('/drafts/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    const snapshot = await db.collection('draftTemplates')
      .where('userId', '==', userId)
      .where('namespaceId', '==', namespaceId)
      .get();
    const count = snapshot.size;
    res.status(200).json({ count });
  } catch (error) {
    console.error(`[ERROR] Error counting draft templates for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to count draft templates', message: error.message });
  }
});

/**
 * GET /drafts/:id
 * Retrieve a specific draft template by ID. Only the owner can access it.
 */
router.get('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftTemplates').doc(req.params.id);
    const doc = await draftRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }
    
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this draft template' });
    }
    
    res.status(200).json({ id: doc.id, ...draftData });
  } catch (error) {
    console.error(`[ERROR] Error retrieving draft template ${req.params.id} for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to retrieve draft template', message: error.message });
  }
});

/**
 * PUT /drafts/:id
 * Update a specific draft template. Only the owner can update it.
 */
router.put('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftTemplates').doc(req.params.id);
    const doc = await draftRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }
    
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this draft template' });
    }
    
    // Prepare update data with provided fields and update the dateModified timestamp.
    const updateData = {
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (req.body.captionType !== undefined) updateData.captionType = req.body.captionType;
    if (req.body.captionPosition !== undefined) updateData.captionPosition = req.body.captionPosition;
    if (req.body.outtroBackgroundColors !== undefined) updateData.outtroBackgroundColors = req.body.outtroBackgroundColors;
    if (req.body.outtroFontColor !== undefined) updateData.outtroFontColor = req.body.outtroFontColor;
    if (req.body.image !== undefined) updateData.image = req.body.image;
    if (req.body.outroText !== undefined) updateData.outroText = req.body.outroText;
    if (req.body.outroTheme !== undefined) updateData.outroTheme = req.body.outroTheme;
    if (req.body.showOutro !== undefined) updateData.showOutro = req.body.showOutro;
    if (req.body.theme !== undefined) updateData.theme = req.body.theme;

    await draftRef.update(updateData);
    const updatedDoc = await draftRef.get();
    
    res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error(`[ERROR] Error updating draft template ${req.params.id} for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to update draft template', message: error.message });
  }
});

/**
 * DELETE /drafts/:id
 * Delete a specific draft template. Only the owner can delete it.
 */
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const draftRef = db.collection('draftTemplates').doc(req.params.id);
    const doc = await draftRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }
    
    const draftData = doc.data();
    if (draftData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this draft template' });
    }
    
    await draftRef.delete();
    res.status(200).json({ message: 'Draft template deleted successfully' });
  } catch (error) {
    console.error(`[ERROR] Error deleting draft template ${req.params.id} for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to delete draft template', message: error.message });
  }
});

module.exports = router;