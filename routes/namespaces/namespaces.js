/**
 * Namespaces API
 *
 * In this version, if an admin adds or modifies members with status="pending",
 * we create an invite doc for them in the "invites" collection.
 * 
 * Additionally, since Firestore cannot query directly on nested fields in an array of maps,
 * we provide a GET /namespaces/my endpoint that retrieves all namespaces and then filters them
 * in memory to return only those where the authenticated user's email is found in the members array with status "active".
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
 * Helper: getUserDocument
 */
async function getUserDocument(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  return userDoc.data();
}

/**
 * Helper: getUserEmail
 */
function getUserEmail(userData) {
  return userData && userData.email ? userData.email.toLowerCase() : null;
}

/**
 * Helper: isUserAdmin
 */
async function isUserAdmin(namespaceId, userEmail) {
  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return false;
  const nsData = nsDoc.data();
  if (!nsData.members) return false;
  const member = nsData.members.find(m =>
    m.email.toLowerCase() === userEmail && m.status === 'active'
  );
  return member && member.permission === Permissions.ADMIN;
}

/**
 * Helper: createInviteDoc
 * Creates an invite in the "invites" collection with status="pending".
 */
async function createInviteDoc({ invitedUserEmail, namespaceId, permission, createdBy }) {
  const inviteData = {
    invitedUserEmail: invitedUserEmail.toLowerCase(),
    namespaceId,
    permission,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy
  };
  return db.collection('invites').add(inviteData);
}

/**
 * POST /namespaces
 * Create a new namespace.
 * If any members have status="pending", we create invites for them as well.
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description, accountId, members } = req.body;
    const userId = req.user.uid; // The user creating the namespace
    if (!name || !accountId) {
      return res.status(400).json({ error: 'Name and accountId are required.' });
    }

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
      // Note: We're not storing a separate "memberEmails" array here.
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Create the namespace
    const docRef = await db.collection('namespaces').add(namespaceData);
    const createdDoc = await docRef.get();

    // Create invites for any newly added pending members
    for (const m of validatedMembers) {
      if (m.status === 'pending') {
        await createInviteDoc({
          invitedUserEmail: m.email,
          namespaceId: docRef.id,
          permission: m.permission,
          createdBy: userId
        });
      }
    }

    res.status(201).json({ id: createdDoc.id, ...createdDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error creating namespace:', error);
    res.status(500).json({ error: 'Failed to create namespace', message: error.message });
  }
});

/**
 * GET /namespaces/my
 * Retrieve all namespaces that the currently authenticated user belongs to.
 * This route retrieves all namespaces and then filters in memory based on membership.
 */
router.get('/my', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    const snapshot = await db.collection('namespaces').get();
    const namespaces = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(ns => {
        if (!ns.members || !Array.isArray(ns.members)) return false;
        // Check if at least one member has matching email and active status
        return ns.members.some(member => member.email.toLowerCase() === userEmail && member.status === 'active');
      });
    res.status(200).json(namespaces);
  } catch (error) {
    console.error('[ERROR] Error fetching user namespaces:', error);
    res.status(500).json({ error: 'Failed to fetch namespaces', message: error.message });
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
 * Only admin can update. If new members are added with status="pending",
 * create invites for them in the "invites" collection.
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.params.id;
    const namespaceRef = db.collection('namespaces').doc(namespaceId);
    const namespaceDoc = await namespaceRef.get();
    if (!namespaceDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }

    // Only admin can update
    const userId = req.user.uid;
    const userData = await getUserDocument(userId);
    if (!userData) {
      return res.status(403).json({ error: 'User document not found' });
    }
    const userEmail = getUserEmail(userData);
    const adminCheck = await isUserAdmin(namespaceId, userEmail);
    if (!adminCheck) {
      return res.status(403).json({ error: 'Only admins can update a namespace' });
    }

    const nsData = namespaceDoc.data();
    const existingMembers = nsData.members || [];

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update name, description if provided
    if (req.body.name !== undefined) {
      updateData.name = req.body.name;
    }
    if (req.body.description !== undefined) {
      updateData.description = req.body.description;
    }

    // If the "members" array is provided, handle membership and invites.
    if (req.body.members !== undefined && Array.isArray(req.body.members)) {
      const newMembers = req.body.members.map(member => ({
        email: member.email,
        permission: Object.values(Permissions).includes(member.permission)
          ? member.permission
          : Permissions.READONLY,
        status: Object.values(Statuses).includes(member.status)
          ? member.status
          : Statuses.PENDING
      }));

      // Build a map for old members by email
      const oldMembersByEmail = {};
      for (const m of existingMembers) {
        oldMembersByEmail[m.email.toLowerCase()] = m;
      }

      updateData.members = newMembers;
      // Optionally, update a flat array of member emails if desired:
      // updateData.memberEmails = newMembers.map(m => m.email.toLowerCase());

      // Identify new pending invites
      for (const newMember of newMembers) {
        const lowerEmail = newMember.email.toLowerCase();
        const oldMember = oldMembersByEmail[lowerEmail];
        if (newMember.status === 'pending') {
          const wasNotInOld = !oldMember;
          const wasInactive = (oldMember && oldMember.status !== 'pending');
          if (wasNotInOld || wasInactive) {
            await createInviteDoc({
              invitedUserEmail: newMember.email,
              namespaceId,
              permission: newMember.permission,
              createdBy: userId
            });
          }
        }
      }
    }

    await namespaceRef.update(updateData);
    const updatedDoc = await namespaceRef.get();
    res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('[ERROR] Error updating namespace:', error);
    res.status(500).json({ error: 'Failed to update namespace', message: error.message });
  }
});

/**
 * DELETE /namespaces/:id
 * Only admins can delete a namespace. Also forbids deleting one's own default namespace.
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const namespaceId = req.params.id;
    const namespaceRef = db.collection('namespaces').doc(namespaceId);
    const namespaceDoc = await namespaceRef.get();
    if (!namespaceDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found' });
    }

    // Check if user is admin
    const userId = req.user.uid;
    const userData = await getUserDocument(userId);
    if (!userData) {
      return res.status(403).json({ error: 'User document not found' });
    }
    const userEmail = getUserEmail(userData);
    const adminCheck = await isUserAdmin(namespaceId, userEmail);
    if (!adminCheck) {
      return res.status(403).json({ error: 'Only admins can delete this namespace' });
    }

    // Prevent deleting your default namespace
    if (userData.defaultNamespace === namespaceId) {
      return res.status(403).json({ error: 'Cannot delete your default namespace' });
    }

    await namespaceRef.delete();
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