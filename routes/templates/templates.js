/**
 * Templates API
 *
 * This module provides endpoints for creating, retrieving, updating, and deleting templates
 * in a namespace-based sharing model.
 *
 * The "templates" collection documents have fields:
 *   - namespaceId
 *   - createdBy, lastUpdatedBy
 *   - name, captionType, captionPosition, outtroBackgroundColors, etc.
 *   - createdAt, lastModified
 *
 * Endpoints:
 *   POST   /templates              - Create a new template (requires "read/write" or "admin").
 *   GET    /templates              - Get all templates in a namespace (any membership).
 *   GET    /templates/count        - Count templates in a namespace (any membership).
 *   GET    /templates/:id          - Get a specific template (any membership).
 *   PUT    /templates/:id          - Update a template (requires "read/write" or "admin").
 *   DELETE /templates/:id          - Delete a template (requires "admin").
 *
 * All endpoints are protected by token verification.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const { logActivity } = require('../../utils/activityLogger');

const router = express.Router();
const db = admin.firestore();

// Helper: check user’s permission in a namespace
async function getUserPermission(namespaceId, userEmail) {
  if (!namespaceId || !userEmail) return null;
  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return null;
  
  const nsData = nsDoc.data();
  if (!nsData.members) return null;

  const member = nsData.members.find(m =>
    m.email.toLowerCase() === userEmail.toLowerCase() && m.status === 'active'
  );
  return member ? member.permission : null;
}

// Collection reference
const templatesCollection = db.collection('templates');

/**
 * POST /templates
 * Create a new template in a given namespace.
 * Requires "read/write" or "admin".
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
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

    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to create a template' });
    }

    const templateData = {
      namespaceId,
      createdBy: userId,
      lastUpdatedBy: userId,
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

    // Log activity
    await logActivity(userId, 'template_created', `Created template: ${name}`, namespaceId, { templateId: docRef.id });

    return res.status(201).json({ id: createdDoc.id, ...createdDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error creating template:', error);
    return res.status(500).json({ error: 'Failed to create template', message: error.message });
  }
});

/**
 * GET /templates
 * Retrieve all templates for the specified namespace.
 * Any user with membership (readonly/read/write/admin) can read.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }

    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to read templates in this namespace' });
    }

    const snapshot = await templatesCollection
      .where('namespaceId', '==', namespaceId)
      .orderBy('createdAt', 'desc')
      .get();
    const templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(templates);
  } catch (error) {
    console.error('[ERROR] Error fetching templates:', error);
    return res.status(500).json({ error: 'Failed to fetch templates', message: error.message });
  }
});

/**
 * GET /templates/count
 * Count how many templates are in a given namespace.
 * Any user with membership can do this.
 */
router.get('/count', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }

    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to count templates in this namespace' });
    }

    const snapshot = await templatesCollection
      .where('namespaceId', '==', namespaceId)
      .get();
    return res.status(200).json({ count: snapshot.size });
  } catch (error) {
    console.error('[ERROR] Error counting templates:', error);
    return res.status(500).json({ error: 'Failed to count templates', message: error.message });
  }
});

/**
 * GET /templates/:id
 * Retrieve a specific template by ID.
 * Any user with membership can read.
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const id = req.params.id;

    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    // Check user membership in that namespace
    const permission = await getUserPermission(data.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to read this template' });
    }

    return res.status(200).json({ id: doc.id, ...data });
  } catch (error) {
    console.error('[ERROR] Error fetching template:', error);
    return res.status(500).json({ error: 'Failed to fetch template', message: error.message });
  }
});

/**
 * PUT /templates/:id
 * Update an existing template.
 * Requires "read/write" or "admin".
 * The namespaceId cannot be updated.
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const id = req.params.id;

    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    // Check if user has "read/write" or "admin" in that namespace
    const permission = await getUserPermission(data.namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to update this template' });
    }

    // Prepare update data and do not allow namespaceId update.
    const {
      namespaceId, // ignore this
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

    const updateData = {
      lastModified: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: userId
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

    // Log activity
    await logActivity(userId, 'template_updated', `Updated template: ${updateData.name || data.name}`, data.namespaceId, { templateId: id });

    return res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error updating template:', error);
    return res.status(500).json({ error: 'Failed to update template', message: error.message });
  }
});

/**
 * DELETE /templates/:id
 * Delete a template.
 * Requires "admin" permission in the template's namespace.
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const id = req.params.id;

    const docRef = templatesCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = doc.data();
    // Must be admin in that namespace
    const permission = await getUserPermission(data.namespaceId, userEmail);
    if (permission !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions to delete template. Admin required.' });
    }

    await docRef.delete();
    // Log activity
    await logActivity(userId, 'template_deleted', `Deleted template: ${data.name}`, data.namespaceId, { templateId: id });

    return res.status(200).json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('[ERROR] Error deleting template:', error);
    return res.status(500).json({ error: 'Failed to delete template', message: error.message });
  }
});

module.exports = router;