/**
 * Invites API
 *
 * This module handles "namespace invites" – a user can be invited to join a namespace,
 * creating a doc in the "invites" collection with status = "pending".
 *
 * Endpoints:
 *   GET  /invites
 *     - Returns all invites for the currently logged-in user (where invitedUserEmail = my email),
 *       including the namespace's name and description.
 *   POST /invites/accept
 *     - Accept an invite, sets the member's status in the namespace from "pending" to "active"
 *       and deletes the invite doc.
 *   POST /invites/decline
 *     - Decline an invite, removes that member from the namespace entirely, then deletes the invite doc.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();
const db = admin.firestore();

/**
 * GET /invites
 * Lists all pending invites for the currently authenticated user by their email.
 * Also includes namespace name and description in the response.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();
    // Query invites where invitedUserEmail == userEmail and status == "pending"
    const snapshot = await db.collection('invites')
      .where('invitedUserEmail', '==', userEmail)
      .where('status', '==', 'pending')
      .get();
    
    const invites = [];
    for (const doc of snapshot.docs) {
      const inviteData = doc.data();

      // Fetch the namespace to retrieve name and description
      let namespaceName = '';
      let namespaceDescription = '';
      if (inviteData.namespaceId) {
        const nsDoc = await db.collection('namespaces').doc(inviteData.namespaceId).get();
        if (nsDoc.exists) {
          const nsData = nsDoc.data();
          namespaceName = nsData.name || '';
          namespaceDescription = nsData.description || '';
        }
      }

      invites.push({
        id: doc.id,
        ...inviteData,
        namespaceName,
        namespaceDescription
      });
    }

    return res.status(200).json(invites);
  } catch (error) {
    console.error('[ERROR] Failed to fetch invites:', error);
    return res.status(500).json({ error: 'Failed to fetch invites', message: error.message });
  }
});

/**
 * POST /invites/accept
 * Body: { inviteId: string }
 * Accepts an invite by:
 *   1. Finding the invite doc (ensure it matches the current user’s email).
 *   2. Updating the namespace’s members array to set that member from "pending" to "active".
 *   3. Deleting the invite doc.
 */
router.post('/accept', verifyToken, async (req, res) => {
  try {
    const { inviteId } = req.body;
    if (!inviteId) {
      return res.status(400).json({ error: 'inviteId is required' });
    }

    const userEmail = req.user.email.toLowerCase();
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    const inviteData = inviteDoc.data();
    
    if (inviteData.invitedUserEmail.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'Forbidden: This invite is not for your email' });
    }
    if (inviteData.status !== 'pending') {
      return res.status(400).json({ error: 'Invite is not in pending status' });
    }

    // Update the namespace’s members array
    const nsRef = db.collection('namespaces').doc(inviteData.namespaceId);
    const nsDoc = await nsRef.get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found for this invite' });
    }
    const nsData = nsDoc.data();
    
    // Find the member in nsData.members that has inviteData.invitedUserEmail
    const members = nsData.members || [];
    let updated = false;
    const updatedMembers = members.map(m => {
      if (m.email.toLowerCase() === userEmail) {
        // set status = "active" if it was "pending"
        if (m.status === 'pending') {
          m.status = 'active';
          updated = true;
        }
      }
      return m;
    });
    
    if (!updated) {
      // Possibly means the user was not found or was already active
      return res.status(400).json({ error: 'No pending membership found in the namespace' });
    }
    
    // Save updated namespace
    await nsRef.update({ members: updatedMembers, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Delete the invite doc
    await inviteRef.delete();

    return res.status(200).json({ message: 'Invite accepted successfully, membership activated' });
  } catch (error) {
    console.error('[ERROR] Failed to accept invite:', error);
    return res.status(500).json({ error: 'Failed to accept invite', message: error.message });
  }
});

/**
 * POST /invites/decline
 * Body: { inviteId: string }
 * Declines an invite by:
 *   1. Finding the invite doc (ensure it’s for the current user).
 *   2. Removing that member from the namespace entirely.
 *   3. Deleting the invite doc.
 */
router.post('/decline', verifyToken, async (req, res) => {
  try {
    const { inviteId } = req.body;
    if (!inviteId) {
      return res.status(400).json({ error: 'inviteId is required' });
    }

    const userEmail = req.user.email.toLowerCase();
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    const inviteData = inviteDoc.data();

    if (inviteData.invitedUserEmail.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'Forbidden: This invite is not for your email' });
    }
    if (inviteData.status !== 'pending') {
      return res.status(400).json({ error: 'Invite is not pending; cannot decline' });
    }

    // Remove user from the namespace membership
    const nsRef = db.collection('namespaces').doc(inviteData.namespaceId);
    const nsDoc = await nsRef.get();
    if (!nsDoc.exists) {
      return res.status(404).json({ error: 'Namespace not found for this invite' });
    }
    const nsData = nsDoc.data();
    const members = nsData.members || [];
    const filteredMembers = members.filter(m => m.email.toLowerCase() !== userEmail);
    // Save updated membership
    await nsRef.update({ members: filteredMembers, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Delete the invite
    await inviteRef.delete();

    return res.status(200).json({ message: 'Invite declined successfully, removed from namespace membership' });
  } catch (error) {
    console.error('[ERROR] Failed to decline invite:', error);
    return res.status(500).json({ error: 'Failed to decline invite', message: error.message });
  }
});

module.exports = router;