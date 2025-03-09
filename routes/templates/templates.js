/**
 * Templates API
 *
 * This module provides endpoints for creating, retrieving, updating, and deleting templates.
 *
 * The "templates" collection documents have the following fields:
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
 *   - lastModified
 *
 * Endpoints:
 *   POST   /templates         - Create a new template.
 *   GET    /templates         - Get all templates for the authenticated user.
 *   GET    /templates/count   - Get the total count of templates for the authenticated user.
 *   GET    /templates/:id     - Get a specific template by ID (account-specific).
 *   PUT    /templates/:id     - Update an existing template (account-specific).
 *   DELETE /templates/:id     - Delete a template (account-specific).
 *
 * All endpoints are protected by token verification.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();
const db = admin.firestore();

// Collection reference
const templatesCollection = db.collection('templates');

/**
 * Create a new template.
 */
router.post('/', verifyToken, async (req, res) => {
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

    const templateData = {
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
      lastModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await templatesCollection.add(templateData);
    const createdDoc = await docRef.get();

    res.status(201).json({ id: createdDoc.id, ...createdDoc.data() });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template', message: error.message });
  }
});

/**
 * Get all templates for the authenticated user.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await templatesCollection
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates', message: error.message });
  }
});

/**
 * Get the total count of templates for the authenticated user.
 */
router.get('/count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await templatesCollection
      .where('userId', '==', userId)
      .get();
    const count = snapshot.size;
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting templates:', error);
    res.status(500).json({ error: 'Failed to count templates', message: error.message });
  }
});

/**
 * Get a specific template by ID.
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const id = req.params.id;
    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    if (data.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this template' });
    }

    res.status(200).json({ id: doc.id, ...data });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template', message: error.message });
  }
});

/**
 * Update an existing template.
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const id = req.params.id;
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

    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    if (data.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this template' });
    }

    // Prepare update data with provided fields and update the lastModified timestamp.
    const updateData = {
      lastModified: admin.firestore.FieldValue.serverTimestamp(),
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

    await docRef.update(updateData);
    const updatedDoc = await docRef.get();

    res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template', message: error.message });
  }
});

/**
 * Delete a template.
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const id = req.params.id;
    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    if (data.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this template' });
    }

    await docRef.delete();
    res.status(200).json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template', message: error.message });
  }
});

module.exports = router;