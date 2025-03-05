// alerts.js
const express = require('express');
const admin = require('../firebase'); // Your Firebase Admin instance
const { verifyToken } = require('../middleware'); // Your token verification middleware

const router = express.Router();
const db = admin.firestore();

// GET /alerts
// Retrieve up to 10 alerts for the authenticated user, prioritizing unread alerts first,
// followed by read alerts, both sorted by createdAt descending
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const maxAlerts = 10;
    console.log(`[DEBUG] Fetching alerts for userId: ${userId}`);

    // Step 1: Fetch unread alerts, sorted by createdAt descending
    console.log('[DEBUG] Querying unread alerts...');
    const unreadQuery = db
      .collection('alerts')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(maxAlerts);
    const unreadSnapshot = await unreadQuery.get();
    console.log(`[DEBUG] Unread alerts snapshot size: ${unreadSnapshot.size}`);
    const unreadAlerts = unreadSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`[DEBUG] Unread alerts count: ${unreadAlerts.length}`);

    // Step 2: If we have fewer than 10 unread alerts, fetch read alerts to fill the rest
    let allAlerts = [...unreadAlerts];
    const remainingSlots = maxAlerts - unreadAlerts.length;
    console.log(`[DEBUG] Remaining slots for read alerts: ${remainingSlots}`);

    if (remainingSlots > 0) {
      console.log('[DEBUG] Querying read alerts...');
      const readQuery = db
        .collection('alerts')
        .where('userId', '==', userId)
        .where('read', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(remainingSlots);
      const readSnapshot = await readQuery.get();
      console.log(`[DEBUG] Read alerts snapshot size: ${readSnapshot.size}`);
      const readAlerts = readSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`[DEBUG] Read alerts count: ${readAlerts.length}`);

      // Step 3: Combine unread and read alerts
      allAlerts = [...unreadAlerts, ...readAlerts];
    }

    // Step 4: Return the combined list (up to 10 alerts)
    console.log(`[DEBUG] Total alerts to return: ${allAlerts.length}`);
    res.status(200).json(allAlerts);
  } catch (error) {
    console.error('[ERROR] Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts', message: error.message });
  }
});

// PATCH /alerts/mark-read
// Mark all alerts for the authenticated user as read
router.patch('/mark-read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[DEBUG] Marking alerts as read for userId: ${userId}`);

    const alertsQuery = db
      .collection('alerts')
      .where('userId', '==', userId)
      .where('read', '==', false);

    const snapshot = await alertsQuery.get();
    console.log(`[DEBUG] Unread alerts to mark as read: ${snapshot.size}`);

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { read: true });
    });

    await batch.commit();
    console.log('[DEBUG] Batch commit successful');
    res.status(200).json({ message: 'All alerts marked as read' });
  } catch (error) {
    console.error('[ERROR] Error marking alerts as read:', error);
    res.status(500).json({ error: 'Failed to mark alerts as read', message: error.message });
  }
});

module.exports = router;