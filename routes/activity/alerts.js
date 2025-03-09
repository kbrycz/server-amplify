/**
 * Alerts API
 *
 * This module handles the retrieval and updating of alerts for an authenticated user.
 *
 * Endpoints:
 *   GET /alerts
 *     - Retrieves up to 10 alerts for the authenticated user.
 *     - Unread alerts are prioritized; if fewer than 10 unread alerts are found,
 *       read alerts are appended to reach up to 10 total alerts.
 *
 *   PATCH /alerts/mark-read
 *     - Marks all unread alerts for the authenticated user as read.
 *
 * @example
 *   // Get alerts:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/alerts
 *
 *   // Mark alerts as read:
 *   curl -X PATCH -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/alerts/mark-read
 */

const express = require('express');
const admin = require('../../config/firebase'); // Firebase Admin instance
const { verifyToken } = require('../../config/middleware'); // Token verification middleware

const router = express.Router();
const db = admin.firestore();

/**
 * GET /alerts
 * Retrieves up to 10 alerts for the authenticated user. Unread alerts are prioritized,
 * followed by read alerts if needed.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const maxAlerts = 10;
    console.log(`[INFO] Retrieving alerts for user: ${userId}`);

    // Step 1: Fetch unread alerts
    const unreadQuery = db.collection('alerts')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(maxAlerts);
    const unreadSnapshot = await unreadQuery.get();
    const unreadAlerts = unreadSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`[DEBUG] Found ${unreadAlerts.length} unread alerts`);

    // Step 2: If unread alerts are fewer than maxAlerts, fetch additional read alerts
    let allAlerts = [...unreadAlerts];
    const remainingSlots = maxAlerts - unreadAlerts.length;
    if (remainingSlots > 0) {
      const readQuery = db.collection('alerts')
        .where('userId', '==', userId)
        .where('read', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(remainingSlots);
      const readSnapshot = await readQuery.get();
      const readAlerts = readSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`[DEBUG] Found ${readAlerts.length} read alerts to fill remaining slots`);
      allAlerts = allAlerts.concat(readAlerts);
    }

    console.log(`[INFO] Returning total ${allAlerts.length} alerts for user: ${userId}`);
    return res.status(200).json(allAlerts);
  } catch (error) {
    console.error('[ERROR] Failed to fetch alerts:', error);
    return res.status(500).json({ error: 'Failed to fetch alerts', message: error.message });
  }
});

/**
 * PATCH /alerts/mark-read
 * Marks all unread alerts for the authenticated user as read.
 */
router.patch('/mark-read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[INFO] Marking alerts as read for user: ${userId}`);

    const alertsQuery = db.collection('alerts')
      .where('userId', '==', userId)
      .where('read', '==', false);
    const snapshot = await alertsQuery.get();
    console.log(`[DEBUG] Found ${snapshot.size} unread alerts to update`);

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, { read: true });
    });

    await batch.commit();
    console.log('[INFO] Successfully marked alerts as read');
    return res.status(200).json({ message: 'All alerts marked as read' });
  } catch (error) {
    console.error('[ERROR] Failed to mark alerts as read:', error);
    return res.status(500).json({ error: 'Failed to mark alerts as read', message: error.message });
  }
});

module.exports = router;