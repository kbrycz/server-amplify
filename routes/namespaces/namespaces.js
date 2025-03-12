/**
 * Namespaces API
 *
 * A namespace has the following structure:
 * {
 *   name: string,
 *   description: string,
 *   accountId: string,
 *   members: [
 *     {
 *       email: string,
 *       permission: "read/write" | "readonly" | "admin",
 *       status: "pending" | "active"
 *     }
 *   ],
 *   createdAt: timestamp,
 *   updatedAt: timestamp
 * }
 *
 * Endpoints:
 *   POST /namespaces               - Create a new namespace.
 *   GET /namespaces/:id            - Get a specific namespace by ID.
 *   PUT /namespaces/:id            - Update a specific namespace.
 *   DELETE /namespaces/:id         - Delete a specific namespace.
 *   GET /namespaces/account/:accountId - Get all namespaces for a given account ID.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();
const db = admin.firestore();

// Define enums for permissions and statuses
const Permissions = Object.freeze({
  READ_WRITE: 'read/write',
  READONLY: 'readonly',
  ADMIN: 'admin'
});

const Statuses = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active'
});

/**
 * POST /namespaces
 * Create a new namespace.
 * Expected body:
 * {
 *   name: string,
 *   description: string,
 *   accountId: string,
 *   members: [
 *     {
 *       email: string,
 *       permission: string, // one of: "read/write", "readonly", "admin"
 *       status: string      // one of: "pending", "active"
 *     },
 *     ...
 *   ]
 * }
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description, accountId, members } = req.body;
    if (!name || !accountId) {
      return res.status(400).json({ error: 'Name and accountId are required.' });
    }

    // Validate members array if provided
    let validatedMembers = [];
    if (Array.isArray(members)) {
      validatedMembers = members.map(member => ({
        email: member.email,
        permission: Object.values(Permissions).includes(member.permission)
          ? member.permission
          : Permissions.READONLY,
        status: Object.values(Statuses).includes(member.status)
          ? member.status
          : Statuses.PENDING
      }));
    }

    const namespaceData = {
      name,
      description: description || '',
      accountId,
      members: validatedMembers,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('namespaces').add(namespaceData);
    const createdDoc = await docRef.get();
    res.status(201).json({ id: createdDoc.id, ...createdDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error creating namespace:', error);
    res.status(500).json({ error: 'Failed to create namespace', message: error.message });
  }
});

/**
 * GET /namespaces/:id
 * Retrieve a specific namespace by its ID.
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.params.id;
    const docRef = db.collection('namespaces').doc(namespaceId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('[ERROR] Error fetching namespace:', error);
    res.status(500).json({ error: 'Failed to fetch namespace', message: error.message });
  }
});

/**
 * PUT /namespaces/:id
 * Update a specific namespace.
 * Acceptable fields for update: name, description, members.
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.params.id;
    const docRef = db.collection('namespaces').doc(namespaceId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (req.body.name !== undefined) {
      updateData.name = req.body.name;
    }
    if (req.body.description !== undefined) {
      updateData.description = req.body.description;
    }
    if (req.body.members !== undefined && Array.isArray(req.body.members)) {
      updateData.members = req.body.members.map(member => ({
        email: member.email,
        permission: Object.values(Permissions).includes(member.permission)
          ? member.permission
          : Permissions.READONLY,
        status: Object.values(Statuses).includes(member.status)
          ? member.status
          : Statuses.PENDING
      }));
    }

    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error updating namespace:', error);
    res.status(500).json({ error: 'Failed to update namespace', message: error.message });
  }
});

/**
 * DELETE /namespaces/:id
 * Delete a specific namespace by its ID.
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.params.id;
    const docRef = db.collection('namespaces').doc(namespaceId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }
    await docRef.delete();
    res.status(200).json({ message: 'Namespace deleted successfully' });
  } catch (error) {
    console.error('[ERROR] Error deleting namespace:', error);
    res.status(500).json({ error: 'Failed to delete namespace', message: error.message });
  }
});

/**
 * GET /namespaces/account/:accountId
 * Retrieve all namespaces for a given accountId.
 */
router.get('/account/:accountId', verifyToken, async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const snapshot = await db.collection('namespaces')
      .where('accountId', '==', accountId)
      .orderBy('createdAt', 'desc')
      .get();
    const namespaces = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(namespaces);
  } catch (error) {
    console.error('[ERROR] Error fetching namespaces for account:', error);
    res.status(500).json({ error: 'Failed to fetch namespaces', message: error.message });
  }
});

module.exports = router;