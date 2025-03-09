/**
 * Draft Templates API
 *
 * This module provides endpoints for managing draft templates for authenticated users.
 *
 * Endpoints:
 *   POST   /drafts         - Create a new draft template.
 *   GET    /drafts         - Retrieve all draft templates for the authenticated user.
 *   GET    /drafts/count   - Count the draft templates for the authenticated user.
 *   GET    /drafts/:id     - Retrieve a specific draft template by ID (account-specific).
 *   PUT    /drafts/:id     - Update a specific draft template (account-specific).
 *   DELETE /drafts/:id     - Delete a specific draft template (account-specific).
 *
 * Each draft template document includes the following fields:
 *   - userId
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
 * All endpoints are protected by token verification.
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
 * Create a new draft template associated with the authenticated user.
 */
router.post('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const {
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
    
    const draftData = {
      userId,
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
    res.status(201).json({ id: draftRef.id, ...draftData });
  } catch (error) {
    console.error(`[ERROR] Error creating draft template for user ${req.user.uid}:`, error);
    res.status(500).json({ error: 'Failed to create draft template', message: error.message });
  }
});

/**
 * GET /drafts
 * Retrieve all draft templates for the authenticated user, sorted by last modified date (descending).
 */
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('draftTemplates')
      .where('userId', '==', userId)
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
 * Count the number of draft templates for the authenticated user.
 */
router.get('/drafts/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('draftTemplates')
      .where('userId', '==', userId)
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
    
    // Extract fields from request body
    const {
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
    
    // Prepare update data with provided fields and update the dateModified timestamp
    const updateData = {
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (name !== undefined) updateData.name = name;
    if (captionType !== undefined) updateData.captionType = captionType;
    if (captionPosition !== undefined) updateData.captionPosition = captionPosition;
    if (outtroBackgroundColors !== undefined) updateData.outtroBackgroundColors = outtroBackgroundColors;
    if (outtroFontColor !== undefined) updateData.outtroFontColor = outtroFontColor;
    if (image !== undefined) updateData.image = image;
    if (outroText !== undefined) updateData.outroText = outroText;
    if (outroTheme !== undefined) updateData.outroTheme = outroTheme;
    if (showOutro !== undefined) updateData.showOutro = showOutro;
    if (theme !== undefined) updateData.theme = theme;

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