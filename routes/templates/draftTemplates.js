/**
 * Draft Templates API
 *
 * This module provides endpoints for managing draft templates for authenticated users.
 * Now uses a namespace-based sharing model rather than userId-only checks.
 *
 * Endpoints:
 *   POST   /drafts              - Create a new draft template (requires "read/write" or "admin").
 *   GET    /drafts              - Retrieve all draft templates in a given namespace (any membership).
 *   GET    /drafts/count        - Count draft templates in a given namespace (any membership).
 *   GET    /drafts/:id          - Retrieve a specific draft template (any membership).
 *   PUT    /drafts/:id          - Update a specific draft template (requires "read/write" or "admin").
 *   DELETE /drafts/:id          - Delete a specific draft template (requires "admin").
 *
 * Each draft template document includes:
 *   - namespaceId
 *   - createdBy (the user who created it)
 *   - lastUpdatedBy (the user who last updated it)
 *   - name, captionType, captionPosition, etc.
 *   - createdAt, dateModified
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
 * Helper: getUserPermission(namespaceId, userEmail)
 * Checks if the userEmail is in the namespace with "active" status.
 * Returns "admin", "read/write", "readonly", or null if not found.
 */
async function getUserPermission(namespaceId, userEmail) {
  if (!namespaceId || !userEmail) return null;
  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return null;
  
  const nsData = nsDoc.data();
  if (!nsData.members) return null;

  // find membership with matching email (case-insensitive)
  const member = nsData.members.find(m =>
    m.email.toLowerCase() === userEmail.toLowerCase() && m.status === 'active'
  );
  return member ? member.permission : null;
}

/**
 * POST /drafts
 * Create a new draft template in a given namespace.
 * Requires "read/write" or "admin" permission in that namespace.
 */
router.post('/drafts', verifyToken, async (req, res) => {
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

    // Check if user has "read/write" or "admin" permission in the namespace
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to create a draft template' });
    }

    const draftData = {
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
      dateModified: admin.firestore.FieldValue.serverTimestamp(),
    };

    const draftRef = await db.collection('draftTemplates').add(draftData);

    // Log creation
    await logActivity(userId, 'draft_template_created', `Created draft template: ${draftData.name}`, namespaceId, { draftTemplateId: draftRef.id });

    return res.status(201).json({ id: draftRef.id, ...draftData });
  } catch (error) {
    console.error('[ERROR] Error creating draft template:', error);
    return res.status(500).json({ error: 'Failed to create draft template', message: error.message });
  }
});

/**
 * GET /drafts
 * Retrieve all draft templates in a given namespace, sorted by dateModified.
 * Any user with membership can read (including "readonly").
 */
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;

    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }

    // Check if user is in the namespace at all (readonly, read/write, or admin)
    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to read draft templates in this namespace' });
    }

    const snapshot = await db.collection('draftTemplates')
      .where('namespaceId', '==', namespaceId)
      .orderBy('dateModified', 'desc')
      .get();

    const drafts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(drafts);
  } catch (error) {
    console.error('[ERROR] Error retrieving draft templates:', error);
    return res.status(500).json({ error: 'Failed to retrieve draft templates', message: error.message });
  }
});

/**
 * GET /drafts/count
 * Count the number of draft templates in a given namespace.
 * Any user with membership can do this (readonly or above).
 */
router.get('/drafts/count', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const namespaceId = req.query.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }

    const permission = await getUserPermission(namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to count draft templates in this namespace' });
    }

    const snapshot = await db.collection('draftTemplates')
      .where('namespaceId', '==', namespaceId)
      .get();

    return res.status(200).json({ count: snapshot.size });
  } catch (error) {
    console.error('[ERROR] Error counting draft templates:', error);
    return res.status(500).json({ error: 'Failed to count draft templates', message: error.message });
  }
});

/**
 * GET /drafts/:id
 * Retrieve a specific draft template by ID. 
 * Any user with membership can read.
 */
router.get('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const draftId = req.params.id;
    const draftRef = db.collection('draftTemplates').doc(draftId);

    const doc = await draftRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }
    const draftData = doc.data();

    // Check that user has membership in that namespace
    const permission = await getUserPermission(draftData.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Insufficient permissions to read this draft template' });
    }

    return res.status(200).json({ id: doc.id, ...draftData });
  } catch (error) {
    console.error('[ERROR] Error retrieving draft template:', error);
    return res.status(500).json({ error: 'Failed to retrieve draft template', message: error.message });
  }
});

/**
 * PUT /drafts/:id
 * Update a specific draft template.
 * Requires "read/write" or "admin".
 * The namespaceId cannot be updated.
 */
router.put('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const draftId = req.params.id;
    const draftRef = db.collection('draftTemplates').doc(draftId);

    const docSnapshot = await draftRef.get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }
    const draftData = docSnapshot.data();

    // Check permission
    const permission = await getUserPermission(draftData.namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions to update this draft template' });
    }

    // Prevent updating the namespaceId
    const { namespaceId, ...updateFields } = req.body;
    updateFields.lastUpdatedBy = userId;
    updateFields.dateModified = admin.firestore.FieldValue.serverTimestamp();

    await draftRef.update(updateFields);

    // Log update
    await logActivity(userId, 'draft_template_updated', `Updated draft template: ${updateFields.name || draftData.name}`, draftData.namespaceId, { draftTemplateId: draftId });

    const updatedDoc = await draftRef.get();
    return res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error updating draft template:', error);
    return res.status(500).json({ error: 'Failed to update draft template', message: error.message });
  }
});

/**
 * DELETE /drafts/:id
 * Delete a specific draft template.
 * Requires "admin" permission in that namespace.
 */
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const draftId = req.params.id;
    const draftRef = db.collection('draftTemplates').doc(draftId);

    const docSnapshot = await draftRef.get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: 'Draft template not found' });
    }

    const draftData = docSnapshot.data();
    const permission = await getUserPermission(draftData.namespaceId, userEmail);
    if (permission !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions to delete this draft template. Admin access required.' });
    }

    await draftRef.delete();

    // Log deletion
    await logActivity(userId, 'draft_template_deleted', `Deleted draft template: ${draftData.name}`, draftData.namespaceId, { draftTemplateId: draftId });

    return res.status(200).json({ message: 'Draft template deleted successfully' });
  } catch (error) {
    console.error('[ERROR] Error deleting draft template:', error);
    return res.status(500).json({ error: 'Failed to delete draft template', message: error.message });
  }
});

module.exports = router;